import { enumeratePairs, makeIrregularWordReadings } from "./sources.ts";
import { isIdeograph, isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.ts";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.ts";
import {
  deriveUnihanOnLengthenings,
  deriveUnihanReadingVariants,
  matchesIterationReading,
} from "./unihan-phonology.ts";
import type { UnihanDerivation } from "./unihan-phonology.ts";
import type { Aligner, JMdict, PassResult, ReadingMap, Segment, WordAlignments } from "./types.ts";

/** A supplemental reading proposed for one character, with what follows it in the whole word. */
export interface SupplementalReadingCandidate {
  character: string;
  reading: string;
  /** Offsets, in graphemes of the whole word, just past the character and its reading. */
  spellingEnd: number;
  readingEnd: number;
  /** The next grapheme of the spelling; undefined at the end of the word. */
  followingSpelling: string | undefined;
  followingReading: string;
}

/** Decides whether a supplemental reading may be used where it is proposed. */
export type SupplementalReadingFilter = (candidate: SupplementalReadingCandidate) => boolean;

export interface UnihanAlignmentOptions {
  /** Whole-word readings inside which no supplemental reading may be placed. */
  irregularWordReadings?: ReadingMap;
  weakCharacterReadings?: ReadingMap;
  supplementalVoicing?: boolean;
  yoonSimplification?: boolean;
  onLengthening?: boolean;
  supplementalReadingFilter?: SupplementalReadingFilter;
}

/** A character whose sound a supplemental reading supplied. */
export interface UnihanCharacterWitness {
  /** The character whose reading was used; for an iteration mark, the character it repeats. */
  character: string;
  spelling: string;
  reading: string;
  field: string;
  codepoint: string;
  /** The listed readings, as the source writes them, that account for the sound. */
  values: string[];
  /** How the sound was reached, when it is not itself a listed reading. */
  derivations?: { value: string; rules: string[] }[];
}

export interface UnihanWitness {
  id: string;
  spelling: string;
  reading: string;
  characters: UnihanCharacterWitness[];
}

/** What supports one normalized sound of a character. */
interface ReadingEvidence {
  /** Whether the ordinary character readings list the sound. */
  primary: boolean;
  weak?: boolean;
  /** The supplemental readings, as written, with this sound; absent for a derived sound. */
  values?: string[];
  /** Present only for a sound derived from listed readings. */
  derivations?: UnihanDerivation[];
}

/** Each character's usable sounds, in normalized kana. */
type ReadingInventory = Map<string, Map<string, ReadingEvidence>>;

interface ReadingCoordinates {
  units: string[];
  normalized: string;
  /** The offset into `normalized` at which each unit starts, and finally where the last ends. */
  offsets: number[];
  /** The index into `offsets` of each such offset. */
  ends: Map<number, number>;
}

/** A stretch of the word that an irregular reading covers, in graphemes. */
interface IrregularRange {
  start: number;
  end: number;
  readStart: number;
  readEnd: number;
}

type SpanCandidate = Omit<SupplementalReadingCandidate, "followingSpelling" | "followingReading">;

/** What surrounds a span, for an iteration mark at either edge of it. */
interface SpanContext {
  iterationInheritance?: boolean;
  previousCharacter?: string;
  previousReading?: string;
  followingIterationReading?: string;
}

interface SpanSolution {
  segments: Segment[];
  witnesses: UnihanCharacterWitness[];
}

/** Parse exact `kJapanese` values without guessing okurigana or inflections. */
export function parseUnihanReadings(text: string): ReadingMap {
  if (typeof text !== "string") throw new TypeError("Unihan readings must be supplied as text");
  const result: ReadingMap = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const [codepoint, property, value] = line.split("\t");
    if (property !== "kJapanese") continue;
    if (!/^U\+[\dA-F]{4,6}$/u.test(codepoint) || value === undefined)
      throw new Error("Malformed Unihan kJapanese record");
    const scalar = Number.parseInt(codepoint.slice(2), 16);
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff))
      throw new Error("Invalid Unihan codepoint");
    const readings = value.trim().split(/\s+/u);
    if (readings.some((reading) => !isKana(reading)))
      throw new Error(`Non-kana Unihan kJapanese reading for ${codepoint}`);
    const character = String.fromCodePoint(scalar);
    result.set(character, [...new Set([...(result.get(character) ?? []), ...readings])]);
  }
  return result;
}

