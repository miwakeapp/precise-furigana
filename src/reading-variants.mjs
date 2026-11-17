import { enumeratePairs } from "./sources.mjs";
import { isKana, kanaPronunciation, normalizeKana, splitGraphemes } from "./kana.mjs";
import { boundaries, pairKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";

function soundKey(reading) {
  return kanaPronunciation(reading).replaceAll("ー", "");
}

function transferReadings(source, targetReading) {
  const target = splitGraphemes(targetReading);
  let paths = [{ end: 0, segments: [] }];
  for (const segment of source.segments) {
    const spelling = segmentText(segment);
    const reading = segmentReading(segment);
    const literal = normalizeKana(spelling) === normalizeKana(reading);
    const key = soundKey(reading);
    const next = [];
    for (const path of paths) {
      for (let end = path.end + 1; end <= target.length; ++end) {
        const candidate = target.slice(path.end, end).join("");
        if (literal ? normalizeKana(candidate) !== normalizeKana(reading) : soundKey(candidate) !== key) continue;
        next.push({ end, segments: [...path.segments, spelling === candidate ? spelling : [spelling, candidate]] });
      }
    }
    // Ambiguous repeated vowels cannot establish a unique character boundary.
    if (next.length > 32) return undefined;
    paths = next;
  }
  const complete = paths.filter(path => path.end === target.length);
  if (complete.length !== 1) return undefined;
  return complete[0].segments;
}

function normalizedBoundaries(segments) {
  return boundaries(segments.map(segment => [segmentText(segment), normalizeKana(segmentReading(segment))]));
}

/** Transfer boundaries only between attested readings of the same spelling and entry. */
export function deriveReadingVariantAlignments(jmdict, align, { targetAlignments = new Map() } = {}) {
  if (!(targetAlignments instanceof Map)) throw new TypeError("targetAlignments must be a Map");
  const constraints = new Map();
  for (const [spelling, readings] of targetAlignments) {
    if (typeof spelling !== "string" || !(readings instanceof Map)) throw new TypeError("Target alignments require spelling and reading maps");
    for (const [reading, segments] of readings) {
      if (typeof reading !== "string") throw new TypeError("Target alignment readings must be strings");
      validateAlignment(spelling, reading, segments);
      const key = pairKey(spelling, normalizeKana(reading));
      constraints.set(key, new Set([...(constraints.get(key) ?? []), ...normalizedBoundaries(segments)]));
    }
  }
  const cache = new Map();
  const candidates = new Map();
  for (const word of jmdict.words) {
    const spellings = new Map();
    for (const pair of enumeratePairs({ words: [word] })) {
      if (pair.kind !== "kanji" || !isKana(pair.reading)) continue;
      const readings = spellings.get(pair.spelling) ?? new Set();
      readings.add(pair.reading);
      spellings.set(pair.spelling, readings);
    }
    for (const [spelling, readings] of spellings) {
      if (readings.size < 2) continue;
      for (const from of readings) {
        const targets = [...readings].filter(to => to !== from && soundKey(to) === soundKey(from));
        if (targets.length === 0) continue;
        const key = pairKey(spelling, from);
        let source = cache.get(key);
        if (source === undefined) {
          source = align(spelling, from);
          cache.set(key, source);
        }
        if (source.status !== "aligned" || source.segments.length < 2) continue;
        for (const reading of targets) {
          const segments = transferReadings(source, reading);
          if (segments === undefined) continue;
          validateAlignment(spelling, reading, segments);
          const required = constraints.get(pairKey(spelling, normalizeKana(reading)));
          if (required !== undefined) {
            const available = new Set(normalizedBoundaries(segments));
            // A unique vowel transfer can still misassign the following
            // character's onset. Exact target evidence only vetoes transfers;
            // it never supplies a source alignment or character reading.
            if ([...required].some(boundary => !available.has(boundary))) continue;
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
          if (boundaries(target.segments).some(boundary => !available.has(boundary))) continue;
          const values = candidates.get(targetKey) ?? [];
          values.push({ spelling, reading, segments, id: word.id, from });
          candidates.set(targetKey, values);
        }
      }
    }
  }
  const wordAlignments = new Map();
  const witnesses = [];
  for (const values of candidates.values()) {
    const candidate = values.find(value => {
      const available = new Set(boundaries(value.segments));
      return values.every(other => boundaries(other.segments).every(boundary => available.has(boundary)));
    });
    if (candidate === undefined) continue;
    const readings = wordAlignments.get(candidate.spelling) ?? new Map();
    readings.set(candidate.reading, candidate.segments);
    wordAlignments.set(candidate.spelling, readings);
    witnesses.push({ id: candidate.id, spelling: candidate.spelling, reading: candidate.reading, from: candidate.from });
  }
  return { wordAlignments, witnesses };
}
