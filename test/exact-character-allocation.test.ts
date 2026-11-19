import assert from "node:assert/strict";
import test from "node:test";
import { uniqueExactCharacterAlignment } from "../src/exact-character-allocation.ts";

test("requires a complete exact allocation for every character", () => {
  const primary = new Map([
    ["甲", ["ア"]],
    ["乙", ["イ"]],
  ]);
  assert.deepEqual(uniqueExactCharacterAlignment("甲乙", "あい", primary)!.segments, [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  assert.equal(uniqueExactCharacterAlignment("甲乙", "あいえ", primary), undefined);
  assert.equal(uniqueExactCharacterAlignment("甲丙", "あい", primary), undefined);
});

test("rejects distinct complete boundary allocations", () => {
  const primary = new Map([
    ["甲", ["ア", "アイ"]],
    ["乙", ["イウ", "ウ"]],
  ]);
  assert.equal(uniqueExactCharacterAlignment("甲乙", "あいう", primary), undefined);
});

test("deduplicates normalized sounds while preserving every raw form", () => {
  const primary = new Map([
    ["甲", ["ア", "あ", "あ.る", "-あ"]],
    ["乙", ["イ"]],
  ]);
  const result = uniqueExactCharacterAlignment("甲乙", "あい", primary);
  assert.deepEqual(result!.segments, [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  assert.deepEqual(result!.allocations[0].rawForms, ["ア", "あ", "あ.る", "-あ"]);
});

test("counts only complete solutions, not dead-end prefixes", () => {
  const primary = new Map([
    ["甲", ["ア", "アイ", "アイウ"]],
    ["乙", ["エ"]],
  ]);
  assert.deepEqual(uniqueExactCharacterAlignment("甲乙", "あいうえ", primary)!.segments, [
    ["甲", "あいう"],
    ["乙", "え"],
  ]);
});

test("keeps explicitly dotted suffixes literal rather than absorbing them", () => {
  const primary = new Map([["甲", ["あ.る"]]]);
  assert.deepEqual(uniqueExactCharacterAlignment("甲る", "ある", primary)!.segments, [
    ["甲", "あ"],
    "る",
  ]);
  assert.equal(uniqueExactCharacterAlignment("甲", "ある", primary), undefined);
  assert.deepEqual(
    uniqueExactCharacterAlignment("甲れ", "あれ", primary)!.allocations[0].rawForms,
    ["あ.る"],
  );
});

test("does not infer voicing, gemination, lengthening or truncated sounds", () => {
  for (const [form, sound] of [
    ["カ", "が"],
    ["カク", "かっ"],
    ["ト", "とー"],
    ["あたま", "あた"],
  ]) {
    assert.equal(uniqueExactCharacterAlignment("甲", sound, new Map([["甲", [form]]])), undefined);
  }
});

test("retains original script and combining graphemes", () => {
  const result = uniqueExactCharacterAlignment(
    "甲カ\u3099乙",
    "アガイ",
    new Map([
      ["甲", ["あ"]],
      ["乙", ["い"]],
    ]),
  );
  assert.deepEqual(result!.segments, [
    ["甲", "ア"],
    ["カ\u3099", "ガ"],
    ["乙", "イ"],
  ]);
});

test("joins contiguous literal kana without introducing display-only cuts", () => {
  const result = uniqueExactCharacterAlignment("かな甲", "カナア", new Map([["甲", ["ア"]]]));
  assert.deepEqual(result!.segments, [
    ["かな", "カナ"],
    ["甲", "ア"],
  ]);
  assert.equal(result!.allocations.length, 3);
});
