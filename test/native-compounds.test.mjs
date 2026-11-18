import assert from "node:assert/strict";
import test from "node:test";
import { deriveNativeCompoundAlignments } from "../src/native-compounds.mjs";

const entry = (id, spelling, reading, readingTags = [], spellingTags = []) => ({
  id,
  kanji: [{ text: spelling, tags: spellingTags }],
  kana: [{ text: reading, tags: readingTags, appliesToKanji: ["*"] }],
});
const grouped = (spelling, reading) => ({ status: "aligned", segments: [[spelling, reading]] });

test("attested native contractions preserve original reading script and expose source evidence", () => {
  const jmdict = { words: [entry("1", "心地", "ココチ")] };
  const primary = new Map([
    ["心", ["こころ"]],
    ["地", ["チ"]],
  ]);
  const result = deriveNativeCompoundAlignments(jmdict, primary, grouped);
  assert.deepEqual(result.wordAlignments.get("心地").get("ココチ"), [
    ["心", "ココ"],
    ["地", "チ"],
  ]);
  assert.deepEqual(result.witnesses[0].characters, [
    {
      character: "心",
      spelling: "心",
      reading: "ココ",
      codepoint: "U+5FC3",
      rule: "attested-native-final-mora-contraction",
      derivations: [{ source: "KANJIDIC2", field: "ja_kun", value: "こころ", omittedMora: "ろ" }],
      span: { spelling: "心地", reading: "ココチ", spellingStart: 0, readingStart: 0 },
    },
  ]);
  assert.deepEqual(result.witnesses[0].companions, [
    { character: "地", spelling: "地", reading: "チ", source: "KANJIDIC2", values: ["チ"] },
  ]);
  assert.equal(result.wordAlignments.has("心知"), false);
});

test("a complete known reading cannot be split across a redundant character, even in a longer span", () => {
  const jmdict = { words: [entry("1", "朔日", "ついたち"), entry("2", "梔子花", "くちなしはな")] };
  const primary = new Map([
    ["朔", ["ついたち"]],
    ["日", ["チ"]],
    ["梔", ["くちなし"]],
    ["子", ["シ"]],
    ["花", ["はな"]],
  ]);
  assert.equal(deriveNativeCompoundAlignments(jmdict, primary, grouped).wordAlignments.size, 0);
});

test("whole readings from every supplemental source block misleading native contractions", () => {
  const word = entry("1", "童子", "わらし");
  const primary = new Map([
    ["童", ["わらべ"]],
    ["子", ["シ"]],
  ]);
  assert.equal(
    deriveNativeCompoundAlignments({ words: [word] }, primary, grouped).wordAlignments.size,
    1,
  );
  for (const options of [
    { weakCharacterReadings: new Map([["童", ["わらし"]]]) },
    { unihanReadings: new Map([["童", ["わらし"]]]) },
    {
      characterReadingBundle: {
        schemaVersion: 1,
        readings: [{ character: "童", reading: "わらし" }],
      },
    },
  ])
    assert.equal(
      deriveNativeCompoundAlignments({ words: [word] }, primary, grouped, options).wordAlignments
        .size,
      0,
    );
  assert.equal(
    deriveNativeCompoundAlignments({ words: [word, entry("2", "童", "わらし")] }, primary, grouped)
      .wordAlignments.size,
    0,
  );
});

test("only undotted kun readings of at least three morae can lose one final mora", () => {
  const jmdict = {
    words: [
      entry("1", "甲地", "ここち"),
      entry("2", "乙地", "あかち"),
      entry("3", "丙地", "いち"),
      entry("4", "丁地", "ここち"),
      entry("5", "戊地", "かかち"),
    ],
  };
  const primary = new Map([
    ["地", ["チ"]],
    ["甲", ["ココロ"]],
    ["乙", ["あかり.す"]],
    ["丙", ["いき"]],
    ["丁", ["こころね"]],
    ["戊", ["かきろ"]],
  ]);
  assert.equal(deriveNativeCompoundAlignments(jmdict, primary, grouped).wordAlignments.size, 0);
});

test("one whole final mora is removed without separating a small kana", () => {
  const jmdict = { words: [entry("1", "甲地", "あかち")] };
  const primary = new Map([
    ["甲", ["あかきゃ"]],
    ["地", ["チ"]],
  ]);
  const result = deriveNativeCompoundAlignments(jmdict, primary, grouped);
  assert.deepEqual(result.wordAlignments.get("甲地").get("あかち"), [
    ["甲", "あか"],
    ["地", "ち"],
  ]);
  assert.equal(result.witnesses[0].characters[0].derivations[0].omittedMora, "きゃ");
});