function validateReadingMap(map: ReadingMap, name: string): void {
  if (!(map instanceof Map)) throw new TypeError(`${name} must be a Map`);
  for (const [character, readings] of map) {
    if (
      typeof character !== "string" ||
      !Array.isArray(readings) ||
      readings.some((reading) => typeof reading !== "string")
    ) {
      throw new TypeError(`${name} must map strings to reading arrays`);
    }
  }
}

function readingCoordinates(reading: string): ReadingCoordinates {
  const units = splitGraphemes(reading);
  let normalized = "";
  const offsets = [0];
  for (const unit of units) {
    normalized += normalizeKana(unit);
    offsets.push(normalized.length);
  }
  return {
    units,
    normalized,
    offsets,
    ends: new Map(offsets.map((offset, index) => [offset, index])),
  };
}

function findIrregularRanges(
  spelling: string[],
  reading: ReadingCoordinates,
  irregularWords: ReadingMap,
): IrregularRange[] {
  const ranges: IrregularRange[] = [];
  for (let start = 0; start < spelling.length; ++start) {
    for (let end = start + 1; end <= spelling.length; ++end) {
      const candidates = irregularWords.get(spelling.slice(start, end).join(""));
      if (candidates === undefined) continue;
      for (let readStart = 0; readStart < reading.units.length; ++readStart) {
        const offset = reading.offsets[readStart];
        for (const candidate of candidates) {
          if (!reading.normalized.startsWith(candidate, offset)) continue;
          const readEnd = reading.ends.get(offset + candidate.length);
          if (readEnd !== undefined) ranges.push({ start, end, readStart, readEnd });
        }
      }
    }
  }
  return ranges;
}

