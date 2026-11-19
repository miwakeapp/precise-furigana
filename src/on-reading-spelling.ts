import { createHash } from "node:crypto";
import { validateCharacterReadingBundle } from "./character-readings.ts";
import { enumeratePairs, makeIrregularWordReadings } from "./sources.ts";
import {
  isIdeograph,
  isKana,
  kanaPronunciation,
  normalizeKana,
  readingStem,
  splitGraphemes,
} from "./kana.ts";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.ts";
import type {
  CharacterReadingBundle,
  CharacterReadingRecord,
  CharacterReadingSource,
} from "./character-readings.ts";
import type {
  Aligner,
  JMdict,
  Kanjidic2,
  Kanjidic2Reading,
  PassResult,
  ReadingMap,
  Segment,
  SourceIdentity,
  WordAlignments,
} from "./types.ts";

export interface OnReadingSpellingOptions {
  characterReadingBundle?: CharacterReadingBundle;
  englishCharacterReadingBundle?: CharacterReadingBundle;
  kanjidicSource?: SourceIdentity;
}

/** A source's listing of a reading for a character. */
export interface OnReadingClaim {
  source: string;
  field: string;
  /** The supplied identity of the source, or a fingerprint of its records when none was supplied. */
  sourceIdentity: SourceIdentity | CharacterReadingSource;
  /** The source's own record of the reading. */
  form: Kanjidic2Reading | CharacterReadingRecord;
  /** Where KANJIDIC lists the reading; absent for a bundle's reading. */
  groupIndex?: number;
  readingIndex?: number;
  /** The reading as the source writes it. */
  value: string;
  kind: "on" | "kun";
}

/** A claim as used for one character, with the notation rules that matching it needed. */
export interface OnReadingEvidence extends OnReadingClaim {
  rules: string[];
}

export interface OnReadingCharacter {
  character: string;
  spelling: string;
  reading: string;
  codepoint: string;
  evidence: OnReadingEvidence[];
}

/** One opaque span of the earlier alignment, as divided among its characters. */
export interface OnReadingSpan {
  spelling: string;
  reading: string;
  segments: Segment[];
  characters: OnReadingCharacter[];
}

export interface OnReadingSpellingWitness {
  id: string;
  spelling: string;
  reading: string;
  interpretation: string;
  spans: OnReadingSpan[];
}

/** A KANJIDIC Japanese reading with its place in the character's record. */
interface PrimaryReading {
  character: string;
  form: Kanjidic2Reading;
  groupIndex: number;
  readingIndex: number;
}

interface InventoryEntry {
  /** The reading in normalized kana. */
  exact: string;
  /** The long-vowel comparison key; on readings only. */
  pronunciation: string | undefined;
  primary: boolean;
  /** Whether a final sokuon needs a following voiceless obstruent. */
  finalSokuonGuard: boolean;
  claim: OnReadingClaim;
}

type Inventory = Map<string, InventoryEntry[]>;

interface InventoryEntryOptions {
  primary?: boolean;
  /** Whether the value carries KANJIDIC's okurigana and affix marks. */
  annotated?: boolean;
  finalSokuonGuard?: boolean;
}

/** A stretch of the word that an irregular reading covers, in graphemes. */
interface IrregularRange {
  start: number;
  end: number;
  readStart: number;
  readEnd: number;
}

interface SpanSolution {
  segments: Segment[];
  characters: OnReadingCharacter[];
}

