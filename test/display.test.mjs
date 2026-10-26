import assert from "node:assert/strict";
import test from "node:test";
import { displaySegments, validateDisplayAlignment } from "../src/display.mjs";

function display(written, reading, segments, evidence = segments.map(segment => typeof segment === "string" ? "literal" : "character")) {
  const result = displaySegments(segments, evidence);
  validateDisplayAlignment(written, reading, result.segments);
  assert.equal(result.evidence.length, result.segments.length);
  return result;
}

test("silent punctuation becomes plain text beside its ruby", () => {
  const result = display("士・農・工・商", "しのうこうしょう", [["士・", "し"], ["農・", "のう"], ["工・", "こう"], ["商", "しょう"]]);
  assert.deepEqual(result.segments, [["士", "し"], "・", ["農", "のう"], "・", ["工", "こう"], "・", ["商", "しょう"]]);
  assert.deepEqual(result.evidence, ["character", "literal", "character", "literal", "character", "literal", "character"]);
  assert.deepEqual(display("・丙", "う", [["・丙", "う"]]).segments, ["・", ["丙", "う"]]);
});

test("punctuation stays in ruby when it is the whole group or appears in the reading", () => {
  assert.deepEqual(display("〜", "から", [["〜", "から"]]).segments, [["〜", "から"]]);
  assert.deepEqual(display("Ｓ・Ｍ", "エス・エム", [["Ｓ・Ｍ", "エス・エム"]]).segments, [["Ｓ・Ｍ", "エス・エム"]]);
  assert.deepEqual(display("ＳＭ、", "エスエム、", [["ＳＭ、", "エスエム、"]]).segments, [["ＳＭ、", "エスエム、"]]);
});

test("kana that differs from its reading only in script loses its ruby", () => {
  assert.deepEqual(display("親ネコ", "おやねこ", [["親", "おや"], ["ネコ", "ねこ"]]).segments, [["親", "おや"], "ネコ"]);
  const result = display("行けない", "イケナイ", [["行", "イ"], ["け", "ケ"], ["ない", "ナイ"]], ["character", "literal", "literal"]);
  assert.deepEqual(result.segments, [["行", "イ"], "けない"]);
  assert.deepEqual(result.evidence, ["character", "literal"]);
  assert.deepEqual(display("高フルクトース・コーン・シロップ", "こうフルクトースコーンシロップ", [["高", "こう"], ["フルクトース・コーン", "フルクトースコーン"], "・シロップ"]).segments,
    [["高", "こう"], "フルクトース・コーン・シロップ"]);
  assert.deepEqual(display("お早う", "おはよー", ["お", ["早", "はよ"], ["う", "ー"]]).segments, ["お", ["早", "はよ"], ["う", "ー"]]);
});

test("validation requires canonical segments that account for the reading", () => {
  assert.throws(() => validateDisplayAlignment("親ネコ", "おやねこ", [["親", "おや"], ["ネコ", "ねこ"]]), /repeats/u);
  assert.throws(() => validateDisplayAlignment("あい", "あい", ["あ", "い"]), /Adjacent/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"], "川"]), /account/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"]]), /reconstruct/u);
  assert.throws(() => validateDisplayAlignment("山", "やま", [["山", ""]]), /Invalid/u);
});
