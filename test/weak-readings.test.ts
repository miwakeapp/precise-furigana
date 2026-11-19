import assert from "node:assert/strict";
import test from "node:test";
import { deriveWeakReadings, refineAlignment } from "../src/weak-readings.ts";

function word(id, spelling, reading) {
  return {
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
  };
}

test("supplementary evidence keeps nanori and complete kun readings separate from primary readings", () => {
  const result = deriveWeakReadings(
    { words: [] },
    { characters: [{ literal: "時", readingMeaning: { nanori: ["と"] } }] },
    new Map([["三", ["み.つ"]]]),
  );
  assert.deepEqual(result.readings.get("時"), ["と"]);
  assert.deepEqual(result.readings.get("三"), ["みつ"]);
  assert.equal(result.witnesses.length, 2);
});

test("a leading kana vowel cannot become an inferred character reading", () => {
  const jmdict = {
    words: [word("1", "あいそ笑い", "あいそうわらい"), word("2", "笑い", "わらい")],
  };
  const result = deriveWeakReadings(jmdict, { characters: [] }, new Map());
  assert.deepEqual(result.readings.get("笑"), ["わら"]);
});

test("weak readings cannot move boundaries justified by stronger evidence", () => {
  const strong = {
    segments: [
      ["細小", "いささ"],
      ["小", "お"],
      ["笹", "ざさ"],
    ],
    status: "aligned",
  };
  const wrong = {
    segments: [
      ["細", "いささ"],
      ["小", "お"],
      ["小", "ざ"],
      ["笹", "さ"],
    ],
    status: "aligned",
  };
  assert.equal(refineAlignment(strong, wrong), strong);
  const finer = {
    segments: [
      ["細", "い"],
      ["小", "ささ"],
      ["小", "お"],
      ["笹", "ざさ"],
    ],
    status: "aligned",
  };
  assert.equal(refineAlignment(strong, finer), finer);
});
