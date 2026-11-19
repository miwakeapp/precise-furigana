import { enumeratePairs } from "./sources.ts";
import { splitGraphemes } from "./kana.ts";
import { boundaries, segmentReading, segmentText, validateAlignment } from "./segments.ts";
import type {
  Aligner,
  Alignment,
  JMdict,
  JMdictSense,
  PassResult,
  ReadingMap,
  Segment,
  WordAlignments,
} from "./types.ts";

export interface NumeralReadingWitness {
  id: string;
  /** The number in decimal digits. */
  spelling: string;
  reading: string;
  /** The English number word that the entry is defined as. */
  definition: string;
}

export interface NumeralReadings {
  readings: ReadingMap;
  witnesses: NumeralReadingWitness[];
}

export interface NumeralAlignmentOptions {
  /** An aligner that knows the foreign number words, used for decimal digits. */
  foreignAlign?: Aligner;
}

export interface NumeralAlignmentWitness {
  id: string;
  spelling: string;
  reading: string;
  /** The equivalent spelling whose alignment was carried over, or a description of the source. */
  from: string;
}

const digits = "〇一二三四五六七八九";
const largeUnits = ["", "万", "億", "兆", "京"];
const numberNames = new Map<string, string>([
  ...[
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ].map((name, index): [string, string] => [name, String(index)]),
  ["thirty", "30"],
  ["forty", "40"],
  ["fifty", "50"],
  ["sixty", "60"],
  ["seventy", "70"],
  ["eighty", "80"],
  ["ninety", "90"],
  ["hundred", "100"],
  ["thousand", "1000"],
  ["million", "1000000"],
  ["billion", "1000000000"],
]);

/** Derive numeral sounds from exact dictionary definitions of number words. */
export function deriveNumeralReadings(jmdict: JMdict, wordReadings: ReadingMap): NumeralReadings {
  const readings = new Map([...wordReadings].map(([spelling, values]) => [spelling, [...values]]));
  const witnesses: NumeralReadingWitness[] = [];
  for (const word of jmdict.words) {
    // Written numeral entries already supply their readings. This layer
    // covers standalone kana number words, not incidental translations of
    // counters, names, abbreviations, or specialized kanji senses.
    if (word.kanji.length !== 0) continue;
    for (const sense of word.sense) {
      const definitions =
        sense.gloss?.filter((gloss) => gloss.lang === "eng" && numberNames.has(gloss.text)) ?? [];
      for (const definition of definitions) {
        const spelling = numberNames.get(definition.text)!;
        const fullwidth = spelling.replace(/[0-9]/gu, (digit) =>
          String.fromCodePoint(digit.codePointAt(0)! + 0xfee0),
        );
        for (const kana of word.kana) {
          if (
            !/^[ァ-ヶー]+$/u.test(kana.text) ||
            !sense.appliesToKana?.some((form) => form === "*" || form === kana.text)
          )
            continue;
          for (const form of [spelling, fullwidth]) {
            const values = readings.get(form) ?? [];
            if (!values.includes(kana.text)) values.push(kana.text);
            readings.set(form, values);
          }
          witnesses.push({
            id: word.id,
            spelling,
            reading: kana.text,
            definition: definition.text,
          });
        }
      }
    }
  }
  return { readings, witnesses };
}

function cardinalSpelling(text: string): string | undefined {
  if (text.length > largeUnits.length * 4) return undefined;
  const stripped = text.replace(/^0+/u, "") || "0";
  if (stripped === "0") return "零";
  const groups: string[] = [];
  for (let end = stripped.length, unit = 0; end > 0; end -= 4, ++unit) {
    const part = stripped.slice(Math.max(0, end - 4), end).padStart(4, "0");
    let group = "";
    for (let index = 0; index < 4; ++index) {
      const digit = Number(part[index]);
      if (digit === 0) continue;
      if (digit !== 1 || index === 3) group += digits[digit];
      group += ["千", "百", "十", ""][index];
    }
    if (group) groups.unshift(group + largeUnits[unit]);
  }
  return groups.join("");
}

type NumeralStyle = "width" | "cardinal" | "digits";

/** A spelling with its numerals rewritten, and how its offsets map back to the original. */
interface Transformation {
  spelling: string;
  /** The graphemes of the original spelling. */
  original: string[];
  /** Grapheme offset in the rewritten spelling to the matching offset in the original. */
  offsets: Map<number, number>;
}

