import assert from "node:assert/strict";
import test from "node:test";
import { deriveLoanAlignments, transliteratePinyin } from "../src/loan-readings.mjs";
import { boundaries, validateAlignment } from "../src/segments.mjs";
import { createAligner } from "../src/align.mjs";

function entry(id, written, reading, options = {}) {
  return {
    id, kanji: [{ text: written, tags: [] }], kana: [{ text: reading, tags: options.tags ?? [], appliesToKanji: ["*"] }],
    sense: [{ appliesToKanji: options.appliesToKanji ?? ["*"], appliesToKana: options.appliesToKana ?? ["*"], languageSource: options.languageSource ?? [{ lang: "chi", wasei: false, text: "independent source" }] }]
  };
}

function characters(specification) {
  return { characters: Object.entries(specification).map(([literal, values]) => ({ literal, readingMeaning: { groups: [{ readings: values.map(([type, value]) => ({ type, value })) }] } })) };
}

const source = characters({
  小: [["pinyin", "xiao3"], ["ja_on", "ショウ"]], 籠: [["pinyin", "long2"], ["ja_on", "ロウ"]], 包: [["pinyin", "bao1"], ["ja_on", "ホウ"]],
  青: [["pinyin", "qing1"]], 山: [["pinyin", "shan1"], ["ja_on", "サン"]],
  門: [["pinyin", "men2"]], 前: [["ja_on", "ゼン"]], 清: [["pinyin", "qing1"]]
});
const grouped = (written, reading) => ({ segments: [[written, reading]], status: "aligned" });

test("transcribes attested Mandarin syllable families without using neighboring residuals", () => {
  for (const [pinyin, kana] of [["xiao3", "しゃお"], ["long2", "ろん"], ["bao1", "ぱお"], ["bao1", "ぽう"], ["qing1", "ちん"], ["ma2", "まー"], ["zi5", "ず"], ["lü4", "りゅ"], ["lu:4", "りゅ"]]) {
    assert.ok(transliteratePinyin(pinyin).includes(kana), `${pinyin}: ${kana}`);
  }
  assert.deepEqual(transliteratePinyin("unknown"), []);
  assert.ok(!transliteratePinyin("xiang1").includes("ほん"), "Mandarin does not fabricate Cantonese Hong Kong readings");
});

test("whole wei and neutral de5 retain old alternatives without widening ui or other e syllables", () => {
  for (const value of ["wei", "wei1", "wei2", "wei3", "wei4", "wei5", "WEI2"]) {
    assert.deepEqual(transliteratePinyin(value), ["うえい", "うぇい"]);
  }
  const existingDe = ["と", "とー", "とぅ", "とぅー", "ど", "どー", "どぅ", "どぅー"];
  for (const value of ["de5", "DE5"]) assert.deepEqual(transliteratePinyin(value), [...existingDe, "で", "でー"]);
  for (const value of ["de", "de1", "de2", "de3", "de4"]) assert.deepEqual(transliteratePinyin(value), existingDe);
  assert.deepEqual(transliteratePinyin("gui1"), ["くえい", "ぐえい"]);
  assert.deepEqual(transliteratePinyin("ge1"), ["こ", "こー", "く", "くー", "ご", "ごー", "ぐ", "ぐー"]);
  for (const value of ["wei6", "wei12", "wēi", "de55"]) assert.deepEqual(transliteratePinyin(value), []);
});

test("refines a language-tagged loan using each character's pinyin and preserves the original reading script", () => {
  const jmdict = { words: [entry("1", "小籠包", "ショーロンポー")] };
  const result = deriveLoanAlignments(jmdict, source, grouped);
  assert.deepEqual(result.wordAlignments.get("小籠包").get("ショーロンポー"), [["小", "ショー"], ["籠", "ロン"], ["包", "ポー"]]);
  assert.equal(result.witnesses[0].characters[1].sources[0].value, "long2");
});

test("allows independently listed Japanese on-readings inside historical hybrid loans", () => {
  const result = deriveLoanAlignments({ words: [entry("1", "門前清", "メンゼンチン")] }, source, grouped);
  assert.deepEqual(result.wordAlignments.get("門前清").get("メンゼンチン"), [["門", "メン"], ["前", "ゼン"], ["清", "チン"]]);
  assert.deepEqual(result.witnesses[0].characters[1].sources, [{ type: "ja_on", value: "ゼン" }]);
});

