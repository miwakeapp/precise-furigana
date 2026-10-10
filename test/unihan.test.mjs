import assert from "node:assert/strict";
import test from "node:test";
import { deriveUnihanAlignments, parseUnihanReadings } from "../src/unihan.mjs";
import { boundaries, validateAlignment } from "../src/segments.mjs";

function entry(id, written, reading, { readingTags = [], writtenTags = [] } = {}) {
  return { id, kanji: [{ text: written, tags: writtenTags }], kana: [{ text: reading, tags: readingTags, appliesToKanji: ["*"] }] };
}
const grouped = (written, reading) => ({ status: "aligned", segments: [[written, reading]] });

test("parses only kJapanese and preserves original exact readings and supplementary codepoints", () => {
  const parsed = parseUnihanReadings("# Unihan\nU+8154\tkJapanese\tコウ クウ\nU+8154\tkJapanese\tクウ\nU+8154\tkMandarin\tqiang\nU+20000\tkJapanese\tカ はじめ\n");
  assert.deepEqual([...parsed], [["腔", ["コウ", "クウ"]], ["𠀀", ["カ", "はじめ"]]]);
  assert.throws(() => parseUnihanReadings("U+110000\tkJapanese\tカ"), /codepoint/u);
  assert.throws(() => parseUnihanReadings("U+8154\tkJapanese\tKU"), /Non-kana/u);
});

test("exact additional readings refine a whole opaque span with source provenance", () => {
  const jmdict = { words: [entry("1", "口腔", "コウクウ")] };
  const result = deriveUnihanAlignments(jmdict, new Map([["口", ["コウ"]], ["腔", ["コウ"]]]), new Map([["腔", ["クウ"]]]), grouped);
  assert.deepEqual(result.wordAlignments.get("口腔").get("コウクウ"), [["口", "コウ"], ["腔", "クウ"]]);
  assert.deepEqual(result.witnesses[0].characters, [{ character: "腔", written: "腔", reading: "クウ", field: "kJapanese", codepoint: "U+8154", values: ["クウ"] }]);
});

test("supplemental readings cannot displace an existing boundary or manufacture an inflection", () => {
  const jmdict = { words: [entry("1", "前口腔", "ぜんこうくう"), entry("2", "心地", "ここち"), entry("3", "口腔", "こうぐう")] };
  const primary = new Map([["前", ["ゼン"]], ["口", ["コウ"]], ["腔", ["コウ"]], ["地", ["チ"]]]);
  const supplemental = new Map([["腔", ["クウ"]], ["心", ["こころ"]]]);
  const align = (written, reading) => written === "前口腔" ? { status: "aligned", segments: [["前", "ぜん"], ["口腔", "こうくう"]] } : grouped(written, reading);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, align);
  const segments = result.wordAlignments.get("前口腔").get("ぜんこうくう");
  assert.deepEqual(segments, [["前", "ぜん"], ["口", "こう"], ["腔", "くう"]]);
  assert.ok(boundaries(segments).includes("1:2"));
  assert.equal(result.wordAlignments.has("心地"), false);
  assert.equal(result.wordAlignments.has("口腔"), false);
});