test("a truncation cannot combine with another truncation or a weak companion", () => {
  const jmdict = { words: [entry("1", "甲乙", "あかさた"), entry("2", "砂蚕", "ごかい")] };
  const primary = new Map([
    ["甲", ["あかり"]],
    ["乙", ["さたり"]],
    ["砂", ["サ"]],
    ["蚕", ["かいこ"]],
  ]);
  assert.equal(
    deriveNativeCompoundAlignments(jmdict, primary, grouped, {
      weakCharacterReadings: new Map([["砂", ["ご"]]]),
    }).wordAlignments.size,
    0,
  );
});

test("even an inadmissible weak companion remains a competing complete allocation", () => {
  const jmdict = { words: [entry("1", "甲乙", "あいえき")] };
  const primary = new Map([
    ["甲", ["あいう"]],
    ["乙", ["エキ", "イエキ"]],
  ]);
  const result = deriveNativeCompoundAlignments(jmdict, primary, grouped);
  assert.deepEqual(result.wordAlignments.get("甲乙").get("あいえき"), [
    ["甲", "あい"],
    ["乙", "えき"],
  ]);
  for (const options of [
    { weakCharacterReadings: new Map([["甲", ["あ"]]]) },
    { unihanReadings: new Map([["甲", ["あ"]]]) },
    {
      characterReadingBundle: { schemaVersion: 1, readings: [{ character: "甲", reading: "あ" }] },
    },
  ])
    assert.equal(
      deriveNativeCompoundAlignments(jmdict, primary, grouped, options).wordAlignments.size,
      0,
    );
  assert.equal(
    deriveNativeCompoundAlignments(
      { words: [...jmdict.words, entry("2", "甲", "あ")] },
      primary,
      grouped,
    ).wordAlignments.size,
    0,
  );
});

test("irregular subwords prohibit extrapolation while spelling-specific phonetic ateji remains eligible", () => {
  const jmdict = {
    words: [entry("1", "心地", "ここち", ["gikun"]), entry("2", "前心地", "ぜんここち")],
  };
  const primary = new Map([
    ["前", ["ゼン"]],
    ["心", ["こころ"]],
    ["地", ["チ"]],
  ]);
  assert.equal(deriveNativeCompoundAlignments(jmdict, primary, grouped).wordAlignments.size, 0);
  const ateji = { words: [entry("3", "心地", "ここち", ["gikun"], ["ateji"])] };
  assert.deepEqual(
    deriveNativeCompoundAlignments(ateji, primary, grouped)
      .wordAlignments.get("心地")
      .get("ここち"),
    [
      ["心", "ここ"],
      ["地", "ち"],
    ],
  );
});

test("the complete supplied baseline keeps every existing boundary and uncertain status", () => {
  const jmdict = { words: [entry("1", "居心地", "いごこち"), entry("2", "心地", "ここち")] };
  const primary = new Map([
    ["居", ["い"]],
    ["心", ["こころ", "-ごころ"]],
    ["地", ["チ"]],
  ]);
  const align = (spelling, reading) =>
    spelling === "居心地"
      ? {
          status: "aligned",
          segments: [
            ["居", "い"],
            ["心地", "ごこち"],
          ],
        }
      : { status: "ambiguous", segments: [[spelling, reading]] };
  const result = deriveNativeCompoundAlignments(jmdict, primary, align);
  assert.deepEqual(result.wordAlignments.get("居心地").get("いごこち"), [
    ["居", "い"],
    ["心", "ごこ"],
    ["地", "ち"],
  ]);
  assert.equal(result.witnesses[0].characters[0].span.spellingStart, 1);
  assert.equal(result.wordAlignments.has("心地"), false);
});

test("invalid optional evidence is rejected instead of being interpreted as a default", () => {
  const empty = { words: [] };
  assert.throws(
    () =>
      deriveNativeCompoundAlignments(empty, new Map(), grouped, { weakCharacterReadings: null }),
    /Map/u,
  );
  assert.throws(
    () =>
      deriveNativeCompoundAlignments(empty, new Map(), grouped, {
        unihanReadings: new Map([["心", ["ここ.ろ"]]]),
      }),
    /character readings/u,
  );
  assert.throws(
    () =>
      deriveNativeCompoundAlignments(empty, new Map(), grouped, {
        characterReadingBundle: { schemaVersion: 2, readings: [] },
      }),
    /bundle/u,
  );
});

test("compatibility ideographs in the source map do not invalidate unrelated candidates", () => {
  const jmdict = { words: [entry("1", "心地", "ここち")] };
  const primary = new Map([
    ["心", ["こころ"]],
    ["地", ["チ"]],
    ["朗", ["ロウ", "ほが.らか"]],
  ]);
  assert.deepEqual(
    deriveNativeCompoundAlignments(jmdict, primary, grouped)
      .wordAlignments.get("心地")
      .get("ここち"),
    [
      ["心", "ここ"],
      ["地", "ち"],
    ],
  );
});
