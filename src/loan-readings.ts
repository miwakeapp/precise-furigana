import { enumeratePairs } from "./sources.ts";
import { isKana, kanaPronunciation, normalizeKana, splitGraphemes } from "./kana.ts";
import { boundaries, segmentReading, segmentText, validateAlignment } from "./segments.ts";

// Mandarin aspiration does not correspond to Japanese voicing. Both Japanese
// stop rows occur in established loans; no Japanese rendaku is inferred here.
const initials = new Map([
  ["", [""]],
  ["b", ["p", "b"]],
  ["p", ["p", "b"]],
  ["m", ["m"]],
  ["f", ["f"]],
  ["d", ["t", "d"]],
  ["t", ["t", "d"]],
  ["n", ["n"]],
  ["l", ["r"]],
  ["g", ["k", "g"]],
  ["k", ["k", "g"]],
  ["h", ["h"]],
  ["j", ["j", "ch"]],
  ["q", ["ch"]],
  ["x", ["sh"]],
  ["zh", ["ch", "j"]],
  ["ch", ["ch", "j"]],
  ["sh", ["sh"]],
  ["r", ["r", "j"]],
  ["z", ["ts", "z"]],
  ["c", ["ts"]],
  ["s", ["s"]],
]);

const kanaRows = new Map(
  Object.entries({
    "": ["あ", "い", "う", "え", "お", "や", "ゆ", "よ", "わ"],
    k: ["か", "き", "く", "け", "こ", "きゃ", "きゅ", "きょ", "くわ"],
    g: ["が", "ぎ", "ぐ", "げ", "ご", "ぎゃ", "ぎゅ", "ぎょ", "ぐわ"],
    s: ["さ", "し", "す", "せ", "そ", "しゃ", "しゅ", "しょ", "すわ"],
    z: ["ざ", "ず", "ず", "ぜ", "ぞ", "じゃ", "じゅ", "じょ", "ずわ"],
    t: ["た", "てぃ", "とぅ", "て", "と", "てぃあ", "てぃう", "てぃお", "とぅあ"],
    d: ["だ", "でぃ", "どぅ", "で", "ど", "でぃあ", "でぃう", "でぃお", "どぅあ"],
    n: ["な", "に", "ぬ", "ね", "の", "にゃ", "にゅ", "にょ", "ぬあ"],
    h: ["は", "ひ", "ふ", "へ", "ほ", "ひゃ", "ひゅ", "ひょ", "ふぁ"],
    f: ["ふぁ", "ふぃ", "ふ", "ふぇ", "ふぉ", "ふゃ", "ふゅ", "ふょ", "ふぁ"],
    b: ["ば", "び", "ぶ", "べ", "ぼ", "びゃ", "びゅ", "びょ", "ぶあ"],
    p: ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ", "ぴゃ", "ぴゅ", "ぴょ", "ぷあ"],
    m: ["ま", "み", "む", "め", "も", "みゃ", "みゅ", "みょ", "むあ"],
    r: ["ら", "り", "る", "れ", "ろ", "りゃ", "りゅ", "りょ", "るあ"],
    j: ["じゃ", "じ", "じゅ", "じぇ", "じょ", "じゃ", "じゅ", "じょ", "じゅあ"],
    ch: ["ちゃ", "ち", "ちゅ", "ちぇ", "ちょ", "ちゃ", "ちゅ", "ちょ", "ちゅあ"],
    sh: ["しゃ", "し", "しゅ", "しぇ", "しょ", "しゃ", "しゅ", "しょ", "しゅあ"],
    ts: ["つぁ", "つぃ", "つ", "つぇ", "つぉ", "つゃ", "つゅ", "つょ", "つぁ"],
  }).map(([initial, row]) => [
    initial,
    new Map(
      ["a", "i", "u", "e", "o", "ya", "yu", "yo", "wa"].map((vowel, index) => [vowel, row[index]]),
    ),
  ]),
);