function splitSpan(
  spelling: string,
  reading: string,
  readings: ReadingInventory,
  ranges: IrregularRange[],
  spellingOffset: number,
  readingOffset: number,
  supplementalReadingFilter: ((candidate: SpanCandidate) => boolean) | undefined,
  {
    iterationInheritance = false,
    previousCharacter,
    previousReading,
    followingIterationReading,
  }: SpanContext = {},
): SpanSolution | undefined {
  const characters = splitGraphemes(spelling);
  const kana = splitGraphemes(reading);
  if (characters.length < 2 || !characters.every(isIdeograph) || !isKana(reading)) return undefined;
  const memo = new Map<string, SpanSolution[]>();
  const resolvedCharacters = characters.map((character, index) => {
    if (character !== "々") previousCharacter = character;
    return character === "々" ? previousCharacter : characters[index];
  });
  function visit(
    index: number,
    offset: number,
    precedingReading: string | undefined,
  ): SpanSolution[] {
    if (index === characters.length) {
      if (
        offset !== kana.length ||
        (iterationInheritance &&
          followingIterationReading !== undefined &&
          !matchesIterationReading(precedingReading, followingIterationReading))
      )
        return [];
      return [{ segments: [], witnesses: [] }];
    }
    const key = iterationInheritance
      ? JSON.stringify([index, offset, precedingReading])
      : `${index}:${offset}`;
    if (memo.has(key)) return memo.get(key)!;
    // An iteration mark with no character before it resolves to undefined, which nothing lists.
    const character = iterationInheritance
      ? resolvedCharacters[index]!
      : characters[index] === "々"
        ? characters[index - 1]
        : characters[index];
    const candidates = readings.get(character);
    if (candidates === undefined) return [];
    const solutions: SpanSolution[] = [];
    for (let end = offset + 1; end <= kana.length - (characters.length - index - 1); ++end) {
      const piece = kana.slice(offset, end).join("");
      if (/^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizeKana(piece))) continue;
      if (
        iterationInheritance &&
        characters[index] === "々" &&
        !matchesIterationReading(precedingReading, piece)
      )
        continue;
      const evidence = candidates.get(normalizeKana(piece));
      if (evidence === undefined) continue;
      const derivations = evidence.derivations?.filter(
        (derivation) =>
          !derivation.requiresFollowingObstruent ||
          (index + 1 < characters.length &&
            /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u.test(normalizeKana(kana[end] ?? ""))),
      );
      if (derivations?.length === 0) continue;
      const supplemental = !evidence.primary;
      if (
        supplemental &&
        !evidence.weak &&
        supplementalReadingFilter !== undefined &&
        !supplementalReadingFilter({
          character,
          reading: piece,
          spellingEnd: spellingOffset + index + 1,
          readingEnd: readingOffset + end,
        })
      )
        continue;
      if (
        supplemental &&
        ranges.some(
          (range) =>
            range.start <= spellingOffset + index &&
            spellingOffset + index < range.end &&
            range.readStart <= readingOffset + offset &&
            readingOffset + end <= range.readEnd,
        )
      )
        continue;
      const witnesses =
        supplemental && !evidence.weak
          ? [
              {
                character,
                spelling: characters[index],
                reading: piece,
                field: "kJapanese",
                codepoint: `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
                values:
                  derivations === undefined
                    ? evidence.values!
                    : [...new Set(derivations.map((derivation) => derivation.value))],
                ...(derivations === undefined
                  ? {}
                  : {
                      derivations: derivations.map(({ value, rules }) => ({ value, rules })),
                    }),
              },
            ]
          : [];
      for (const suffix of visit(index + 1, end, piece)) {
        solutions.push({
          segments: [[characters[index], piece], ...suffix.segments],
          witnesses: [...witnesses, ...suffix.witnesses],
        });
        if (solutions.length === 2) break;
      }
      if (solutions.length === 2) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const solutions = visit(0, 0, previousReading);
  if (solutions.length !== 1 || solutions[0].witnesses.length === 0) return undefined;
  if (
    iterationInheritance &&
    !solutions[0].witnesses.some((witness) =>
      witness.derivations?.some((derivation) =>
        derivation.rules.includes("single-mora-vowel-extension"),
      ),
    )
  )
    return undefined;
  return solutions[0];
}

/** Refine opaque spans while retaining existing and exact supplemental boundaries. */
export function deriveUnihanAlignments(
  jmdict: JMdict,
  characterReadings: ReadingMap,
  unihanReadings: ReadingMap,
  align: Aligner,
  {
    irregularWordReadings = makeIrregularWordReadings(jmdict),
    weakCharacterReadings = new Map(),
    supplementalVoicing = false,
    yoonSimplification = false,
    onLengthening = false,
    supplementalReadingFilter,
  }: UnihanAlignmentOptions = {},
): PassResult<UnihanWitness> {
  validateReadingMap(characterReadings, "characterReadings");
  validateReadingMap(unihanReadings, "unihanReadings");
  validateReadingMap(irregularWordReadings, "irregularWordReadings");
  validateReadingMap(weakCharacterReadings, "weakCharacterReadings");
  if (
    [supplementalVoicing, yoonSimplification, onLengthening].some(
      (option) => typeof option !== "boolean",
    )
  )
    throw new TypeError("Unihan phonology options must be booleans");
  if (supplementalReadingFilter !== undefined && typeof supplementalReadingFilter !== "function")
    throw new TypeError("supplementalReadingFilter must be a function");
  const readings: ReadingInventory = new Map();
  for (const [character, values] of characterReadings) {
    readings.set(
      character,
      new Map(
        values
          .map(readingStem)
          .filter(Boolean)
          .map((value): [string, ReadingEvidence] => [value, { primary: true, values: [] }]),
      ),
    );
  }
  for (const [character, values] of weakCharacterReadings) {
    const candidates = readings.get(character) ?? new Map<string, ReadingEvidence>();
    for (const value of values) {
      const normalized = normalizeKana(value);
      if (!normalized) continue;
      const evidence = candidates.get(normalized) ?? { primary: false, values: [] };
      evidence.weak = true;
      candidates.set(normalized, evidence);
    }
    readings.set(character, candidates);
  }
  const knownReadings = new Map(
    [...readings].map(([character, candidates]) => [character, new Set(candidates.keys())]),
  );
  for (const [character, values] of unihanReadings) {
    if (splitGraphemes(character).length !== 1)
      throw new TypeError("Unihan reading keys must be single characters");
    const candidates = readings.get(character) ?? new Map<string, ReadingEvidence>();
    for (const value of values) {
      if (!isKana(value)) throw new TypeError("Unihan readings must contain exact kana text");
      const normalized = normalizeKana(value);
      const evidence = candidates.get(normalized) ?? { primary: false, values: [] };
      if (!evidence.values!.includes(value)) evidence.values!.push(value);
      candidates.set(normalized, evidence);
    }
    readings.set(character, candidates);
  }
  const phonologicalReadings =
    supplementalVoicing || yoonSimplification
      ? new Map([...readings].map(([character, candidates]) => [character, new Map(candidates)]))
      : undefined;
  if (phonologicalReadings !== undefined) {
    for (const [character, values] of unihanReadings) {
      const candidates = phonologicalReadings.get(character)!;
      for (const { reading, ...derivation } of deriveUnihanReadingVariants(
        values,
        knownReadings.get(character) ?? new Set(),
        { supplementalVoicing, yoonSimplification },
      )) {
        const exact = readings.get(character)!.has(reading);
        if (exact) continue;
        const evidence = candidates.get(reading) ?? { primary: false, derivations: [] };
        if (
          !evidence.derivations!.some(
            (previous) =>
              previous.value === derivation.value &&
              previous.rules.join() === derivation.rules.join(),
          )
        )
          evidence.derivations!.push(derivation);
        candidates.set(reading, evidence);
      }
    }
  }
  // This later stage uses exact companions only. Voicing and yoon results
  // remain fixed, and their inferred readings cannot support new lengthening.
  const lengthenedReadings = onLengthening
    ? new Map([...readings].map(([character, candidates]) => [character, new Map(candidates)]))
    : undefined;
  if (lengthenedReadings !== undefined) {
    for (const [character, values] of unihanReadings) {
      const candidates = lengthenedReadings.get(character)!;
      for (const { reading, ...derivation } of deriveUnihanOnLengthenings(values)) {
        if (readings.get(character)!.has(reading)) continue;
        const evidence = candidates.get(reading) ?? { primary: false, derivations: [] };
        if (!evidence.derivations!.some((previous) => previous.value === derivation.value))
          evidence.derivations!.push(derivation);
        candidates.set(reading, evidence);
      }
    }
  }
  const irregularWords = new Map(
    [...irregularWordReadings].map(([spelling, values]) => [
      spelling,
      [...new Set(values.map(normalizeKana))],
    ]),
  );
  const seen = new Set<string>();
  const wordAlignments: WordAlignments = new Map();
  const witnesses: UnihanWitness[] = [];
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind !== "kanji") continue;
    const key = pairKey(pair.spelling, pair.reading);
    if (seen.has(key)) continue;
    seen.add(key);
    const original = align(pair.spelling, pair.reading);
    if (original.status !== "aligned") continue;
    const spellingUnits = splitGraphemes(pair.spelling);
    const coordinates = readingCoordinates(pair.reading);
    const ranges = findIrregularRanges(spellingUnits, coordinates, irregularWords);
    const readingFilter =
      supplementalReadingFilter === undefined
        ? undefined
        : (candidate: SpanCandidate) =>
            supplementalReadingFilter({
              ...candidate,
              followingSpelling: spellingUnits[candidate.spellingEnd],
              followingReading: coordinates.units.slice(candidate.readingEnd).join(""),
            });
    const characterEvidence: UnihanCharacterWitness[] = [];
    let segments = original.segments;
    // Exact source allocations take precedence over optional correspondences.
    // A competing phonological path must not erase an already supported split.
    for (const candidates of [readings, phonologicalReadings, lengthenedReadings]) {
      if (candidates === undefined) continue;
      let spellingOffset = 0;
      let readingOffset = 0;
      let previousCharacter: string | undefined;
      let previousReading: string | undefined;
      segments = segments.flatMap((segment, index) => {
        const spelling = segmentText(segment);
        const reading = segmentReading(segment);
        const following = segments[index + 1];
        const split = splitSpan(
          spelling,
          reading,
          candidates,
          ranges,
          spellingOffset,
          readingOffset,
          readingFilter,
          {
            iterationInheritance: candidates === lengthenedReadings,
            previousCharacter,
            previousReading,
            followingIterationReading:
              following !== undefined && segmentText(following) === "々"
                ? segmentReading(following)
                : undefined,
          },
        );
        spellingOffset += splitGraphemes(spelling).length;
        readingOffset += splitGraphemes(reading).length;
        const replacement = split?.segments ?? [segment];
        for (const part of replacement) {
          const text = segmentText(part);
          if (splitGraphemes(text).length === 1 && isIdeograph(text)) {
            if (text !== "々") previousCharacter = text;
            previousReading = segmentReading(part);
          } else {
            previousCharacter = undefined;
            previousReading = undefined;
          }
        }
        if (split === undefined) return replacement;
        characterEvidence.push(...split.witnesses);
        return split.segments;
      });
    }
    if (characterEvidence.length === 0) continue;
    validateAlignment(pair.spelling, pair.reading, segments);
    const variants = wordAlignments.get(pair.spelling) ?? new Map<string, Segment[]>();
    variants.set(pair.reading, segments);
    wordAlignments.set(pair.spelling, variants);
    witnesses.push({
      id: pair.id,
      spelling: pair.spelling,
      reading: pair.reading,
      characters: characterEvidence,
    });
  }
  return { wordAlignments, witnesses };
}
