import assert from "node:assert/strict";
import test from "node:test";
import { createAligner } from "../src/align.mjs";
import { deriveVariantAlignments } from "../src/variants.mjs";

const substitutions = { kanaSubstitutions: true, characterReadings: new Map(), continuativeReadings: new Map() };

function entry(id, spellings, reading) {
  return {
    id,
    kanji: spellings.map(text => ({ text, tags: [] })),
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }]
  };
}

function fixtureAligner(alignments) {
  return (written, reading) => alignments.get(written) ?? { status: "fallback", segments: [[written, reading]] };
}

test("omitted okurigana attaches its reading to the immediately preceding kanji", () => {
  const sourceSegments = [["取", "と"], "り", ["扱", "あつか"], "い"];
  const sourceSnapshot = structuredClone(sourceSegments);
  const jmdict = { words: [
    entry("1000000", ["取り扱い", "取扱い", "取扱"], "とりあつかい"),
    entry("1000001", ["書き換え", "書換え"], "かきかえ")
  ] };
  const { wordAlignments, transfers } = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["取り扱い", { status: "aligned", segments: sourceSegments }],
    ["書き換え", { status: "aligned", segments: [["書", "か"], "き", ["換", "か"], "え"] }]
  ])));
  assert.deepEqual(wordAlignments.get("取扱い").get("とりあつかい"), [["取", "とり"], ["扱", "あつか"], "い"]);
  assert.deepEqual(wordAlignments.get("取扱").get("とりあつかい"), [["取", "とり"], ["扱", "あつかい"]]);
  assert.deepEqual(wordAlignments.get("書換え").get("かきかえ"), [["書", "かき"], ["換", "か"], "え"]);
  assert.deepEqual(transfers.find(transfer => transfer.to === "取扱い"), {
    id: "1000000", from: "取り扱い", to: "取扱い", reading: "とりあつかい"
  });
  assert.deepEqual(sourceSegments, sourceSnapshot);
});

test("existing grouped kanji spans remain grouped when interior and following kana disappear", () => {
  const jmdict = { words: [entry("1000000", ["取り扱い方", "取扱方"], "とりあつかいかた")] };
  const { wordAlignments } = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["取り扱い方", { status: "aligned", segments: [["取り扱", "とりあつか"], "い", ["方", "かた"]] }]
  ])));
  assert.deepEqual(wordAlignments.get("取扱方").get("とりあつかいかた"), [["取扱", "とりあつかい"], ["方", "かた"]]);
});

test("ambiguous deletion mappings, removed prefixes, and deletion after retained literals are rejected", () => {
  const jmdict = { words: [
    entry("1000000", ["書きき", "書き"], "かきき"),
    entry("1000001", ["お母さん", "母さん"], "おかあさん"),
    entry("1000002", ["書きつける", "書きる"], "かきつける")
  ] };
  const { wordAlignments, transfers } = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["書きき", { status: "aligned", segments: [["書", "か"], "きき"] }],
    ["お母さん", { status: "aligned", segments: ["お", ["母", "かあ"], "さん"] }],
    ["書きつける", { status: "aligned", segments: [["書", "か"], "きつける"] }]
  ])));
  assert.equal(wordAlignments.size, 0);
  assert.deepEqual(transfers, []);
});

test("conflicting sibling boundaries are withheld regardless of spelling order", () => {
  const spellings = ["甲い乙", "甲乙う", "甲乙"];
  const align = fixtureAligner(new Map([
    ["甲い乙", { status: "aligned", segments: [["甲", "あ"], "い", ["乙", "う"]] }],
    ["甲乙う", { status: "aligned", segments: [["甲", "あ"], ["乙", "い"], "う"] }]
  ]));
  for (const ordered of [spellings, spellings.toReversed()]) {
    const result = deriveVariantAlignments({ words: [entry("1000000", ordered, "あいう")] }, align);
    assert.equal(result.wordAlignments.has("甲乙"), false);
    assert.deepEqual(result.transfers, []);
  }
});

test("conflicts are also withheld across entries sharing a target spelling and reading", () => {
  const jmdict = { words: [
    entry("1000000", ["甲い乙", "甲乙"], "あいう"),
    entry("1000001", ["甲乙う", "甲乙"], "あいう")
  ] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["甲い乙", { status: "aligned", segments: [["甲", "あ"], "い", ["乙", "う"]] }],
    ["甲乙う", { status: "aligned", segments: [["甲", "あ"], ["乙", "い"], "う"] }]
  ])));
  assert.equal(result.wordAlignments.size, 0);
});

