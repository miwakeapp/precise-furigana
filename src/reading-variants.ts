import { enumeratePairs } from "./sources.ts";
import { getKanaVowels, isKana, kanaPronunciation, normalizeKana, splitGraphemes } from "./kana.ts";
import { boundaries, pairKey, segmentReading, segmentText, validateAlignment } from "./segments.ts";
import type { Aligner, Alignment, JMdict, PassResult, Segment, WordAlignments } from "./types.ts";

export interface ReadingVariantOptions {
  /** Alignments already established for target pairs. A transfer must keep their boundaries. */
  targetAlignments?: WordAlignments;
  /** Also transfer between readings that differ by one kana. */
  nearVariants?: boolean;
}

export interface ReadingVariantWitness {
  id: string;
  spelling: string;
  reading: string;
  /** The reading whose alignment was carried over. */
  from: string;
}

function soundKey(reading: string): string {
  return kanaPronunciation(reading).replaceAll("ー", "");
}

function transferReadings(source: Alignment, targetReading: string): Segment[] | undefined {
  const target = splitGraphemes(targetReading);
  let paths: { end: number; segments: Segment[] }[] = [{ end: 0, segments: [] }];
  for (const segment of source.segments) {
    const spelling = segmentText(segment);
    const reading = segmentReading(segment);
    const literal = normalizeKana(spelling) === normalizeKana(reading);
    const key = soundKey(reading);
    const next: typeof paths = [];
    for (const path of paths) {
      for (let end = path.end + 1; end <= target.length; ++end) {
        const candidate = target.slice(path.end, end).join("");
        if (
          literal
            ? normalizeKana(candidate) !== normalizeKana(reading)
            : soundKey(candidate) !== key
        )
          continue;
        next.push({
          end,
          segments: [...path.segments, spelling === candidate ? spelling : [spelling, candidate]],
        });
      }
    }
    // Ambiguous repeated vowels cannot establish a unique character boundary.
    if (next.length > 32) return undefined;
    paths = next;
  }
  const complete = paths.filter((path) => path.end === target.length);
  if (complete.length !== 1) return undefined;
  return complete[0].segments;
}

// Kana that cannot begin a reading: small kana, the sokuon, ん, and the long-vowel mark.
const dependentKana = /^[ぁぃぅぇぉゃゅょゎっんー]$/u;
// Kana that are written differently but stand for the same kana in another orthography.
const writtenAs = new Map(
  [..."ぁあぃいぅうぇえぉおゃやゅゆょよゎわっつづずぢじをおゑえゐい"].flatMap(
    (kana, index, all): [string, string][] => (index % 2 === 0 ? [[kana, all[index + 1]]] : []),
  ),
);
const written = (kana: string): string => writtenAs.get(kana) ?? kana;
/** Whether a kana only extends the one before it, by lengthening its vowel or by being unable to stand alone. */
const extendsKana = (previous: string | undefined, kana: string): boolean =>
  previous !== undefined &&
  (dependentKana.test(kana) || (getKanaVowels(previous) ?? []).includes(kana));

/**
 * Carry boundaries to a reading that differs from the source's by one kana, as バンコック
 * does from バンコク or いちこち from いちこつ. The readings are one word's pronunciations,
 * so the change stays inside the segment it falls in. That is only certain when the changed
 * kana cannot have crossed a boundary: a replaced kana must leave its segment another kana,
 * or be the same kana in another orthography, and an added or dropped kana must be one that
 * only extends the kana before it. A respelling can leave a segment starting inside a syllable,
 * as しょう from しよう leaves 仕[し] 様[ょう]: the contracted sound stays with its character.
 */
function transferNearReading(source: Alignment, targetReading: string): Segment[] | undefined {
  const from = source.segments.flatMap((segment, index) =>
    splitGraphemes(segmentReading(segment)).map((kana) => ({ kana: normalizeKana(kana), index })),
  );
  const target = splitGraphemes(targetReading);
  const to = target.map((kana) => normalizeKana(kana));
  let prefix = 0;
  while (prefix < from.length && prefix < to.length && from[prefix].kana === to[prefix]) ++prefix;
  let suffix = 0;
  while (
    suffix < from.length - prefix &&
    suffix < to.length - prefix &&
    from.at(-1 - suffix)!.kana === to.at(-1 - suffix)
  )
    ++suffix;
  const removed = from.length - prefix - suffix,
    added = to.length - prefix - suffix;
  if (removed > 1 || added > 1 || removed + added === 0) return undefined;
  const sizes = source.segments.map(
    (_, index) => from.filter((unit) => unit.index === index).length,
  );
  const before = from[prefix - 1];
  if (removed === 0) {
    if (!extendsKana(before?.kana, to[prefix])) return undefined;
    ++sizes[before.index];
  } else {
    const { kana, index } = from[prefix];
    if (added === 1) {
      if (sizes[index] < 2 && written(kana) !== written(to[prefix])) return undefined;
    } else {
      if (before?.index !== index || !extendsKana(before.kana, kana)) return undefined;
      --sizes[index];
    }
  }
  const segments: Segment[] = [];
  let offset = 0;
  for (const [index, segment] of source.segments.entries()) {
    const spelling = segmentText(segment);
    const candidate = target.slice(offset, offset + sizes[index]).join("");
    offset += sizes[index];
    const reading = normalizeKana(segmentReading(segment));
    if (normalizeKana(spelling) === reading && normalizeKana(candidate) !== reading)
      return undefined;
    segments.push(spelling === candidate ? spelling : [spelling, candidate]);
  }
  return segments;
}

