import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAligner } from "./align.ts";
import {
  loadSources,
  enumeratePairs,
  makeCharacterReadings,
  makeWordReadings,
  makeIrregularWordReadings,
} from "./sources.ts";
import {
  boundaries,
  combineAlignments,
  pairKey,
  recordKey,
  segmentReading,
  segmentText,
  validateAlignment,
} from "./segments.ts";
import { isSilentPunctuation, splitGraphemes } from "./kana.ts";
import { chunkNumerals } from "./numeral-chunks.ts";
import {
  deriveOmittedParticles,
  deriveVariantAlignments,
  joinOmittedParticles,
  omittedParticleSites,
} from "./variants.ts";
import { deriveContinuativeReadings } from "./morphology.ts";
import { deriveWeakReadings, refineAlignment } from "./weak-readings.ts";
import { deriveNumeralAlignments, deriveNumeralReadings } from "./numerals.ts";
import { deriveReadingVariantAlignments } from "./reading-variants.ts";
import { deriveAtejiAlignments } from "./ateji.ts";
import { deriveLoanAlignments } from "./loan-readings.ts";
import { deriveUnihanAlignments, parseUnihanReadings } from "./unihan.ts";
import { deriveCharacterBundleAlignments } from "./character-readings.ts";
import { compileLexicalEvidence, refineWithLexicalEvidence } from "./lexical-evidence.ts";
import { deriveListedPhonologyAlignments } from "./listed-phonology.ts";
import { deriveKoreanAlignments } from "./korean-readings.ts";
import { deriveOnReadingSpellingAlignments } from "./on-reading-spelling.ts";
import { deriveSharedRunAlignments } from "./shared-run-alignments.ts";
import type { AtejiWitness } from "./ateji.ts";
import type { CharacterBundleWitness, CharacterReadingBundle } from "./character-readings.ts";
import type { KoreanWitness } from "./korean-readings.ts";
import type { CompiledLexicalFact, LexicalFact } from "./lexical-evidence.ts";
import type { ListedPhonologyWitness } from "./listed-phonology.ts";
import type { LoanWitness } from "./loan-readings.ts";
import type { NumeralAlignmentWitness, NumeralReadingWitness } from "./numerals.ts";
import type { OnReadingSpellingWitness } from "./on-reading-spelling.ts";
import type { ReadingVariantWitness } from "./reading-variants.ts";
import type { SharedRunWitness } from "./shared-run-alignments.ts";
import type { SourceLock } from "./sources.ts";
import type { UnihanWitness } from "./unihan.ts";
import type { OmittedParticles, VariantAlignments, VariantTransfer } from "./variants.ts";
import type { WeakReadingWitness, WeakReadings } from "./weak-readings.ts";
import type {
  Aligner,
  Alignment,
  Evidence,
  JMdict,
  Kanjidic2,
  Pair,
  PassResult,
  ReadingMap,
  Segment,
  SourceIdentity,
  WordAlignments,
} from "./types.ts";

export const schemaVersion = 1;
export const defaultConfiguration = {
  terminalContraction: true,
  phonologicalAlternations: true,
  compoundVoicing: true,
  variantTransfers: true,
  continuativeStems: true,
  weakReadings: true,
  kanaSubstitutions: true,
  numeralTransfers: true,
  readingVariants: true,
  hanSubstitutions: true,
  kanaRunCorrespondence: true,
  internalKanaAnchors: true,
  dictionaryUnvoicing: true,
  phoneticAteji: true,
  dictionaryRenjo: true,
  counterSymbols: true,
  latinSubstitutions: true,
  loanReadings: true,
  untaggedKatakanaLoans: true,
  dictionaryNasalLoss: true,
  dictionaryInitialVoicing: true,
  unihanReadings: true,
  foreignNumerals: true,
  unihanVoicing: true,
  unihanYoon: true,
  listedCharacterReadings: true,
  reviewedLexicalEvidence: true,
  unihanOnLengthening: true,
  englishCharacterReadings: true,
  listedPhonology: true,
  koreanReadings: true,
  untaggedKatakanaKorean: true,
  onReadingSpelling: true,
  sharedRunTransfers: true,
  lateSiblingTransfers: true,
};

export type Configuration = typeof defaultConfiguration;

/** Switches to change from their defaults. An undefined one keeps its default. */
export type PipelineOptions = Partial<Configuration>;

/** A reviewed alignment for one exact JMdict pair, from `data/annotations.json`. */
export interface Annotation {
  id: string;
  spelling: string;
  reading: string;
  segments: Segment[];
  reason: string;
  sources: string[];
}

/** The evidence beyond JMdict and KANJIDIC2 that a pipeline can draw on. */
export interface PipelineSources {
  unihanReadings?: ReadingMap;
  unihanSource?: SourceIdentity;
  /** Japanese Wiktionary's character readings. */
  characterReadingBundle?: CharacterReadingBundle;
  /** English Wiktionary's character readings. */
  englishCharacterReadingBundle?: CharacterReadingBundle;
  /** The reviewed facts of `data/lexical-evidence.json`. */
  lexicalEvidence?: LexicalFact[];
  kanjidicSource?: SourceIdentity;
  jmdictSource?: SourceIdentity;
}

/** A late pass's witness, with the paths that produced it when reviewed facts make two of them. */
export type LateWitness<Witness> = Witness & { lexicalContexts?: string[] };

