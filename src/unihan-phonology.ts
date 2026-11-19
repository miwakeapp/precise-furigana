import { getKanaVowels, kanaPronunciation, normalizeKana } from "./kana.ts";

/** How a contextual sound was reached from a listed value. */
export interface UnihanDerivation {
  /** The listed reading, as the source writes it. */
  value: string;
  rules: string[];
  /** Whether the sound is only possible before a voiceless obstruent in the next character. */
  requiresFollowingObstruent?: boolean;
}

/** A contextual sound for a character, in normalized kana. */
export interface UnihanReadingVariant extends UnihanDerivation {
  reading: string;
}

export interface UnihanReadingVariantOptions {
  supplementalVoicing?: boolean;
  yoonSimplification?: boolean;
}

const voicedInitials = new Map(
  Array.from("かきくけこさしすせそたちつてとはひふへほ").map((value, index) => [
    value,
    Array.from("がぎぐげござじずぜぞだぢづでどばびぶべぼ")[index],
  ]),
);
const unvoicedInitials = new Map([...voicedInitials].map(([left, right]) => [right, left]));
const plosiveInitials = new Map(
  Array.from("はひふへほ").map((value, index) => [value, Array.from("ぱぴぷぺぽ")[index]]),
);
const modernVoicedInitials = new Map([
  ["ち", "じ"],
  ["つ", "ず"],
]);
const plainSyllables = new Map<string, string>();
for (const [bases, outputs] of [
  ["きぎ", ["かくこ", "がぐご"]],
  ["しじ", ["さすそ", "ざずぞ"]],
  ["ちぢ", ["たつと", "だづど"]],
  ["に", ["なぬの"]],
  ["ひびぴ", ["はふほ", "ばぶぼ", "ぱぷぽ"]],
  ["み", ["まむも"]],
  ["り", ["らるろ"]],
] as const) {
  for (const [index, base] of Array.from(bases).entries()) {
    for (const [position, ending] of Array.from("ゃゅょ").entries())
      plainSyllables.set(base + ending, outputs[index][position]);
  }
}

/**
 * Finite contextual correspondences, not additional dictionary readings.
 * Unihan's katakana convention suggests on readings but has exceptions; the
 * short-reading bound excludes long native and non-Sino loan transcriptions.
 */
export function deriveUnihanReadingVariants(
  values: string[],
  knownReadings: Set<string>,
  { supplementalVoicing = false, yoonSimplification = false }: UnihanReadingVariantOptions = {},
): UnihanReadingVariant[] {
  const variants: UnihanReadingVariant[] = [];
  for (const value of values) {
    if (!/^[\p{Script=Katakana}ー]+$/u.test(value)) continue;
    const reading = normalizeKana(value);
    const morae = reading.match(/[ぁ-ゖ][ぁぃぅぇぉゃゅょゎ]?|ー/gu) ?? [];
    if (morae.join("") !== reading || morae.length < 1 || morae.length > 2) continue;
    // Primary and weak readings already receive their own bounded phonology.
    if (supplementalVoicing && !knownReadings.has(reading)) {
      const initials = new Set([
        voicedInitials.get(reading[0]),
        plosiveInitials.get(unvoicedInitials.get(reading[0]) ?? reading[0]),
        modernVoicedInitials.get(reading[0]),
      ]);
      const onsets: { reading: string; rules: string[] }[] = [{ reading, rules: [] }];
      for (const initial of initials) {
        if (initial !== undefined && initial !== reading[0])
          onsets.push({ reading: initial + reading.slice(1), rules: ["initial-voicing"] });
      }
      for (const onset of onsets) {
        if (onset.rules.length) variants.push({ value, ...onset });
        variants.push({
          value,
          reading: onset.reading + "っ",
          rules: [...onset.rules, "gemination"],
          requiresFollowingObstruent: true,
        });
        if (/[くきちつう]$/u.test(onset.reading)) {
          variants.push({
            value,
            reading: onset.reading.slice(0, -1) + "っ",
            rules: [...onset.rules, "sokuon"],
            requiresFollowingObstruent: true,
          });
        }
      }
    }
    if (yoonSimplification) {
      for (let index = 0; index + 1 < reading.length; ++index) {
        const plain = plainSyllables.get(reading.slice(index, index + 2));
        if (plain !== undefined)
          variants.push({
            value,
            reading: reading.slice(0, index) + plain + reading.slice(index + 2),
            rules: ["yoon-simplification"],
          });
      }
    }
  }
  return variants;
}

/** Extend only a listed one-mora katakana sound, without other sound changes. */
export function deriveUnihanOnLengthenings(values: string[]): UnihanReadingVariant[] {
  const variants: UnihanReadingVariant[] = [];
  for (const value of values) {
    if (!/^[\p{Script=Katakana}]+$/u.test(value)) continue;
    const reading = normalizeKana(value);
    if (
      !/^[あ-ゖ][ぁぃぅぇぉゃゅょゎ]?$/u.test(reading) ||
      /^[ぁぃぅぇぉゃゅょゎっん]/u.test(reading)
    )
      continue;
    const vowels = getKanaVowels(reading.at(-1)!);
    if (vowels === undefined) continue;
    for (const vowel of [...vowels, "ー"]) {
      variants.push({ value, reading: reading + vowel, rules: ["single-mora-vowel-extension"] });
    }
  }
  return variants;
}

/** An iteration mark repeats its actual predecessor, with optional voicing. */
export function matchesIterationReading(previous: string | undefined, current: string): boolean {
  if (previous === undefined) return false;
  const source = normalizeKana(previous);
  const target = kanaPronunciation(current);
  const initials = [voicedInitials.get(source[0]), modernVoicedInitials.get(source[0])];
  return [
    source,
    ...initials
      .filter((initial) => initial !== undefined)
      .map((initial) => initial + source.slice(1)),
  ].some((reading) => kanaPronunciation(reading) === target);
}