function normalizedBoundaries(segments: Segment[]): string[] {
  return boundaries(
    segments.map((segment) => [segmentText(segment), normalizeKana(segmentReading(segment))]),
  );
}

/** A witness together with the segments it proposes for its pair. */
interface ReadingVariantCandidate extends ReadingVariantWitness {
  segments: Segment[];
}

/**
 * Transfer boundaries only between attested readings of the same spelling and entry. The
 * readings must sound alike apart from vowel length, or, with `nearVariants`, differ by one kana.
 */
export function deriveReadingVariantAlignments(
  jmdict: JMdict,
  align: Aligner,
  { targetAlignments = new Map(), nearVariants = false }: ReadingVariantOptions = {},
): PassResult<ReadingVariantWitness> {
  const constraints = new Map<string, Set<string>>();
  for (const [spelling, readings] of targetAlignments) {
    for (const [reading, segments] of readings) {
      validateAlignment(spelling, reading, segments);
      const key = pairKey(spelling, normalizeKana(reading));
      constraints.set(
        key,
        new Set([...(constraints.get(key) ?? []), ...normalizedBoundaries(segments)]),
      );
    }
  }
  const cache = new Map<string, Alignment>();
  const candidates = new Map<string, ReadingVariantCandidate[]>();
  for (const word of jmdict.words) {
    const spellings = new Map<string, Set<string>>();
    for (const pair of enumeratePairs({ words: [word] })) {
      if (pair.kind !== "kanji" || !isKana(pair.reading)) continue;
      const readings = spellings.get(pair.spelling) ?? new Set();
      readings.add(pair.reading);
      spellings.set(pair.spelling, readings);
    }
    for (const [spelling, readings] of spellings) {
      if (readings.size < 2) continue;
      for (const from of readings) {
        const targets = [...readings].filter(
          (to) => to !== from && (nearVariants || soundKey(to) === soundKey(from)),
        );
        if (targets.length === 0) continue;
        const key = pairKey(spelling, from);
        let source = cache.get(key);
        if (source === undefined) {
          source = align(spelling, from);
          cache.set(key, source);
        }
        if (source.status !== "aligned" || source.segments.length < 2) continue;
        for (const reading of targets) {
          const segments =
            soundKey(reading) === soundKey(from)
              ? transferReadings(source, reading)
              : transferNearReading(source, reading);
          if (segments === undefined) continue;
          validateAlignment(spelling, reading, segments);
          const required = constraints.get(pairKey(spelling, normalizeKana(reading)));
          if (required !== undefined) {
            const available = new Set(normalizedBoundaries(segments));
            // A unique vowel transfer can still misassign the following
            // character's onset. Exact target evidence only vetoes transfers;
            // it never supplies a source alignment or character reading.
            if ([...required].some((boundary) => !available.has(boundary))) continue;
          }
          const targetKey = pairKey(spelling, reading);
          let target = cache.get(targetKey);
          if (target === undefined) {
            target = align(spelling, reading);
            cache.set(targetKey, target);
          }
          const available = new Set(boundaries(segments));
          // A vowel-length variant does not overrule a boundary already
          // established for this reading, as in `見[み] 出[いだ] す`.
          if (boundaries(target.segments).some((boundary) => !available.has(boundary))) continue;
          const values = candidates.get(targetKey) ?? [];
          values.push({ spelling, reading, segments, id: word.id, from });
          candidates.set(targetKey, values);
        }
      }
    }
  }
  const wordAlignments: WordAlignments = new Map();
  const witnesses: ReadingVariantWitness[] = [];
  for (const values of candidates.values()) {
    const candidate = values.find((value) => {
      const available = new Set(boundaries(value.segments));
      return values.every((other) =>
        boundaries(other.segments).every((boundary) => available.has(boundary)),
      );
    });
    if (candidate === undefined) continue;
    const readings = wordAlignments.get(candidate.spelling) ?? new Map();
    readings.set(candidate.reading, candidate.segments);
    wordAlignments.set(candidate.spelling, readings);
    witnesses.push({
      id: candidate.id,
      spelling: candidate.spelling,
      reading: candidate.reading,
      from: candidate.from,
    });
  }
  return { wordAlignments, witnesses };
}
