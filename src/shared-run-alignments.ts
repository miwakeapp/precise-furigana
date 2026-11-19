import { createHash } from "node:crypto";
import { createAligner } from "./align.ts";
import { getKanaVowels, isIdeograph, isKana, normalizeKana, splitGraphemes } from "./kana.ts";
import {
  enumeratePairs,
  makeCharacterReadings,
  makeWordReadings,
  makeIrregularWordReadings,
} from "./sources.ts";
import { boundaries, pairKey, segmentReading, segmentText } from "./segments.ts";
import {
  compileLexicalEvidence,
  refineWithLexicalEvidence,
  makeLexicalContextChecker,
} from "./lexical-evidence.ts";
import type { CompiledLexicalFact, LexicalFact } from "./lexical-evidence.ts";
import type {
  Aligner,
  Alignment,
  AlignmentStatus,
  Evidence,
  JMdict,
  Kanjidic2,
  Pair,
  PassResult,
  Segment,
  SourceIdentity,
  WordAlignments,
} from "./types.ts";

/** The sound switches forwarded to the aligner that checks a source spelling on its own. */
export interface RawAlignerOptions {
  phonologicalAlternations?: boolean;
  terminalContraction?: boolean;
  compoundVoicing?: boolean;
  kanaRunCorrespondence?: boolean;
  internalKanaAnchors?: boolean;
}

export interface SharedRunOptions {
  /** Reviewed facts whose boundaries a transfer may not contradict. */
  reviewedFacts?: CompiledLexicalFact[];
  jmdictSource?: SourceIdentity;
  kanjidicSource?: SourceIdentity;
  rawAlignerOptions?: RawAlignerOptions;
}

/** A pinned source's identity, or a hash standing in for a dictionary supplied without one. */
export type SharedRunSourceIdentity = SourceIdentity | { name: string; inputSHA256: string };

/** One kana that differs between a source spelling and the target spelling at the same position. */
export interface KanaCorrespondence {
  spellingIndex: number;
  source: string;
  target: string;
  rule: string;
  readingIndex?: number;
  reading?: string;
  sourceRule?: string;
  targetRule?: string;
}

/** The division a source spelling lends to part or all of a target spelling. */
export interface SharedRunFact extends LexicalFact {
  id: string;
}

/** One fact used to refine a target, with everything that supported it. */
export interface SharedRunUnit {
  fact: SharedRunFact;
  sourcePair: { id: string; spelling: string; reading: string };
  sourceAttestation: Pair;
  sourceSegments: Segment[];
  sourceEvidence: Evidence[] | undefined;
  sourceIdentities: { jmdict: SharedRunSourceIdentity; kanjidic: SharedRunSourceIdentity };
  rawAlignerOptions: RawAlignerOptions;
  rawCharacterReadings: Record<string, string[]>;
  /** The source's segments the fact covers, as a start index and an end index. */
  sourceSegmentRange: [start: number, end: number];
  kanaCorrespondences?: KanaCorrespondence[];
}

export interface SharedRunWitness {
  targetPair: { id: string; spelling: string; reading: string };
  targetAttestation: Pair;
  units: SharedRunUnit[];
}

export interface SharedRunCounts {
  targetPairs: number;
  targetWithOpaqueSpan: number;
  potentialSourceRelations: number;
  rawAlignedSources: number;
  acceptedSourceAgreement: number;
  proposedUnits: number;
  conflictingUnits: number;
  changed: number;
  kanaCorrespondenceUnits: number;
  rejectedPairConflicts: number;
  emittedPairs: number;
}

export interface SharedRunResult extends PassResult<SharedRunWitness> {
  counts: SharedRunCounts;
}

/** A target pair whose division changed, before entries sharing the pair are reconciled. */
interface SharedRunRecord extends Pair {
  before: Segment[];
  after: Segment[];
  status: AlignmentStatus;
  original: Alignment;
  refined: Alignment;
}

interface SharedRunProposal {
  record: SharedRunRecord;
  points: Set<string>;
  witnesses: SharedRunWitness[];
  conflict: boolean;
}

const rawOptionNames = new Set([
  "phonologicalAlternations",
  "terminalContraction",
  "compoundVoicing",
  "kanaRunCorrespondence",
  "internalKanaAnchors",
]);

