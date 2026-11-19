import assert from "node:assert/strict";
import test from "node:test";
import { deriveCharacterReadings } from "../src/lexicon.ts";
import * as fixture from "./support/dictionaries.ts";

function word(id: string, spelling: string, reading: string, tags: string[] = []) {
  return {
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, appliesToKanji: ["*"], tags }],
  };
}

test("single-kanji readings and exact kana anchors provide source witnesses", () => {
  const jmdict = fixture.jmdict({
    words: [
      word("1000000", "母", "かあ"),
      word("1000001", "お母さん", "おかあさん"),
      word("1000002", "食べる", "たべる"),
      word("1000003", "𠮟る", "しかる"),
    ],
  });
  const { characterReadings, additions } = deriveCharacterReadings(jmdict);
  assert.deepEqual(characterReadings.get("母"), ["かあ"]);
  assert.deepEqual(characterReadings.get("食"), ["た"]);
  assert.deepEqual(characterReadings.get("𠮟"), ["しか"]);
  assert.deepEqual(additions.find((addition) => addition.character === "母")!.witnesses, [
    { id: "1000000", spelling: "母", reading: "かあ" },
    { id: "1000001", spelling: "お母さん", reading: "おかあさん" },
  ]);
});

test("normalization deduplicates existing annotated readings without changing base evidence", () => {
  const baseMap = new Map([["食", ["ショク", "た.べる", "-ぐい"]]]);
  const snapshot = structuredClone(baseMap);
  const jmdict = fixture.jmdict({
    words: [
      word("1000000", "食", "しょく"),
      word("1000001", "食べる", "タベル"),
      word("1000002", "食", "グイ"),
      word("1000003", "食", "じき"),
    ],
  });
  const { characterReadings, additions } = deriveCharacterReadings(jmdict, baseMap);
  assert.deepEqual(baseMap, snapshot);
  assert.notEqual(characterReadings.get("食"), baseMap.get("食"));
  assert.deepEqual(characterReadings.get("食"), ["ショク", "た.べる", "-ぐい", "じき"]);
  assert.deepEqual(
    additions.map(({ character, reading }) => [character, reading]),
    [["食", "じき"]],
  );
});

test("multiple kanji, punctuation, Latin letters, and repetition marks cannot become character evidence", () => {
  const jmdict = fixture.jmdict({
    words: [
      word("1000000", "日本", "にほん"),
      word("1000001", "お土産", "おみやげ"),
      word("1000002", "Ａ型", "エーがた"),
      word("1000003", "亜・あ", "ああ"),
      word("1000004", "人々", "ひとびと"),
      word("1000005", "々", "のま"),
      word("1000006", "アイス", "あいす"),
    ],
  });
  assert.deepEqual(deriveCharacterReadings(jmdict).additions, []);
});

test("both kana anchors must match without overlapping or consuming the entire reading", () => {
  const jmdict = fixture.jmdict({
    words: [
      word("1000000", "お母さん", "ははさん"),
      word("1000001", "お母さん", "おかあちゃん"),
      word("1000002", "お日お", "お"),
      word("1000003", "お日お", "おお"),
      word("1000004", "日", "abc"),
    ],
  });
  assert.deepEqual(deriveCharacterReadings(jmdict).additions, []);
});

test("irregular and search-only reading tags are excluded from reusable evidence", () => {
  const jmdict = fixture.jmdict({
    words: [
      word("1000000", "日", "に", ["ik"]),
      word("1000001", "本", "ぽん", ["sk"]),
      word("1000002", "母", "かあ", ["gikun"]),
    ],
  });
  assert.deepEqual(
    deriveCharacterReadings(jmdict).additions.map(({ character, reading }) => [character, reading]),
    [["母", "かあ"]],
  );
});

test("reading restrictions and no-kanji forms remain authoritative", () => {
  const jmdict = fixture.jmdict({
    words: [
      {
        id: "1000000",
        kanji: [
          { text: "日", tags: [] },
          { text: "月", tags: [] },
        ],
        kana: [
          { text: "ひ", tags: [], appliesToKanji: ["日"] },
          { text: "つき", tags: [], appliesToKanji: ["月"] },
          { text: "にち", tags: [], appliesToKanji: [] },
        ],
      },
    ],
  });
  const { characterReadings } = deriveCharacterReadings(jmdict);
  assert.deepEqual(characterReadings.get("日"), ["ひ"]);
  assert.deepEqual(characterReadings.get("月"), ["つき"]);
});
