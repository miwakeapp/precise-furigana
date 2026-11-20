import { isKana, isSilentPunctuation, normalizeKana, splitGraphemes } from "./kana.ts";
import { pairKey, segmentReading, segmentText } from "./segments.ts";
import type { Segment } from "./types.ts";
import type { ParticleSite } from "./variants.ts";

/** How a JMdict pair contradicts its spelling. */
export type ContradictionKind = "mispaired" | "phonetic";

/** A pair in `data/synthesized-pairs.json`. */
export interface SynthesizedPair {
  id: string;
  spelling: string;
  reading: string;
  note?: string;
  /** Set on a pair the build proposed and nobody has checked. */
  unreviewed?: boolean;
}

/** A JMdict pair with the generator's segments and, where they are known, the release's. */
export interface PairingRecord {
  id: string;
  spelling: string;
  reading: string;
  segments: Segment[];
  displaySegments?: Segment[];
}

export interface SynthesizedPairPlan {
  /** The reviewed pairs to add to the database. */
  pairs: SynthesizedPair[];
  /** Messages that should stop the build. */
  problems: string[];
  /** Proposed pairs for spellings that need one and have none listed. */
  missing: SynthesizedPair[];
  /** Listed pairs that are no longer needed. */
  obsolete: SynthesizedPair[];
}

type UnitKind = "kana" | "symbol" | "other";

/** A run of a spelling that is matched against a reading as a whole. */
interface Unit {
  kind: UnitKind;
  text: string;
}

// Counter symbols and kana iteration marks stand for a sound the way a kanji does. ケ is a counter only
// beside non-kana, as in 一ケ月; inside a katakana word such as ケータイ it is kana.
const isSoundSymbol = (unit: string, previous = "", next = ""): boolean =>
  /^[ヶヵゝゞヽヾ]$/u.test(unit) || (unit === "ケ" && !isKana(previous) && !isKana(next));
// JMdict spellings that pun on their reading, where the kana that differ are the point.
const kanaPuns = new Set([pairKey("怪レい日本語", "あやしいにほんご"), pairKey("ネ申", "かみ")]);
// Kana stand for themselves. Punctuation and symbols may be silent, like ・, or read, like ＆ for アンド.
// Anything else, such as a kanji, a letter, or a counter symbol, stands for some reading.
const unitKind = (unit: string, previous?: string, next?: string): UnitKind =>
  isKana(unit) && !isSoundSymbol(unit, previous, next)
    ? "kana"
    : /^[\p{P}\p{S}]$/u.test(unit)
      ? "symbol"
      : "other";
// A small ッ can stand for a full つ, as in 八ッ橋.
// Other small kana change the sound, as ェ in ウェスタン does, so they must match exactly.
const fullSize = new Map([["っ", "つ"]]);
const kanaPattern = (text: string): string => {
  const kana = pronounced(text),
    full = fullSize.get(kana);
  return full === undefined ? escape(kana) : `[${kana}${full}]`;
};
const sameKana = (unit: string, sound: string): boolean =>
  normalizeKana(unit) === normalizeKana(sound) ||
  fullSize.get(normalizeKana(unit)) === normalizeKana(sound);
// Consecutive kanji or letters share a reading, as in 海鷂魚 for えい or ＡＳＣＩＩ for アスキー.
function units(spelling: string): Unit[] {
  const result: Unit[] = [],
    graphemes = splitGraphemes(spelling);
  for (const [index, unit] of graphemes.entries()) {
    const kind = unitKind(unit, graphemes[index - 1], graphemes[index + 1]);
    if (kind === "other" && result.at(-1)?.kind === "other") result.at(-1)!.text += unit;
    else result.push({ kind, text: unit });
  }
  return result;
}
const pronounced = (text: string): string =>
  normalizeKana(text).replace(/[^\p{Script=Hiragana}ー]/gu, "");
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Whether a reading has punctuation that its spelling does not write, as エス・エフ does for
 * ＳＦ. JMdict punctuates some readings for legibility; the marks are not part of how the
 * spelling is read.
 */
function hasUnwrittenPunctuation(spelling: string, reading: string): boolean {
  const count = (text: string, mark: string) =>
    splitGraphemes(text).filter((unit) => unit === mark).length;
  return [...new Set(splitGraphemes(reading).filter(isSilentPunctuation))].some(
    (mark) => count(reading, mark) > count(spelling, mark),
  );
}

/** A reading without the punctuation its spelling does not write. */
export function withoutUnwrittenPunctuation(spelling: string, reading: string): string {
  return splitGraphemes(reading)
    .filter((unit) => !(isSilentPunctuation(unit) && !spelling.includes(unit)))
    .join("");
}

