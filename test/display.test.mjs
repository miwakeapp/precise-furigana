import assert from "node:assert/strict";
import test from "node:test";
import { displaySegments, validateDisplayAlignment } from "../src/display.mjs";

function display(written, reading, segments) {
  const result = displaySegments(segments);
  validateDisplayAlignment(written, reading, result);
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

test("kana that the reading contradicts is shown as written", () => {
  assert.deepEqual(display("気持ちよい", "きもちいい", [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]), [["気", "き"], ["持", "も"], "ちよい"]);
  assert.deepEqual(display("サイム油", "タイムゆ", [["サ", "タ"], "イム", ["油", "ゆ"]]), ["サイム", ["油", "ゆ"]]);
  assert.deepEqual(display("お早う", "おはよー", ["お", ["早", "はよ"], ["う", "ー"]]), ["お", ["早", "はよ"], "う"]);
  assert.deepEqual(display("メーカ物", "メーカーもの", ["メー", ["カ", "カー"], ["物", "もの"]]), ["メーカ", ["物", "もの"]]);
});

test("kana runs at the edge of a ruby group are plain where the reading repeats them", () => {
  assert.deepEqual(display("そっぽ向く", "そっぽをむく", ["そっ", ["ぽ向", "ぽをむ"], "く"]), ["そっぽ", ["向", "をむ"], "く"]);
  assert.deepEqual(display("尻もつ", "けつをもつ", [["尻も", "けつをも"], "つ"]), [["尻", "けつを"], "もつ"]);
  assert.deepEqual(display("カメラを止めるな！", "カメラをとめるな", ["カメラを", ["止めるな", "とめるな"], "！"]), ["カメラを", ["止", "と"], "めるな！"]);
  // Only a whole run moves, so a coincidental first kana stays in the group.
  assert.deepEqual(display("近からずとも遠からず", "ちかからずとおからず", [["近", "ちか"], "からず", ["とも遠", "とお"], "からず"]),
    [["近", "ちか"], "からず", ["とも遠", "とお"], "からず"]);
  // The group keeps part of the reading.
  assert.deepEqual(display("ア♀ウ", "アウ", [["ア♀ウ", "アウ"]]), [["ア♀ウ", "アウ"]]);
  assert.throws(() => validateDisplayAlignment("そっぽ向く", "そっぽをむく", ["そっ", ["ぽ向", "ぽをむ"], "く"]), /Ruby over kana/u);
});

test("counters and puns keep ruby over kana", () => {
  assert.deepEqual(display("何ヶ月", "なんかげつ", [["何", "なん"], ["ヶ", "か"], ["月", "げつ"]]), [["何", "なん"], ["ヶ", "か"], ["月", "げつ"]]);
  assert.deepEqual(display("二ケ所", "にかしょ", [["二", "に"], ["ケ", "か"], ["所", "しょ"]]), [["二", "に"], ["ケ", "か"], ["所", "しょ"]]);
  assert.deepEqual(display("ケ月", "けげつ", [["ケ", "け"], ["月", "げつ"]]), ["ケ", ["月", "げつ"]]);
  assert.deepEqual(display("怪レい日本語", "あやしいにほんご", [["怪", "あや"], ["レ", "し"], "い", ["日", "に"], ["本", "ほん"], ["語", "ご"]]),
    [["怪", "あや"], ["レ", "し"], "い", ["日", "に"], ["本", "ほん"], ["語", "ご"]]);
});

test("validation requires canonical segments whose ruby follows the reading", () => {
  assert.throws(() => validateDisplayAlignment("親ネコ", "おやねこ", [["親", "おや"], ["ネコ", "ねこ"]]), /Ruby over kana/u);
  assert.throws(() => validateDisplayAlignment("気持ちよい", "きもちいい", [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]), /Ruby over kana/u);
  assert.throws(() => validateDisplayAlignment("あい", "あい", ["あ", "い"]), /Adjacent/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"], "川"]), /needs ruby/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"], ["川", "がわ"]]), /account/u);
  assert.throws(() => validateDisplayAlignment("山川", "やまかわ", [["山", "やま"]]), /reconstruct/u);
  assert.throws(() => validateDisplayAlignment("山", "やま", [["山", ""]]), /Invalid/u);
});
