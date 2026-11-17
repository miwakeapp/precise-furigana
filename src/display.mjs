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
 *
 * A group of only kana holds no character whose sound peeling could take, so
 * any kana the reading repeats at its edges is shown plain, leaving the
 * smallest group that carries the contradiction: 黒んぼう read くろんぼ shows
 * ん plain beside ぼう read ぼ. A cut never falls before a small kana, which
 * belongs with the kana before it.
 */
function peelKana([spelling, reading]) {
  const units = splitGraphemes(spelling), sounds = splitGraphemes(reading);
  if (units.every(isKana)) return peelKanaGroup(units, sounds) ?? [[spelling, reading]];
  let start = 0, end = units.length;
  while (start < end && isKana(units[start])) ++start;
  while (end > start && isKana(units[end - 1])) --end;
  const repeats = (run, candidates) => run.length > 0 && run.every((unit, index) => normalizeKana(unit) === normalizeKana(candidates[index] ?? ""));
  const leading = repeats(units.slice(0, start), sounds) ? start : 0;
  const trailing = repeats(units.slice(end).reverse(), [...sounds].reverse()) ? units.length - end : 0;
  if (start === end || leading + trailing === 0 || leading + trailing >= sounds.length) return [[spelling, reading]];
  return [
    units.slice(0, leading).join(""),
    [units.slice(leading, units.length - trailing).join(""), sounds.slice(leading, sounds.length - trailing).join("")],
    units.slice(units.length - trailing).join("")
  ].filter(part => part !== "");
}

const isSmallKana = unit => /^[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]$/u.test(unit);
const sameKana = (left, right) => right !== undefined && normalizeKana(left) === normalizeKana(right);

function peelKanaGroup(units, sounds) {
  let leading = 0, trailing = 0;
  // Keep at least one written unit and one sound in the group.
  const room = () => units.length - leading - trailing > 1 && sounds.length - leading - trailing > 1;
  while (room() && sameKana(units[leading], sounds[leading]) && !isSmallKana(units[leading + 1]) && !isSmallKana(sounds[leading + 1])) ++leading;
  while (room() && sameKana(units.at(-1 - trailing), sounds.at(-1 - trailing)) && !isSmallKana(units.at(-1 - trailing))) ++trailing;
  if (leading + trailing === 0) return undefined;
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
    const [spelling, reading] = segment;
    const units = splitGraphemes(spelling);
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
export function validateDisplayAlignment(spelling, reading, segments) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error(`Missing alignment: ${spelling}/${reading}`);
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
  if (segments.map(segmentText).join("") !== spelling) {
    throw new Error(`Alignment does not reconstruct ${spelling}: ${JSON.stringify(segments)}`);
  }
  if (pronounced(segments.map(segmentReading).join("")) !== pronounced(reading)) {
    throw new Error(`Alignment does not account for ${reading}: ${JSON.stringify(segments)}`);
  }
}
