import { deriveCharacterReadings } from "./lexicon.ts";
import { makeNanoriReadings } from "./sources.ts";
import { normalizeKana, readingStem } from "./kana.ts";
import { boundaries } from "./segments.ts";
import type { CharacterReadingWitness } from "./lexicon.ts";
import type { Alignment, JMdict, Kanjidic2, ReadingMap } from "./types.ts";

/** Where a weak reading came from, with the detail that kind of source records. */
export type WeakReadingSource =
  | { source: "KANJIDIC2 nanori" }
  | { source: "KANJIDIC2 complete kun reading"; original: string }
  | { source: "JMdict single-kanji spelling"; witness: CharacterReadingWitness };

export type WeakReadingWitness = { spelling: string; reading: string } & WeakReadingSource;

export interface WeakReadings {
  readings: ReadingMap;
  witnesses: WeakReadingWitness[];
}

/** Keep supplementary sound evidence weaker than ordinary on/kun readings. */
export function deriveWeakReadings(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  characterReadings: ReadingMap,
): WeakReadings {
  const readings: ReadingMap = new Map();
  const witnesses: WeakReadingWitness[] = [];
  const known = new Map(
    [...characterReadings].map(([spelling, values]) => [
      spelling,
      new Set(values.map(readingStem)),
    ]),
  );
  const add = (spelling: string, reading: string, source: WeakReadingSource) => {
    if (!reading || known.get(spelling)?.has(reading)) return;
    const values = readings.get(spelling) ?? [];
    if (!values.includes(reading)) values.push(reading);
    readings.set(spelling, values);
    witnesses.push({ spelling, reading, ...source });
  };
  for (const [spelling, values] of makeNanoriReadings(kanjidic)) {
    for (const reading of values)
      add(spelling, normalizeKana(reading), { source: "KANJIDIC2 nanori" });
  }
  for (const [spelling, values] of characterReadings) {
    for (const value of values) {
      if (!value.includes(".")) continue;
      add(spelling, normalizeKana(value.replaceAll(".", "").replace(/^-|-$/gu, "")), {
        source: "KANJIDIC2 complete kun reading",
        original: value,
      });
    }
  }
  for (const candidate of deriveCharacterReadings(jmdict, characterReadings).additions) {
    // A leading kana run can hide a long vowel or inserted consonant. Its
    // residual is local evidence only, never a reusable character reading.
    for (const witness of candidate.witnesses.filter((value) =>
      value.spelling.startsWith(candidate.character),
    )) {
      add(candidate.character, candidate.reading, {
        source: "JMdict single-kanji spelling",
        witness,
      });
    }
  }
  return { readings, witnesses };
}

/** Weaker readings may add boundaries, but cannot move a stronger boundary. */
export function refineAlignment(strong: Alignment, supplementary: Alignment): Alignment {
  const previous = new Set(boundaries(strong.segments));
  const candidate = new Set(boundaries(supplementary.segments));
  if (candidate.size <= previous.size || [...previous].some((boundary) => !candidate.has(boundary)))
    return strong;
  return supplementary;
}