function transform(spelling: string, style: NumeralStyle): Transformation | undefined {
  const units = splitGraphemes(spelling);
  const offsets = new Map<number, number>([[0, 0]]);
  const parts: string[] = [];
  let sourceOffset = 0;
  for (let index = 0; index < units.length;) {
    let end = index + 1;
    let replacement: string | undefined;
    if (/^[0-9０-９]$/u.test(units[index])) {
      while (end < units.length && /^[0-9０-９]$/u.test(units[end])) ++end;
      const decimal = units.slice(index, end).join("").normalize("NFKC");
      replacement =
        style === "width"
          ? decimal
          : style === "cardinal"
            ? cardinalSpelling(decimal)
            : Array.from(decimal, (digit) => digits[Number(digit)]).join("");
      if (replacement === undefined) return undefined;
    } else {
      replacement = /^[\uFF01-\uFF60]$/u.test(units[index])
        ? units[index].normalize("NFKC")
        : units[index];
    }
    parts.push(replacement);
    sourceOffset += splitGraphemes(replacement).length;
    // Keep positional decimal numerals together: individual digits need not
    // have separately pronounceable readings, especially the zeros in `１００`.
    offsets.set(sourceOffset, end);
    index = end;
  }
  return { spelling: parts.join(""), original: units, offsets };
}

function transfer(
  transformation: Transformation,
  reading: string,
  result: Alignment,
): Segment[] | undefined {
  if (result.status !== "aligned") return undefined;
  const segments: Segment[] = [];
  let sourceOffset = 0;
  let originalOffset = 0;
  let pendingReading = "";
  for (const part of result.segments) {
    sourceOffset += splitGraphemes(segmentText(part)).length;
    pendingReading += segmentReading(part);
    const end = transformation.offsets.get(sourceOffset);
    if (end === undefined) continue;
    const spelling = transformation.original.slice(originalOffset, end).join("");
    if (spelling === pendingReading) {
      if (typeof segments.at(-1) === "string") segments[segments.length - 1] += spelling;
      else segments.push(spelling);
    } else segments.push([spelling, pendingReading]);
    originalOffset = end;
    pendingReading = "";
  }
  if (pendingReading || originalOffset !== transformation.original.length) return undefined;
  validateAlignment(transformation.original.join(""), reading, segments);
  return segments;
}

/** Transfer sound boundaries through equivalent decimal and fullwidth spellings. */
export function deriveNumeralAlignments(
  jmdict: JMdict,
  align: Aligner,
  { foreignAlign }: NumeralAlignmentOptions = {},
): PassResult<NumeralAlignmentWitness> {
  const wordAlignments: WordAlignments = new Map();
  const witnesses: NumeralAlignmentWitness[] = [];
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind !== "kanji" || !/[0-9\uFF01-\uFF60]/u.test(pair.spelling)) continue;
    const alternatives: { segments: Segment[]; from: string }[] = [];
    for (const style of ["width", "cardinal", "digits"] as const) {
      const transformation = transform(pair.spelling, style);
      if (transformation === undefined || transformation.spelling === pair.spelling) continue;
      const segments = transfer(
        transformation,
        pair.reading,
        align(transformation.spelling, pair.reading),
      );
      if (segments === undefined) continue;
      alternatives.push({ segments, from: transformation.spelling });
    }
    // Choose a refinement only if it preserves every boundary from every
    // supported interpretation; differing allocations remain unresolved.
    let candidate = alternatives.find((option) => {
      const available = new Set(boundaries(option.segments));
      return alternatives.every((other) =>
        boundaries(other.segments).every((boundary) => available.has(boundary)),
      );
    });
    if (foreignAlign !== undefined && /[0-9０-９]/u.test(pair.spelling)) {
      const result = foreignAlign(pair.spelling, pair.reading);
      const available = new Set(boundaries(result.segments));
      if (
        result.status === "aligned" &&
        alternatives.every((other) =>
          boundaries(other.segments).every((boundary) => available.has(boundary)),
        )
      ) {
        candidate = { segments: result.segments, from: "JMdict number-word definitions" };
      }
    }
    if (candidate === undefined) continue;
    const readings = wordAlignments.get(pair.spelling) ?? new Map();
    readings.set(pair.reading, candidate.segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({
      id: pair.id,
      spelling: pair.spelling,
      reading: pair.reading,
      from: candidate.from,
    });
  }
  return { wordAlignments, witnesses };
}
