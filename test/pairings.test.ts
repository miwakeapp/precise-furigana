import assert from "node:assert/strict";
import test from "node:test";
import {
  contradictsSpelling,
  fitsSpelling,
  impliedReading,
  contradictionKind,
  listedReadingTest,
  siblingReadingPairs,
  planMispairedPairs,
  planSynthesizedPairs,
  unrestrictedPairs,
} from "../src/pairings.ts";
import type { ContradictionKind, PairingRecord } from "../src/pairings.ts";
import { recordKey } from "../src/segments.ts";
import type { Segment } from "../src/types.ts";

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
  const kind = (spelling: string, reading: string, segments: Segment[], siblings = [reading]) =>
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
  const records: PairingRecord[] = [
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

test("a reviewed mispaired pair marks a JMdict pair that the rules leave unmarked", () => {
  const kinds = new Map<string, ContradictionKind | undefined>([
    [recordKey("1", "上口唇", "じょうしん"), undefined],
    [recordKey("1", "上くちびる", "じょうしん"), "mispaired"],
  ]);
  const item = { id: "1", spelling: "上口唇", reading: "じょうしん", note: "Nothing reads 口." };
  const plan = planMispairedPairs(kinds, [item]);
  assert.deepEqual([...plan.keys], [recordKey("1", "上口唇", "じょうしん")]);
  assert.deepEqual(plan.problems, []);
  // A pair the rules already mark, or that JMdict has dropped, is obsolete and stops the build.
  for (const stale of [
    { ...item, spelling: "上くちびる" },
    { ...item, reading: "じょうこうしん" },
  ]) {
    const { keys, problems, obsolete } = planMispairedPairs(kinds, [stale]);
    assert.equal(keys.size, 0);
    assert.equal(problems.length, 1);
    assert.deepEqual(obsolete, [stale]);
  }
  // A duplicate or a missing note is a mistake to fix by hand, not something to drop.
  assert.equal(planMispairedPairs(kinds, [item, item]).problems.length, 1);
  assert.deepEqual(planMispairedPairs(kinds, [item, item]).obsolete, []);
  assert.equal(planMispairedPairs(kinds, [{ ...item, note: "" }]).problems.length, 1);
});

test("a spelling whose only pairs are reviewed as mispaired needs a synthesized pair", () => {
  const records: PairingRecord[] = [
    { id: "1", spelling: "上口唇", reading: "じょうしん", segments: [["上口唇", "じょうしん"]] },
  ];
  const jmdictPairs = new Set(["1\t上口唇\tじょうしん"]);
  assert.deepEqual(planSynthesizedPairs(records, new Map(), [], jmdictPairs).missing, []);
  const mispaired = new Set([recordKey("1", "上口唇", "じょうしん")]);
  const { missing } = planSynthesizedPairs(records, new Map(), [], jmdictPairs, mispaired);
  // The mispaired reading itself fits the kana, but it is not one to propose.
  assert.deepEqual(
    missing.map((item) => [item.spelling, item.reading, item.unreviewed]),
    [["上口唇", "", true]],
  );
});

test("a search-only form with several unmarked partners leaves pairs for review", () => {
  const pair = (
    spelling: string,
    reading: string,
    spellingTags: string[],
    readingTags: string[],
  ) => ({ id: "1", spelling, reading, spellingTags, readingTags });
  const pairs = [
    pair("上唇", "うわくちびる", [], []),
    pair("上唇", "じょうしん", [], []),
    pair("上口唇", "うわくちびる", ["sK"], []),
    pair("上口唇", "じょうしん", ["sK"], []),
    pair("上くちびる", "うわくちびる", ["sK"], []),
    pair("上くちびる", "じょうしん", ["sK"], []),
    // A search-only reading is in the same position as a search-only spelling.
    pair("上唇", "うえくちびる", [], ["sk"]),
    pair("うわくちびる", "うわくちびる", [], []),
  ];
  const keys = (marked: string[]) => [...unrestrictedPairs(pairs, new Set(marked))].sort();
  const marked = [recordKey("1", "上くちびる", "じょうしん")];
  // 上くちびる has one partner left, so that pair needs no review; an ordinary spelling never does.
  assert.deepEqual(
    keys(marked),
    [recordKey("1", "上口唇", "うわくちびる"), recordKey("1", "上口唇", "じょうしん")].sort(),
  );
  // Once review marks one of the two, the other is the spelling's only reading.
  assert.deepEqual(keys([...marked, recordKey("1", "上口唇", "じょうしん")]), []);
  // The search-only reading has one spelling here; with a second it would be listed.
  assert.ok(
    unrestrictedPairs([...pairs, pair("上脣", "うえくちびる", [], ["sk"])], new Set(marked)).has(
      recordKey("1", "上唇", "うえくちびる"),
    ),
  );
});

test("a kanji is listed with a reading through rendaku, gemination and a shortened vowel", () => {
  const lists = listedReadingTest(
    new Map([
      ["他", ["タ", "ほか"]],
      ["外", ["ガイ", "ゲ", "そと", "ほか", "はず.す", "-がい"]],
      ["学", ["ガク", "まな.ぶ"]],
      ["校", ["コウ"]],
    ]),
    new Map([["外", ["と"]]]),
  );
  assert.ok(lists("他", "た"));
  assert.ok(!lists("外", "た"));
  // Katakana or hiragana, okurigana, an affix, and a name reading all count.
  assert.ok(
    lists("外", "ガイ") && lists("外", "はず") && lists("外", "はずす") && lists("外", "と"),
  );
  // 学校 is がっこう, and a compound can voice or shorten a reading.
  assert.ok(lists("学", "がっ") && lists("校", "ごう") && lists("校", "こ"));
  assert.ok(!lists("校", "がく"));
  // Nothing is known about a character with no listed reading.
  assert.ok(lists("々", "ひと"));
});

test("an ordinary pair whose reading fits only a sibling spelling's kanji is a candidate", () => {
  const lists = listedReadingTest(
    new Map([
      ["他", ["タ", "ほか"]],
      ["外", ["ガイ", "ほか"]],
      ["鳶", ["エン", "とび", "とんび"]],
      ["鴟", ["シ", "とび"]],
    ]),
  );
  const pair = (id: string, spelling: string, reading: string, segments: Segment[], tags = {}) => ({
    id,
    spelling,
    reading,
    segments,
    spellingTags: [] as string[],
    readingTags: [] as string[],
    ...tags,
  });
  const pairs = [
    pair("1", "その他", "そのほか", ["その", ["他", "ほか"]]),
    pair("1", "その外", "そのほか", ["その", ["外", "ほか"]]),
    pair("1", "その他", "そのた", ["その", ["他", "た"]]),
    pair("1", "その外", "そのた", ["その", ["外", "た"]]),
    // Flagged the same way, though both kanji write the one word: review tells them apart.
    pair("2", "鳶", "とび", [["鳶", "とび"]]),
    pair("2", "鴟", "とび", [["鴟", "とび"]]),
    pair("2", "鳶", "とんび", [["鳶", "とんび"]]),
    pair("2", "鴟", "とんび", [["鴟", "とんび"]]),
  ];
  const keys = (marked: string[] = [], list = pairs) =>
    [...siblingReadingPairs(list, new Set(marked), lists)].sort();
  assert.deepEqual(
    keys(),
    [recordKey("1", "その外", "そのた"), recordKey("2", "鴟", "とんび")].sort(),
  );
  // A marked pair is settled, and a search-only form is the other kind of candidate.
  assert.deepEqual(keys([recordKey("1", "その外", "そのた")]), [recordKey("2", "鴟", "とんび")]);
  const searchOnly = pairs.map((item) =>
    item.spelling === "その外" ? { ...item, spellingTags: ["sK"] } : item,
  );
  assert.deepEqual(keys([], searchOnly), [recordKey("2", "鴟", "とんび")]);
  // Without another reading that fits it, the spelling's kanji is simply not well listed.
  assert.deepEqual(
    keys(
      [],
      pairs.filter((item) => !(item.spelling === "その外" && item.reading === "そのほか")),
    ),
    [recordKey("2", "鴟", "とんび")],
  );
});