test("any competing complete allocation defeats a supplemental split", () => {
  const jmdict = { words: [entry("1", "甲乙", "あいき")] };
  const primary = new Map([["甲", ["あい"]], ["乙", ["き"]]]);
  const supplemental = new Map([["甲", ["あ"]], ["乙", ["いき"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped).wordAlignments.size, 0);
});

test("irregular readings block supplemental edges inside the exact containing word", () => {
  const jmdict = { words: [entry("1", "明日", "あす", { readingTags: ["gikun"] }), entry("2", "今明日", "こんあす")] };
  const primary = new Map([["今", ["コン"]], ["明", ["メイ"]], ["日", ["ニチ"]]]);
  const supplemental = new Map([["明", ["あ"]], ["日", ["す"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped).wordAlignments.size, 0);
  const ateji = { words: [entry("3", "明日", "あす", { readingTags: ["gikun"], writtenTags: ["ateji"] })] };
  assert.deepEqual(deriveUnihanAlignments(ateji, primary, supplemental, grouped).wordAlignments.get("明日").get("あす"), [["明", "あ"], ["日", "す"]]);
});

test("ambiguous baselines and wholly primary readings do not create new Unihan witnesses", () => {
  const jmdict = { words: [entry("1", "口腔", "こうくう")] };
  const primary = new Map([["口", ["コウ"]], ["腔", ["クウ"]]]);
  const supplemental = new Map([["腔", ["クウ"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped).wordAlignments.size, 0);
  const ambiguous = (written, reading) => ({ status: "ambiguous", segments: [[written, reading]] });
  assert.equal(deriveUnihanAlignments(jmdict, new Map([["口", ["コウ"]]]), supplemental, ambiguous).wordAlignments.size, 0);
});

test("weak companions can complete a split only when Unihan contributes a genuinely new reading", () => {
  const jmdict = { words: [entry("1", "露西亜", "ロシヤ"), entry("2", "益々", "ますます")] };
  const primary = new Map([["露", ["ロ"]], ["西", ["セイ"]], ["亜", ["ア"]], ["益", ["エキ"]]]);
  const supplemental = new Map([["西", ["シ"]], ["益", ["ます"]]]);
  const weakCharacterReadings = new Map([["亜", ["や"]], ["益", ["ます"]]]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { weakCharacterReadings });
  assert.deepEqual(result.wordAlignments.get("露西亜").get("ロシヤ"), [["露", "ロ"], ["西", "シ"], ["亜", "ヤ"]]);
  assert.deepEqual(result.witnesses[0].characters.map(value => value.character), ["西"]);
  assert.equal(result.wordAlignments.has("益々"), false);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped, {
    weakCharacterReadings: new Map([...weakCharacterReadings, ["西", ["し"]]])
  }).wordAlignments.size, 0);
});

test("weak companions obey irregular ranges even when a different character has new Unihan evidence", () => {
  const jmdict = { words: [entry("1", "明日", "あす", { readingTags: ["gikun"] }), entry("2", "甲明日", "こうあす")] };
  const primary = new Map([["甲", ["か"]], ["明", ["メイ"]], ["日", ["ニチ"]]]);
  const supplemental = new Map([["甲", ["コウ"]]]);
  const weakCharacterReadings = new Map([["明", ["あ"]], ["日", ["す"]]]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { weakCharacterReadings });
  assert.equal(result.wordAlignments.size, 0);
  const unguarded = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { weakCharacterReadings, irregularWordReadings: new Map() });
  assert.deepEqual(unguarded.wordAlignments.get("甲明日").get("こうあす"), [["甲", "こう"], ["明", "あ"], ["日", "す"]]);
});

test("an exact additional reading applies to an iteration mark without learning a new global reading", () => {
  const jmdict = { words: [entry("1", "甲々", "きき")] };
  const result = deriveUnihanAlignments(jmdict, new Map([["甲", ["コウ"]]]), new Map([["甲", ["き"]]]), grouped);
  const segments = result.wordAlignments.get("甲々").get("きき");
  assert.deepEqual(segments, [["甲", "き"], ["々", "き"]]);
  assert.equal(result.witnesses[0].characters[1].codepoint, "U+7532");
  validateAlignment("甲々", "きき", segments);
});

test("supplemental voicing preserves modern voiced spelling and original kana script", () => {
  const jmdict = { words: [entry("1", "饅頭", "まんじゅう"), entry("2", "北京", "ペキン"), entry("3", "喇叭", "らっぱ")] };
  const primary = new Map([["饅", ["マン"]], ["頭", ["トウ"]], ["北", ["ホク"]], ["京", ["キン"]]]);
  const supplemental = new Map([["頭", ["チュウ"]], ["北", ["ヘ"]], ["喇", ["ラチ"]], ["叭", ["ハ"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped).wordAlignments.size, 0);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { supplementalVoicing: true });
  assert.deepEqual(result.wordAlignments.get("饅頭").get("まんじゅう"), [["饅", "まん"], ["頭", "じゅう"]]);
  assert.deepEqual(result.wordAlignments.get("北京").get("ペキン"), [["北", "ペ"], ["京", "キン"]]);
  assert.deepEqual(result.wordAlignments.get("喇叭").get("らっぱ"), [["喇", "らっ"], ["叭", "ぱ"]]);
  assert.deepEqual(result.witnesses[0].characters[0].derivations, [{ value: "チュウ", rules: ["initial-voicing"] }]);
});

test("voicing cannot alter native or long katakana readings, existing weak readings, or literal kana", () => {
  const jmdict = { words: [
    entry("1", "甲乙", "がき"), entry("2", "甲丙", "ぜんちめーとるき"),
    entry("3", "頭乙", "じゅうき"), entry("4", "カ乙", "ガキ")
  ] };
  const primary = new Map([["乙", ["キ"]], ["丙", ["キ"]]]);
  const supplemental = new Map([["甲", ["か", "センチメートル"]], ["頭", ["チュウ"]]]);
  const weakCharacterReadings = new Map([["頭", ["ちゅう"]]]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { supplementalVoicing: true, weakCharacterReadings });
  assert.equal(result.wordAlignments.size, 0);
  assert.throws(() => deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { supplementalVoicing: null }), /booleans/u);
});

test("gemination needs a following obstruent and retains each source derivation separately", () => {
  const jmdict = { words: [entry("1", "服忌", "ぶっき"), entry("2", "甲乙", "しっな"), entry("3", "丙甲", "かしっ")] };
  const primary = new Map([["忌", ["キ"]], ["乙", ["ナ"]], ["丙", ["カ"]]]);
  const supplemental = new Map([["服", ["フ", "フウ"]], ["甲", ["シ"]]]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { supplementalVoicing: true });
  assert.deepEqual(result.wordAlignments.get("服忌").get("ぶっき"), [["服", "ぶっ"], ["忌", "き"]]);
  assert.deepEqual(result.witnesses[0].characters[0].derivations, [
    { value: "フ", rules: ["initial-voicing", "gemination"] },
    { value: "フウ", rules: ["initial-voicing", "sokuon"] }
  ]);
  assert.equal(result.wordAlignments.has("甲乙"), false);
  assert.equal(result.wordAlignments.has("丙甲"), false);
});

test("yoon simplification preserves vowel and consonant row without enabling other edits", () => {
  const jmdict = { words: [
    entry("1", "余所", "よそ"), entry("2", "修羅", "すら"), entry("3", "受領", "ずろう"),
    entry("4", "甲乙", "しょき"), entry("5", "丙乙", "すき"), entry("6", "丁乙", "そこき"), entry("7", "戊乙", "そうき")
  ] };
  const primary = new Map([["余", ["ヨ"]], ["羅", ["ラ"]], ["乙", ["キ"]]]);
  const supplemental = new Map([
    ["所", ["ショ"]], ["修", ["シュ"]], ["受", ["ジュ"]], ["領", ["リョウ"]],
    ["甲", ["シュ"]], ["丙", ["しゅ"]], ["丁", ["ショキョ"]], ["戊", ["ソ"]]
  ]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { yoonSimplification: true });
  assert.deepEqual(result.wordAlignments.get("余所").get("よそ"), [["余", "よ"], ["所", "そ"]]);
  assert.deepEqual(result.wordAlignments.get("修羅").get("すら"), [["修", "す"], ["羅", "ら"]]);
  assert.deepEqual(result.wordAlignments.get("受領").get("ずろう"), [["受", "ず"], ["領", "ろう"]]);
  for (const written of ["甲乙", "丙乙", "丁乙", "戊乙"]) assert.equal(result.wordAlignments.has(written), false);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { supplementalVoicing: true }).wordAlignments.has("余所"), false);
});

test("new competing phonological allocations cannot erase exact Unihan boundaries", () => {
  const jmdict = { words: [entry("1", "甲乙", "そうき")] };
  const primary = new Map([["乙", ["ウキ", "キ"]]]);
  const supplemental = new Map([["甲", ["ソ", "ショウ"]]]);
  const exact = deriveUnihanAlignments(jmdict, primary, supplemental, grouped);
  const extended = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { yoonSimplification: true });
  assert.deepEqual(exact.wordAlignments.get("甲乙").get("そうき"), [["甲", "そ"], ["乙", "うき"]]);
  assert.deepEqual(extended, exact);
  const competing = new Map([["甲", ["ショ", "ショウ"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, competing, grouped, { yoonSimplification: true }).wordAlignments.size, 0);
});

test("phonological evidence remains local, irregular-gated, and cannot cross existing boundaries", () => {
  const jmdict = { words: [
    entry("1", "饅頭", "まんじゅう", { readingTags: ["gikun"] }),
    entry("2", "前饅頭", "ぜんまんじゅう"),
    entry("3", "前余所", "ぜんよそ")
  ] };
  const primary = new Map([["前", ["ゼン"]], ["饅", ["マン"]], ["余", ["ヨ"]]]);
  const supplemental = new Map([["頭", ["チュウ"]], ["所", ["ショ"]]]);
  const align = (written, reading) => written === "前余所" ? { status: "aligned", segments: [["前", "ぜん"], ["余所", "よそ"]] } : grouped(written, reading);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, align, { supplementalVoicing: true, yoonSimplification: true });
  assert.equal(result.wordAlignments.has("饅頭"), false);
  assert.equal(result.wordAlignments.has("前饅頭"), false);
  assert.deepEqual(result.wordAlignments.get("前余所").get("ぜんよそ"), [["前", "ぜん"], ["余", "よ"], ["所", "そ"]]);
  const ateji = { words: [entry("4", "饅頭", "まんじゅう", { readingTags: ["gikun"], writtenTags: ["ateji"] })] };
  const allowed = deriveUnihanAlignments(ateji, primary, supplemental, grouped, { supplementalVoicing: true });
  assert.deepEqual(allowed.wordAlignments.get("饅頭").get("まんじゅう"), [["饅", "まん"], ["頭", "じゅう"]]);
  assert.equal(allowed.wordAlignments.has("前饅頭"), false);
});

test("one-mora on lengthening is opt-in, source-backed, and keeps the original kana script", () => {
  const jmdict = { words: [entry("1", "口腔", "コウクウ"), entry("2", "贔屓", "ひいき")] };
  const primary = new Map([["口", ["コウ"]], ["屓", ["キ"]]]);
  const supplemental = new Map([["腔", ["ク"]], ["贔", ["ヒ"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped).wordAlignments.size, 0);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { onLengthening: true });
  assert.deepEqual(result.wordAlignments.get("口腔").get("コウクウ"), [["口", "コウ"], ["腔", "クウ"]]);
  assert.deepEqual(result.wordAlignments.get("贔屓").get("ひいき"), [["贔", "ひい"], ["屓", "き"]]);
  assert.deepEqual(result.witnesses[0].characters[0].derivations, [{ value: "ク", rules: ["single-mora-vowel-extension"] }]);
  assert.throws(() => deriveUnihanAlignments(jmdict, primary, supplemental, grouped, { onLengthening: null }), /booleans/u);
});

test("lengthening preserves allocations from the exact and yoon stages when a new path competes", () => {
  const exactWords = { words: [entry("1", "甲乙", "そうき")] };
  const primary = new Map([["乙", ["ウキ", "キ"]]]);
  const supplemental = new Map([["甲", ["ソ"]]]);
  const exact = deriveUnihanAlignments(exactWords, primary, supplemental, grouped);
  assert.deepEqual(deriveUnihanAlignments(exactWords, primary, supplemental, grouped, { onLengthening: true }), exact);

  const phonologicalWords = { words: [entry("2", "甲乙", "きいそ")] };
  const phonologicalSource = new Map([["甲", ["キ"]], ["乙", ["イショ", "ソ"]]]);
  const earlier = deriveUnihanAlignments(phonologicalWords, new Map(), phonologicalSource, grouped, { yoonSimplification: true });
  assert.deepEqual(earlier.wordAlignments.get("甲乙").get("きいそ"), [["甲", "き"], ["乙", "いそ"]]);
  assert.deepEqual(deriveUnihanAlignments(phonologicalWords, new Map(), phonologicalSource, grouped, {
    yoonSimplification: true, onLengthening: true
  }), earlier);
  assert.deepEqual(deriveUnihanAlignments(phonologicalWords, new Map(), phonologicalSource, grouped, {
    onLengthening: true
  }).wordAlignments.get("甲乙").get("きいそ"), [["甲", "きい"], ["乙", "そ"]]);
});

test("an iteration mark inherits actual sound length while allowing voicing and equivalent vowel notation", () => {
  const jmdict = { words: [
    entry("1", "戸々", "ここう"), entry("2", "図々しい", "ずうずうしい"),
    entry("3", "図々しい", "ずうずーしい"), entry("4", "甲々", "カーガー"),
    entry("5", "御御様", "おごうさま")
  ] };
  const primary = new Map([["戸", ["コ"]], ["御", ["お"]], ["様", ["さま"]]]);
  const supplemental = new Map([["戸", ["コ"]], ["図", ["ズ"]], ["甲", ["カ", "ガ"]], ["御", ["ゴ"]]]);
  const align = (written, reading) => written === "図々しい" ? {
    status: "aligned", segments: [["図々", reading.slice(0, -2)], "しい"]
  } : grouped(written, reading);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, align, { onLengthening: true });
  assert.equal(result.wordAlignments.has("戸々"), false);
  assert.deepEqual(result.wordAlignments.get("図々しい").get("ずうずうしい"), [["図", "ずう"], ["々", "ずう"], "しい"]);
  assert.deepEqual(result.wordAlignments.get("図々しい").get("ずうずーしい"), [["図", "ずう"], ["々", "ずー"], "しい"]);
  assert.deepEqual(result.wordAlignments.get("甲々").get("カーガー"), [["甲", "カー"], ["々", "ガー"]]);
  assert.deepEqual(result.wordAlignments.get("御御様").get("おごうさま"), [["御", "お"], ["御", "ごう"], ["様", "さま"]]);
});

test("iteration inheritance checks the retained allocations on both sides of an opaque span", () => {
  const jmdict = { words: [entry("1", "図々体", "ずうずうたい"), entry("2", "戸々体", "ここうたい"), entry("3", "甲図々", "かずうず")] };
  const primary = new Map([["体", ["タイ"]], ["甲", ["カ"]]]);
  const supplemental = new Map([["図", ["ズ"]], ["戸", ["コ"]]]);
  const align = (written, reading) => ({ status: "aligned", segments: {
    "図々体": [["図", "ずう"], ["々体", "ずうたい"]],
    "戸々体": [["戸", "こ"], ["々体", "こうたい"]],
    "甲図々": [["甲図", "かずう"], ["々", "ず"]]
  }[written] });
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, align, { onLengthening: true });
  assert.deepEqual(result.wordAlignments.get("図々体").get("ずうずうたい"), [["図", "ずう"], ["々", "ずう"], ["体", "たい"]]);
  assert.equal(result.wordAlignments.has("戸々体"), false);
  assert.equal(result.wordAlignments.has("甲図々"), false);
});

