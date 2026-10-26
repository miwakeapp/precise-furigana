import { isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { segmentReading, segmentText } from "./segments.mjs";

// Wave dashes can stand for から, so they are never assumed to be silent.
const isSilentPunctuation = unit => /^\p{P}$/u.test(unit) && !/^[〜～]$/u.test(unit);

// Kana and silent punctuation that sound exactly like the reading need no ruby.
const repeatsReading = (written, reading) => {
  const sounded = splitGraphemes(written).filter(unit => !(isSilentPunctuation(unit) && !reading.includes(unit))).join("");
  return sounded !== "" && isKana(sounded) && normalizeKana(sounded) === normalizeKana(reading);
};

const pronounced = text => normalizeKana(text).replace(/[^\p{Script=Hiragana}ー]/gu, "");

/**
 * Convert generator segments, which reconstruct both strings exactly, into
 * release segments, where a string is text shown without ruby. Silent
 * punctuation at the edge of a ruby group becomes its own string, and kana
 * that differs from its reading only in script loses its ruby.
 */
export function displaySegments(segments) {
  const result = [];
  const push = segment => {
    if (typeof segment === "string" && typeof result.at(-1) === "string") result[result.length - 1] += segment;
    else result.push(segment);
  };
  for (const segment of segments) {
    if (typeof segment === "string") {
      push(segment);
      continue;
    }
    const [written, reading] = segment;
    const units = splitGraphemes(written);
    const silent = unit => isSilentPunctuation(unit) && !reading.includes(unit);
    let start = 0, end = units.length;
    while (start < end - 1 && silent(units[start])) ++start;
    while (end - 1 > start && silent(units[end - 1])) --end;
    if (start > 0) push(units.slice(0, start).join(""));
    const core = units.slice(start, end).join("");
    push(repeatsReading(core, reading) ? core : [core, reading]);
    if (end < units.length) push(units.slice(end).join(""));
  }
  return result;
}

/** Check that release segments are canonical and account for the record. */
export function validateDisplayAlignment(written, reading, segments) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error(`Missing alignment: ${written}/${reading}`);
  for (const [index, segment] of segments.entries()) {
    if (typeof segment === "string") {
      if (segment.length === 0) throw new Error("Empty plain segment");
      if (typeof segments[index - 1] === "string") throw new Error(`Adjacent plain segments: ${JSON.stringify(segments)}`);
    } else if (!Array.isArray(segment) || segment.length !== 2 ||
      segment.some(value => typeof value !== "string" || value.length === 0)) {
      throw new Error(`Invalid ruby segment: ${JSON.stringify(segment)}`);
    } else if (repeatsReading(segment[0], segment[1])) {
      throw new Error(`Ruby repeats its kana: ${JSON.stringify(segment)}`);
    }
  }
  if (segments.map(segmentText).join("") !== written) {
    throw new Error(`Alignment does not reconstruct ${written}: ${JSON.stringify(segments)}`);
  }
  if (pronounced(segments.map(segmentReading).join("")) !== pronounced(reading)) {
    throw new Error(`Alignment does not account for ${reading}: ${JSON.stringify(segments)}`);
  }
}
