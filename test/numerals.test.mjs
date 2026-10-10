import assert from "node:assert/strict";
import test from "node:test";
import { createAligner } from "../src/align.mjs";
import { deriveNumeralAlignments, deriveNumeralReadings } from "../src/numerals.mjs";
import { compileAlignmentPipeline } from "../src/dataset.mjs";

function dictionary(written, reading) {
  return { words: [{ id: "1000000", kanji: [{ text: written, tags: [] }], kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }] }] };
}

test("decimal numerals retain one base while their adjacent kanji stay precise", () => {
  const align = createAligner({ characterReadings: new Map([["十", ["ジュウ"]], ["一", ["イチ"]], ["月", ["ガツ"]]]) });
  const result = deriveNumeralAlignments(dictionary("１１月", "じゅういちがつ"), align);
  assert.deepEqual(result.wordAlignments.get("１１月").get("じゅういちがつ"), [["１１", "じゅういち"], ["月", "がつ"]]);
});

test("fullwidth spellings retain exact original text", () => {
  const align = createAligner({ characterReadings: new Map([["版", ["ハン"]]]), wordReadings: new Map([["Web", ["ウェブ"]]]) });
  const result = deriveNumeralAlignments(dictionary("Ｗｅｂ版", "ウェブばん"), align);
  assert.deepEqual(result.wordAlignments.get("Ｗｅｂ版").get("ウェブばん"), [["Ｗｅｂ", "ウェブ"], ["版", "ばん"]]);
});

test("unsupported synthetic spellings cannot establish new boundaries", () => {
  const align = createAligner({ characterReadings: new Map([["一", ["イチ"]]]) });
  assert.equal(deriveNumeralAlignments(dictionary("１１謎", "じゅういちなぞ"), align).wordAlignments.size, 0);
});

test("width normalization also keeps an entire decimal numeral together", () => {
  const align = written => ({ status: "aligned", segments: written === "11月" ? [["1", "じゅう"], ["1", "いち"], ["月", "がつ"]] : [[written, "じゅういちがつ"]] });
  const result = deriveNumeralAlignments(dictionary("１１月", "じゅういちがつ"), align);
  assert.deepEqual(result.wordAlignments.get("１１月").get("じゅういちがつ"), [["１１", "じゅういち"], ["月", "がつ"]]);
});

test("number definitions respect reading restrictions and exclude incidental translations", () => {
  const words = [
    { id: "1", kanji: [], kana: [{ text: "スリー" }, { text: "ミツ" }], sense: [{ appliesToKana: ["スリー"], gloss: [{ lang: "eng", text: "three" }] }] },
    { id: "2", kanji: [{ text: "飛" }], kana: [{ text: "トビ" }], sense: [{ appliesToKana: ["*"], gloss: [{ lang: "eng", text: "zero" }] }] },
    { id: "3", kanji: [], kana: [{ text: "テン" }], sense: [{ appliesToKana: ["*"], gloss: [{ lang: "eng", text: "TEN" }] }] },
    { id: "4", kanji: [], kana: [{ text: "ナイン" }], sense: [{ appliesToKana: ["*"], gloss: [{ lang: "ger", text: "nine" }] }] }
  ];
  const original = new Map([["3", ["さん"]]]);
  const { readings, witnesses } = deriveNumeralReadings({ words }, original);
  assert.deepEqual(readings.get("3"), ["さん", "スリー"]);
  assert.deepEqual(readings.get("３"), ["スリー"]);
  assert.deepEqual(original.get("3"), ["さん"]);
  assert.equal(readings.size, 2);
  assert.deepEqual(witnesses, [{ id: "1", written: "3", reading: "スリー", definition: "three" }]);
});

test("source number words refine mixed alphanumerics while spoken cardinals stay whole", () => {
  const words = [];
  const add = (written, reading, gloss) => words.push({
    id: String(words.length + 1),
    kanji: written === undefined ? [] : [{ text: written, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
    sense: gloss === undefined ? [] : [{ appliesToKanji: ["*"], appliesToKana: ["*"], partOfSpeech: ["n"], languageSource: [], gloss: [{ lang: "eng", text: gloss }] }]
  });
  add(undefined, "スリー", "three");
  add(undefined, "テン", "ten");
  add("Ｄ", "ディー");
  add("Ｇ", "ジー");
  add("３Ｄ", "スリーディー");
  add("Ｇ１０", "ジーテン");
  const jmdict = { words }, kanjidic = { characters: [] };
  const baseline = compileAlignmentPipeline(jmdict, kanjidic, { foreignNumerals: false });
  const candidate = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(baseline.align("３Ｄ", "スリーディー").segments, [["３Ｄ", "スリーディー"]]);
  assert.deepEqual(candidate.align("３Ｄ", "スリーディー").segments, [["３", "スリー"], ["Ｄ", "ディー"]]);
  assert.deepEqual(candidate.align("Ｇ１０", "ジーテン").segments, [["Ｇ", "ジー"], ["１０", "テン"]]);
});

test("foreign number candidates cannot move a supported numeral boundary", () => {
  const align = written => written === "十二月" ? {
    status: "aligned", segments: [["十", "じゅう"], ["二", "に"], ["月", "がつ"]]
  } : { status: "fallback", segments: [[written, "じゅうにがつ"]] };
  const foreignAlign = () => ({ status: "aligned", segments: [["１２", "じゅう"], ["月", "にがつ"]] });
  const result = deriveNumeralAlignments(dictionary("１２月", "じゅうにがつ"), align, { foreignAlign });
  assert.deepEqual(result.wordAlignments.get("１２月").get("じゅうにがつ"), [["１２", "じゅうに"], ["月", "がつ"]]);
  assert.equal(result.witnesses[0].from, "十二月");
});