test("a reading must explicitly apply to both spellings in the same entry", () => {
  const restricted = entry("1000000", ["取り扱い", "取扱い"], "とりあつかい");
  restricted.kana[0].appliesToKanji = ["取り扱い"];
  const jmdict = { words: [restricted, entry("1000001", ["取扱い"], "とりあつかい")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["取り扱い", { status: "aligned", segments: [["取", "と"], "り", ["扱", "あつか"], "い"] }]
  ])));
  assert.equal(result.wordAlignments.size, 0);
});

test("source ambiguity and fallback do not supply transferable evidence", () => {
  const jmdict = { words: [entry("1000000", ["取り扱い", "取扱い"], "とりあつかい")] };
  for (const status of ["ambiguous", "fallback", "reviewed"]) {
    const result = deriveVariantAlignments(jmdict, () => ({ status, segments: [["取り扱い", "とりあつかい"]] }));
    assert.equal(result.wordAlignments.size, 0);
  }
});

test("matching kana scripts preserve exact target text and original reading", () => {
  const jmdict = { words: [entry("1000000", ["書き換え", "書換エ"], "かきかえ")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["書き換え", { status: "aligned", segments: [["書", "か"], "き", ["換", "か"], "え"] }]
  ])));
  assert.deepEqual(result.wordAlignments.get("書換エ").get("かきかえ"), [["書", "かき"], ["換", "か"], ["エ", "え"]]);
});

test("a retained grouped prefix cannot transfer its deleted reading across a source boundary", () => {
  const jmdict = { words: [entry("1000000", ["手の内", "手内"], "てのうち")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["手の内", { status: "aligned", segments: [["手", "て"], ["の内", "のうち"]] }]
  ])));
  assert.equal(result.wordAlignments.size, 0);
});

test("transferred evidence is local to the licensed variant word, including when embedded in a longer word", () => {
  const characterReadings = new Map([["取", ["と.る"]], ["扱", ["あつか.う"]], ["書", ["か.く"]], ["係", ["かかり"]]]);
  const wordReadings = new Map([["取り扱い", ["とりあつかい"]], ["取扱い", ["とりあつかい"]]]);
  const baseAlign = createAligner({ characterReadings, wordReadings });
  const jmdict = { words: [entry("1000000", ["取り扱い", "取扱い"], "とりあつかい")] };
  const { wordAlignments } = deriveVariantAlignments(jmdict, baseAlign);
  const enrichedAlign = createAligner({ characterReadings, wordReadings, wordAlignments });
  assert.deepEqual(enrichedAlign("取扱い", "とりあつかい").segments, [["取", "とり"], ["扱", "あつか"], "い"]);
  assert.deepEqual(enrichedAlign("取扱い係", "とりあつかいかかり").segments, [["取", "とり"], ["扱", "あつか"], "い", ["係", "かかり"]]);
  assert.equal(enrichedAlign("取", "とり").status, "fallback");
});

test("kana-written components expose local readings in sibling kanji spellings", () => {
  const jmdict = { words: [
    entry("1000000", ["あぶれ者", "溢れ者"], "あぶれもの"),
    entry("1000001", ["日やけ", "日焼け"], "ひやけ"),
    entry("1000002", ["とんぼ返り", "蜻蛉返り"], "とんぼがえり")
  ] };
  const align = fixtureAligner(new Map([
    ["あぶれ者", { status: "aligned", segments: ["あぶれ", ["者", "もの"]] }],
    ["日やけ", { status: "aligned", segments: [["日", "ひ"], "やけ"] }],
    ["とんぼ返り", { status: "aligned", segments: ["とんぼ", ["返", "がえ"], "り"] }]
  ]));
  assert.equal(deriveVariantAlignments(jmdict, align).wordAlignments.size, 0);
  const { wordAlignments } = deriveVariantAlignments(jmdict, align, substitutions);
  assert.deepEqual(wordAlignments.get("溢れ者").get("あぶれもの"), [["溢", "あぶ"], "れ", ["者", "もの"]]);
  assert.deepEqual(wordAlignments.get("日焼け").get("ひやけ"), [["日", "ひ"], ["焼", "や"], "け"]);
  assert.deepEqual(wordAlignments.get("蜻蛉返り").get("とんぼがえり"), [["蜻蛉", "とんぼ"], ["返", "がえ"], "り"]);
});

