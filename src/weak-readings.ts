import { deriveCharacterReadings } from "./lexicon.ts";
import { makeNanoriReadings } from "./sources.ts";
import { normalizeKana, readingStem } from "./kana.ts";
import { boundaries } from "./segments.ts";

/** Keep supplementary sound evidence weaker than ordinary on/kun readings. */
export function deriveWeakReadings(jmdict, kanjidic, characterReadings) {
  const readings = new Map();
  const witnesses = [];
  const known = new Map(
    [...characterReadings].map(([spelling, values]) => [
      spelling,
      new Set(values.map(readingStem)),
    ]),
  );
  const add = (spelling, reading, source) => {
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
export function refineAlignment(strong, supplementary) {
  const previous = new Set(boundaries(strong.segments));
  const candidate = new Set(boundaries(supplementary.segments));
  if (candidate.size <= previous.size || [...previous].some((boundary) => !candidate.has(boundary)))
    return strong;
  return supplementary;
}