// Each option has a Japanese onset vowel, the remaining kana, and whether an
// open syllable permits the long-vowel notation commonly used in Chinese loans.
const finals = new Map(
  Object.entries({
    a: [["a", "", true]],
    o: [["o", "", true]],
    e: [
      ["o", "", true],
      ["u", "", true],
    ],
    ai: [["a", "い"]],
    ei: [["e", "い"]],
    ao: [
      ["a", "お"],
      ["o", "う"],
    ],
    ou: [["o", "う"]],
    an: [["a", "ん"]],
    en: [["e", "ん"]],
    ang: [["a", "ん"]],
    eng: [["e", "ん"]],
    ong: [["o", "ん"]],
    i: [["i", "", true]],
    ia: [["ya", "", true]],
    ie: [["i", "え"]],
    iao: [
      ["ya", "お"],
      ["yo", "う"],
    ],
    iu: [["yu", "う"]],
    ian: [["i", "えん"]],
    in: [["i", "ん"]],
    iang: [["ya", "ん"]],
    ing: [["i", "ん"]],
    iong: [["yo", "ん"]],
    u: [["u", "", true]],
    ua: [
      ["wa", "", true],
      ["u", "あ"],
    ],
    uo: [
      ["u", "お"],
      ["o", "", true],
    ],
    uai: [["wa", "い"]],
    ui: [["u", "えい"]],
    uan: [
      ["u", "あん"],
      ["wa", "ん"],
    ],
    un: [
      ["u", "ん"],
      ["u", "えん"],
    ],
    uang: [["wa", "ん"]],
    ueng: [["u", "えん"]],
    v: [["yu", "", true]],
    ve: [["yu", "え"]],
    van: [
      ["yu", "あん"],
      ["yu", "えん"],
    ],
    vn: [["yu", "ん"]],
  }),
);

const zeroInitial = new Map(
  Object.entries({
    yi: "i",
    ya: "ia",
    ye: "ie",
    yao: "iao",
    you: "iu",
    yan: "ian",
    yin: "in",
    yang: "iang",
    ying: "ing",
    yong: "iong",
    yu: "v",
    yue: "ve",
    yuan: "van",
    yun: "vn",
    wu: "u",
    wa: "ua",
    wo: "uo",
    wai: "uai",
    wei: "ui",
    wan: "uan",
    wen: "un",
    wang: "uang",
    weng: "ueng",
  }),
);

/** Bounded Mandarin sound correspondences, not a universal loanword converter. */
export function transliteratePinyin(value) {
  const syllable = value.toLowerCase().replace(/u:|ü/gu, "v");
  let pinyin = syllable.replace(/[1-5]$/u, "");
  pinyin = zeroInitial.get(pinyin) ?? pinyin;
  if (pinyin === "er") return ["ある", "あーる"];
  const initial = pinyin.match(/^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcs])/u)?.[0] ?? "";
  let final = pinyin.slice(initial.length);
  if (/^[jqx]$/u.test(initial)) final = final.replace(/^u/u, "v");
  if (!initials.has(initial) || !finals.has(final)) return [];
  const result = new Set();
  for (const row of initials.get(initial)) {
    for (const [vowel, tail, long] of finals.get(final)) {
      let onset = kanaRows.get(row).get(vowel);
      if (final === "i" && /^[zcs]$/u.test(initial))
        onset = initial === "s" ? "す" : row === "z" ? "ず" : "つ";
      result.add(onset + tail);
      if (long) result.add(onset + "ー");
    }
  }
  if (/^wei[1-5]?$/u.test(syllable)) result.add("うぇい");
  if (syllable === "de5") {
    result.add("で");
    result.add("でー");
  }
  return [...result];
}

function makeSoundEvidence(kanjidic, pinyinOnly = false) {
  const result = new Map();
  for (const character of kanjidic.characters) {
    const candidates = new Map();
    for (const group of character.readingMeaning?.groups ?? []) {
      for (const source of group.readings) {
        const readings =
          source.type === "pinyin"
            ? transliteratePinyin(source.value)
            : !pinyinOnly && source.type === "ja_on"
              ? [source.value]
              : [];
        for (const reading of readings) {
          const key = kanaPronunciation(reading);
          const witnesses = candidates.get(key) ?? [];
          witnesses.push({ type: source.type, value: source.value });
          candidates.set(key, witnesses);
        }
      }
    }
    if (candidates.size) result.set(character.literal, candidates);
  }
  return result;
}

