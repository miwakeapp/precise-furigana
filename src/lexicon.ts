import { isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.ts";
import { enumeratePairs } from "./sources.ts";
import type { JMdict, ReadingMap } from "./types.ts";

/** A JMdict pair whose single kanji, once its surrounding kana is taken away, has the reading. */
export interface CharacterReadingWitness {
  id: string;
  spelling: string;
  reading: string;
}

/** A reading for a character that the base map does not already list. */
export interface CharacterReadingCandidate {
  character: string;
  reading: string;
  witnesses: CharacterReadingWitness[];
}

export interface DerivedCharacterReadings {
  /** The base map's readings, followed by the additions. */
  characterReadings: ReadingMap;
  additions: CharacterReadingCandidate[];
}

const hanGraphemePattern = /^\p{Unified_Ideograph}[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]*$/u;
const excludedReadingTags = new Set(["ik", "sk"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Derive candidates from a single written kanji and exact surrounding kana, keeping source witnesses. */
export function deriveCharacterReadings(
  jmdict: JMdict,
  baseMap: ReadingMap = new Map(),
): DerivedCharacterReadings {
  const characterReadings: ReadingMap = new Map(
    [...baseMap].map(([character, readings]) => [character, [...readings]]),
  );
  const baseReadings = new Map(
    [...baseMap].map(([character, readings]) => [character, new Set(readings.map(readingStem))]),
  );
  const candidates = new Map<string, CharacterReadingCandidate>();

  for (const pair of enumeratePairs(jmdict)) {
    if (
      pair.kind !== "kanji" ||
      pair.readingTags.some((tag) => excludedReadingTags.has(tag)) ||
      !isKana(pair.reading)
    ) {
      continue;
    }
    const graphemes = splitGraphemes(pair.spelling);
    const characterIndex = graphemes.findIndex((grapheme) => hanGraphemePattern.test(grapheme));
    if (
      characterIndex === -1 ||
      graphemes.some((grapheme, index) => index !== characterIndex && !isKana(grapheme))
    ) {
      continue;
    }
    const character = graphemes[characterIndex];
    const prefix = normalizeKana(graphemes.slice(0, characterIndex).join(""));
    const suffix = normalizeKana(graphemes.slice(characterIndex + 1).join(""));
    const wholeReading = normalizeKana(pair.reading);
    if (
      !wholeReading.startsWith(prefix) ||
      !wholeReading.endsWith(suffix) ||
      prefix.length + suffix.length >= wholeReading.length
    ) {
      continue;
    }
    const reading = wholeReading.slice(prefix.length, wholeReading.length - suffix.length);
    if (!isKana(reading) || baseReadings.get(character)?.has(reading)) {
      continue;
    }

    const candidateKey = `${character}\t${reading}`;
    let candidate = candidates.get(candidateKey);
    if (candidate === undefined) {
      candidate = { character, reading, witnesses: [] };
      candidates.set(candidateKey, candidate);
    }
    if (
      !candidate.witnesses.some(
        (witness) =>
          witness.id === pair.id &&
          witness.spelling === pair.spelling &&
          witness.reading === pair.reading,
      )
    ) {
      candidate.witnesses.push({ id: pair.id, spelling: pair.spelling, reading: pair.reading });
    }
  }

  const additions = [...candidates.values()].sort(
    (left, right) =>
      compareText(left.character, right.character) || compareText(left.reading, right.reading),
  );
  for (const addition of additions) {
    const readings = characterReadings.get(addition.character);
    if (readings === undefined) {
      characterReadings.set(addition.character, [addition.reading]);
    } else {
      readings.push(addition.reading);
    }
  }
  return { characterReadings, additions };
}
