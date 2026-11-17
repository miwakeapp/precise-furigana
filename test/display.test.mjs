import assert from "node:assert/strict";
import test from "node:test";
import { displaySegments, validateDisplayAlignment } from "../src/display.mjs";

function display(spelling, reading, segments) {
  const result = displaySegments(segments);
  validateDisplayAlignment(spelling, reading, result);
  return result;
}

test("silent punctuation becomes plain text beside its ruby", () => {
  assert.deepEqual(display("士・農・工・商", "しのうこうしょう", [["士・", "し"], ["農・", "のう"], ["工・", "こう"], ["商", "しょう"]]),
    [["士", "し"], "・", ["農", "のう"], "・", ["工", "こう"], "・", ["商", "しょう"]]);
  assert.deepEqual(display("・丙", "う", [["・丙", "う"]]), ["・", ["丙", "う"]]);
});

test("punctuation stays in ruby when it is the whole group or appears in the reading", () => {
  assert.deepEqual(display("〜", "から", [["〜", "から"]]), [["〜", "から"]]);
  assert.deepEqual(display("Ｓ・Ｍ", "エス・エム", [["Ｓ・Ｍ", "エス・エム"]]), [["Ｓ・Ｍ", "エス・エム"]]);
  assert.deepEqual(display("ＳＭ、", "エスエム、", [["ＳＭ、", "エスエム、"]]), [["ＳＭ、", "エスエム、"]]);
});

test("kana that differs from its reading only in script loses its ruby", () => {
  assert.deepEqual(display("親ネコ", "おやねこ", [["親", "おや"], ["ネコ", "ねこ"]]), [["親", "おや"], "ネコ"]);
  assert.deepEqual(display("行けない", "イケナイ", [["行", "イ"], ["け", "ケ"], ["ない", "ナイ"]]), [["行", "イ"], "けない"]);
  assert.deepEqual(display("高フルクトース・コーン・シロップ", "こうフルクトースコーンシロップ", [["高", "こう"], ["フルクトース・コーン", "フルクトースコーン"], "・シロップ"]),
    [["高", "こう"], "フルクトース・コーン・シロップ"]);
});

test("kana that the reading contradicts keeps its ruby, so the segments spell out the reading", () => {
  assert.deepEqual(display("気持ちよい", "きもちいい", [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]), [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]);
  assert.deepEqual(display("お早う", "おはよー", ["お", ["早", "はよ"], ["う", "ー"]]), ["お", ["早", "はよ"], ["う", "ー"]]);
  assert.deepEqual(display("何ヶ月", "なんかげつ", [["何", "なん"], ["ヶ", "か"], ["月", "げつ"]]), [["何", "なん"], ["ヶ", "か"], ["月", "げつ"]]);
  assert.deepEqual(display("ケ月", "けげつ", [["ケ", "け"], ["月", "げつ"]]), ["ケ", ["月", "げつ"]]);
});

test("a kana-only ruby group shows the kana its reading repeats at the edges as plain text", () => {
  assert.deepEqual(display("黒んぼう", "くろんぼ", [["黒", "くろ"], ["んぼう", "んぼ"]]), [["黒", "くろ"], "ん", ["ぼう", "ぼ"]]);
  assert.deepEqual(display("ててなし子", "ちちなしご", [["ててなし", "ちちなし"], ["子", "ご"]]), [["てて", "ちち"], "なし", ["子", "ご"]]);
  assert.deepEqual(display("何だかんだ", "なんだかだ", [["何", "なん"], ["だかん", "だか"], "だ"]), [["何", "なん"], "だ", ["かん", "か"], "だ"]);
  assert.deepEqual(display("餡ドーナツ", "あんドーナッツ", [["餡", "あん"], ["ドーナ", "ドーナッ"], "ツ"]), [["餡", "あん"], "ドー", ["ナ", "ナッ"], "ツ"]);
  // The group keeps at least one sound, and a small kana stays with the kana before it.
  assert.deepEqual(display("もう一度", "もいちど", [["もう", "も"], ["一", "いち"], ["度", "ど"]]), [["もう", "も"], ["一", "いち"], ["度", "ど"]]);
  assert.deepEqual(display("ちょうちょう結び", "ちょうちょむすび", ["ちょう", ["ちょう", "ちょ"], ["結", "むす"], "び"]), ["ちょう", ["ちょう", "ちょ"], ["結", "むす"], "び"]);
  assert.throws(() => validateDisplayAlignment("黒んぼう", "くろんぼ", [["黒", "くろ"], ["んぼう", "んぼ"]]), /Ruby over kana/u);
});

test("validation requires canonical segments that spell out the reading", () => {
  assert.throws(() => validateDisplayAlignment("親ネコ", "おやねこ", [["親", "おや"], ["ネコ", "ねこ"]]), /Ruby over kana/u);
  assert.throws(() => validateDisplayAlignment("気持ちよい", "きもちいい", [["気", "き"], ["持", "も"], "ちよい"]), /account/u);
  assert.throws(() => validateDisplayAlignment("あい", "あい", ["あ", "い"]), /Adjacent/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"], "川"]), /needs ruby/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"], ["川", "がわ"]]), /account/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"]]), /reconstruct/u);
  assert.throws(() => validateDisplayAlignment("山", "やま", [["山", ""]]), /Invalid/u);
});