function sourceIdentity(
  supplied: SourceIdentity | undefined,
  dictionary: unknown,
  name: string,
): SharedRunSourceIdentity {
  if (supplied === undefined)
    return {
      name: `Supplied ${name} input`,
      inputSHA256: createHash("sha256").update(JSON.stringify(dictionary)).digest("hex"),
    };
  if (
    supplied === null ||
    typeof supplied !== "object" ||
    typeof supplied.version !== "string" ||
    !supplied.version.trim() ||
    !/^[\da-f]{64}$/u.test(supplied.jsonSHA256 ?? "")
  )
    throw new TypeError(`${name} source identity requires a version and JSON SHA256`);
  return structuredClone(supplied);
}

function validateRawOptions(options: RawAlignerOptions): RawAlignerOptions {
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Raw aligner options must be an object");
  const result: RawAlignerOptions = {};
  for (const [name, value] of Object.entries(options)) {
    if (!rawOptionNames.has(name)) throw new TypeError(`Unsupported raw aligner option: ${name}`);
    if (value === undefined) continue;
    if (typeof value !== "boolean")
      throw new TypeError(`Raw aligner option ${name} must be a boolean`);
    result[name as keyof RawAlignerOptions] = value;
  }
  return result;
}

function uniqueOccurrence(text: string[], needle: string[]): boolean {
  const matches: number[] = [];
  for (let start = 0; start <= text.length - needle.length; ++start) {
    if (needle.every((value, offset) => value === text[start + offset])) matches.push(start);
  }
  return matches.length === 1;
}

const historicalKana = new Set(["ふう", "うふ", "ひい", "いひ", "へえ", "えへ"]);
const voicedKana = new Map(
  Array.from("かきくけこさしすせそたちつてとはひふへほ").map((unit, index) => [
    unit,
    Array.from("がぎぐげござじずぜぞだぢづでどばびぶべぼ")[index],
  ]),
);

function kanaCorrespondence(
  spelling: string,
  reading: string,
  previousSpelling: string | undefined,
  previousReading: string | undefined,
  soundOptions: RawAlignerOptions,
): string | undefined {
  const a = normalizeKana(spelling),
    b = normalizeKana(reading);
  if (a === b) return "kana-script";
  if (soundOptions.phonologicalAlternations !== false) {
    if (historicalKana.has(a + b)) return "historical-kana";
    if (voicedKana.get(a) === b || voicedKana.get(b) === a) return "kana-voicing";
  }
  if (
    (a === "ー") !== (b === "ー") &&
    isKana(previousSpelling ?? "") &&
    isKana(previousReading ?? "")
  ) {
    const vowel = a === "ー" ? b : a;
    if (
      getKanaVowels(previousSpelling!)?.includes(vowel) &&
      getKanaVowels(previousReading!)?.includes(vowel)
    )
      return "long-vowel-notation";
  }
  return undefined;
}

function projectCorrespondingKana(
  source: string[],
  target: string[],
  reading: string,
  result: Alignment,
  soundOptions: RawAlignerOptions,
): { segments: Segment[]; changes: KanaCorrespondence[] } | undefined {
  if (
    soundOptions.kanaRunCorrespondence === false ||
    source.length !== target.length ||
    !source.some(isIdeograph)
  )
    return undefined;
  const changes: KanaCorrespondence[] = [];
  for (let index = 0; index < source.length; ++index) {
    if (source[index] === target[index]) continue;
    if (!isKana(source[index]) || !isKana(target[index])) return undefined;
    const rule = kanaCorrespondence(
      source[index],
      target[index],
      source[index - 1],
      target[index - 1],
      soundOptions,
    );
    if (rule === undefined) return undefined;
    changes.push({ spellingIndex: index, source: source[index], target: target[index], rule });
  }
  if (
    !changes.length ||
    result.evidence!.some(
      (edge) =>
        edge.type === "fallback" ||
        edge.type === "ambiguous" ||
        edge.rules.some((rule) =>
          [
            "dictionary-kana-anchors",
            "dictionary-internal-kana-anchors",
            "dictionary-kana-mismatch",
            "post-kana-gemination",
          ].includes(rule),
        ),
    )
  )
    return undefined;
  const readingUnits = splitGraphemes(reading),
    points = new Map([[0, 0]]),
    spans: {
      start: number;
      end: number;
      readStart: number;
      readEnd: number;
      literalKana: boolean;
    }[] = [];
  let x = 0,
    y = 0;
  for (const segment of result.segments) {
    const text = splitGraphemes(segmentText(segment)),
      sound = splitGraphemes(segmentReading(segment));
    const literalKana =
      text.length === sound.length &&
      text.every(
        (unit, index) => isKana(unit) && normalizeKana(unit) === normalizeKana(sound[index]),
      );
    if (literalKana)
      for (let index = 1; index < text.length; ++index) points.set(x + index, y + index);
    spans.push({
      start: x,
      end: x + text.length,
      readStart: y,
      readEnd: y + sound.length,
      literalKana,
    });
    x += text.length;
    y += sound.length;
    points.set(x, y);
  }
  for (const change of changes) {
    const index = change.spellingIndex,
      readStart = points.get(index),
      readEnd = points.get(index + 1);
    if (readStart === undefined || readEnd !== readStart + 1) return undefined;
    const sound = readingUnits[readStart],
      previous = readingUnits[readStart - 1];
    const sourceRule = kanaCorrespondence(
      source[index],
      sound,
      source[index - 1],
      previous,
      soundOptions,
    );
    const targetRule = kanaCorrespondence(
      target[index],
      sound,
      target[index - 1],
      previous,
      soundOptions,
    );
    if (sourceRule === undefined || targetRule === undefined) return undefined;
    Object.assign(change, { readingIndex: readStart, reading: sound, sourceRule, targetRule });
  }
  const segments: Segment[] = [];
  const append = (text: string, sound: string) => {
    const previous = segments.at(-1);
    if (
      previous !== undefined &&
      isKana(text) &&
      normalizeKana(text) === normalizeKana(sound) &&
      isKana(segmentText(previous)) &&
      normalizeKana(segmentText(previous)) === normalizeKana(segmentReading(previous))
    ) {
      text = segmentText(previous) + text;
      sound = segmentReading(previous) + sound;
      segments.pop();
    }
    segments.push(text === sound ? text : [text, sound]);
  };
  for (const span of spans) {
    if (span.literalKana)
      for (let index = span.start; index < span.end; ++index)
        append(target[index], readingUnits[span.readStart + index - span.start]);
    else
      append(
        target.slice(span.start, span.end).join(""),
        readingUnits.slice(span.readStart, span.readEnd).join(""),
      );
  }
  return { segments, changes };
}

