import { isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { pairKey, segmentReading, segmentText } from "./segments.mjs";

// Counter symbols and kana iteration marks stand for a sound the way a kanji does. ケ is a counter only
// beside non-kana, as in 一ケ月; inside a katakana word such as ケータイ it is kana.
const isSoundSymbol = (unit, previous = "", next = "") =>
  /^[ヶヵゝゞヽヾ]$/u.test(unit) || (unit === "ケ" && !isKana(previous) && !isKana(next));
// JMdict spellings that pun on their reading, where the mismatched kana is the point.
const kanaPuns = new Set([pairKey("怪レい日本語", "あやしいにほんご"), pairKey("ネ申", "かみ")]);
// Kana stand for themselves. Punctuation and symbols may be silent, like ・, or read, like ＆ for アンド.
// Anything else, such as a kanji, a letter, or a counter symbol, stands for some reading.
const unitKind = (unit, previous, next) =>
  isKana(unit) && !isSoundSymbol(unit, previous, next)
    ? "kana"
    : /^[\p{P}\p{S}]$/u.test(unit)
      ? "symbol"
      : "other";
// A small ッ can stand for a full つ, as in 八ッ橋.
// Other small kana change the sound, as ェ in ウェスタン does, so they must match exactly.
const fullSize = new Map([["っ", "つ"]]);
const kanaPattern = (text) => {
  const kana = pronounced(text),
    full = fullSize.get(kana);
  return full === undefined ? escape(kana) : `[${kana}${full}]`;
};
const sameKana = (unit, sound) =>
  normalizeKana(unit) === normalizeKana(sound) ||
  fullSize.get(normalizeKana(unit)) === normalizeKana(sound);
// Consecutive kanji or letters share a reading, as in 海鷂魚 for えい or ＡＳＣＩＩ for アスキー.
function units(spelling) {
  const result = [],
    graphemes = splitGraphemes(spelling);
  for (const [index, unit] of graphemes.entries()) {
    const kind = unitKind(unit, graphemes[index - 1], graphemes[index + 1]);
    if (kind === "other" && result.at(-1)?.kind === "other") result.at(-1).text += unit;
    else result.push({ kind, text: unit });
  }
  return result;
}
const pronounced = (text) => normalizeKana(text).replace(/[^\p{Script=Hiragana}ー]/gu, "");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Whether the spelling's kana appear, in order and exactly, in the reading,
 * with kanji and other characters standing for any reading. 気持ちよい does not
 * fit きもちいい, and 元どうり does not fit もとどおり.
 */
export function fitsSpelling(spelling, reading) {
  if (spelling === reading || kanaPuns.has(pairKey(spelling, reading))) return true;
  const pattern = units(spelling)
    .map(({ kind, text }) =>
      kind === "kana" ? kanaPattern(text) : kind === "symbol" ? ".*?" : ".+?",
    )
    .join("");
  return new RegExp(`^${pattern}$`, "u").test(pronounced(reading));
}

/**
 * Whether a pair's reading contradicts its spelling: the spelling's kana do not
 * fit the reading, a search-only spelling omits a particle that the reading
 * keeps, as そっぽ向く does with そっぽをむく, or the segments put a reading over
 * kana that it does not fit. The last catches readings that fit only if a kanji
 * absorbs a sound that belongs to the kana, as けも耳 with けものみみ fits only
 * with 耳 read のみみ, and is segmented け も[もの] 耳[みみ]. Every spelling needs
 * at least one pair that does not contradict it.
 */
export function contradictsSpelling(spelling, reading, drops, segments = []) {
  if (kanaPuns.has(pairKey(spelling, reading))) return false;
  return (
    !fitsSpelling(spelling, reading) ||
    (drops?.length ?? 0) > 0 ||
    segments.some((segment) => typeof segment !== "string" && !fitsSpelling(segment[0], segment[1]))
  );
}

/**
 * A contradicting pair is flagged as mismatched when it involves a search-only
 * spelling or reading: JMdict does not restrict search-only forms, so such pairs
 * combine forms that do not belong together. A visible pair such as 宣ふ with
 * のたまう contradicts its kana only by orthographic convention and is not flagged.
 */
export function isMismatched(pair, drops, segments) {
  return (
    (pair.spellingTags.includes("sK") || pair.readingTags.includes("sk")) &&
    contradictsSpelling(pair.spelling, pair.reading, drops, segments)
  );
}

/**
 * The reading a spelling implies when its kana contradict the reading: its kana
 * stand for themselves, and each run of kanji or other characters takes the
 * part of the reading that a least-cost alignment gives it. A kana with no
 * counterpart in the reading costs one, and one that differs from its
 * counterpart costs a little more, so 元どうり with もとどおり implies もとどうり
 * but the silent の of の月 with づき leaves づき alone.
 */
function literalReading(spelling, reading) {
  const runs = units(spelling),
    sounds = [...reading];
  const width = sounds.length + 1,
    cost = new Float64Array((runs.length + 1) * width).fill(Infinity),
    from = new Int32Array(cost.length).fill(-1);
  cost[0] = 0;
  for (let i = 0; i < runs.length; ++i) {
    const { kind, text } = runs[i];
    for (let j = 0; j <= sounds.length; ++j) {
      const here = cost[i * width + j];
      if (here === Infinity) continue;
      const relax = (target, value) => {
        if (value < cost[target]) {
          cost[target] = value;
          from[target] = i * width + j;
        }
      };
      if (kind === "kana") {
        if (j < sounds.length)
          relax((i + 1) * width + j + 1, here + (sameKana(text, sounds[j]) ? 0 : 1.125));
        relax((i + 1) * width + j, here + 1);
        if (j < sounds.length) relax(i * width + j + 1, here + 1);
      } else {
        // A kanji consumes at least one sound; a symbol may be silent. Each sound costs a little, so that
        // when costs otherwise tie, the spelling's own kana account for the reading rather than a kanji.
        for (let end = kind === "symbol" ? j : j + 1; end <= sounds.length; ++end)
          relax((i + 1) * width + end, here + (end - j) / 1024);
      }
    }
  }
  if (cost[runs.length * width + sounds.length] === Infinity) return undefined;
  const parts = [];
  for (let state = runs.length * width + sounds.length; state > 0;) {
    const previous = from[state],
      i = Math.floor(previous / width),
      j = previous % width;
    const nextI = Math.floor(state / width),
      nextJ = state % width;
    if (nextI > i)
      parts.unshift(runs[i].kind === "kana" ? runs[i].text : sounds.slice(j, nextJ).join(""));
    state = previous;
  }
  return parts.join("");
}

/**
 * The reading that a mismatched pair's spelling implies. An omitted particle
 * is removed beside the cut where the generator's segments put it; otherwise
 * the spelling's own kana replace the ones the reading contradicts. Undefined
 * when the segments have no cut at the omitted particle.
 */
export function impliedReading(segments, drops = []) {
  if (drops.length > 0) {
    const cuts = new Map();
    let spellingOffset = 0,
      readingOffset = 0;
    for (const segment of segments) {
      spellingOffset += splitGraphemes(segmentText(segment)).length;
      readingOffset += segmentReading(segment).length;
      cuts.set(spellingOffset, readingOffset);
    }
    let reading = segments.map(segmentReading).join("");
    for (const { offset, particle } of [...drops].sort(
      (left, right) => right.offset - left.offset,
    )) {
      const at = cuts.get(offset);
      if (at === undefined) return undefined;
      if (normalizeKana(reading[at - 1] ?? "") === particle)
        reading = reading.slice(0, at - 1) + reading.slice(at);
      else if (normalizeKana(reading[at] ?? "") === particle)
        reading = reading.slice(0, at) + reading.slice(at + 1);
      else return undefined;
    }
    return reading;
  }
  // The generator's segments already separate kanji from kana; only a ruby group that contains
  // kana needs aligning within itself.
  const parts = [];
  for (const segment of segments) {
    if (typeof segment === "string") {
      parts.push(segment);
      continue;
    }
    const [spelling, reading] = segment;
    const hasKana = units(spelling).some((unit) => unit.kind === "kana");
    const literal = hasKana ? literalReading(spelling, reading) : reading;
    if (literal === undefined) return undefined;
    parts.push(literal);
  }
  return parts.join("");
}

/**
 * Work out which spellings need a synthesized pair, because none of their JMdict
 * pairs fits, and check them against the reviewed list. `records` lists
 * `{ id, spelling, reading, segments, displaySegments }`, with the generator's
 * segments and the release's.
 * Returns the synthesized pairs to add and any problems that should stop the build.
 */
export function planSynthesizedPairs(records, drops, reviewed, jmdictPairs) {
  const bySpelling = new Map();
  for (const record of records) {
    const key = `${record.id}\t${record.spelling}`;
    (bySpelling.get(key) ?? bySpelling.set(key, []).get(key)).push(record);
  }
  const listed = new Map(reviewed.map((item) => [`${item.id}\t${item.spelling}`, item]));
  const pairs = [],
    problems = [],
    missing = [],
    obsolete = [];
  for (const [key, spellingRecords] of bySpelling) {
    const invalid = spellingRecords.filter((record) =>
      contradictsSpelling(
        record.spelling,
        record.reading,
        drops.get(pairKey(record.spelling, record.reading)),
        record.displaySegments ?? record.segments,
      ),
    );
    if (invalid.length < spellingRecords.length) continue;
    const { id, spelling } = invalid[0];
    const implied = [
      ...new Set(
        invalid
          .map((record) =>
            impliedReading(record.segments, drops.get(pairKey(record.spelling, record.reading))),
          )
          .filter((value) => value !== undefined && fitsSpelling(spelling, value)),
      ),
    ];
    const item = listed.get(key);
    listed.delete(key);
    if (item === undefined) {
      missing.push({
        id,
        spelling,
        reading: implied[0] ?? "",
        upstream: "unreviewed",
        note: implied.length === 1 ? "" : "Choose the reading this spelling implies.",
      });
      continue;
    }
    if (!fitsSpelling(spelling, item.reading))
      problems.push(`Synthesized reading ${item.reading} does not fit ${spelling} (${id})`);
    else if (item.upstream === "unreviewed")
      problems.push(`Review the synthesized reading ${item.reading} for ${spelling} (${id})`);
    else if (jmdictPairs.has(`${id}\t${spelling}\t${item.reading}`)) {
      problems.push(
        `JMdict now pairs ${spelling} with ${item.reading} (${id}); remove it from the synthesized pairs`,
      );
      obsolete.push(item);
    } else pairs.push(item);
  }
  for (const item of listed.values()) {
    problems.push(`${item.spelling} (${item.id}) no longer needs a synthesized pair; remove it`);
    obsolete.push(item);
  }
  if (missing.length)
    problems.push(
      `${missing.length} spellings need a synthesized pair:\n${missing.map((item) => JSON.stringify(item)).join(",\n")}`,
    );
  return { pairs, problems, missing, obsolete };
}
