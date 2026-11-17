import { isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { segmentReading, segmentText } from "./segments.mjs";

// Wave dashes can stand for から, so they are never assumed to be silent.
const isSilentPunctuation = unit => /^\p{P}$/u.test(unit) && !/^[〜～]$/u.test(unit);

// As counters, ヶ, ヵ, and ケ are read か or が, so their ruby is kept.
const isCounter = text => /^[ヶヵケ]$/u.test(text);

// JMdict spellings that pun on their reading, where ruby over the kana is the point.
const kanaPuns = new Set(["怪レい日本語/あやしいにほんご"]);
const isKanaPun = (written, reading) => kanaPuns.has(`${written}/${reading}`);

const pronounced = text => normalizeKana(text).replace(/[^\p{Script=Hiragana}ー]/gu, "");
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Kana is shown as written, even where JMdict pairs a spelling with a reading
 * its kana contradict, as in 気持ちよい read きもちいい. Silent punctuation is
 * ignored.
 */
function needsRuby(base, reading, pun) {
  const sounded = splitGraphemes(base).filter(unit => !(isSilentPunctuation(unit) && !reading.includes(unit))).join("");
  if (sounded === "" || !isKana(sounded)) return true;
  if (normalizeKana(sounded) === normalizeKana(reading)) return false;
  return isCounter(sounded) || pun;
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
 * loses its ruby.
 */
export function displaySegments(segments, { drops = [] } = {}) {
  const pun = isKanaPun(segments.map(segmentText).join(""), segments.map(segmentReading).join(""));
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
    if (needsRuby(core, reading, pun)) for (const part of peelKana([core, reading])) push(part);
    else push(core);
    if (end < units.length) push(units.slice(end).join(""));
  }
  // An omitted particle that the reading keeps leaves the ruby beside it.
  const offsets = [];
  let writtenOffset = 0;
  for (const segment of result) {
    offsets.push(writtenOffset);
    writtenOffset += splitGraphemes(segmentText(segment)).length;
  }
  for (const { offset, particle } of drops) {
    const index = offsets.indexOf(offset), left = result[index - 1], right = result[index];
    if (index <= 0) continue;
    if (Array.isArray(left) && left[1].length > 1 && normalizeKana(left[1]).endsWith(particle)) left[1] = left[1].slice(0, -1);
    else if (Array.isArray(right) && right[1].length > 1 && normalizeKana(right[1]).startsWith(particle)) right[1] = right[1].slice(1);
  }
  return result;
}

// Whether the ruby readings occur in order in the reading, with plain kana standing for any reading and
// each dropped particle allowed between segments.
function rubyFollowsReading(segments, reading, drops) {
  const gap = drops.length ? `(?:${[...new Set(drops.map(drop => escape(drop.particle)))].join("|")})?` : "";
  const pattern = segments.map(segment => typeof segment !== "string" ? escape(pronounced(segment[1])) :
    pronounced(segment) === "" ? "" : ".+?").join(gap);
  return new RegExp(`^${pattern}$`, "u").test(pronounced(reading));
}

/** Check that release segments are canonical and account for the record. */
export function validateDisplayAlignment(written, reading, segments, { drops = [] } = {}) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error(`Missing alignment: ${written}/${reading}`);
  const pun = isKanaPun(written, reading);
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
    } else if (!needsRuby(segment[0], segment[1], pun) || peelKana(segment).length > 1) {
      throw new Error(`Ruby over kana: ${JSON.stringify(segment)}`);
    }
  }
  if (segments.map(segmentText).join("") !== written) {
    throw new Error(`Alignment does not reconstruct ${written}: ${JSON.stringify(segments)}`);
  }
  // Plain kana usually spell out their part of the reading, but where the reading differs from the written kana,
  // they are shown as written, so only the ruby is checked against the reading. The generator has already checked
  // that its segments reconstruct the reading exactly.
  if (!rubyFollowsReading(segments, reading, drops)) {
    throw new Error(`Alignment does not account for ${reading}: ${JSON.stringify(segments)}`);
  }
}
