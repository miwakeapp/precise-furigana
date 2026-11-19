import assert from "node:assert/strict";
import test from "node:test";
import {
  contradictsSpelling,
  fitsSpelling,
  impliedReading,
  contradictionKind,
  planSynthesizedPairs,
} from "../src/pairings.mjs";

test("a reading fits a spelling when the spelling's kana appear in it in order", () => {
  assert.ok(fitsSpelling("気持ちいい", "きもちいい"));
  assert.ok(!fitsSpelling("気持ちよい", "きもちいい"));
  assert.ok(!fitsSpelling("元どうり", "もとどおり"));
  assert.ok(fitsSpelling("親ネコ", "おやねこ"));
  assert.ok(fitsSpelling("何ヶ月", "なんかげつ"));
  assert.ok(fitsSpelling("士・農・工・商", "しのうこうしょう"));
  assert.ok(fitsSpelling("怪レい日本語", "あやしいにほんご"));
  // A kanji can absorb an omitted particle, which the omitted-particle sites catch instead.
  assert.ok(fitsSpelling("そっぽ向く", "そっぽをむく"));
  assert.ok(contradictsSpelling("そっぽ向く", "そっぽをむく", [{ offset: 3, particle: "を" }]));
  // A reading that fits only by letting a kanji absorb a sound of the kana contradicts the segments that place it.
  assert.ok(fitsSpelling("けも耳", "けものみみ"));
  assert.ok(
    contradictsSpelling("けも耳", "けものみみ", [], ["け", ["も", "もの"], ["耳", "みみ"]]),
  );
  assert.ok(!contradictsSpelling("けも耳", "けもみみ", [], ["けも", ["耳", "みみ"]]));
  assert.ok(
    !contradictsSpelling(
      "平将門の乱",
      "たいらのまさかどのらん",
      [],
      [["平将門の乱", "たいらのまさかどのらん"]],
    ),
  );
  assert.ok(
    !contradictsSpelling(
      "怪レい日本語",
      "あやしいにほんご",
      [],
      [["怪", "あや"], ["レ", "し"], "い", ["日", "に"], ["本", "ほん"], ["語", "ご"]],
    ),
  );
});

test("a contradicting pair is phonetic when its reading gives a sound the spelling's kana do not", () => {
  const kind = (spelling, reading, segments, siblings = [reading]) =>
    contradictionKind(spelling, reading, undefined, segments, siblings);
  // Historical kana, the particle は, and full-size kana for small ones.
  assert.equal(
    kind("宣ふ", "のたまう", [
      ["宣", "のたま"],
      ["ふ", "う"],
    ]),
    "phonetic",
  );
  assert.equal(kind("宣ふ", "のたもう", [["宣ふ", "のたもう"]]), "phonetic");
  assert.equal(
    kind("坊つちやん", "ぼっちゃん", [["坊", "ぼ"], ["つ", "っ"], "ち", ["や", "ゃ"], "ん"]),
    "phonetic",
  );
  assert.equal(
    kind(
      "今日は",
      "こんにちわ",
      [
        ["今", "こん"],
        ["日", "にち"],
        ["は", "わ"],
      ],
      ["こんにちは"],
    ),
    "phonetic",
  );
  assert.equal(
    kind("同じうする", "おなじゅうする", [["同", "おな"], ["じ", "じゅ"], "うする"]),
    "phonetic",
  );
  // The same sound spelled another way is no aid.
  assert.equal(
    kind("税金ドロボー", "ぜいきんどろぼう", [
      ["税", "ぜい"],
      ["金", "きん"],
      "ドロボ",
      ["ー", "う"],
    ]),
    "mispaired",
  );
  assert.equal(
    kind("元どうり", "もとどおり", [["元", "もと"], "ど", ["う", "お"], "り"]),
    "mispaired",
  );
  // A spelling that JMdict also reads at face value is itself how the word is said.
  assert.equal(
    kind(
      "しようが無い",
      "しょうがない",
      ["し", ["よ", "ょ"], "うが", ["無", "な"], "い"],
      ["しようがない"],
    ),
    "mispaired",
  );
  assert.equal(
    kind("草はら", "くさわら", [["草", "くさ"], ["は", "わ"], "ら"], ["くさはら"]),
    "mispaired",
  );
  // Other contradictions.
  assert.equal(
    kind("気持ちよい", "きもちいい", [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]),
    "mispaired",
  );
  assert.equal(
    kind("ＳＦ", "エス・エフ", [
      ["Ｓ", "エス・"],
      ["Ｆ", "エフ"],
    ]),
    "mispaired",
  );
  assert.equal(
    contradictionKind(
      "そっぽ向く",
      "そっぽをむく",
      [{ offset: 3, particle: "を" }],
      ["そっぽ", ["向", "をむ"], "く"],
    ),
    "mispaired",
  );
  assert.equal(kind("気持ちいい", "きもちいい", [["気", "き"], ["持", "も"], "ちいい"]), undefined);
});

