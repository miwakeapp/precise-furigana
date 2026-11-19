import assert from "node:assert/strict";
import test from "node:test";
import { createAligner } from "../src/align.ts";
import { deriveAtejiAlignments } from "../src/ateji.ts";
import type { JMdict } from "../src/types.ts";
import { jmdict } from "./support/dictionaries.ts";

function dictionary(spelling: string, reading: string, tags: string[] = ["ateji"]): JMdict {
  return jmdict({
    words: [
      {
        id: "1000000",
        kanji: [{ text: spelling, tags }],
        kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
      },
    ],
  });
}

test("phonetic ateji can vary vowels while preserving character consonants", () => {
  const characters = new Map([
    ["珈", ["カ"]],
    ["琲", ["ハイ"]],
  ]);
  const align = createAligner({
    characterReadings: characters,
    wordReadings: new Map([["珈琲", ["コーヒー"]]]),
  });
  const result = deriveAtejiAlignments(dictionary("珈琲", "コーヒー"), characters, align);
  assert.deepEqual(result.wordAlignments.get("珈琲")!.get("コーヒー"), [
    ["珈", "コー"],
    ["琲", "ヒー"],
  ]);
  assert.equal(
    deriveAtejiAlignments(dictionary("珈琲", "コーヒー", []), characters, align).wordAlignments
      .size,
    0,
  );
});

test("an ateji tag alone cannot justify arbitrary character sounds", () => {
  const characters = new Map([
    ["明", ["メイ"]],
    ["白", ["ハク"]],
  ]);
  const align = createAligner({
    characterReadings: characters,
    wordReadings: new Map([["明白", ["あからさま"]]]),
  });
  assert.equal(
    deriveAtejiAlignments(dictionary("明白", "あからさま"), characters, align).wordAlignments.size,
    0,
  );
});

test("ordinary kun readings stay exact in phonetic spellings", () => {
  const characters = new Map([
    ["型", ["かた"]],
    ["録", ["ロク"]],
  ]);
  const align = createAligner({
    characterReadings: characters,
    wordReadings: new Map([["型録", ["カタログ"]]]),
  });
  assert.deepEqual(
    deriveAtejiAlignments(dictionary("型録", "カタログ"), characters, align)
      .wordAlignments.get("型録")!
      .get("カタログ"),
    [
      ["型", "カタ"],
      ["録", "ログ"],
    ],
  );
});