test("does not infer Chinese provenance from an all-katakana reading", () => {
  const words = [entry("1", "小籠包", "ショーロンポー", { languageSource: [] }), entry("2", "小籠包", "ショーロンポー", { languageSource: [{ lang: "kor", wasei: false }] })];
  assert.equal(deriveLoanAlignments({ words }, source, grouped).wordAlignments.size, 0);
});

test("respects sense restrictions, reading tags, and Japanese-coined source metadata", () => {
  for (const options of [{ appliesToKanji: ["別表記"] }, { appliesToKana: ["べつ"] }, { tags: ["ik"] }, { tags: ["sk"] }, { languageSource: [{ lang: "chi", wasei: true }] }]) {
    assert.equal(deriveLoanAlignments({ words: [entry("1", "小籠包", "ショーロンポー", options)] }, source, grouped).wordAlignments.size, 0);
  }
});

test("requires every character to have independent sound evidence", () => {
  const result = deriveLoanAlignments({ words: [entry("1", "小謎包", "ショーロンポー")] }, source, grouped);
  assert.equal(result.wordAlignments.size, 0);
});

test("withholds different valid allocations of a vowel between characters", () => {
  const ambiguous = characters({ 麻: [["pinyin", "ma2"]], 阿: [["pinyin", "a1"]] });
  const result = deriveLoanAlignments({ words: [entry("1", "麻阿", "まああ")] }, ambiguous, grouped);
  assert.equal(result.wordAlignments.size, 0);
});

test("refines each baseline segment separately and never shifts an accepted boundary", () => {
  const baseline = () => ({ segments: [["青", "チン"], ["小籠包", "ショーロンポー"]], status: "aligned" });
  const result = deriveLoanAlignments({ words: [entry("1", "青小籠包", "チンショーロンポー")] }, source, baseline);
  const segments = result.wordAlignments.get("青小籠包").get("チンショーロンポー");
  assert.ok(boundaries(segments).includes(boundaries(baseline().segments)[0]));
  validateAlignment("青小籠包", "チンショーロンポー", segments);
});

test("optional untagged eligibility requires complete katakana and pinyin support for every character", () => {
  const options = { languageSource: [] };
  const words = [entry("1", "小籠包", "シャオロンパオ", options), entry("2", "門前清", "メンゼンチン", options), entry("3", "小籠包", "しゃおろんぱお", options)];
  const result = deriveLoanAlignments({ words }, source, grouped, { untaggedKatakana: true });
  assert.equal(result.witnesses.length, 1);
  assert.equal(result.witnesses[0].eligibility, "pinyin-only-katakana");
  assert.deepEqual(result.wordAlignments.get("小籠包").get("シャオロンパオ"), [["小", "シャオ"], ["籠", "ロン"], ["包", "パオ"]]);
});

test("untagged Mandarin proof cannot move a baseline boundary", () => {
  const words = [entry("1", "小籠包", "シャオロンパオ", { languageSource: [] })];
  const baseline = () => ({ segments: [["小", "シャ"], ["籠包", "オロンパオ"]] });
  assert.equal(deriveLoanAlignments({ words }, source, baseline, { untaggedKatakana: true }).wordAlignments.size, 0);
});

test("the engine can reuse a supported whole loan in longer compounds without learning free character readings", () => {
  const result = deriveLoanAlignments({ words: [entry("1", "小籠包", "ショーロンポー")] }, source, grouped);
  const align = createAligner({
    characterReadings: new Map([["屋", ["や"]]]),
    wordReadings: new Map([["小籠包", ["ショーロンポー"]], ["小籠包屋", ["ショーロンポーや"]]]),
    wordAlignments: result.wordAlignments
  });
  assert.deepEqual(align("小籠包屋", "ショーロンポーや").segments, [["小", "ショー"], ["籠", "ロン"], ["包", "ポー"], ["屋", "や"]]);
  assert.deepEqual(align("小籠", "ショーロン").segments, [["小籠", "ショーロン"]]);
});