test("the implied reading keeps contradicted kana as written and removes an omitted particle", () => {
  assert.equal(
    impliedReading([["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]),
    "きもちよい",
  );
  assert.equal(
    impliedReading(["そっぽ", ["向", "をむ"], "く"], [{ offset: 3, particle: "を" }]),
    "そっぽむく",
  );
  assert.equal(
    impliedReading([["水", "みずを"], ["差", "さ"], "す"], [{ offset: 1, particle: "を" }]),
    "みずさす",
  );
  assert.equal(
    impliedReading([["外方向", "そっぽをむ"], "く"], [{ offset: 2, particle: "を" }]),
    undefined,
  );
});

test("only spellings without a fitting pair need a synthesized one, and the reviewed list must match", () => {
  const records = [
    {
      id: "1",
      spelling: "気持ちよい",
      reading: "きもちいい",
      segments: [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"],
    },
    {
      id: "2",
      spelling: "一日じゅう",
      reading: "いちにちじゅう",
      segments: [["一", "いち"], ["日", "にち"], "じゅう"],
    },
    {
      id: "2",
      spelling: "一日じゅう",
      reading: "いちにちぢゅう",
      segments: [["一", "いち"], ["日", "にち"], ["じ", "ぢ"], "ゅう"],
    },
  ];
  const jmdictPairs = new Set(
    records.map((record) => `${record.id}\t${record.spelling}\t${record.reading}`),
  );
  const missing = planSynthesizedPairs(records, new Map(), [], jmdictPairs);
  assert.deepEqual(
    missing.missing.map((item) => [item.spelling, item.reading]),
    [["気持ちよい", "きもちよい"]],
  );
  assert.ok(missing.problems.length > 0);
  const item = {
    id: "1",
    spelling: "気持ちよい",
    reading: "きもちよい",
    note: "",
  };
  const planned = planSynthesizedPairs(records, new Map(), [item], jmdictPairs);
  assert.deepEqual(planned.problems, []);
  assert.deepEqual(planned.pairs, [item]);
  // A listed pair that JMdict now has, or that no longer needs synthesizing, must be removed.
  assert.ok(
    planSynthesizedPairs(
      records,
      new Map(),
      [item, { ...item, id: "2", spelling: "一日じゅう", reading: "いちにちじゅう" }],
      jmdictPairs,
    ).problems.length > 0,
  );
  assert.ok(
    planSynthesizedPairs(
      records,
      new Map(),
      [item],
      new Set([...jmdictPairs, "1\t気持ちよい\tきもちよい"]),
    ).problems.length > 0,
  );
  assert.ok(
    planSynthesizedPairs(records, new Map(), [{ ...item, reading: "きもちええ" }], jmdictPairs)
      .problems.length > 0,
  );
  assert.ok(
    planSynthesizedPairs(records, new Map(), [{ ...item, unreviewed: true }], jmdictPairs).problems
      .length > 0,
  );
});