test("optional kana substitution requires evidence maps for its boundary guards", () => {
  assert.throws(() => deriveVariantAlignments({ words: [] }, () => {}, { kanaSubstitutions: true }), /require characterReadings and continuativeReadings Maps/u);
});

test("kana replacements reject ambiguous anchors and never split existing ruby groups", () => {
  const jmdict = { words: [
    entry("1000000", ["あああい者", "亜あ伊者"], "あああいもの"),
    entry("1000001", ["とんぼ返り", "蜻蛉返り"], "とんぼがえり"),
    entry("1000002", ["あぶれ者", "溢れ者"], "あぶれもの")
  ] };
  const { wordAlignments } = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["あああい者", { status: "aligned", segments: ["あああい", ["者", "もの"]] }],
    ["とんぼ返り", { status: "aligned", segments: [["とんぼ返", "とんぼがえ"], "り"] }],
    ["あぶれ者", { status: "aligned", segments: ["あ", ["ぶれ者", "ぶれもの"]] }]
  ])), substitutions);
  assert.equal(wordAlignments.size, 0);
});

test("kana replacements preserve source reading script and cannot change kanji identities", () => {
  const jmdict = { words: [
    entry("1000000", ["トンボ返り", "蜻蛉返リ"], "とんぼがえり"),
    entry("1000001", ["日やけ", "陽焼け"], "ひやけ")
  ] };
  const { wordAlignments } = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["トンボ返り", { status: "aligned", segments: [["トンボ", "とんぼ"], ["返", "がえ"], "り"] }],
    ["日やけ", { status: "aligned", segments: [["日", "ひ"], "やけ"] }]
  ])), substitutions);
  assert.deepEqual(wordAlignments.get("蜻蛉返リ").get("とんぼがえり"), [["蜻蛉", "とんぼ"], ["返", "がえ"], ["リ", "り"]]);
  assert.equal(wordAlignments.has("陽焼け"), false);
});

test("conflicting kana-derived evidence is withheld rather than selecting a sibling", () => {
  const jmdict = { words: [entry("1000000", ["あい乙", "甲いう", "甲乙"], "あいう")] };
  const align = fixtureAligner(new Map([
    ["あい乙", { status: "aligned", segments: ["あい", ["乙", "う"]] }],
    ["甲いう", { status: "aligned", segments: [["甲", "あ"], "いう"] }]
  ]));
  const { wordAlignments } = deriveVariantAlignments(jmdict, align, substitutions);
  assert.equal(wordAlignments.has("甲乙"), false);
});

test("compatible coarse sibling evidence preserves independently established finer boundaries", () => {
  const align = fixtureAligner(new Map([
    ["甲い乙", { status: "aligned", segments: [["甲", "あ"], "い", ["乙", "う"]] }],
    ["あいう", { status: "aligned", segments: ["あいう"] }]
  ]));
  const spellings = ["甲い乙", "あいう", "甲乙"];
  for (const order of [spellings, spellings.toReversed()]) {
    const result = deriveVariantAlignments({ words: [entry("1000000", order, "あいう")] }, align, substitutions);
    assert.deepEqual(result.wordAlignments.get("甲乙").get("あいう"), [["甲", "あい"], ["乙", "う"]]);
  }
});

test("kana replacements cannot absorb a preceding character's independently attested okurigana or continuative", () => {
  const jmdict = { words: [
    entry("1000000", ["行くえ", "行方"], "ゆくえ"),
    entry("1000001", ["糶り売買", "糶糴売買"], "せりばいばい")
  ] };
  const align = fixtureAligner(new Map([
    ["行くえ", { status: "aligned", segments: [["行", "ゆ"], "くえ"] }],
    ["糶り売買", { status: "aligned", segments: [["糶", "せ"], "り", ["売", "ばい"], ["買", "ばい"]] }]
  ]));
  const result = deriveVariantAlignments(jmdict, align, {
    kanaSubstitutions: true,
    characterReadings: new Map([["行", ["ゆ.く"]]]),
    continuativeReadings: new Map([["糶", ["せり"]]])
  });
  assert.equal(result.wordAlignments.size, 0);
});