/** The finished aligner, and each pass's record of what it established. */
export interface AlignmentPipeline {
  configuration: Configuration;
  variantTransfers: VariantTransfer[];
  supplementaryVariants: VariantTransfer[];
  weakReadings: WeakReadingWitness[];
  numeralTransfers: NumeralAlignmentWitness[];
  numeralReadings: NumeralReadingWitness[];
  readingVariants: ReadingVariantWitness[];
  phoneticAteji: AtejiWitness[];
  loanReadings: LoanWitness[];
  unihanReadings: UnihanWitness[];
  listedCharacterReadings: CharacterBundleWitness[];
  lexicalEvidence: CompiledLexicalFact[];
  unihanOnLengthening: LateWitness<UnihanWitness>[];
  englishCharacterReadings: LateWitness<CharacterBundleWitness>[];
  listedPhonology: LateWitness<ListedPhonologyWitness>[];
  koreanReadings: LateWitness<KoreanWitness>[];
  onReadingSpelling: LateWitness<OnReadingSpellingWitness>[];
  sharedRunTransfers: SharedRunWitness[];
  omittedParticles: OmittedParticles | undefined;
  align: Aligner;
}

/** A pipeline with the pinned sources it was compiled from and the reviewed annotations. */
export interface Dataset extends AlignmentPipeline {
  jmdict: JMdict;
  kanjidic: Kanjidic2;
  lock: SourceLock;
  annotations: Map<string, Annotation>;
  annotationsSHA256: string;
  pairs: () => Generator<Pair, void, undefined>;
  /** Align a pair as the release does: by its annotation if it has one, else by the pipeline. */
  alignPair(pair: Pick<Pair, "id" | "spelling" | "reading">): Alignment;
}

/** What an evaluation's result depends on, so that a stale one can be told apart. */
export interface EvaluationProvenance {
  generatorSHA256: string;
  sourcesSHA256: string;
  annotationsSHA256: string;
  configuration: Configuration;
  goldSHA256: string;
}

