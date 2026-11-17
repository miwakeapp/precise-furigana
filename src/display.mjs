import { isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { segmentReading, segmentText } from "./segments.mjs";

// Wave dashes can stand for から, so they are never assumed to be silent.
const isSilentPunctuation = unit => /^\p{P}$/u.test(unit) && !/^[〜～]$/u.test(unit);

const pronounced = text => normalizeKana(text).replace(/[^\p{Script=Hiragana}ー]/gu, "");

// Kana and silent punctuation that sound exactly like the reading need no ruby.
function needsRuby(base, reading) {
  const sounded = splitGraphemes(base).filter(unit => !(isSilentPunctuation(unit) && !reading.includes(unit))).join("");
  return sounded === "" || !isKana(sounded) || normalizeKana(sounded) !== normalizeKana(reading);
}

/**
 * The generator can put kana into a ruby group when an unwritten particle
 * sits beside it, as in そっぽ向く read そっぽをむく. Where the reading repeats
 * a group's whole leading or trailing kana run, that run is shown as plain
 * text, as long as the rest of the group keeps part of the reading.
 */
function peelKana([written, reading]) {
  const units = splitGraphemes(written), sounds = splitGraphemes(reading);
  let start = 0, end = units.length;
  while (start < end && isKana(units[start])) ++start;
  while (end > start && isKana(units[end - 1])) --end;
  const repeats = (run, candidates) => run.length > 0 && run.every((unit, index) => normalizeKana(unit) === normalizeKana(candidates[index] ?? ""));
  const leading = repeats(units.slice(0, start), sounds) ? start : 0;
  const trailing = repeats(units.slice(end).reverse(), [...sounds].reverse()) ? units.length - end : 0;
  if (start === end || leading + trailing === 0 || leading + trailing >= sounds.length) return [[written, reading]];
  return [
    units.slice(0, leading).join(""),
    [units.slice(leading, units.length - trailing).join(""), sounds.slice(leading, sounds.length - trailing).join("")],
    units.slice(units.length - trailing).join("")
  ].filter(part => part !== "");
}

/**
 * Convert generator segments, which reconstruct both strings exactly, into
 * release segments, where a string is text shown without ruby. Silent
 * punctuation at the edge of a ruby group becomes its own string, and kana
 * that the reading repeats loses its ruby.
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
    if (needsRuby(core, reading)) for (const part of peelKana([core, reading])) push(part);
    else push(core);
    if (end < units.length) push(units.slice(end).join(""));
  }
  return result;
}

/** Check that release segments are canonical and spell out the record's reading. */
export function validateDisplayAlignment(written, reading, segments) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error(`Missing alignment: ${written}/${reading}`);
  for (const [index, segment] of segments.entries()) {
    if (typeof segment === "string") {
      if (segment.length === 0) throw new Error("Empty plain segment");
      if (typeof segments[index - 1] === "string") throw new Error(`Adjacent plain segments: ${JSON.stringify(segments)}`);
      if (!splitGraphemes(segment).every(unit => isKana(unit) || /^[\p{P}\p{S}]$/u.test(unit))) {
        throw new Error(`Plain text needs ruby: ${JSON.stringify(segment)}`);
      }
    } else if (!Array.isArray(segment) || segment.length !== 2 ||
      segment.some(value => typeof value !== "string" || value.length === 0)) {
      throw new Error(`Invalid ruby segment: ${JSON.stringify(segment)}`);
    } else if (!needsRuby(segment[0], segment[1]) || peelKana(segment).length > 1) {
      throw new Error(`Ruby over kana: ${JSON.stringify(segment)}`);
    }
  }
  if (segments.map(segmentText).join("") !== written) {
    throw new Error(`Alignment does not reconstruct ${written}: ${JSON.stringify(segments)}`);
  }
  if (pronounced(segments.map(segmentReading).join("")) !== pronounced(reading)) {
    throw new Error(`Alignment does not account for ${reading}: ${JSON.stringify(segments)}`);
  }
}
