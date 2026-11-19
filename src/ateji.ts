import { enumeratePairs } from "./sources.ts";
import {
  isIdeograph,
  isKana,
  kanaPronunciation,
  normalizeKana,
  readingStem,
  splitGraphemes,
} from "./kana.ts";
import { boundaries, segmentReading, segmentText, validateAlignment } from "./segments.ts";

const consonants = new Map(
  [
    ["あいうえおぁぃぅぇぉ", ""],
    ["かきくけこがぎぐげご", "k"],
    ["さしすせそざじずぜぞ", "s"],
    ["たちつてとだぢづでど", "t"],
    ["なにぬねの", "n"],
    ["はひふへほばびぶべぼぱぴぷぺぽ", "h"],
    ["まみむめも", "m"],
    ["やゆよゃゅょ", "y"],
    ["らりるれろ", "r"],
    ["わゐゑをゎ", "w"],
    ["ん", "N"],
    ["っ", "Q"],
  ].flatMap(([text, consonant]) => Array.from(text, (kana) => [kana, consonant])),
);

function morae(text) {
  return kanaPronunciation(text).match(/.[ぁぃぅぇぉゃゅょゎ]?/gu) ?? [];
}

function alternatives(reading) {
  const parts = morae(reading).filter((part) => part !== "ー");
  const result = [{ parts, cost: 0 }];
  if (parts.length > 1 && /^[いうくきちつん]$/u.test(parts.at(-1)))
    result.push({ parts: parts.slice(0, -1), cost: 2 });
  return result;
}

function phoneticCost(candidate, reading) {
  if (candidate.exact !== undefined)
    return normalizeKana(reading) === candidate.exact ? 0 : Infinity;
  const target = morae(reading).filter((part) => part !== "ー");
  if (candidate.parts.length !== target.length) return Infinity;
  let cost = candidate.cost;
  for (let index = 0; index < target.length; ++index) {
    const from = candidate.parts[index];
    const to = target[index];
    if (from === to) continue;
    const consonant = consonants.get(from[0]);
    if (consonant === undefined || consonant !== consonants.get(to[0])) return Infinity;
    // Phonetic spellings can use a different vowel or a voiced member of the
    // same consonant row; the consonant sequence itself must remain intact.
    cost += 2;
  }
  return cost <= 4 ? cost : Infinity;
}

function splitPhonetic(spelling, reading, onReadings) {
  const units = splitGraphemes(spelling);
  const readUnits = splitGraphemes(reading);
  if (units.length < 2 || !units.every(isIdeograph) || !isKana(reading)) return undefined;
  let paths = [{ end: 0, cost: 0, segments: [] }];
  for (const [index, character] of units.entries()) {
    const candidates = onReadings.get(character);
    if (candidates === undefined) return undefined;
    const next = [];
    for (const path of paths) {
      for (let end = path.end + 1; end <= readUnits.length - (units.length - index - 1); ++end) {
        const piece = readUnits.slice(path.end, end).join("");
        if (/^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizeKana(piece))) continue;
        const cost = Math.min(...candidates.map((candidate) => phoneticCost(candidate, piece)));
        if (!Number.isFinite(cost)) continue;
        next.push({
          end,
          cost: path.cost + cost,
          segments: [...path.segments, [character, piece]],
        });
      }
    }
    if (next.length > 5000) return undefined;
    paths = next;
  }
  const complete = paths.filter((path) => path.end === readUnits.length);
  if (complete.length === 0) return undefined;
  const cost = Math.min(...complete.map((path) => path.cost));
  const best = complete.filter((path) => path.cost === cost);
  if (best.length !== 1) return undefined;
  return best[0].segments;
}

/** Experimental phonetic correspondence, restricted to explicitly tagged ateji pairs. */
export function deriveAtejiAlignments(jmdict, characterReadings, align) {
  const onReadings = new Map();
  for (const [spelling, readings] of characterReadings) {
    const candidates = readings.flatMap((reading) =>
      /^[\p{Script=Katakana}ー]+$/u.test(reading)
        ? alternatives(readingStem(reading))
        : [{ exact: readingStem(reading) }],
    );
    if (candidates.length) onReadings.set(spelling, candidates);
  }
  const wordAlignments = new Map();
  const witnesses = [];
  for (const pair of enumeratePairs(jmdict)) {
    if (
      pair.kind !== "kanji" ||
      !pair.spellingTags.includes("ateji") ||
      pair.readingTags.includes("gikun")
    )
      continue;
    const original = align(pair.spelling, pair.reading);
    const segments = original.segments.flatMap(
      (segment) =>
        splitPhonetic(segmentText(segment), segmentReading(segment), onReadings) ?? [segment],
    );
    if (boundaries(segments).length <= boundaries(original.segments).length) continue;
    validateAlignment(pair.spelling, pair.reading, segments);
    const readings = wordAlignments.get(pair.spelling) ?? new Map();
    readings.set(pair.reading, segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({ id: pair.id, spelling: pair.spelling, reading: pair.reading });
  }
  return { wordAlignments, witnesses };
}
