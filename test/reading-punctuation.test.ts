import assert from "node:assert/strict";
import test from "node:test";
import { alignPastPunctuation } from "../src/dataset.ts";

// A stand-in aligner that knows a few alignments and groups everything else.
function aligner(known) {
  return alignPastPunctuation((spelling, reading) => ({
    status: "aligned",
    segments: known[`${spelling}/${reading}`] ?? [[spelling, reading]],
  }));
}
const known = {
  "ＳＦ/エスエフ": [
    ["Ｓ", "エス"],
    ["Ｆ", "エフ"],
  ],
  "ＳＭ/エスエム": [
    ["Ｓ", "エス"],
    ["Ｍ", "エム"],
  ],
  "ＡＤコンバーター/エーディーコンバーター": [["Ａ", "エー"], ["Ｄ", "ディー"], "コンバーター"],
  "ウインナー珈琲/ウインナーコーヒー": ["ウインナー", ["珈", "コー"], ["琲", "ヒー"]],
  "かな山/かなやま": ["かな", ["山", "やま"]],
};

test("a mark that both the spelling and the reading have becomes its own segment", () => {
  const align = aligner(known);
  assert.deepEqual(align("Ｓ・Ｍ", "エス・エム").segments, [["Ｓ", "エス"], "・", ["Ｍ", "エム"]]);
});

test("a mark that only the spelling has joins a ruby segment's base, for display to show plainly", () => {
  const align = aligner(known);
  assert.deepEqual(align("Ａ／Ｄコンバーター", "エーディーコンバーター").segments, [
    ["Ａ／", "エー"],
    ["Ｄ", "ディー"],
    "コンバーター",
  ]);
  assert.deepEqual(align("Ｓ・Ｍ", "エスエム").segments, [
    ["Ｓ・", "エス"],
    ["Ｍ", "エム"],
  ]);
});

test("a mark that only the reading has joins a ruby segment's reading", () => {
  const align = aligner(known);
  // It joins the ruby segment that ends where it stands.
  assert.deepEqual(align("ＳＦ", "エス・エフ").segments, [
    ["Ｓ", "エス・"],
    ["Ｆ", "エフ"],
  ]);
  // Plain kana cannot hold it, so here it joins the ruby segment that starts there.
  assert.deepEqual(align("ウインナー珈琲", "ウインナー・コーヒー").segments, [
    "ウインナー",
    ["珈", "・コー"],
    ["琲", "ヒー"],
  ]);
  // The two sides can differ at the same place.
  assert.deepEqual(align("Ｓ．Ｆ．", "エス・エフ").segments, [
    ["Ｓ．", "エス・"],
    ["Ｆ．", "エフ"],
  ]);
});

test("the direct alignment stands when nothing is gained, and a read mark is never set aside", () => {
  const align = aligner(known);
  // Removing the marks finds no finer division.
  assert.deepEqual(align("ＮＧ", "エヌ・ジー").segments, [["ＮＧ", "エヌ・ジー"]]);
  // A mark that is read aloud is not silent, so nothing is removed.
  assert.deepEqual(align("１００％", "ひゃくパーセント").segments, [
    ["１００％", "ひゃくパーセント"],
  ]);
});

test("a boundary found without the marks is added to the direct alignment's", () => {
  // The direct alignment divides the first half, and the one without marks divides the second.
  const align = alignPastPunctuation((spelling, reading) => ({
    status: "aligned",
    segments: {
      "甲乙・丙丁/かきくけ": [
        ["甲", "か"],
        ["乙・丙丁", "きくけ"],
      ],
      "甲乙丙丁/かきくけ": [
        ["甲乙", "かき"],
        ["丙", "く"],
        ["丁", "け"],
      ],
    }[`${spelling}/${reading}`] ?? [[spelling, reading]],
  }));
  assert.deepEqual(align("甲乙・丙丁", "かきくけ").segments, [
    ["甲", "か"],
    ["乙・", "き"],
    ["丙", "く"],
    ["丁", "け"],
  ]);
});

test("a mark the reading has inside plain kana puts that kana under ruby", () => {
  const align = aligner(known);
  assert.deepEqual(align("かな山", "か・なやま").segments, [
    ["かな", "か・な"],
    ["山", "やま"],
  ]);
});