export function digest(contents: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function generatorDigest(): Promise<string> {
  const names = (await readdir(new URL("./", import.meta.url)))
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const inputs: (string | Buffer)[] = [];
  for (const name of names)
    inputs.push(name, "\0", await readFile(new URL(name, import.meta.url)), "\0");
  for (const name of ["build.ts", "lib/options.ts", "lib/evaluation.ts"]) {
    inputs.push(
      `scripts/${name}`,
      "\0",
      await readFile(new URL(`../scripts/${name}`, import.meta.url)),
    );
  }
  inputs.push(
    "data/lexical-evidence.json",
    "\0",
    await readFile(new URL("../data/lexical-evidence.json", import.meta.url)),
  );
  const synthesizedPairs = new URL("../data/synthesized-pairs.json", import.meta.url);
  inputs.push(
    "data/synthesized-pairs.json",
    "\0",
    await readFile(synthesizedPairs).catch(() => ""),
  );
  inputs.push(
    "data/mispaired-pairs.json",
    "\0",
    await readFile(new URL("../data/mispaired-pairs.json", import.meta.url)).catch(() => ""),
  );
  const hash = createHash("sha256");
  for (const input of inputs) hash.update(input);
  return hash.digest("hex");
}

export function compileAnnotations(annotations: Annotation[]): Map<string, Annotation> {
  const result = new Map<string, Annotation>();
  for (const annotation of annotations) {
    if (
      typeof annotation.id !== "string" ||
      !/^\d+$/u.test(annotation.id) ||
      typeof annotation.reason !== "string" ||
      !annotation.reason.trim() ||
      !Array.isArray(annotation.sources) ||
      !annotation.sources.length ||
      annotation.sources.some((source) => typeof source !== "string" || !source.trim())
    ) {
      throw new Error("Annotations require a string JMdict ID, rationale, and evidence sources");
    }
    validateAlignment(annotation.spelling, annotation.reading, annotation.segments);
    const key = recordKey(annotation.id, annotation.spelling, annotation.reading);
    if (result.has(key)) throw new Error(`Duplicate annotation: ${key}`);
    result.set(key, annotation);
  }
  return result;
}

export function compileAlignmentPipeline(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  options: PipelineOptions = {},
  sources: PipelineSources = {},
): AlignmentPipeline {
  const pipeline = compilePipeline(jmdict, kanjidic, options, sources);
  // These two steps work on a finished alignment, so they wrap the pipeline's result.
  return { ...pipeline, align: chunkNumerals(alignPastPunctuation(pipeline.align)) };
}

/**
 * Silent punctuation is not part of how a word divides, so the spelling and reading are also
 * aligned without it, and any boundaries that adds are kept. That lets Ｓ・Ｍ read エス・エム
 * divide as ＳＭ read エスエム does. The marks are put back afterwards: one that both sides have
 * at the same place becomes its own segment, a spelling's mark joins the segment before it,
 * which the release shows as plain text, and a reading's mark joins a neighboring ruby segment,
 * which makes the pair mispaired.
 *
 * A mark can also be read aloud, as the dot of Ｗｅｂ２．０ is ポイント, so each side's marks are
 * set aside separately as well as together.
 */
export function alignPastPunctuation(align: Aligner): Aligner {
  interface Stripped {
    kept: string[];
    marks: Map<number, string>;
  }
  // The text without its marks, and the marks that stood before each of its positions.
  function strip(text: string, enabled: boolean): Stripped {
    const kept: string[] = [],
      marks = new Map<number, string>();
    for (const unit of splitGraphemes(text)) {
      if (enabled && isSilentPunctuation(unit)) {
        marks.set(kept.length, (marks.get(kept.length) ?? "") + unit);
      } else kept.push(unit);
    }
    return { kept, marks };
  }
  function withoutMarks(
    spelling: string,
    reading: string,
    stripSpelling: boolean,
    stripReading: boolean,
  ): Segment[] | undefined {
    const base = strip(spelling, stripSpelling),
      ruby = strip(reading, stripReading);
    if (base.marks.size + ruby.marks.size === 0 || !base.kept.length || !ruby.kept.length) {
      return undefined;
    }
    const result = align(base.kept.join(""), ruby.kept.join(""));
    if (result.status !== "aligned") return undefined;
    const take = (side: Stripped, offset: number) => {
      const marks = side.marks.get(offset) ?? "";
      side.marks.delete(offset);
      return marks;
    };
    // Every segment is a pair here; a pair whose sides are equal becomes plain text at the end.
    const pairs: [string, string][] = [];
    const isRuby = (segment: Segment | undefined) =>
      segment !== undefined && typeof segment !== "string";
    let baseOffset = 0,
      rubyOffset = 0,
      basePrefix = "",
      rubyPrefix = "";
    // Place the marks that stand between the previous segment and the next one.
    const boundary = (next: Segment | undefined) => {
      const baseMarks = take(base, baseOffset),
        rubyMarks = take(ruby, rubyOffset);
      const previous = pairs.at(-1);
      if (baseMarks !== "" && baseMarks === rubyMarks) pairs.push([baseMarks, rubyMarks]);
      else {
        if (previous === undefined) basePrefix += baseMarks;
        else previous[0] += baseMarks;
        // A reading's mark prefers a ruby segment to plain kana.
        const previousIsRuby = previous !== undefined && previous[0] !== previous[1];
        if (previous !== undefined && (previousIsRuby || !isRuby(next))) previous[1] += rubyMarks;
        else rubyPrefix += rubyMarks;
      }
    };
    for (const segment of result.segments) {
      boundary(segment);
      const rebuild = (side: Stripped, offset: number, text: string) =>
        splitGraphemes(text)
          .map((unit, inner) => (inner > 0 ? take(side, offset + inner) : "") + unit)
          .join("");
      pairs.push([
        basePrefix + rebuild(base, baseOffset, segmentText(segment)),
        rubyPrefix + rebuild(ruby, rubyOffset, segmentReading(segment)),
      ]);
      basePrefix = rubyPrefix = "";
      baseOffset += splitGraphemes(segmentText(segment)).length;
      rubyOffset += splitGraphemes(segmentReading(segment)).length;
    }
    boundary(undefined);
    const segments = pairs.map(([text, sound]): Segment => (text === sound ? text : [text, sound]));
    try {
      validateAlignment(spelling, reading, segments);
    } catch {
      return undefined;
    }
    return segments;
  }
  // A reading's marks usually fall where a sibling spelling writes them, as 鱧も一期、海老も一期
  // does for 鱧も一期海老も一期. Writing them into the spelling at the boundaries where the
  // reading has them finds that sibling, whose alignment can rest on evidence for the exact
  // pair; its boundaries carry over once the added marks are taken out again.
  function throughPunctuatedSpelling(
    spelling: string,
    reading: string,
    segments: Segment[],
  ): Segment[] | undefined {
    const unwritten = (unit: string) => isSilentPunctuation(unit) && !spelling.includes(unit);
    const added = new Set<number>();
    let punctuated = "";
    for (const segment of segments) {
      const sounds = splitGraphemes(segmentReading(segment));
      let leading = 0,
        trailing = 0;
      while (leading < sounds.length && unwritten(sounds[leading])) ++leading;
      while (trailing < sounds.length - leading && unwritten(sounds.at(-1 - trailing)!)) ++trailing;
      const text = splitGraphemes(segmentText(segment));
      for (const [units, mark] of [
        [sounds.slice(0, leading), true],
        [text, false],
        [sounds.slice(sounds.length - trailing), true],
      ] as const) {
        for (const unit of units) {
          if (mark) added.add(splitGraphemes(punctuated).length);
          punctuated += unit;
        }
      }
    }
    if (added.size === 0) return undefined;
    const result = align(punctuated, reading);
    if (result.status !== "aligned") return undefined;
    interface Piece {
      text: string;
      sound: string | undefined;
    }
    // Cut each segment into its added marks and the text between them.
    const pieces: Piece[] = [];
    let offset = 0;
    for (const segment of result.segments) {
      const units = splitGraphemes(segmentText(segment));
      const plain = typeof segment === "string";
      let text = "";
      const flush = () => {
        if (text !== "") pieces.push({ text, sound: plain ? text : undefined });
        text = "";
      };
      for (const [index, unit] of units.entries()) {
        if (!added.has(offset + index)) text += unit;
        else if (plain) {
          flush();
          pieces.push({ text: "", sound: unit });
        }
      }
      offset += units.length;
      if (!plain) pieces.push({ text, sound: segmentReading(segment) });
      else flush();
    }
    // An added mark has only a sound, which goes to a ruby segment beside it if there is one.
    const pairs: [string, string][] = [];
    let prefix = "";
    for (const [index, piece] of pieces.entries()) {
      const isRuby = (other: Piece | undefined) =>
        other !== undefined && other.text !== "" && other.text !== other.sound;
      if (piece.text !== "") {
        pairs.push([piece.text, prefix + piece.sound]);
        prefix = "";
      } else if (pairs.length > 0 && (isRuby(pieces[index - 1]) || !isRuby(pieces[index + 1]))) {
        pairs.at(-1)![1] += piece.sound;
      } else prefix += piece.sound;
    }
    if (prefix !== "" && pairs.length > 0) pairs.at(-1)![1] += prefix;
    const projected = pairs.map(([text, sound]): Segment =>
      text === sound ? text : [text, sound],
    );
    try {
      validateAlignment(spelling, reading, projected);
    } catch {
      return undefined;
    }
    return projected;
  }
  return (spelling, reading) => {
    const direct = align(spelling, reading);
    // Marks that both sides share place themselves, so that alignment is the one to build on:
    // a direct alignment can misplace them, and then nothing else can be combined with it.
    const shared = withoutMarks(spelling, reading, true, true);
    // When both sides have the same marks, a boundary must leave the same marks on each side
    // of it. One that does not has matched a spelling's mark to nothing and put the reading's
    // into a neighbor's ruby.
    const marksOf = (text: string) => splitGraphemes(text).filter(isSilentPunctuation).join("");
    const marksAgree = marksOf(spelling) !== "" && marksOf(spelling) === marksOf(reading);
    const keepsMarksTogether = (candidate: Segment[]) => {
      if (!marksAgree) return true;
      let text = "",
        sound = "";
      return candidate.every((segment) => {
        text += segmentText(segment);
        sound += segmentReading(segment);
        return marksOf(text) === marksOf(sound);
      });
    };
    let segments = shared ?? direct.segments;
    const candidates = [
      direct.segments,
      withoutMarks(spelling, reading, false, true),
      withoutMarks(spelling, reading, true, false),
    ];
    for (const candidate of candidates) {
      if (candidate !== undefined && keepsMarksTogether(candidate)) {
        segments = combineAlignments(segments, candidate);
      }
    }
    const sibling = throughPunctuatedSpelling(spelling, reading, segments);
    if (sibling !== undefined) segments = combineAlignments(segments, sibling);
    if (JSON.stringify(segments) === JSON.stringify(direct.segments)) return direct;
    const known = new Map(
      direct.segments.map((segment, index) => [JSON.stringify(segment), direct.evidence?.[index]]),
    );
    return {
      ...direct,
      segments,
      evidence: segments.map(
        (segment) =>
          known.get(JSON.stringify(segment)) ?? {
            spelling: segmentText(segment),
            reading: segmentReading(segment),
            type: typeof segment === "string" ? "literal" : "dictionary",
            rules: ["punctuation-set-aside"],
          },
      ),
    };
  };
}

function cacheAligner(align: Aligner): Aligner {
  const cache = new Map<string, Alignment>();
  return (spelling, reading) => {
    const key = pairKey(spelling, reading);
    if (!cache.has(key)) cache.set(key, align(spelling, reading));
    return cache.get(key)!;
  };
}

/** A stretch of an alignment, by its offsets in the spelling and reading, and what supports it. */
interface SupportingSpan {
  spellingStart: number;
  readingStart: number;
  spellingEnd: number;
  readingEnd: number;
  evidence: Evidence;
}

function mergeLateAlignments(independent: Alignment, integrated: Alignment): Alignment {
  if (independent === integrated) return integrated;
  const independentPoints = new Set(boundaries(independent.segments));
  const integratedPoints = new Set(boundaries(integrated.segments));
  const shared = new Set([...integratedPoints].filter((point) => independentPoints.has(point)));
  function regions(parts: Segment[]): Segment[][] {
    const result: Segment[][] = [];
    let spellingOffset = 0,
      readingOffset = 0,
      start = 0;
    for (const [index, segment] of parts.entries()) {
      spellingOffset += splitGraphemes(segmentText(segment)).length;
      readingOffset += splitGraphemes(segmentReading(segment)).length;
      if (shared.has(`${spellingOffset}:${readingOffset}`) || index === parts.length - 1) {
        result.push(parts.slice(start, index + 1));
        start = index + 1;
      }
    }
    return result;
  }
  const independentRegions = regions(independent.segments);
  // Keep the lexical-integrated result on conflict within each region. A
  // disagreement cannot discard evidence beyond an agreed boundary anchor.
  const regionContexts: string[][] = [];
  const segments = regions(integrated.segments).flatMap((region, index) => {
    const candidate = independentRegions[index];
    const merged = combineAlignments(region, candidate);
    regionContexts.push(
      merged === region
        ? ["with-lexical-refinement"]
        : merged === candidate
          ? ["without-lexical-refinement"]
          : ["with-lexical-refinement", "without-lexical-refinement"],
    );
    return merged;
  });
  const points = boundaries(segments);
  if (
    points.length === integratedPoints.size &&
    points.every((point) => integratedPoints.has(point))
  )
    return integrated;
  if (
    points.length === independentPoints.size &&
    points.every((point) => independentPoints.has(point))
  )
    return independent;

  const supportingSpans: SupportingSpan[] = [];
  for (const [context, result] of [
    ["without-lexical-refinement", independent],
    ["with-lexical-refinement", integrated],
  ] as const) {
    let spellingOffset = 0,
      readingOffset = 0,
      regionIndex = 0;
    for (const [index, segment] of result.segments.entries()) {
      const spelling = segmentText(segment),
        reading = segmentReading(segment);
      const span = { spellingStart: spellingOffset, readingStart: readingOffset };
      spellingOffset += splitGraphemes(spelling).length;
      readingOffset += splitGraphemes(reading).length;
      if (regionContexts[regionIndex].includes(context))
        supportingSpans.push({
          ...span,
          spellingEnd: spellingOffset,
          readingEnd: readingOffset,
          evidence: {
            context,
            ...(result.evidence?.[index] ?? {
              spelling,
              reading,
              type: typeof segment === "string" ? "literal" : "dictionary",
              rules: [],
            }),
          },
        });
      if (shared.has(`${spellingOffset}:${readingOffset}`) || index === result.segments.length - 1)
        ++regionIndex;
    }
  }
  let spellingOffset = 0,
    readingOffset = 0;
  const evidence = segments.map((segment) => {
    const spelling = segmentText(segment),
      reading = segmentReading(segment);
    const spellingEnd = spellingOffset + splitGraphemes(spelling).length,
      readingEnd = readingOffset + splitGraphemes(reading).length;
    const supporting = supportingSpans
      .filter(
        (span) =>
          span.spellingStart <= spellingOffset &&
          spellingEnd <= span.spellingEnd &&
          span.readingStart <= readingOffset &&
          readingEnd <= span.readingEnd,
      )
      .map((span) => span.evidence);
    spellingOffset = spellingEnd;
    readingOffset = readingEnd;
    return {
      spelling,
      reading,
      type: typeof segment === "string" ? "literal" : "dictionary",
      rules: [
        ...new Set([
          ...supporting.flatMap((span) => span.rules ?? []),
          "independent-late-evidence-union",
        ]),
      ],
      supportingSpans: supporting,
    };
  });
  return { ...integrated, segments, evidence };
}

function mergeLateWitnesses<Witness extends object>(
  independent: Witness[],
  integrated: Witness[],
): LateWitness<Witness>[] {
  if (independent === integrated) return independent;
  const witnesses = new Map<string, Witness & { lexicalContexts: string[] }>();
  for (const [context, records] of [
    ["without-lexical-refinement", independent],
    ["with-lexical-refinement", integrated],
  ] as const) {
    for (const witness of records) {
      const key = JSON.stringify(witness);
      const record: Witness & { lexicalContexts: string[] } = witnesses.get(key) ?? {
        ...witness,
        lexicalContexts: [],
      };
      record.lexicalContexts.push(context);
      witnesses.set(key, record);
    }
  }
  return [...witnesses.values()];
}

function compilePipeline(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  options: PipelineOptions,
  {
    unihanReadings = new Map(),
    unihanSource,
    characterReadingBundle,
    englishCharacterReadingBundle,
    lexicalEvidence = [],
    kanjidicSource,
    jmdictSource,
  }: PipelineSources,
): AlignmentPipeline {
  const configuration = { ...defaultConfiguration };
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined) configuration[name as keyof Configuration] = value;
  }
  const facts = configuration.reviewedLexicalEvidence
    ? compileLexicalEvidence(lexicalEvidence)
    : [];
  const variantTargets: WordAlignments = new Map();
  for (const fact of facts) {
    const readings = variantTargets.get(fact.spelling) ?? new Map<string, Segment[]>();
    readings.set(fact.reading, fact.segments);
    variantTargets.set(fact.spelling, readings);
  }
  const characterReadings = makeCharacterReadings(kanjidic);
  const alignerOptions = {
    characterReadings,
    wordReadings: makeWordReadings(jmdict),
    irregularWordReadings: makeIrregularWordReadings(jmdict),
    continuativeReadings: configuration.continuativeStems
      ? deriveContinuativeReadings(jmdict).readings
      : new Map<string, string[]>(),
    ...configuration,
  };
  const baseline = createAligner(alignerOptions);
  const { wordAlignments, transfers }: VariantAlignments = configuration.variantTransfers
    ? deriveVariantAlignments(jmdict, baseline)
    : { wordAlignments: new Map(), transfers: [] };
  const strong = createAligner({ ...alignerOptions, wordAlignments });
  const weak: WeakReadings = configuration.weakReadings
    ? deriveWeakReadings(jmdict, kanjidic, characterReadings)
    : { readings: new Map(), witnesses: [] };
  const supplementaryOptions = { ...alignerOptions, weakCharacterReadings: weak.readings };
  const supplementaryBase = createAligner({ ...supplementaryOptions, wordAlignments });
  const supplementaryVariants: VariantAlignments = configuration.variantTransfers
    ? deriveVariantAlignments(jmdict, supplementaryBase, {
        kanaSubstitutions: configuration.kanaSubstitutions,
        hanSubstitutions: configuration.hanSubstitutions,
        counterSymbols: configuration.counterSymbols,
        latinSubstitutions: configuration.latinSubstitutions,
        characterReadings,
        continuativeReadings: alignerOptions.continuativeReadings,
      })
    : { wordAlignments: new Map(), transfers: [] };
  const supplementary = createAligner({
    ...supplementaryOptions,
    wordAlignments: supplementaryVariants.wordAlignments,
  });
  // Several evidence passes below query every JMdict pair through this fixed pipeline.
  const refined = cacheAligner((spelling, reading) =>
    refineAlignment(strong(spelling, reading), supplementary(spelling, reading)),
  );

  const numeralReadings = configuration.foreignNumerals
    ? deriveNumeralReadings(jmdict, alignerOptions.wordReadings)
    : undefined;
  const foreignAlign =
    numeralReadings === undefined
      ? undefined
      : createAligner({
          ...supplementaryOptions,
          wordReadings: numeralReadings.readings,
          wordAlignments: supplementaryVariants.wordAlignments,
        });
  const numerals: PassResult<NumeralAlignmentWitness> = configuration.numeralTransfers
    ? deriveNumeralAlignments(jmdict, refined, { foreignAlign })
    : { wordAlignments: new Map(), witnesses: [] };
  const readingVariants: PassResult<ReadingVariantWitness> = configuration.readingVariants
    ? deriveReadingVariantAlignments(jmdict, refined, { targetAlignments: variantTargets })
    : { wordAlignments: new Map(), witnesses: [] };
  const ateji: PassResult<AtejiWitness> = configuration.phoneticAteji
    ? deriveAtejiAlignments(jmdict, characterReadings, refined)
    : { wordAlignments: new Map(), witnesses: [] };
  const loans: PassResult<LoanWitness> = configuration.loanReadings
    ? deriveLoanAlignments(jmdict, kanjidic, refined, {
        untaggedKatakana: configuration.untaggedKatakanaLoans,
      })
    : { wordAlignments: new Map(), witnesses: [] };
  const unihan: PassResult<UnihanWitness> = configuration.unihanReadings
    ? deriveUnihanAlignments(jmdict, characterReadings, unihanReadings, refined, {
        weakCharacterReadings: weak.readings,
        supplementalVoicing: configuration.unihanVoicing,
        yoonSimplification: configuration.unihanYoon,
      })
    : { wordAlignments: new Map(), witnesses: [] };
  function withTransfers(initial: WordAlignments) {
    const merged = new Map(
      [...initial].map(([spelling, readings]) => [spelling, new Map(readings)]),
    );
    const wordAlignmentRules = new Map<string, Map<string, string[]>>();
    for (const [source, rule] of [
      [numerals.wordAlignments, "numeric-or-width-spelling"],
      [readingVariants.wordAlignments, "attested-reading-variant"],
      [ateji.wordAlignments, "phonetic-ateji"],
      [loans.wordAlignments, "attested-loan-sounds"],
      [unihan.wordAlignments, "unihan-character-evidence"],
    ] as const) {
      for (const [spelling, readings] of source) {
        const existing = merged.get(spelling) ?? new Map<string, Segment[]>();
        for (const [reading, segments] of readings) {
          const previous = existing.get(reading);
          const chosen = previous === undefined ? segments : combineAlignments(previous, segments);
          existing.set(reading, chosen);
          if (chosen !== previous) {
            const rules = wordAlignmentRules.get(spelling) ?? new Map<string, string[]>();
            rules.set(
              reading,
              chosen === segments
                ? [rule]
                : [...new Set([...(rules.get(reading) ?? ["alternate-spelling"]), rule])],
            );
            wordAlignmentRules.set(spelling, rules);
          }
        }
        merged.set(spelling, existing);
      }
    }
    return { wordAlignments: merged, wordAlignmentRules };
  }
  const finalStrong = createAligner({ ...alignerOptions, ...withTransfers(wordAlignments) });
  const finalSupplementary = createAligner({
    ...supplementaryOptions,
    ...withTransfers(supplementaryVariants.wordAlignments),
  });
  // Later evidence passes repeatedly query this fixed pipeline. Cache only
  // raw spelling/reading pairs so script-sensitive projections stay distinct.
  const baseCache = new Map<string, Alignment>();
  const alignBase: Aligner = (spelling, reading) => {
    const key = pairKey(spelling, reading);
    if (baseCache.has(key)) return baseCache.get(key)!;
    const previous = refined(spelling, reading);
    const candidate = refineAlignment(
      finalStrong(spelling, reading),
      finalSupplementary(spelling, reading),
    );
    // A transferred subword can compete with different character readings in
    // a longer input. Preserve the boundaries accepted before those transfers.
    const result = refineAlignment(previous, candidate);
    baseCache.set(key, result);
    return result;
  };
  const listed: PassResult<CharacterBundleWitness> =
    configuration.listedCharacterReadings && characterReadingBundle !== undefined
      ? deriveCharacterBundleAlignments(
          jmdict,
          characterReadings,
          characterReadingBundle,
          alignBase,
          {
            weakCharacterReadings: weak.readings,
            unihanReadings: configuration.unihanReadings
              ? unihanReadings
              : new Map<string, string[]>(),
          },
        )
      : { wordAlignments: new Map(), witnesses: [] };
  function applyRefinement(
    result: Alignment,
    segments: Segment[] | undefined,
    rule: string,
  ): Alignment {
    if (segments === undefined) return result;
    const previous = new Map<string, Evidence>();
    let spellingOffset = 0,
      readingOffset = 0;
    for (const [index, segment] of result.segments.entries()) {
      const spelling = segmentText(segment),
        reading = segmentReading(segment);
      const start = `${spellingOffset}:${readingOffset}`;
      spellingOffset += splitGraphemes(spelling).length;
      readingOffset += splitGraphemes(reading).length;
      previous.set(
        `${start}:${spellingOffset}:${readingOffset}`,
        result.evidence?.[index] ?? {
          spelling,
          reading,
          type: typeof segment === "string" ? "literal" : "dictionary",
          rules: [],
        },
      );
    }
    spellingOffset = 0;
    readingOffset = 0;
    return refineAlignment(result, {
      ...result,
      segments,
      evidence: segments.map((segment) => {
        const spelling = segmentText(segment),
          reading = segmentReading(segment);
        const start = `${spellingOffset}:${readingOffset}`;
        spellingOffset += splitGraphemes(spelling).length;
        readingOffset += splitGraphemes(reading).length;
        return (
          previous.get(`${start}:${spellingOffset}:${readingOffset}`) ?? {
            spelling,
            reading,
            type: typeof segment === "string" ? "literal" : "dictionary",
            rules: [rule],
          }
        );
      }),
    });
  }
  const alignListedCharacters =
    listed.wordAlignments.size === 0
      ? alignBase
      : cacheAligner((spelling, reading) =>
          applyRefinement(
            alignBase(spelling, reading),
            listed.wordAlignments.get(spelling)?.get(reading),
            "listed-character-evidence",
          ),
        );
  const alignReviewed =
    facts.length === 0
      ? alignListedCharacters
      : cacheAligner((spelling, reading) =>
          refineWithLexicalEvidence(alignListedCharacters(spelling, reading), facts),
        );
  const englishCompanions = new Map(
    [...(configuration.unihanReadings ? unihanReadings : new Map<string, string[]>())].map(
      ([character, readings]) => [character, [...readings]],
    ),
  );
  for (const { character, reading } of configuration.listedCharacterReadings
    ? (characterReadingBundle?.readings ?? [])
    : []) {
    const readings = englishCompanions.get(character) ?? [];
    if (!readings.includes(reading)) readings.push(reading);
    englishCompanions.set(character, readings);
  }
  function compileLateSequence(initialAlign: Aligner) {
    // These refinements use the complete earlier pipeline and remain local to
    // exact dictionary pairs. Their inferred sounds cannot enter subword transfers.
    const lengthened: PassResult<UnihanWitness> =
      configuration.unihanReadings && configuration.unihanOnLengthening
        ? deriveUnihanAlignments(jmdict, characterReadings, unihanReadings, initialAlign, {
            weakCharacterReadings: weak.readings,
            supplementalVoicing: configuration.unihanVoicing,
            yoonSimplification: configuration.unihanYoon,
            onLengthening: true,
          })
        : { wordAlignments: new Map(), witnesses: [] };
    const alignLengthened: Aligner = (spelling, reading) =>
      applyRefinement(
        initialAlign(spelling, reading),
        lengthened.wordAlignments.get(spelling)?.get(reading),
        "unihan-final-character-evidence",
      );
    const english: PassResult<CharacterBundleWitness> =
      configuration.englishCharacterReadings && englishCharacterReadingBundle !== undefined
        ? deriveCharacterBundleAlignments(
            jmdict,
            characterReadings,
            englishCharacterReadingBundle,
            alignLengthened,
            {
              weakCharacterReadings: weak.readings,
              unihanReadings: englishCompanions,
            },
          )
        : { wordAlignments: new Map(), witnesses: [] };
    const alignEnglish: Aligner = (spelling, reading) =>
      applyRefinement(
        alignLengthened(spelling, reading),
        english.wordAlignments.get(spelling)?.get(reading),
        "english-listed-character-evidence",
      );
    const listedPhonology: PassResult<ListedPhonologyWitness> = configuration.listedPhonology
      ? deriveListedPhonologyAlignments(jmdict, characterReadings, alignEnglish, {
          weakCharacterReadings: weak.readings,
          kanjidic,
          kanjidicSource,
          jmdictSource,
          weakWitnesses: weak.witnesses,
          lexicalFacts: facts,
          loanReadings: configuration.loanReadings,
          koreanReadings: configuration.koreanReadings,
          unihanReadings: configuration.unihanReadings
            ? unihanReadings
            : new Map<string, string[]>(),
          unihanSource: configuration.unihanReadings ? unihanSource : undefined,
          characterReadingBundle: configuration.listedCharacterReadings
            ? characterReadingBundle
            : undefined,
          englishCharacterReadingBundle: configuration.englishCharacterReadings
            ? englishCharacterReadingBundle
            : undefined,
          supplementalVoicing: configuration.unihanVoicing,
          yoonSimplification: configuration.unihanYoon,
          onLengthening: configuration.unihanOnLengthening,
        })
      : { wordAlignments: new Map(), witnesses: [] };
    const alignListed: Aligner = (spelling, reading) =>
      applyRefinement(
        alignEnglish(spelling, reading),
        listedPhonology.wordAlignments.get(spelling)?.get(reading),
        "listed-reading-sound-correspondence",
      );
    const korean: PassResult<KoreanWitness> = configuration.koreanReadings
      ? deriveKoreanAlignments(jmdict, kanjidic, alignListed, {
          untaggedKatakana: configuration.untaggedKatakanaKorean,
          kanjidicSource,
        })
      : { wordAlignments: new Map(), witnesses: [] };
    const alignKorean: Aligner = (spelling, reading) =>
      applyRefinement(
        alignListed(spelling, reading),
        korean.wordAlignments.get(spelling)?.get(reading),
        "listed-korean-sound-compatibility",
      );
    const onSpelling: PassResult<OnReadingSpellingWitness> = configuration.onReadingSpelling
      ? deriveOnReadingSpellingAlignments(jmdict, kanjidic, alignKorean, {
          characterReadingBundle: configuration.listedCharacterReadings
            ? characterReadingBundle
            : undefined,
          englishCharacterReadingBundle: configuration.englishCharacterReadings
            ? englishCharacterReadingBundle
            : undefined,
          kanjidicSource,
        })
      : { wordAlignments: new Map(), witnesses: [] };
    const align: Aligner = (spelling, reading) =>
      applyRefinement(
        alignKorean(spelling, reading),
        onSpelling.wordAlignments.get(spelling)?.get(reading),
        "on-long-vowel-notation-equivalence",
      );
    return { lengthened, english, listedPhonology, korean, onSpelling, align };
  }
  // Both paths share the expensive base, source inventories and the same
  // reviewed variant-transfer veto. A new coarse lexical cut must not remove
  // the witness that allowed another late pass to establish finer boundaries.
  const independentLate = compileLateSequence(alignListedCharacters);
  const integratedLate = facts.length === 0 ? independentLate : compileLateSequence(alignReviewed);
  const alignLate: Aligner =
    facts.length === 0
      ? independentLate.align
      : (spelling, reading) =>
          mergeLateAlignments(
            independentLate.align(spelling, reading),
            integratedLate.align(spelling, reading),
          );
  const sharedRuns: PassResult<SharedRunWitness> =
    configuration.variantTransfers && configuration.sharedRunTransfers
      ? deriveSharedRunAlignments(jmdict, kanjidic, alignLate, {
          reviewedFacts: facts,
          jmdictSource,
          kanjidicSource,
          rawAlignerOptions: {
            phonologicalAlternations: configuration.phonologicalAlternations,
            terminalContraction: configuration.terminalContraction,
            compoundVoicing: configuration.compoundVoicing,
            kanaRunCorrespondence: configuration.kanaRunCorrespondence,
            internalKanaAnchors: configuration.internalKanaAnchors,
          },
        })
      : { wordAlignments: new Map(), witnesses: [] };
  const alignSharedRuns: Aligner =
    sharedRuns.wordAlignments.size === 0
      ? alignLate
      : (spelling, reading) =>
          applyRefinement(
            alignLate(spelling, reading),
            sharedRuns.wordAlignments.get(spelling)?.get(reading),
            "same-entry-shared-run",
          );
  // The sibling passes ran before most evidence was in, so a split that a later stage established
  // never reached the entry's other spellings and readings. Run both once more over the result.
  const lateSiblings = configuration.variantTransfers && configuration.lateSiblingTransfers;
  const siblingBase = lateSiblings ? cacheAligner(alignSharedRuns) : alignSharedRuns;
  const siblingSpellings: VariantAlignments = lateSiblings
    ? deriveVariantAlignments(jmdict, siblingBase, {
        kanaSubstitutions: configuration.kanaSubstitutions,
        hanSubstitutions: configuration.hanSubstitutions,
        counterSymbols: configuration.counterSymbols,
        latinSubstitutions: configuration.latinSubstitutions,
        characterReadings,
        continuativeReadings: alignerOptions.continuativeReadings,
      })
    : { wordAlignments: new Map(), transfers: [] };
  const siblingReadings: PassResult<ReadingVariantWitness> =
    lateSiblings && configuration.readingVariants
      ? deriveReadingVariantAlignments(jmdict, siblingBase, {
          targetAlignments: variantTargets,
          nearVariants: true,
        })
      : { wordAlignments: new Map(), witnesses: [] };
  const alignSiblings: Aligner = lateSiblings
    ? (spelling, reading) =>
        applyRefinement(
          applyRefinement(
            siblingBase(spelling, reading),
            siblingSpellings.wordAlignments.get(spelling)?.get(reading),
            "alternate-spelling",
          ),
          siblingReadings.wordAlignments.get(spelling)?.get(reading),
          "attested-reading-variant",
        )
    : alignSharedRuns;
  // Any stage can cut beside an omitted particle, so the grouping is applied last.
  const omittedParticles = configuration.variantTransfers
    ? deriveOmittedParticles(jmdict, characterReadings)
    : undefined;
  const align: Aligner =
    omittedParticles === undefined
      ? alignSiblings
      : (spelling, reading) =>
          joinOmittedParticles(
            alignSiblings(spelling, reading),
            omittedParticleSites(omittedParticles, spelling, reading),
          );
  type LateSequence = ReturnType<typeof compileLateSequence>;
  const lateWitnesses = <Name extends Exclude<keyof LateSequence, "align">>(name: Name) =>
    mergeLateWitnesses<LateSequence[Name]["witnesses"][number]>(
      independentLate[name].witnesses,
      integratedLate[name].witnesses,
    );
  return {
    configuration,
    variantTransfers: transfers,
    supplementaryVariants: supplementaryVariants.transfers,
    weakReadings: weak.witnesses,
    numeralTransfers: numerals.witnesses,
    numeralReadings: numeralReadings?.witnesses ?? [],
    readingVariants: readingVariants.witnesses,
    phoneticAteji: ateji.witnesses,
    loanReadings: loans.witnesses,
    unihanReadings: unihan.witnesses,
    listedCharacterReadings: listed.witnesses,
    lexicalEvidence: facts,
    unihanOnLengthening: lateWitnesses("lengthened"),
    englishCharacterReadings: lateWitnesses("english"),
    listedPhonology: lateWitnesses("listedPhonology"),
    koreanReadings: lateWitnesses("korean"),
    onReadingSpelling: lateWitnesses("onSpelling"),
    sharedRunTransfers: sharedRuns.witnesses,
    omittedParticles,
    align,
  };
}

