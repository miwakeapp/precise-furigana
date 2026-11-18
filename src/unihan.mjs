import { enumeratePairs, makeIrregularWordReadings } from "./sources.mjs";
import { isIdeograph, isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";
import {
  deriveUnihanOnLengthenings,
  deriveUnihanReadingVariants,
  matchesIterationReading,
} from "./unihan-phonology.mjs";

/** Parse exact `kJapanese` values without guessing okurigana or inflections. */
export function parseUnihanReadings(text) {
  if (typeof text !== "string") throw new TypeError("Unihan readings must be supplied as text");
  const result = new Map();
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

function validateReadingMap(map, name) {
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

function readingCoordinates(reading) {
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

function findIrregularRanges(spelling, reading, irregularWords) {
  const ranges = [];
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
  spelling,
  reading,
  readings,
  ranges,
  spellingOffset,
  readingOffset,
  supplementalReadingFilter,
  {
    iterationInheritance = false,
    previousCharacter,
    previousReading,
    followingIterationReading,
  } = {},
) {
  const characters = splitGraphemes(spelling);
  const kana = splitGraphemes(reading);
  if (characters.length < 2 || !characters.every(isIdeograph) || !isKana(reading)) return undefined;
  const memo = new Map();
  const resolvedCharacters = characters.map((character, index) => {
    if (character !== "々") previousCharacter = character;
    return character === "々" ? previousCharacter : characters[index];
  });
  function visit(index, offset, precedingReading) {
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
    if (memo.has(key)) return memo.get(key);
    const character = iterationInheritance
      ? resolvedCharacters[index]
      : characters[index] === "々"
        ? characters[index - 1]
        : characters[index];
    const candidates = readings.get(character);
    if (candidates === undefined) return [];
    const solutions = [];
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
                codepoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
                values:
                  derivations === undefined
                    ? evidence.values
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
  jmdict,
  characterReadings,
  unihanReadings,
  align,
  {
    irregularWordReadings = makeIrregularWordReadings(jmdict),
    weakCharacterReadings = new Map(),
    supplementalVoicing = false,
    yoonSimplification = false,
    onLengthening = false,
    supplementalReadingFilter,
  } = {},
) {
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
  const readings = new Map();
  for (const [character, values] of characterReadings) {
    readings.set(
      character,
      new Map(
        values
          .map(readingStem)
          .filter(Boolean)
          .map((value) => [value, { primary: true, values: [] }]),
      ),
    );
  }
  for (const [character, values] of weakCharacterReadings) {
    const candidates = readings.get(character) ?? new Map();
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
    const candidates = readings.get(character) ?? new Map();
    for (const value of values) {
      if (!isKana(value)) throw new TypeError("Unihan readings must contain exact kana text");
      const normalized = normalizeKana(value);
      const evidence = candidates.get(normalized) ?? { primary: false, values: [] };
      if (!evidence.values.includes(value)) evidence.values.push(value);
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
      const candidates = phonologicalReadings.get(character);
      for (const { reading, ...derivation } of deriveUnihanReadingVariants(
        values,
        knownReadings.get(character) ?? new Set(),
        { supplementalVoicing, yoonSimplification },
      )) {
        const exact = readings.get(character).has(reading);
        if (exact) continue;
        const evidence = candidates.get(reading) ?? { primary: false, derivations: [] };
        if (
          !evidence.derivations.some(
            (previous) =>
              previous.value === derivation.value &&
              previous.rules.join() === derivation.rules.join(),
          )
        )
          evidence.derivations.push(derivation);
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
      const candidates = lengthenedReadings.get(character);
      for (const { reading, ...derivation } of deriveUnihanOnLengthenings(values)) {
        if (readings.get(character).has(reading)) continue;
        const evidence = candidates.get(reading) ?? { primary: false, derivations: [] };
        if (!evidence.derivations.some((previous) => previous.value === derivation.value))
          evidence.derivations.push(derivation);
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
  const seen = new Set();
  const wordAlignments = new Map();
  const witnesses = [];
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
        : (candidate) =>
            supplementalReadingFilter({
              ...candidate,
              followingSpelling: spellingUnits[candidate.spellingEnd],
              followingReading: coordinates.units.slice(candidate.readingEnd).join(""),
            });
    const characterEvidence = [];
    let segments = original.segments;
    // Exact source allocations take precedence over optional correspondences.
    // A competing phonological path must not erase an already supported split.
    for (const candidates of [readings, phonologicalReadings, lengthenedReadings]) {
      if (candidates === undefined) continue;
      let spellingOffset = 0;
      let readingOffset = 0;
      let previousCharacter;
      let previousReading;
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
    const variants = wordAlignments.get(pair.spelling) ?? new Map();
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