export function deriveSharedRunAlignments(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  align: Aligner,
  {
    reviewedFacts = [],
    jmdictSource,
    kanjidicSource,
    rawAlignerOptions = {},
  }: SharedRunOptions = {},
): SharedRunResult {
  if (!Array.isArray(jmdict?.words) || !Array.isArray(kanjidic?.characters))
    throw new TypeError("JMdict and KANJIDIC arrays are required");
  if (typeof align !== "function") throw new TypeError("An earlier alignment function is required");
  const soundOptions = validateRawOptions(rawAlignerOptions);
  const checkReviewed = makeLexicalContextChecker(reviewedFacts);
  const identities = {
    jmdict: sourceIdentity(jmdictSource, jmdict, "JMdict"),
    kanjidic: sourceIdentity(kanjidicSource, kanjidic, "KANJIDIC2"),
  };
  const primary = makeCharacterReadings(kanjidic);
  const rawAlign = createAligner({
    ...soundOptions,
    characterReadings: primary,
    wordReadings: makeWordReadings(jmdict),
    irregularWordReadings: makeIrregularWordReadings(jmdict),
    dictionaryUnvoicing: false,
    dictionaryRenjo: false,
    dictionaryNasalLoss: false,
    dictionaryInitialVoicing: false,
  });
  const rawCache = new Map<string, Alignment>(),
    existingCache = new Map<string, Alignment>();
  function cached(
    cache: Map<string, Alignment>,
    callback: Aligner,
    spelling: string,
    reading: string,
  ): Alignment {
    const key = pairKey(spelling, reading);
    if (!cache.has(key)) cache.set(key, callback(spelling, reading));
    return cache.get(key)!;
  }
  const counts: Omit<SharedRunCounts, "rejectedPairConflicts" | "emittedPairs"> &
    Partial<SharedRunCounts> = {
    targetPairs: 0,
    targetWithOpaqueSpan: 0,
    potentialSourceRelations: 0,
    rawAlignedSources: 0,
    acceptedSourceAgreement: 0,
    proposedUnits: 0,
    conflictingUnits: 0,
    changed: 0,
    kanaCorrespondenceUnits: 0,
  };
  const records: SharedRunRecord[] = [],
    witnesses: SharedRunWitness[] = [],
    seen = new Set<string>();
  for (const word of jmdict.words) {
    const pairs = [...enumeratePairs({ words: [word] })].filter((pair) => pair.kind === "kanji");
    if (new Set(pairs.map((pair) => pair.spelling)).size < 2) continue;
    const byReading = new Map<string, Pair[]>();
    for (const pair of pairs) {
      const group = byReading.get(pair.reading) ?? [];
      group.push(pair);
      byReading.set(pair.reading, group);
    }
    for (const target of pairs) {
      const key = `${target.id}:${pairKey(target.spelling, target.reading)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ++counts.targetPairs;
      const original = cached(existingCache, align, target.spelling, target.reading);
      if (
        original?.status !== "aligned" ||
        !original.segments.some(
          (segment) => Array.isArray(segment) && splitGraphemes(segmentText(segment)).length > 1,
        )
      )
        continue;
      ++counts.targetWithOpaqueSpan;
      const targetUnits = splitGraphemes(target.spelling),
        facts = new Map<string, SharedRunFact>(),
        provenance = new Map<string, SharedRunUnit>(),
        conflicts = new Set<string>();
      let factSequence = 0;
      function addFact(
        spelling: string,
        reading: string,
        parts: Segment[],
        source: Pair,
        independentlyAligned: Alignment,
        sourceUnits: string[],
        sourceSegmentRange: [start: number, end: number],
        kanaCorrespondences?: KanaCorrespondence[],
      ): void {
        const factKey = pairKey(spelling, normalizeKana(reading)),
          id = `shared-run-${factSequence++}`;
        if (conflicts.has(factKey)) return;
        const fact = {
          id,
          spelling,
          reading,
          segments: parts,
          reason: kanaCorrespondences
            ? "Exact one-to-one kana correspondences preserve independently supported same-entry character ownership."
            : "Unique complete shared run from an independently raw-aligned same-entry spelling, with exact whole-reading agreement.",
          sources: [{ url: "https://www.edrdg.org/jmdict/edict_doc.html" }],
        };
        const previous = facts.get(factKey),
          previousPoints = new Set(previous ? boundaries(previous.segments) : []),
          nextPoints = new Set(boundaries(parts));
        if (
          previous !== undefined &&
          [...previousPoints].some((point) => !nextPoints.has(point)) &&
          [...nextPoints].some((point) => !previousPoints.has(point))
        ) {
          facts.delete(factKey);
          provenance.delete(factKey);
          conflicts.add(factKey);
          ++counts.conflictingUnits;
          return;
        }
        if (previous !== undefined && [...nextPoints].every((point) => previousPoints.has(point)))
          return;
        facts.set(factKey, fact);
        provenance.set(factKey, {
          fact,
          sourcePair: { id: source.id, spelling: source.spelling, reading: source.reading },
          sourceAttestation: { ...source },
          sourceSegments: independentlyAligned.segments,
          sourceEvidence: independentlyAligned.evidence,
          sourceIdentities: identities,
          rawAlignerOptions: { ...soundOptions },
          rawCharacterReadings: Object.fromEntries(
            [...new Set(sourceUnits)]
              .filter((character) => primary.has(character))
              .map((character) => [character, [...primary.get(character)!]]),
          ),
          sourceSegmentRange,
          ...(kanaCorrespondences ? { kanaCorrespondences } : {}),
        });
        ++counts.proposedUnits;
      }
      for (const source of byReading.get(target.reading)!) {
        if (source.spelling === target.spelling) continue;
        const sourceUnits = splitGraphemes(source.spelling);
        const hasSharedRun = sourceUnits.some(
          (value, index) =>
            index + 1 < sourceUnits.length &&
            target.spelling.includes(value + sourceUnits[index + 1]),
        );
        const hasSameAnchors =
          sourceUnits.length === targetUnits.length &&
          sourceUnits.every(
            (unit, index) =>
              unit === targetUnits[index] || (isKana(unit) && isKana(targetUnits[index])),
          );
        if (!hasSharedRun && !hasSameAnchors) continue;
        ++counts.potentialSourceRelations;
        const independentlyAligned = cached(rawCache, rawAlign, source.spelling, source.reading);
        if (independentlyAligned.status !== "aligned") continue;
        ++counts.rawAlignedSources;
        const acceptedSource = cached(existingCache, align, source.spelling, source.reading);
        if (acceptedSource?.status !== "aligned") continue;
        const sourcePoints = new Set(boundaries(acceptedSource.segments));
        if (boundaries(independentlyAligned.segments).some((point) => !sourcePoints.has(point)))
          continue;
        ++counts.acceptedSourceAgreement;
        const segments = independentlyAligned.segments;
        const projected = projectCorrespondingKana(
          sourceUnits,
          targetUnits,
          target.reading,
          independentlyAligned,
          soundOptions,
        );
        if (
          projected !== undefined &&
          !checkReviewed(
            { ...original, spelling: target.spelling, reading: target.reading },
            projected.segments,
          ).veto
        ) {
          addFact(
            target.spelling,
            target.reading,
            projected.segments,
            source,
            independentlyAligned,
            sourceUnits,
            [0, segments.length],
            projected.changes,
          );
          ++counts.kanaCorrespondenceUnits;
        }
        if (!hasSharedRun) continue;
        for (let start = 0; start < segments.length; ++start)
          for (let end = start + 2; end <= segments.length; ++end) {
            const parts = segments.slice(start, end),
              spelling = parts.map(segmentText).join(""),
              reading = parts.map(segmentReading).join("");
            const units = splitGraphemes(spelling),
              normalized = normalizeKana(reading);
            if (
              !uniqueOccurrence(sourceUnits, units) ||
              !uniqueOccurrence(targetUnits, units) ||
              !uniqueOccurrence(Array.from(normalizeKana(target.reading)), Array.from(normalized))
            )
              continue;
            // Each whole placement must fit inside an existing opaque span. The
            // lexical refiner checks its endpoints and every internal boundary,
            // including mora-suffix guards and reviewed larger-context vetoes.
            if (
              !original.segments.some(
                (segment) =>
                  Array.isArray(segment) &&
                  segmentText(segment).includes(spelling) &&
                  normalizeKana(segmentReading(segment)).includes(normalized),
              )
            )
              continue;
            addFact(spelling, reading, parts, source, independentlyAligned, sourceUnits, [
              start,
              end,
            ]);
          }
      }
      if (!facts.size) continue;
      const contexts = reviewedFacts.filter((fact) => target.spelling.includes(fact.spelling));
      const sharedFacts = [...facts]
        .filter(([key]) => provenance.get(key)!.kanaCorrespondences === undefined)
        .map(([, fact]) => fact);
      // Preserve shared-run interior cuts before a whole-spelling kana
      // projection can disqualify that run's unused outer endpoint.
      const shared = refineWithLexicalEvidence(original, [
        ...contexts,
        ...compileLexicalEvidence(sharedFacts),
      ]);
      const refined = refineWithLexicalEvidence(shared, [
        ...contexts,
        ...compileLexicalEvidence([...facts.values()]),
      ]);
      if (refined === original) continue;
      const usedIds = new Set(
        refined.evidence!.flatMap((edge) => (edge.facts as string[] | undefined) ?? []),
      );
      const used = [...provenance.values()].filter((value) => usedIds.has(value.fact.id));
      if (!used.length) continue;
      ++counts.changed;
      records.push({
        ...target,
        before: original.segments,
        after: refined.segments,
        status: original.status,
        original,
        refined,
      });
      witnesses.push({
        targetPair: { id: target.id, spelling: target.spelling, reading: target.reading },
        targetAttestation: { ...target },
        units: used,
      });
    }
  }
  // A spelling/reading lookup can be shared by multiple entries. Keep a
  // consistently finer proposal; incomparable entry-specific proposals must
  // not depend on dictionary order.
  const proposals = new Map<string, SharedRunProposal>();
  for (const [index, record] of records.entries()) {
    const key = pairKey(record.spelling, record.reading),
      previous = proposals.get(key);
    if (previous?.conflict) continue;
    const points = new Set(boundaries(record.after));
    if (previous === undefined) {
      proposals.set(key, { record, points, witnesses: [witnesses[index]], conflict: false });
    } else if ([...previous.points].every((point) => points.has(point))) {
      if (points.size > previous.points.size)
        Object.assign(previous, { record, points, witnesses: [witnesses[index]] });
      else previous.witnesses.push(witnesses[index]);
    } else if (![...points].every((point) => previous.points.has(point))) {
      previous.conflict = true;
    }
  }
  const wordAlignments: WordAlignments = new Map(),
    selectedWitnesses: SharedRunWitness[] = [];
  for (const proposal of proposals.values()) {
    if (proposal.conflict) continue;
    const { record } = proposal,
      readings = wordAlignments.get(record.spelling) ?? new Map();
    readings.set(record.reading, record.after);
    wordAlignments.set(record.spelling, readings);
    selectedWitnesses.push(...proposal.witnesses);
  }
  counts.rejectedPairConflicts = [...proposals.values()].filter(
    (proposal) => proposal.conflict,
  ).length;
  counts.emittedPairs = [...wordAlignments.values()].reduce(
    (total, readings) => total + readings.size,
    0,
  );
  return { wordAlignments, witnesses: selectedWitnesses, counts: counts as SharedRunCounts };
}