test("kana replacements reject repetition marks, unattached small kana, and inferred anchor readings", () => {
  const jmdict = { words: [
    entry("1000000", ["晴ればれしい", "晴々しい"], "はればれしい"),
    entry("1000001", ["目っかる", "目付かる"], "めっかる"),
    entry("1000002", ["寝ぼけまなこ", "寝惚けまなこ"], "ねとぼけまなこ")
  ] };
  const align = fixtureAligner(new Map([
    ["晴ればれしい", { status: "aligned", segments: [["晴", "は"], "ればれしい"] }],
    ["目っかる", { status: "aligned", segments: [["目", "め"], "っかる"] }],
    ["寝ぼけまなこ", { status: "aligned", segments: [["寝", "ねと"], "ぼけまなこ"], evidence: [{ rules: ["dictionary-kana-anchors"] }] }]
  ]));
  const result = deriveVariantAlignments(jmdict, align, substitutions);
  assert.equal(result.wordAlignments.size, 0);
});

test("a sokuon assigned after literal kana cannot cross into a kanji-written sibling", () => {
  const jmdict = { words: [entry("1000000", ["やぶ蚊", "藪蚊"], "やぶっか")] };
  const align = fixtureAligner(new Map([
    ["やぶ蚊", {
      status: "aligned", segments: ["やぶ", ["蚊", "っか"]],
      evidence: [{ rules: ["post-kana-gemination"] }]
    }]
  ]));
  const result = deriveVariantAlignments(jmdict, align, substitutions);
  assert.equal(result.wordAlignments.size, 0);
});

test("a single alternate kanji spelling transfers only local attested boundaries", () => {
  const characterReadings = new Map([["映", ["エイ"]], ["画", ["ガ"]], ["館", ["カン"]]]);
  const wordReadings = new Map([["映画", ["えいが"]], ["映畵", ["えいが"]]]);
  const baseline = createAligner({ characterReadings, wordReadings });
  const jmdict = { words: [entry("1000000", ["映画", "映畵"], "えいが")] };
  const { wordAlignments } = deriveVariantAlignments(jmdict, baseline, { hanSubstitutions: true });
  assert.deepEqual(wordAlignments.get("映畵").get("えいが"), [["映", "えい"], ["畵", "が"]]);
  const align = createAligner({ characterReadings, wordReadings, wordAlignments });
  assert.deepEqual(align("映畵館", "えいがかん").segments, [["映", "えい"], ["畵", "が"], ["館", "かん"]]);
  assert.equal(align("畵", "が").status, "fallback");
});

test("kanji substitutions preserve grouped source spans and exact literal script", () => {
  const jmdict = { words: [entry("1000000", ["手刀づくり", "手剣ヅクリ"], "てがたなづくり")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["手刀づくり", { status: "aligned", segments: [["手刀", "てがたな"], "づくり"] }]
  ])), { hanSubstitutions: true });
  assert.deepEqual(result.wordAlignments.get("手剣ヅクリ").get("てがたなづくり"), [["手剣", "てがたな"], ["ヅクリ", "づくり"]]);
});

test("kanji substitutions require a shared kanji anchor, unchanged kana, and explicit reading restrictions", () => {
  const restricted = entry("1000000", ["映画", "映畵"], "えいが");
  restricted.kana[0].appliesToKanji = ["映画"];
  const jmdict = { words: [
    restricted,
    entry("1000001", ["発行", "發刊"], "はっこう"),
    entry("1000002", ["押し図", "推す図"], "おしず"),
    entry("1000003", ["人事", "人々"], "ひとごと")
  ] };
  const result = deriveVariantAlignments(jmdict, (written, reading) => ({ status: "aligned", segments: [[written, reading]] }), { hanSubstitutions: true });
  assert.equal(result.wordAlignments.size, 0);
});

test("conflicting kanji siblings cannot establish a target boundary by insertion order", () => {
  const spellings = ["甲乙丙", "甲戊丙", "甲丁丙"];
  const align = fixtureAligner(new Map([
    ["甲乙丙", { status: "aligned", segments: [["甲", "あ"], ["乙", "いう"], ["丙", "え"]] }],
    ["甲戊丙", { status: "aligned", segments: [["甲", "あい"], ["戊", "う"], ["丙", "え"]] }]
  ]));
  for (const ordered of [spellings, spellings.toReversed()]) {
    const result = deriveVariantAlignments({ words: [entry("1000000", ordered, "あいうえ")] }, align, { hanSubstitutions: true });
    assert.equal(result.wordAlignments.has("甲丁丙"), false);
  }
});