function makeInventory(
  kanjidic: Kanjidic2,
  bundles: (CharacterReadingBundle | undefined)[],
  kanjidicSource: SourceIdentity | undefined,
): Inventory {
  const primary: PrimaryReading[] = [];
  for (const character of kanjidic.characters) {
    for (const [groupIndex, group] of (character.readingMeaning?.groups ?? []).entries()) {
      for (const [readingIndex, form] of group.readings.entries()) {
        if (form.type !== "ja_on" && form.type !== "ja_kun") continue;
        if (
          typeof character.literal !== "string" ||
          splitGraphemes(character.literal).length !== 1 ||
          typeof form.value !== "string" ||
          !isKana(readingStem(form.value))
        )
          throw new TypeError("Invalid KANJIDIC Japanese reading record");
        primary.push({
          character: character.literal,
          form: structuredClone(form),
          groupIndex,
          readingIndex,
        });
      }
    }
  }
  const sourceIdentity: SourceIdentity =
    kanjidicSource === undefined
      ? {
          name: "Supplied KANJIDIC Japanese reading records",
          readingsSHA256: createHash("sha256").update(JSON.stringify(primary)).digest("hex"),
        }
      : structuredClone(kanjidicSource);
  const inventory: Inventory = new Map();
  function add(
    character: string,
    value: string,
    kind: "on" | "kun",
    claim: Omit<OnReadingClaim, "value" | "kind">,
    { primary = false, annotated = false, finalSokuonGuard = false }: InventoryEntryOptions = {},
  ): void {
    const entries = inventory.get(character) ?? [];
    const exact = annotated ? readingStem(value) : normalizeKana(value);
    entries.push({
      exact,
      pronunciation: kind === "on" ? kanaPronunciation(exact) : undefined,
      primary,
      finalSokuonGuard,
      claim: { ...claim, value, kind },
    });
    inventory.set(character, entries);
  }
  for (const { character, form, groupIndex, readingIndex } of primary) {
    add(
      character,
      form.value,
      form.type === "ja_on" ? "on" : "kun",
      {
        source: "KANJIDIC2",
        field: form.type,
        sourceIdentity,
        form,
        groupIndex,
        readingIndex,
      },
      { primary: true, annotated: true },
    );
  }
  for (const bundle of bundles) {
    if (bundle === undefined) continue;
    validateCharacterReadingBundle(bundle);
    for (const form of bundle.readings)
      add(
        form.character,
        form.reading,
        form.kind,
        {
          source: bundle.source.publisher ?? bundle.source.name,
          field: bundle.source.field ?? "forms",
          sourceIdentity: structuredClone(bundle.source),
          form: structuredClone(form),
        },
        { finalSokuonGuard: true },
      );
  }
  return inventory;
}

function findIrregularRanges(
  spelling: string[],
  reading: string[],
  irregularWords: ReadingMap,
): IrregularRange[] {
  const ranges: IrregularRange[] = [];
  for (let start = 0; start < spelling.length; ++start) {
    for (let end = start + 1; end <= spelling.length; ++end) {
      const values = irregularWords.get(spelling.slice(start, end).join(""));
      if (values === undefined) continue;
      for (let readStart = 0; readStart < reading.length; ++readStart) {
        for (const value of values) {
          let normalized = "";
          for (let readEnd = readStart + 1; readEnd <= reading.length; ++readEnd) {
            normalized += normalizeKana(reading[readEnd - 1]);
            if (normalized === value) ranges.push({ start, end, readStart, readEnd });
            if (normalized.length >= value.length) break;
          }
        }
      }
    }
  }
  return ranges;
}