test("lengthening cannot combine with new voicing or yoon, alter native or long readings, or enter irregular spans", () => {
  const jmdict = { words: [
    entry("1", "腔頭", "くうじゅう"), entry("2", "腔所", "くうそ"),
    entry("3", "甲乙", "かあき"), entry("4", "丙乙", "こううき"),
    entry("5", "口腔", "こうくう", { readingTags: ["gikun"] })
  ] };
  const primary = new Map([["口", ["コウ"]], ["乙", ["キ"]]]);
  const supplemental = new Map([["腔", ["ク"]], ["頭", ["チュウ"]], ["所", ["ショ"]], ["甲", ["か"]], ["丙", ["コウ"]]]);
  assert.equal(deriveUnihanAlignments(jmdict, primary, supplemental, grouped, {
    onLengthening: true, supplementalVoicing: true, yoonSimplification: true
  }).wordAlignments.size, 0);
});

test("competing lengthened allocations remain grouped while exact weak companions can complete a unique split", () => {
  const jmdict = { words: [entry("1", "甲乙丙", "かああき"), entry("2", "贔屓", "ひいき")] };
  const primary = new Map([["丙", ["キ"]]]);
  const supplemental = new Map([["甲", ["カ"]], ["乙", ["ア"]], ["贔", ["ヒ"]]]);
  const result = deriveUnihanAlignments(jmdict, primary, supplemental, grouped, {
    onLengthening: true, weakCharacterReadings: new Map([["屓", ["き"]]])
  });
  assert.equal(result.wordAlignments.has("甲乙丙"), false);
  assert.deepEqual(result.wordAlignments.get("贔屓").get("ひいき"), [["贔", "ひい"], ["屓", "き"]]);
  assert.deepEqual(result.witnesses[0].characters.map(witness => witness.character), ["贔"]);
});