/**
 * Whether the spelling's kana appear, in order and exactly, in the reading,
 * with kanji and other characters standing for any reading, and the reading
 * has no punctuation the spelling lacks. 気持ちよい does not fit きもちいい,
 * 元どうり does not fit もとどおり, and ＳＦ does not fit エス・エフ.
 */
export function fitsSpelling(spelling: string, reading: string): boolean {
  if (spelling === reading || kanaPuns.has(pairKey(spelling, reading))) return true;
  if (hasUnwrittenPunctuation(spelling, reading)) return false;
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
export function contradictsSpelling(
  spelling: string,
  reading: string,
  drops: ParticleSite[] | undefined,
  segments: Segment[] = [],
): boolean {
  if (kanaPuns.has(pairKey(spelling, reading))) return false;
  return (
    !fitsSpelling(spelling, reading) ||
    (drops?.length ?? 0) > 0 ||
    segments.some((segment) => typeof segment !== "string" && !fitsSpelling(segment[0], segment[1]))
  );
}

// Kana that a reading gives another sound: a modern sound for historical kana, わ for the particle
// は, and small kana for the full-size ones older texts wrote. Kana that only spell the same sound
// another way, as ー does う, are not here: glossing them tells a reader nothing.
const phoneticRespellings = new Map([
  ["ふ", "う"],
  ["ひ", "い"],
  ["へ", "え"],
  ["ほ", "お"],
  ["は", "わ"],
  ["ゐ", "い"],
  ["ゑ", "え"],
  ["つ", "っ"],
  ["や", "ゃ"],
  ["ゆ", "ゅ"],
  ["よ", "ょ"],
]);
// Historical spelling also wrote an い-row kana before う for what is now said with ゅ, as じう
// for じゅう.
const palatalizedBeforeU = "きしちにひみりぎじぢびぴ";

/**
 * If the reading fits the spelling once some of the spelling's kana are read as
 * `phoneticRespellings` gives them, return the reading with those kana as written, which is the
 * spelling read at face value, and whether the only such kana is a final は. Undefined when
 * the reading needs no respelling or needs some other change. `alone` is for a single segment,
 * whose following kana are not in view.
 */
function faceValueReading(
  spelling: string,
  reading: string,
  alone = false,
): { reading: string; particleOnly: boolean } | undefined {
  if (hasUnwrittenPunctuation(spelling, reading)) return undefined;
  const runs = units(spelling);
  const pattern = runs
    .map(({ kind, text }, index) => {
      if (kind !== "kana") return kind === "symbol" ? "(.*?)" : "(.+?)";
      const kana = pronounced(text);
      const next = runs[index + 1];
      const beforeU =
        next === undefined ? alone : next.kind === "kana" && pronounced(next.text) === "う";
      const sounds = [kana, fullSize.get(kana), phoneticRespellings.get(kana)];
      if (palatalizedBeforeU.includes(kana) && beforeU) sounds.push(`${kana}ゅ`);
      return `(${sounds.filter((sound) => sound !== undefined).join("|")})`;
    })
    .join("");
  const match = new RegExp(`^${pattern}$`, "u").exec(pronounced(reading));
  if (match === null) return undefined;
  const respelled: { kana: string; last: boolean }[] = [];
  const faceValue = runs
    .map(({ kind, text }, index) => {
      if (kind !== "kana") return match[index + 1];
      const kana = pronounced(text);
      if (match[index + 1] === kana || match[index + 1] === fullSize.get(kana))
        return match[index + 1];
      respelled.push({ kana, last: index === runs.length - 1 });
      return kana;
    })
    .join("");
  if (respelled.length === 0) return undefined;
  return {
    reading: faceValue,
    particleOnly: respelled.every(({ kana, last }) => kana === "は" && last),
  };
}

/**
 * How a JMdict pair that contradicts its spelling is flagged; undefined when it does not
 * contradict it. `siblingReadings` lists the readings JMdict pairs with this spelling in the entry,
 * leaving out search-only ones, which are lookup keys and not ways the word is said.
 *
 * "phonetic": the reading gives the sound of kana that the spelling writes another way, as
 * のたまう does for 宣ふ and こんにちわ for 今日は. Ruby over those kana is a real pronunciation
 * aid, so whether to use the pair depends on what is being annotated. A spelling that JMdict also
 * reads at face value is itself how the word is said, as しようが無い is beside しょうがない, so its
 * other readings belong to other spellings; the particle は, which is never said は, is the
 * exception.
 *
 * "mispaired": every other contradiction. The reading belongs to another spelling, says
 * different words, has punctuation the spelling lacks, or only spells the same sound another way.
 * No use of the spelling is better served by it than by a pair that fits.
 */
export function contradictionKind(
  spelling: string,
  reading: string,
  drops: ParticleSite[] | undefined,
  segments: Segment[] = [],
  siblingReadings: string[] = [],
): ContradictionKind | undefined {
  if (!contradictsSpelling(spelling, reading, drops, segments)) return undefined;
  if ((drops?.length ?? 0) > 0) return "mispaired";
  const faceValue = faceValueReading(spelling, reading);
  if (faceValue === undefined) return "mispaired";
  const glossed = segments.every(
    (segment) =>
      typeof segment === "string" ||
      fitsSpelling(segment[0], segment[1]) ||
      faceValueReading(segment[0], segment[1], true) !== undefined,
  );
  if (!glossed) return "mispaired";
  const saidAsWritten = siblingReadings.some(
    (sibling) => pronounced(sibling) === faceValue.reading,
  );
  return saidAsWritten && !faceValue.particleOnly ? "mispaired" : "phonetic";
}

/**
 * The reading a spelling implies when its kana contradict the reading: its kana
 * stand for themselves, and each run of kanji or other characters takes the
 * part of the reading that a least-cost alignment gives it. A kana with no
 * counterpart in the reading costs one, and one that differs from its
 * counterpart costs a little more, so 元どうり with もとどおり implies もとどうり
 * but the silent の of の月 with づき leaves づき alone.
 */
function literalReading(spelling: string, reading: string): string | undefined {
  const runs = units(spelling),
    sounds = splitGraphemes(reading);
  const width = sounds.length + 1,
    cost = new Float64Array((runs.length + 1) * width).fill(Infinity),
    from = new Int32Array(cost.length).fill(-1);
  cost[0] = 0;
  for (let i = 0; i < runs.length; ++i) {
    const { kind, text } = runs[i];
    for (let j = 0; j <= sounds.length; ++j) {
      const here = cost[i * width + j];
      if (here === Infinity) continue;
      const relax = (target: number, value: number) => {
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
  const parts: string[] = [];
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
 * The reading that a contradicting pair's spelling implies. An omitted particle
 * is removed beside the cut where the generator's segments put it; otherwise
 * the spelling's own kana replace the ones the reading contradicts. Undefined
 * when the segments have no cut at the omitted particle.
 */
export function impliedReading(
  segments: Segment[],
  drops: ParticleSite[] = [],
): string | undefined {
  if (drops.length > 0) {
    const cuts = new Map<number, number>();
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
  const parts: string[] = [];
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
export function planSynthesizedPairs(
  records: PairingRecord[],
  drops: Map<string, ParticleSite[]>,
  reviewed: SynthesizedPair[],
  jmdictPairs: Set<string>,
): SynthesizedPairPlan {
  const bySpelling = new Map<string, PairingRecord[]>();
  for (const record of records) {
    const key = `${record.id}\t${record.spelling}`;
    (bySpelling.get(key) ?? bySpelling.set(key, []).get(key)!).push(record);
  }
  const listed = new Map<string, SynthesizedPair>(
    reviewed.map((item) => [`${item.id}\t${item.spelling}`, item]),
  );
  const pairs: SynthesizedPair[] = [],
    problems: string[] = [],
    missing: SynthesizedPair[] = [],
    obsolete: SynthesizedPair[] = [];
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
          .filter((value) => value !== undefined)
          .map((value) => withoutUnwrittenPunctuation(spelling, value))
          .filter((value) => fitsSpelling(spelling, value)),
      ),
    ];
    // A reading that only needs its unwritten punctuation removed needs no judgment.
    const unpunctuated = invalid
      .map((record) => withoutUnwrittenPunctuation(spelling, record.reading))
      .find((value) => fitsSpelling(spelling, value));
    const item = listed.get(key);
    listed.delete(key);
    if (item === undefined) {
      missing.push(
        unpunctuated === undefined
          ? {
              id,
              spelling,
              reading: implied[0] ?? "",
              note: implied.length === 1 ? "" : "Choose the reading this spelling implies.",
              unreviewed: true,
            }
          : {
              id,
              spelling,
              reading: unpunctuated,
              note: "Punctuation: the entry's reading has punctuation that the spelling does not write.",
            },
      );
      continue;
    }
    if (!fitsSpelling(spelling, item.reading))
      problems.push(`Synthesized reading ${item.reading} does not fit ${spelling} (${id})`);
    else if (item.unreviewed)
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