function splitSpan(
  spelling: string,
  reading: string,
  inventory: Inventory,
  ranges: IrregularRange[],
  spellingOffset: number,
  readingOffset: number,
  fullSpelling: string[],
  fullReading: string[],
): SpanSolution | undefined {
  const characters = splitGraphemes(spelling);
  const kana = splitGraphemes(reading);
  if (
    characters.length < 2 ||
    !characters.every(isIdeograph) ||
    !isKana(reading) ||
    characters.includes("々")
  )
    return undefined;
  const memo = new Map<string, SpanSolution[]>();
  function visit(index: number, offset: number): SpanSolution[] {
    if (index === characters.length)
      return offset === kana.length ? [{ segments: [], characters: [] }] : [];
    const key = `${index}:${offset}`;
    if (memo.has(key)) return memo.get(key)!;
    const candidates = inventory.get(characters[index]) ?? [];
    const solutions: SpanSolution[] = [];
    for (let end = offset + 1; end <= kana.length - (characters.length - index - 1); ++end) {
      const piece = kana.slice(offset, end).join("");
      const normalized = normalizeKana(piece);
      if (/^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalized)) continue;
      const pronunciation = kanaPronunciation(piece);
      const inIrregular = ranges.some(
        (range) =>
          range.start <= spellingOffset + index &&
          spellingOffset + index < range.end &&
          range.readStart <= readingOffset + offset &&
          readingOffset + end <= range.readEnd,
      );
      const evidence = candidates.flatMap((candidate): OnReadingEvidence[] => {
        const exact = candidate.exact === normalized;
        if (!exact && candidate.pronunciation !== pronunciation) return [];
        // As in the supplemental character allocator, direct primary readings
        // remain usable; weaker or changed correspondences need regular context.
        if ((!candidate.primary || !exact) && inIrregular) return [];
        if (
          candidate.finalSokuonGuard &&
          normalized.endsWith("っ") &&
          (!isIdeograph(fullSpelling[spellingOffset + index + 1] ?? "") ||
            !/^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u.test(
              normalizeKana(fullReading[readingOffset + end] ?? ""),
            ))
        )
          return [];
        return [{ ...candidate.claim, rules: exact ? [] : ["on-long-vowel-notation-equivalence"] }];
      });
      if (!evidence.length) continue;
      const character: OnReadingCharacter = {
        character: characters[index],
        spelling: characters[index],
        reading: piece,
        codepoint: `U+${characters[index].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        evidence,
      };
      for (const suffix of visit(index + 1, end)) {
        solutions.push({
          segments: [[characters[index], piece], ...suffix.segments],
          characters: [character, ...suffix.characters],
        });
        if (solutions.length === 2) break;
      }
      if (solutions.length === 2) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const solutions = visit(0, 0);
  if (solutions.length !== 1) return undefined;
  // This pass supplies notation equivalence, not an unrelated exact-reading
  // replay. Every refined span must require at least one changed on spelling.
  if (
    !solutions[0].characters.some((character) =>
      character.evidence.every((claim) => claim.rules.length > 0),
    )
  )
    return undefined;
  return solutions[0];
}

/** Refine attested opaque spans using exact on-reading long-vowel notation. */
export function deriveOnReadingSpellingAlignments(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  align: Aligner,
  {
    characterReadingBundle,
    englishCharacterReadingBundle,
    kanjidicSource,
  }: OnReadingSpellingOptions = {},
): PassResult<OnReadingSpellingWitness> {
  if (!Array.isArray(jmdict?.words) || !Array.isArray(kanjidic?.characters))
    throw new TypeError("JMdict and KANJIDIC arrays are required");
  if (typeof align !== "function") throw new TypeError("An aligner is required");
  if (
    kanjidicSource !== undefined &&
    (kanjidicSource === null ||
      typeof kanjidicSource !== "object" ||
      typeof kanjidicSource.version !== "string" ||
      !kanjidicSource.version.trim() ||
      !/^[\da-f]{64}$/u.test(kanjidicSource.jsonSHA256 ?? ""))
  ) {
    throw new TypeError("KANJIDIC source identity requires a version and JSON SHA256");
  }
  const inventory = makeInventory(
    kanjidic,
    [characterReadingBundle, englishCharacterReadingBundle],
    kanjidicSource,
  );
  const irregularWords = new Map(
    [...makeIrregularWordReadings(jmdict)].map(([spelling, readings]) => [
      spelling,
      readings.map(normalizeKana),
    ]),
  );
  const wordAlignments: WordAlignments = new Map(),
    witnesses: OnReadingSpellingWitness[] = [],
    seen = new Set<string>();
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind !== "kanji") continue;
    const key = pairKey(pair.spelling, pair.reading);
    if (seen.has(key)) continue;
    seen.add(key);
    const original = align(pair.spelling, pair.reading);
    if (original.status !== "aligned") continue;
    if (
      !original.segments.some((segment) => {
        const characters = splitGraphemes(segmentText(segment));
        return (
          characters.length > 1 &&
          characters.every(isIdeograph) &&
          !characters.includes("々") &&
          isKana(segmentReading(segment))
        );
      })
    )
      continue;
    const spellingUnits = splitGraphemes(pair.spelling);
    const readUnits = splitGraphemes(pair.reading);
    const ranges = findIrregularRanges(spellingUnits, readUnits, irregularWords);
    const spans: OnReadingSpan[] = [];
    let spellingOffset = 0;
    let readingOffset = 0;
    const segments = original.segments.flatMap((segment) => {
      const spelling = segmentText(segment);
      const reading = segmentReading(segment);
      const split = splitSpan(
        spelling,
        reading,
        inventory,
        ranges,
        spellingOffset,
        readingOffset,
        spellingUnits,
        readUnits,
      );
      spellingOffset += splitGraphemes(spelling).length;
      readingOffset += splitGraphemes(reading).length;
      if (split === undefined) return [segment];
      spans.push({ spelling, reading, segments: split.segments, characters: split.characters });
      return split.segments;
    });
    if (!spans.length) continue;
    validateAlignment(pair.spelling, pair.reading, segments);
    const readings = wordAlignments.get(pair.spelling) ?? new Map<string, Segment[]>();
    readings.set(pair.reading, segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({
      id: pair.id,
      spelling: pair.spelling,
      reading: pair.reading,
      interpretation:
        "Exact listed on-reading notation equivalence with literal companions; not an etymological claim",
      spans,
    });
  }
  return { wordAlignments, witnesses };
}