function splitLoanSegment(spelling, reading, evidence) {
  const characters = splitGraphemes(spelling);
  const kana = splitGraphemes(reading);
  if (
    characters.length < 2 ||
    !characters.every((character) => /^\p{Unified_Ideograph}$/u.test(character)) ||
    !isKana(reading)
  )
    return undefined;
  const memo = new Map();
  function visit(index, offset) {
    const key = `${index}:${offset}`;
    if (memo.has(key)) return memo.get(key);
    if (index === characters.length) {
      return offset === kana.length ? [{ segments: [], witnesses: [] }] : [];
    }
    const candidates = evidence.get(characters[index]);
    if (candidates === undefined) return [];
    const solutions = [];
    for (let end = offset + 1; end <= kana.length - (characters.length - index - 1); ++end) {
      const part = kana.slice(offset, end).join("");
      if (/^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizeKana(part))) continue;
      const sources = candidates.get(kanaPronunciation(part));
      if (sources === undefined) continue;
      for (const suffix of visit(index + 1, end)) {
        solutions.push({
          segments: [[characters[index], part], ...suffix.segments],
          witnesses: [
            { character: characters[index], reading: part, sources },
            ...suffix.witnesses,
          ],
        });
        if (solutions.length > 1) break;
      }
      if (solutions.length > 1) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const solutions = visit(0, 0);
  return solutions.length === 1 &&
    solutions[0].witnesses.some((witness) =>
      witness.sources.some((source) => source.type === "pinyin"),
    )
    ? solutions[0]
    : undefined;
}

function applies(restrictions, value) {
  return restrictions?.includes("*") || restrictions?.includes(value);
}

/** Refine attested Chinese loans locally; no reusable character readings are learned. */
export function deriveLoanAlignments(jmdict, kanjidic, align, { untaggedKatakana = false } = {}) {
  const evidence = makeSoundEvidence(kanjidic);
  const pinyinEvidence = untaggedKatakana ? makeSoundEvidence(kanjidic, true) : undefined;
  const words = new Map(jmdict.words.map((word) => [word.id, word]));
  const wordAlignments = new Map();
  const witnesses = [];
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind !== "kanji" || pair.readingTags.some((tag) => tag === "ik" || tag === "sk"))
      continue;
    const languageSources = words
      .get(pair.id)
      .sense.filter(
        (sense) =>
          applies(sense.appliesToKanji, pair.spelling) &&
          applies(sense.appliesToKana, pair.reading),
      )
      .flatMap((sense) =>
        sense.languageSource.filter((source) => source.lang === "chi" && !source.wasei),
      );
    const tagged = languageSources.length > 0;
    if (
      !tagged &&
      (!untaggedKatakana ||
        !/^\p{Unified_Ideograph}{2,}$/u.test(pair.spelling) ||
        !/^[\p{Script=Katakana}ー]+$/u.test(pair.reading.normalize("NFKC")))
    )
      continue;
    const original = align(pair.spelling, pair.reading);
    const characterEvidence = [];
    let segments;
    if (tagged) {
      segments = original.segments.flatMap((segment) => {
        const split = splitLoanSegment(segmentText(segment), segmentReading(segment), evidence);
        if (split === undefined) return [segment];
        characterEvidence.push(...split.witnesses);
        return split.segments;
      });
    } else {
      // Without language metadata, require an independent Mandarin match for
      // every character in the complete word, including already aligned parts.
      const split = splitLoanSegment(pair.spelling, pair.reading, pinyinEvidence);
      if (split === undefined || split.segments.length <= original.segments.length) continue;
      const proposedBoundaries = new Set(boundaries(split.segments));
      if (!boundaries(original.segments).every((boundary) => proposedBoundaries.has(boundary)))
        continue;
      segments = split.segments;
      characterEvidence.push(...split.witnesses);
    }
    if (characterEvidence.length === 0) continue;
    validateAlignment(pair.spelling, pair.reading, segments);
    const readings = wordAlignments.get(pair.spelling) ?? new Map();
    readings.set(pair.reading, segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({
      id: pair.id,
      spelling: pair.spelling,
      reading: pair.reading,
      language: tagged ? "chi" : undefined,
      eligibility: tagged ? "source-language" : "pinyin-only-katakana",
      languageSources,
      characters: characterEvidence,
    });
  }
  return { wordAlignments, witnesses };
}
