import { enumeratePairs, makeIrregularWordReadings, makeWordReadings } from "./sources.mjs";
import { isIdeograph, isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";

function validateReadings(map, name, annotated = false) {
  if (!(map instanceof Map)) throw new TypeError(`${name} must be a Map`);
  for (const [character, values] of map) {
    if (typeof character !== "string" || splitGraphemes(character).length !== 1 || !Array.isArray(values) || values.some(value =>
      typeof value !== "string" || !isKana(annotated ? value.replace(/[.-]/gu, "") : value)
    )) throw new TypeError(`${name} must contain character readings`);
  }
}

function compileReadings(characterReadings, weakCharacterReadings, unihanReadings, characterReadingBundle, jmdict) {
  validateReadings(characterReadings, "characterReadings", true);
  validateReadings(weakCharacterReadings, "weakCharacterReadings");
  validateReadings(unihanReadings, "unihanReadings");
  const exact = new Map();
  const native = new Map();
  const whole = new Map();
  function rememberWhole(character, reading) {
    const values = whole.get(character) ?? new Set();
    values.add(normalizeKana(reading));
    whole.set(character, values);
  }
  for (const [character, values] of characterReadings) {
    const candidates = new Map();
    const contractions = [];
    for (const value of values) {
      const reading = readingStem(value);
      const evidence = candidates.get(reading) ?? { primary: true, values: [] };
      if (!evidence.values.includes(value)) evidence.values.push(value);
      candidates.set(reading, evidence);
      rememberWhole(character, reading);
      rememberWhole(character, value.replace(/[.-]/gu, ""));
      // An annotated okurigana boundary is not permission to truncate its stem.
      if (!/^-?[ぁ-ゖー]+-?$/u.test(value)) continue;
      const morae = reading.match(/.[ぁぃぅぇぉゃゅょゎ]?/gu) ?? [];
      if (morae.length < 3) continue;
      contractions.push({ value, reading: morae.slice(0, -1).join(""), omittedMora: morae.at(-1) });
    }
    exact.set(character, candidates);
    native.set(character, contractions);
  }
  for (const map of [weakCharacterReadings, unihanReadings]) {
    for (const [character, values] of map) {
      const candidates = exact.get(character) ?? new Map();
      for (const value of values) {
        const reading = normalizeKana(value);
        if (!candidates.has(reading)) candidates.set(reading, { primary: false });
        rememberWhole(character, reading);
      }
      exact.set(character, candidates);
    }
  }
  for (const [character, values] of makeWordReadings(jmdict)) {
    if (!isIdeograph(character)) continue;
    const candidates = exact.get(character) ?? new Map();
    for (const value of values) {
      rememberWhole(character, value);
      const reading = normalizeKana(value);
      if (!candidates.has(reading)) candidates.set(reading, { primary: false });
    }
    exact.set(character, candidates);
  }
  if (characterReadingBundle !== undefined) {
    if (characterReadingBundle?.schemaVersion !== 1 || !Array.isArray(characterReadingBundle.readings)) throw new TypeError("Invalid character-reading bundle");
    for (const record of characterReadingBundle.readings) {
      if (typeof record.character !== "string" || !isIdeograph(record.character) || typeof record.reading !== "string" || !isKana(record.reading)) {
        throw new TypeError("Character-reading bundle must contain exact character sounds");
      }
      rememberWhole(record.character, record.reading);
      const candidates = exact.get(record.character) ?? new Map();
      const reading = normalizeKana(record.reading);
      if (!candidates.has(reading)) candidates.set(reading, { primary: false });
      exact.set(record.character, candidates);
    }
  }
  return { exact, native, whole };
}

function findIrregularRanges(written, reading, irregularWords) {
  const result = [];
  for (let start = 0; start < written.length; ++start) {
    for (let end = start + 1; end <= written.length; ++end) {
      const candidates = irregularWords.get(written.slice(start, end).join(""));
      if (candidates === undefined) continue;
      for (let readStart = 0; readStart < reading.length; ++readStart) {
        for (const candidate of candidates) {
          if (normalizeKana(reading.slice(readStart, readStart + candidate.length).join("")) === candidate.join("")) {
            result.push({ start, end, readStart, readEnd: readStart + candidate.length });
          }
        }
      }
    }
  }
  return result;
}

function refineSpan(written, reading, readings, ranges, writtenOffset, readingOffset) {
  const characters = splitGraphemes(written), kana = splitGraphemes(reading);
  if (characters.length < 2 || !characters.every(isIdeograph) || !isKana(reading)) return undefined;
  const normalizedSpan = normalizeKana(reading);
  const memo = new Map();
  function visit(index, offset, inferred) {
    if (index === characters.length) return offset === kana.length ? [{ segments: [], characters: [], companions: [], inferred, weakCompanion: false }] : [];
    const key = `${index}:${offset}:${inferred}`;
    if (memo.has(key)) return memo.get(key);
    const character = characters[index] === "々" ? characters[index - 1] : characters[index];
    const exact = readings.exact.get(character) ?? new Map();
    const native = readings.native.get(character) ?? [];
    const whole = readings.whole.get(character) ?? new Set();
    const remainder = normalizeKana(kana.slice(offset).join(""));
    const solutions = [];
    for (let end = offset + 1; end <= kana.length - (characters.length - index - 1); ++end) {
      const piece = kana.slice(offset, end).join("");
      const target = normalizeKana(piece);
      if (/^[ぁぃぅぇぉゃゅょゎっんー]/u.test(target)) continue;
      const direct = exact.get(target);
      const irregular = ranges.some(range => range.start <= writtenOffset + index && writtenOffset + index < range.end &&
        range.readStart <= readingOffset + offset && readingOffset + end <= range.readEnd);
      if (direct !== undefined && !direct.primary && irregular) continue;
      // A full known reading that crosses the proposed cut can explain the
      // apparent contraction as a redundant spelling, even inside a longer word.
      const shadow = whole.has(normalizedSpan) || [...whole].some(value => value.length > target.length && remainder.startsWith(value));
      const derivations = direct !== undefined || inferred || irregular || shadow ? [] : native.filter(value => value.reading === target);
      if (direct === undefined && derivations.length === 0) continue;
      const evidence = derivations.length === 0 ? [] : [{
        character,
        written: characters[index],
        reading: piece,
        codepoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
        rule: "attested-native-final-mora-contraction",
        derivations: derivations.map(({ value, omittedMora }) => ({ source: "KANJIDIC2", field: "ja_kun", value, omittedMora })),
        span: { written, reading, writtenStart: writtenOffset, readingStart: readingOffset }
      }];
      const companions = direct?.primary ? [{ character, written: characters[index], reading: piece, source: "KANJIDIC2", values: direct.values }] : [];
      for (const suffix of visit(index + 1, end, inferred || derivations.length > 0)) {
        solutions.push({
          segments: [[characters[index], piece], ...suffix.segments],
          characters: [...evidence, ...suffix.characters],
          companions: [...companions, ...suffix.companions],
          inferred: suffix.inferred,
          weakCompanion: Boolean(direct && !direct.primary) || suffix.weakCompanion
        });
        if (solutions.length === 2) break;
      }
      if (solutions.length === 2) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const paths = visit(0, 0, false);
  // Weaker complete alternatives still defeat uniqueness, even though they
  // cannot serve as companions to a new native contraction themselves.
  return paths.length === 1 && paths[0].inferred && !paths[0].weakCompanion ? paths[0] : undefined;
}

/** Refine exact attested compounds without adding unrestricted character readings. */
export function deriveNativeCompoundAlignments(jmdict, characterReadings, align, {
  weakCharacterReadings = new Map(),
  unihanReadings = new Map(),
  characterReadingBundle
} = {}) {
  const readings = compileReadings(characterReadings, weakCharacterReadings, unihanReadings, characterReadingBundle, jmdict);
  const irregularWords = new Map([...makeIrregularWordReadings(jmdict)].map(([written, values]) => [written, values.map(value => splitGraphemes(normalizeKana(value)))]));
  const wordAlignments = new Map();
  const witnesses = [];
  const seen = new Set();
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind !== "written") continue;
    const key = pairKey(pair.written, pair.reading);
    if (seen.has(key)) continue;
    seen.add(key);
    const original = align(pair.written, pair.reading);
    if (original.status !== "aligned") continue;
    if (!original.segments.some(segment => {
      if (typeof segment === "string") return false;
      const units = splitGraphemes(segment[0]);
      return units.length > 1 && units.every(isIdeograph);
    })) continue;
    const ranges = findIrregularRanges(splitGraphemes(pair.written), splitGraphemes(pair.reading), irregularWords);
    const characters = [];
    const companions = [];
    let writtenOffset = 0, readingOffset = 0;
    const segments = original.segments.flatMap(segment => {
      const written = segmentText(segment), reading = segmentReading(segment);
      const result = refineSpan(written, reading, readings, ranges, writtenOffset, readingOffset);
      writtenOffset += splitGraphemes(written).length;
      readingOffset += splitGraphemes(reading).length;
      if (result === undefined) return [segment];
      characters.push(...result.characters);
      companions.push(...result.companions);
      return result.segments;
    });
    if (characters.length === 0) continue;
    validateAlignment(pair.written, pair.reading, segments);
    const variants = wordAlignments.get(pair.written) ?? new Map();
    variants.set(pair.reading, segments);
    wordAlignments.set(pair.written, variants);
    witnesses.push({ id: pair.id, written: pair.written, reading: pair.reading, characters, companions });
  }
  return { wordAlignments, witnesses };
}
