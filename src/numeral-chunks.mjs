import { normalizeKana, splitGraphemes } from "./kana.mjs";
import { segmentReading, segmentText } from "./segments.mjs";

// A positional numeral is divided at each nonzero digit. A chunk is a digit with the zeros after
// it, and it carries the digit's sound, its place word, and any myriad word spoken at that point:
// １９８２ is １[せん] ９[きゅうひゃく] ８[はちじゅう] ２[に], and ８４０００ is ８[はちまん] ４０００[よんせん].
// A zero never has a sound of its own, so １００ and 三〇 are single chunks.

const digitValues = new Map(
  [..."０１２３４５６７８９"].flatMap((digit, value) => [
    [digit, value],
    [String(value), value],
    ["〇一二三四五六七八九"[value], value],
  ]),
);
const isDigit = (unit) => digitValues.has(unit);

// How each digit can sound, including the forms it takes before a place word or a counter.
const digitSounds = [
  [],
  ["いち", "いっ"],
  ["に"],
  ["さん"],
  ["よん", "よ", "よっ", "し"],
  ["ご"],
  ["ろく", "ろっ"],
  ["なな", "しち"],
  ["はち", "はっ"],
  ["きゅう", "く"],
];
// The place word for tens, hundreds, and thousands, with its sound changes.
const placeSounds = [
  [""],
  ["じゅう", "じゅっ", "じっ"],
  ["ひゃく", "びゃく", "ぴゃく", "ひゃっ", "びゃっ", "ぴゃっ"],
  ["せん", "ぜん"],
];
const myriadSounds = ["", "まん", "おく", "ちょう", "けい"];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const alternatives = (sounds) => `(?:${sounds.map(escape).join("|")})`;

/** The chunks of a digit run: each nonzero digit with the zeros that follow it. */
function chunks(digits) {
  const result = [];
  for (const [index, digit] of digits.entries()) {
    if (digitValues.get(digit) !== 0 || result.length === 0) {
      result.push({ start: index, digits: [digit] });
    } else result.at(-1).digits.push(digit);
  }
  return result;
}

/** A pattern for the sounds one chunk can carry, given where it stands in the numeral. */
function chunkPattern(chunk, length) {
  const value = digitValues.get(chunk.digits[0]);
  const position = length - 1 - chunk.start; // The digit's place, counting from the right.
  const lowest = position - (chunk.digits.length - 1); // The chunk's last place.
  const place = position % 4;
  // One is silent before ten, a hundred, or a thousand, though いっせん is also said.
  const digit =
    value === 1 && place > 0
      ? `${alternatives(digitSounds[1])}?`
      : alternatives(digitSounds[value]);
  // 万, 億 and so on are spoken after the last nonzero digit of their group of four, which is
  // this digit when the chunk's zeros reach the bottom of the group.
  const group = Math.floor(position / 4);
  if (group >= myriadSounds.length) return "(?!)";
  const myriads = group >= 1 && lowest <= group * 4 ? escape(myriadSounds[group]) : "";
  return `${digit}${alternatives(placeSounds[place])}${myriads}`;
}

/**
 * Divide a numeral's reading among its chunks, or return undefined when the reading is not the
 * positional one, as when digits are read one by one, or when it could divide in two ways.
 */
export function chunkNumeral(spelling, reading) {
  const digits = splitGraphemes(spelling);
  if (digits.length < 2 || !digits.every(isDigit) || digitValues.get(digits[0]) === 0) {
    return undefined;
  }
  const parts = chunks(digits);
  if (parts.length < 2) return undefined;
  const sounds = splitGraphemes(reading);
  const normalized = sounds.map((sound) => normalizeKana(sound));
  if (normalized.some((sound) => splitGraphemes(sound).length !== 1)) return undefined;
  const patterns = parts.map((part) => new RegExp(`^${chunkPattern(part, digits.length)}$`, "u"));
  // Count the ways to reach each position of the reading, keeping one way to rebuild it.
  let reachable = new Map([[0, { count: 1, cuts: [] }]]);
  for (const pattern of patterns) {
    const next = new Map();
    for (const [start, state] of reachable) {
      for (let end = start + 1; end <= sounds.length; ++end) {
        if (!pattern.test(normalized.slice(start, end).join(""))) continue;
        const existing = next.get(end);
        next.set(end, {
          count: (existing?.count ?? 0) + state.count,
          cuts: existing?.cuts ?? [...state.cuts, end],
        });
      }
    }
    reachable = next;
  }
  const whole = reachable.get(sounds.length);
  if (whole === undefined || whole.count !== 1) return undefined;
  return parts.map((part, index) => [
    part.digits.join(""),
    sounds.slice(whole.cuts[index - 1] ?? 0, whole.cuts[index]).join(""),
  ]);
}

/**
 * Apply the chunk rule to an alignment. Neighboring ruby segments made only of digits are read
 * as one numeral, so a division that an earlier stage made differently is replaced; where the
 * reading is not positional, the segments are left exactly as they were.
 */
export function chunkNumerals(align) {
  const digitsOnly = (segment) =>
    typeof segment !== "string" && splitGraphemes(segment[0]).every(isDigit);
  return (spelling, reading) => {
    const result = align(spelling, reading);
    if (!result.segments.some(digitsOnly)) return result;
    const segments = [],
      evidence = [];
    let changed = false;
    for (let index = 0; index < result.segments.length;) {
      let end = index;
      while (end < result.segments.length && digitsOnly(result.segments[end])) ++end;
      const run = result.segments.slice(index, Math.max(end, index + 1));
      const divided =
        end > index
          ? chunkNumeral(run.map(segmentText).join(""), run.map(segmentReading).join(""))
          : undefined;
      if (divided !== undefined && JSON.stringify(divided) !== JSON.stringify(run)) {
        changed = true;
        for (const [text, sound] of divided) {
          segments.push([text, sound]);
          evidence.push({
            spelling: text,
            reading: sound,
            type: "dictionary",
            rules: ["numeral-chunk"],
          });
        }
      } else {
        for (const [offset, segment] of run.entries()) {
          segments.push(segment);
          evidence.push(
            result.evidence?.[index + offset] ?? {
              spelling: segmentText(segment),
              reading: segmentReading(segment),
              type: typeof segment === "string" ? "literal" : "dictionary",
              rules: [],
            },
          );
        }
      }
      index += run.length;
    }
    return changed ? { ...result, segments, evidence } : result;
  };
}
