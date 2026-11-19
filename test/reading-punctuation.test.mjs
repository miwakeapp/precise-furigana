import assert from "node:assert/strict";
import test from "node:test";
import { alignPastReadingPunctuation } from "../src/dataset.mjs";

// A stand-in aligner that knows a few alignments and groups everything else.
function aligner(known) {
  return alignPastReadingPunctuation((spelling, reading) => ({
    status: "aligned",
    segments: known[`${spelling}/${reading}`] ?? [[spelling, reading]],
  }));
}

test("a reading's unwritten punctuation does not stop the spelling from dividing", () => {
  const align = aligner({
    "ＳＦ/エスエフ": [
      ["Ｓ", "エス"],
      ["Ｆ", "エフ"],
    ],
    "ウインナー珈琲/ウインナーコーヒー": ["ウインナー", ["珈", "コー"], ["琲", "ヒー"]],
    "Ｑ＆Ａ/キューアンドエー": [
      ["Ｑ", "キュー"],
      ["＆", "アンド"],
      ["Ａ", "エー"],
    ],
  });
  // A mark goes into the ruby segment that ends where it stands.
  assert.deepEqual(align("ＳＦ", "エス・エフ").segments, [
    ["Ｓ", "エス・"],
    ["Ｆ", "エフ"],
  ]);
  assert.deepEqual(align("Ｑ＆Ａ", "キュー・アンド・エー").segments, [
    ["Ｑ", "キュー・"],
    ["＆", "アンド・"],
    ["Ａ", "エー"],
  ]);
  // Plain kana cannot hold a mark, so it goes into the ruby segment that starts there.
  assert.deepEqual(align("ウインナー珈琲", "ウインナー・コーヒー").segments, [
    "ウインナー",
    ["珈", "・コー"],
    ["琲", "ヒー"],
  ]);
});

test("the direct alignment stands when the marks have nowhere to go or nothing is gained", () => {
  const align = aligner({ "かな山/かなやま": ["かな", ["山", "やま"]] });
  // The mark falls inside plain kana.
  assert.deepEqual(align("かな山", "か・なやま").segments, [["かな山", "か・なやま"]]);
  // Punctuation that the spelling writes is aligned as usual.
  assert.deepEqual(align("Ｓ・Ｍ", "エス・エム").segments, [["Ｓ・Ｍ", "エス・エム"]]);
  // Stripping the marks finds no finer division.
  assert.deepEqual(align("ＮＧ", "エヌ・ジー").segments, [["ＮＧ", "エヌ・ジー"]]);
});