export async function loadDataset(options: PipelineOptions = {}): Promise<Dataset> {
  const {
    jmdict,
    kanjidic,
    unihanText,
    characterReadingBundle,
    englishCharacterReadingBundle,
    lock,
  } = await loadSources();
  const annotationsText = await readFile(
    new URL("../data/annotations.json", import.meta.url),
    "utf8",
  );
  const annotations = compileAnnotations(JSON.parse(annotationsText) as Annotation[]);
  const lexicalBundle = JSON.parse(
    await readFile(new URL("../data/lexical-evidence.json", import.meta.url), "utf8"),
  ) as { schemaVersion: number; facts: LexicalFact[] };
  if (lexicalBundle.schemaVersion !== 2) throw new Error("Unsupported lexical evidence schema");
  const pipeline = compileAlignmentPipeline(jmdict, kanjidic, options, {
    unihanReadings: unihanText === undefined ? new Map() : parseUnihanReadings(unihanText),
    unihanSource: lock.lexicalSources?.unihan,
    characterReadingBundle,
    englishCharacterReadingBundle,
    lexicalEvidence: lexicalBundle.facts,
    kanjidicSource: lock.sources.kanjidic,
    jmdictSource: lock.sources.jmdict,
  });
  return {
    ...pipeline,
    jmdict,
    kanjidic,
    lock,
    annotations,
    annotationsSHA256: digest(annotationsText),
    pairs: () => enumeratePairs(jmdict),
    alignPair(pair) {
      const annotation = annotations.get(recordKey(pair.id, pair.spelling, pair.reading));
      const result: Alignment = annotation
        ? { segments: annotation.segments, status: "reviewed" }
        : pipeline.align(pair.spelling, pair.reading);
      validateAlignment(pair.spelling, pair.reading, result.segments);
      return result;
    },
  };
}

export async function evaluationProvenance(
  dataset: Pick<Dataset, "annotationsSHA256" | "configuration"> & { lock: unknown },
  goldText: string,
): Promise<EvaluationProvenance> {
  return {
    generatorSHA256: await generatorDigest(),
    sourcesSHA256: digest(JSON.stringify(dataset.lock)),
    annotationsSHA256: dataset.annotationsSHA256,
    configuration: dataset.configuration,
    goldSHA256: digest(goldText),
  };
}