test("kanji substitutions cannot recycle uncorroborated source anchor readings", () => {
  const jmdict = { words: [entry("1000000", ["寝惚け目", "寝惚け眼"], "ねとぼけまなこ")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["寝惚け目", { status: "aligned", segments: [["寝", "ねと"], ["惚", "ぼ"], "け", ["目", "まなこ"]], evidence: [{ rules: ["dictionary-kana-anchors"] }] }]
  ])), { hanSubstitutions: true });
  assert.equal(result.wordAlignments.size, 0);
});

test("positional kanji numerals cannot acquire a cardinal character's pronunciation", () => {
  const jmdict = { words: [
    entry("1000000", ["十三日", "一三日"], "じゅうさんにち"),
    entry("1000001", ["十二月", "一二月"], "じゅうにがつ")
  ] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["十三日", { status: "aligned", segments: [["十", "じゅう"], ["三", "さん"], ["日", "にち"]] }],
    ["十二月", { status: "aligned", segments: [["十", "じゅう"], ["二", "に"], ["月", "がつ"]] }]
  ])), { hanSubstitutions: true });
  assert.equal(result.wordAlignments.size, 0);
});

test("counter symbols inherit only same-entry supported sibling boundaries", () => {
  const jmdict = { words: [
    entry("1000000", ["ヶ月", "ヵ月", "ケ月", "か月", "箇月"], "かげつ"),
    entry("1000001", ["霞ヶ関", "霞が関"], "かすみがせき")
  ] };
  const align = fixtureAligner(new Map([
    ["か月", { status: "aligned", segments: ["か", ["月", "げつ"]] }],
    ["箇月", { status: "aligned", segments: [["箇", "か"], ["月", "げつ"]] }],
    ["霞が関", { status: "aligned", segments: [["霞", "かすみ"], "が", ["関", "せき"]] }]
  ]));
  const result = deriveVariantAlignments(jmdict, align, { counterSymbols: true });
  assert.deepEqual(result.wordAlignments.get("ヶ月").get("かげつ"), [["ヶ", "か"], ["月", "げつ"]]);
  assert.deepEqual(result.wordAlignments.get("ヵ月").get("かげつ"), [["ヵ", "か"], ["月", "げつ"]]);
  assert.deepEqual(result.wordAlignments.get("霞ヶ関").get("かすみがせき"), [["霞", "かすみ"], ["ヶ", "が"], ["関", "せき"]]);
});

test("counter symbol substitution cannot change other characters or evade reading restrictions", () => {
  const restricted = entry("1000000", ["ヶ所", "か所"], "かしょ");
  restricted.kana[0].appliesToKanji = ["ヶ所"];
  const jmdict = { words: [restricted,
    entry("1000001", ["ヶ所", "か処"], "かしょ"),
    entry("1000002", ["ヶ所", "き所"], "かしょ")
  ] };
  const result = deriveVariantAlignments(jmdict, (written, reading) => ({ status: "aligned", segments: [[written, reading]] }), { counterSymbols: true });
  assert.equal(result.wordAlignments.size, 0);
});

test("Latin-written components inherit an opaque reading from kana siblings", () => {
  const jmdict = { words: [
    entry("1000000", ["ウェブ版", "Ｗｅｂ版"], "ウェブばん"),
    entry("1000001", ["ビー型", "Ｂ型"], "ビーがた")
  ] };
  const align = fixtureAligner(new Map([
    ["ウェブ版", { status: "aligned", segments: ["ウェブ", ["版", "ばん"]] }],
    ["ビー型", { status: "aligned", segments: ["ビー", ["型", "がた"]] }]
  ]));
  const result = deriveVariantAlignments(jmdict, align, { ...substitutions, kanaSubstitutions: false, latinSubstitutions: true });
  assert.deepEqual(result.wordAlignments.get("Ｗｅｂ版").get("ウェブばん"), [["Ｗｅｂ", "ウェブ"], ["版", "ばん"]]);
  assert.deepEqual(result.wordAlignments.get("Ｂ型").get("ビーがた"), [["Ｂ", "ビー"], ["型", "がた"]]);
});

test("Latin substitutions cannot invent a sound for individual letters or cross opaque source groups", () => {
  const jmdict = { words: [entry("1000000", ["ウェブ版", "Ｗｅｂ版"], "ウェブばん")] };
  const result = deriveVariantAlignments(jmdict, fixtureAligner(new Map([
    ["ウェブ版", { status: "aligned", segments: [["ウェブ版", "ウェブばん"]] }]
  ])), { ...substitutions, latinSubstitutions: true });
  assert.equal(result.wordAlignments.size, 0);
});
