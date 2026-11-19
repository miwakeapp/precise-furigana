import assert from "node:assert/strict";
import test from "node:test";
import { createAligner } from "../src/align.ts";
import { normalizeKana, readingStem } from "../src/kana.ts";
import { boundaries } from "../src/segments.ts";

// These small fixtures describe linguistic cases; production data is supplied
// separately by the caller and is never fetched by the alignment engine.
const characterReadings = new Map([
  ["日", ["ニチ", "ジツ", "ひ"]],
  ["本", ["ホン", "もと"]],
  ["語", ["ゴ", "かた.る"]],
  ["大", ["ダイ", "タイ", "おお"]],
  ["人", ["ジン", "ニン", "ひと"]],
  ["取", ["シュ", "と.る"]],
  ["扱", ["あつか.う"]],
  ["祝", ["シュク", "いわ.う"]],
  ["一", ["イチ", "イツ", "ひと"]],
  ["昨", ["サク"]],
  ["時", ["ジ", "とき"]],
  ["山", ["サン", "やま"]],
  ["川", ["セン", "かわ"]],
  ["学", ["ガク", "まな.ぶ"]],
  ["校", ["コウ"]],
  ["作", ["サク", "つく.る"]],
  ["家", ["カ", "いえ"]],
  ["先", ["セン", "さき"]],
  ["輩", ["ハイ"]],
  ["藪", ["やぶ"]],
  ["蚊", ["か"]],
  ["子", ["シ", "こ"]],
  ["欠", ["ケツ", "か.ける", "か.く"]],
  ["片", ["ヘン", "かた"]],
  ["突", ["トツ", "つ.く"]],
  ["向", ["コウ", "む.く"]],
  ["抽", ["チュウ", "ひ.く"]],
  ["斗", ["ト"]],
]);

const wordReadings = new Map([
  ["一", ["いち", "ひとつ", "ひと", "ひ"]],
  ["日本", ["にほん", "にっぽん"]],
  ["大人", ["おとな"]],
  ["一昨日", ["おととい", "いっさくじつ"]],
  ["欠片", ["かけら"]],
  ["一向", ["ひたすら", "ひたぶる", "いっこう"]],
  ["抽斗", ["ひきだし"]],
]);

const align = createAligner({ characterReadings, wordReadings });

function assertAlignment(spelling, reading, expected, expectedStatus = "aligned") {
  const result = align(spelling, reading);
  assert.deepEqual(result.segments, expected);
  assert.equal(result.status, expectedStatus);
  assert.equal(
    result.segments.map((segment) => (typeof segment === "string" ? segment : segment[0])).join(""),
    spelling,
  );
  assert.equal(
    result.segments.map((segment) => (typeof segment === "string" ? segment : segment[1])).join(""),
    reading,
  );
  return result;
}

test("kun reading dots specify the stem belonging to the kanji", () => {
  assert.equal(readingStem("はな.す"), "はな");
  assert.equal(readingStem("はなし"), "はなし");
  assert.equal(readingStem("-び"), "び");
  assertAlignment("取り扱う", "とりあつかう", [["取", "と"], "り", ["扱", "あつか"], "う"]);
  assertAlignment("お祝い", "おいわい", ["お", ["祝", "いわ"], "い"]);
  assertAlignment("一突き", "ひとつき", [["一", "ひと"], ["突", "つ"], "き"]);
});

test("dictionary-backed terminal contraction and sokuon produce supported splits", () => {
  const contracted = assertAlignment("日本", "にほん", [
    ["日", "に"],
    ["本", "ほん"],
  ]);
  assert.deepEqual(contracted.evidence[0].rules, ["dictionary-supported-terminal-contraction"]);
  assertAlignment("日本語", "にほんご", [
    ["日", "に"],
    ["本", "ほん"],
    ["語", "ご"],
  ]);
  assertAlignment("日本", "にっぽん", [
    ["日", "にっ"],
    ["本", "ぽん"],
  ]);
  assertAlignment("学校", "がっこう", [
    ["学", "がっ"],
    ["校", "こう"],
  ]);
  assertAlignment("作家", "さっか", [
    ["作", "さっ"],
    ["家", "か"],
  ]);
  assertAlignment("先輩", "せんぱい", [
    ["先", "せん"],
    ["輩", "ぱい"],
  ]);
});

test("rendaku and iteration marks use character readings", () => {
  assertAlignment("山川", "やまがわ", [
    ["山", "やま"],
    ["川", "がわ"],
  ]);
  assertAlignment("人々", "ひとびと", [
    ["人", "ひと"],
    ["々", "びと"],
  ]);
  assertAlignment("時々", "ときどき", [
    ["時", "とき"],
    ["々", "どき"],
  ]);
});

test("literal kana keep their boundaries when a compound adds gemination", () => {
  assertAlignment("ヤブ蚊", "やぶっか", [
    ["ヤブ", "やぶ"],
    ["蚊", "っか"],
  ]);
  assertAlignment("ママ子", "ままっこ", [
    ["ママ", "まま"],
    ["子", "っこ"],
  ]);
  assertAlignment("藪蚊", "やぶっか", [
    ["藪", "やぶっ"],
    ["蚊", "か"],
  ]);
});

test("attested kana vowel extensions preserve a following proven kanji reading", () => {
  const localCharacters = new Map([...characterReadings, ["臭", ["シュウ", "くさ.い"]]]);
  const localAlign = createAligner({
    characterReadings: localCharacters,
    wordReadings: new Map([["メンド臭い", ["めんどうくさい"]]]),
  });
  const result = localAlign("メンド臭い", "めんどうくさい");
  assert.deepEqual(result.segments, [["メン", "めん"], ["ド", "どう"], ["臭", "くさ"], "い"]);
  assert.equal(result.status, "aligned");
  assert.deepEqual(result.evidence[1].rules, ["dictionary-supported-kana-vowel-extension"]);
  assert.equal(localAlign("ド", "どう").status, "fallback");
  assert.deepEqual(localAlign("メンド臭い", "メンドウクサイ").segments, [
    "メン",
    ["ド", "ドウ"],
    ["臭", "クサ"],
    ["い", "イ"],
  ]);
  const prolongedAlign = createAligner({
    characterReadings: new Map([["明", ["メイ", "あ.く", "あか.るい"]]]),
    wordReadings: new Map([["明かん", ["あかーん"]]]),
  });
  assert.deepEqual(prolongedAlign("明かん", "あかーん").segments, [
    ["明", "あ"],
    ["か", "かー"],
    "ん",
  ]);
});

test("hiragana cannot steal an initial vowel from the following kanji", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["説", ["セツ", "と.く"]],
      ["染", ["セン", "そ.める"]],
      ["出", ["シュツ", "だ.す", "で.る"]],
      ["届", ["カイ", "とど.ける"]],
      ["伝", ["デン"]],
      ["病", ["ビョウ"]],
      ["呉", ["ゴ", "くれ"]],
      ["母", ["ボ", "も"]],
    ]),
    wordReadings: new Map([
      ["出す", ["いだす"]],
      ["説き出す", ["ときいだす"]],
      ["染め出す", ["そめいだす"]],
      ["届け出伝染病", ["とどけいででんせんびょう"]],
      ["呉の母", ["くれのおも"]],
    ]),
    continuativeReadings: new Map([["出", ["いで"]]]),
  });
  assert.deepEqual(localAlign("説き出す", "ときいだす").segments, [
    ["説", "と"],
    "き",
    ["出", "いだ"],
    "す",
  ]);
  assert.deepEqual(localAlign("染め出す", "そめいだす").segments, [
    ["染", "そ"],
    "め",
    ["出", "いだ"],
    "す",
  ]);
  assert.deepEqual(localAlign("届け出伝染病", "とどけいででんせんびょう").segments, [
    ["届", "とど"],
    "け",
    ["出", "いで"],
    ["伝", "でん"],
    ["染", "せん"],
    ["病", "びょう"],
  ]);
  assert.deepEqual(localAlign("呉の母", "くれのおも").segments, [
    ["呉", "くれ"],
    "の",
    ["母", "おも"],
  ]);
});

test("a dotted reading can absorb only a prefix of its literally remaining okurigana", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["説", ["セツ", "と.く"]],
      ["染", ["セン", "そ.める"]],
      ["出", ["シュツ", "で.る", "だ.す", "い.でる", "い.だす"]],
      ["山", ["サン", "やま"]],
    ]),
    wordReadings: new Map([
      ["出す", ["だす"]],
      ["説き出す", ["ときいだす"]],
      ["染め出す", ["そめいだす"]],
      ["出る", ["でる", "いでる"]],
      ["出山", ["いだやま"]],
      ["出せ", ["いだせ"]],
    ]),
  });
  const result = localAlign("説き出す", "ときいだす");
  assert.deepEqual(result.segments, [["説", "と"], "き", ["出", "いだ"], "す"]);
  assert.deepEqual(result.evidence[2].rules, ["partial-okurigana"]);
  assert.deepEqual(localAlign("染め出す", "そめいだす").segments, [
    ["染", "そ"],
    "め",
    ["出", "いだ"],
    "す",
  ]);
  assert.deepEqual(localAlign("出る", "いでる").segments, [["出", "いで"], "る"]);
  assert.equal(localAlign("出す", "だす").evidence[0].type, "character");
  for (const pair of [
    ["出", "いだ"],
    ["出す", "いだす"],
    ["出山", "いだやま"],
    ["出せ", "いだせ"],
  ]) {
    assert.equal(
      localAlign(...pair).evidence.some((part) => part.rules.includes("partial-okurigana")),
      false,
    );
  }
});

test("vowel extension cannot displace a following literal kana into a substitution", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["機", ["キ"]],
      ["内", ["ナイ"]],
      ["値", ["チ"]],
    ]),
    wordReadings: new Map([
      ["機内エンターテイメント", ["きないエンターテインメント"]],
      ["エンターテイメント", ["エンターテインメント"]],
      ["パラメタ値", ["パラメータち"]],
    ]),
  });
  const result = localAlign("機内エンターテイメント", "きないエンターテインメント");
  assert.equal(
    result.evidence.some((part) =>
      part.rules.includes("dictionary-supported-kana-vowel-extension"),
    ),
    false,
  );
  assert.equal(
    result.evidence.some((part) => part.rules.includes("dictionary-kana-mismatch")),
    false,
  );
  assert.deepEqual(localAlign("パラメタ値", "パラメータち").segments, [
    "パラ",
    ["メ", "メー"],
    "タ",
    ["値", "ち"],
  ]);
});

test("attested residual kana mismatches retain surrounding known boundaries", () => {
  const localAlign = createAligner({
    characterReadings: new Map([["体", ["タイ", "からだ"]]]),
    wordReadings: new Map([["体によい", ["からだにいい"]]]),
  });
  const result = localAlign("体によい", "からだにいい");
  assert.deepEqual(result.segments, [["体", "からだ"], "に", ["よ", "い"], "い"]);
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.evidence[2].rules, ["dictionary-kana-mismatch"]);
  assert.equal(localAlign("よ", "い").status, "fallback");
});

test("kana mismatches cannot absorb omitted okurigana from a preceding kanji", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["湯", ["トウ", "ゆ"]],
      ["上", ["ジョウ", "あ.がる"]],
      ["問", ["モン", "と.う"]],
      ["合", ["ゴウ", "あ.わせる"]],
      ["窓", ["ソウ", "まど"]],
      ["口", ["コウ", "くち"]],
      ["穴", ["ケツ", "あな"]],
      ["開", ["カイ", "あ.ける"]],
    ]),
    wordReadings: new Map([
      ["湯上り", ["ゆあがり"]],
      ["問い合せ", ["といあわせ"]],
      ["問い合せ窓口", ["といあわせまどぐち"]],
      ["穴開パンチ", ["あなあけパンチ"]],
    ]),
  });
  assert.deepEqual(localAlign("湯上り", "ゆあがり").segments, [["湯上", "ゆあが"], "り"]);
  assert.deepEqual(localAlign("問い合せ窓口", "といあわせまどぐち").segments, [
    ["問", "と"],
    "い",
    ["合", "あわ"],
    "せ",
    ["窓", "まど"],
    ["口", "ぐち"],
  ]);
  assert.deepEqual(localAlign("穴開パンチ", "あなあけパンチ").segments, [
    ["穴開", "あなあけ"],
    "パンチ",
  ]);
});

test("irregular dictionary compounds stay grouped inside longer expressions", () => {
  const result = assertAlignment("大人", "おとな", [["大人", "おとな"]]);
  assert.equal(result.evidence[0].type, "dictionary");
  assertAlignment("一昨日", "おととい", [["一昨日", "おととい"]]);
  assertAlignment("一向", "ひたすら", [["一向", "ひたすら"]]);
  assertAlignment("一向", "ひたぶる", [["一向", "ひたぶる"]]);
  assertAlignment("抽斗", "ひきだし", [["抽斗", "ひきだし"]]);
  assertAlignment("ひと欠片", "ひとかけら", ["ひと", ["欠片", "かけら"]]);
  assertAlignment("一欠片", "ひとかけら", [
    ["一", "ひと"],
    ["欠片", "かけら"],
  ]);
});

test("literal kana delimit irregular dictionary readings without learning global readings", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["母", ["ボ", "はは"]],
      ["大", ["ダイ", "おお"]],
      ["人", ["ジン", "ひと"]],
    ]),
    wordReadings: new Map([
      ["お母", ["おかあ", "おふくろ"]],
      ["お母さん", ["おかあさん"]],
      ["大人しい", ["おとなしい"]],
    ]),
  });
  assert.deepEqual(localAlign("お母さん", "おかあさん").segments, ["お", ["母", "かあ"], "さん"]);
  assert.deepEqual(localAlign("お母", "おふくろ").segments, ["お", ["母", "ふくろ"]]);
  assert.deepEqual(localAlign("大人しい", "おとなしい").segments, [["大人", "おとな"], "しい"]);
  assert.equal(localAlign("母", "かあ").status, "fallback");
  assert.equal(localAlign("母", "ふくろ").status, "fallback");
});

test("dictionary kana trimming cannot assign a neighboring possible long vowel to an unsupported kanji reading", () => {
  const localCharacters = new Map([
    ...characterReadings,
    ["臭", ["シュウ", "くさ.い"]],
    ["良", ["リョウ", "い.い"]],
    ["笑", ["ショウ", "わら.う"]],
    ["結", ["ケツ", "むす.ぶ"]],
  ]);
  const pairs = [
    ["めんど臭い", "めんどうくさい"],
    ["かっこ良い", "かっこういい"],
    ["あいそ笑い", "あいそうわらい"],
    ["あいそ笑", "あいそうわらい"],
    ["ちょうちょ結び", "ちょうちょうむすび"],
    ["日おい", "ひおおい"],
  ];
  const localWords = new Map([
    ...pairs.map(([spelling, reading]) => [spelling, [reading]]),
    ["笑", ["わらい"]],
  ]);
  const localAlign = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
  });
  for (const [spelling, reading] of pairs) {
    assert.deepEqual(localAlign(spelling, reading).segments, [[spelling, reading]]);
  }
  const withIndependentReading = createAligner({
    characterReadings: localCharacters,
    wordReadings: new Map([...localWords, ["臭", ["うくさ"]]]),
  });
  assert.deepEqual(withIndependentReading("めんど臭い", "めんどうくさい").segments, [
    "めんど",
    ["臭", "うくさ"],
    "い",
  ]);
});

test("complete leading kana runs use lexically attested vowel-length variants", () => {
  const localCharacters = new Map([
    ...characterReadings,
    ["臭", ["くさ.い"]],
    ["良", ["い.い"]],
    ["笑", ["わら.う"]],
    ["結", ["むす.ぶ"]],
    ["間", ["カン", "ま"]],
  ]);
  const localWords = new Map([
    ["めんど臭い", ["めんどくさい", "めんどうくさい"]],
    ["かっこ良い", ["かっこういい"]],
    ["格好", ["かっこ", "かっこう"]],
    ["あいそ笑い", ["あいそうわらい"]],
    ["愛想", ["あいそ", "あいそう"]],
    ["ちょうちょ結び", ["ちょうちょうむすび"]],
    ["チョウチョウ結び", ["ちょうちょむすび"]],
    ["蝶々", ["ちょうちょ", "ちょうちょう"]],
    ["あっとゆう間", ["あっとゆーま"]],
  ]);
  const localAlign = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
  });
  assert.deepEqual(localAlign("めんど臭い", "めんどうくさい").segments, [
    "めん",
    ["ど", "どう"],
    ["臭", "くさ"],
    "い",
  ]);
  assert.deepEqual(localAlign("かっこ良い", "かっこういい").segments, [
    "かっ",
    ["こ", "こう"],
    ["良", "い"],
    "い",
  ]);
  assert.deepEqual(localAlign("あいそ笑い", "あいそうわらい").segments, [
    "あい",
    ["そ", "そう"],
    ["笑", "わら"],
    "い",
  ]);
  assert.deepEqual(localAlign("ちょうちょ結び", "ちょうちょうむすび").segments, [
    "ちょう",
    ["ちょ", "ちょう"],
    ["結", "むす"],
    "び",
  ]);
  assert.deepEqual(localAlign("チョウチョウ結び", "ちょうちょむすび").segments, [
    ["チョウ", "ちょう"],
    ["チョウ", "ちょ"],
    ["結", "むす"],
    "び",
  ]);
  const equivalent = localAlign("あっとゆう間", "あっとゆーま");
  assert.deepEqual(equivalent.segments, ["あっとゆ", ["う", "ー"], ["間", "ま"]]);
  assert.deepEqual(equivalent.evidence[1].rules, [
    "kana-run-correspondence",
    "long-vowel-notation",
  ]);
  const withoutRuns = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
    kanaRunCorrespondence: false,
  });
  assert.deepEqual(withoutRuns("めんど臭い", "めんどうくさい").segments, [
    ["めんど臭い", "めんどうくさい"],
  ]);
});

test("kana-run alternatives cannot displace a stronger literal prefix and annotated kanji reading", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["出", ["だ.す", "い.だす"]],
      ["母", ["も"]],
      ["呉", ["くれ"]],
    ]),
    wordReadings: new Map([
      ["おくり出す", ["おくりだす", "おくりいだす"]],
      ["くれの母", ["くれのおも"]],
      ["呉の母", ["くれのおも"]],
    ]),
  });
  assert.deepEqual(localAlign("おくり出す", "おくりいだす").segments, [
    "おくり",
    ["出", "いだ"],
    "す",
  ]);
  for (const pair of [
    ["くれの母", "くれのおも"],
    ["呉の母", "くれのおも"],
  ]) {
    assert.equal(
      localAlign(...pair).evidence.some((part) => part.rules.includes("kana-run-correspondence")),
      false,
    );
  }
});

test("internal literal anchors split only residual groups with shared boundary positions", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["呉", ["くれ"]],
      ["母", ["も"]],
    ]),
    wordReadings: new Map([
      ["八幡の不知藪", ["やわたのやぶしらず"]],
      ["呉の母", ["くれのおも"]],
      ["甲の乙に丙", ["あののいにう"]],
      ["甲の乙", ["あののい", "のい"]],
    ]),
  });
  assert.deepEqual(localAlign("八幡の不知藪", "やわたのやぶしらず").segments, [
    ["八幡", "やわた"],
    "の",
    ["不知藪", "やぶしらず"],
  ]);
  assert.deepEqual(localAlign("呉の母", "くれのおも").segments, [
    ["呉", "くれ"],
    "の",
    ["母", "おも"],
  ]);
  assert.deepEqual(localAlign("甲の乙", "あののい").segments, [["甲の乙", "あののい"]]);
  assert.deepEqual(localAlign("甲の乙に丙", "あののいにう").segments, [
    ["甲の乙", "あののい"],
    "に",
    ["丙", "う"],
  ]);
  assert.deepEqual(localAlign("甲の乙", "のい").segments, [["甲の乙", "のい"]]);
  const disabled = createAligner({
    characterReadings: new Map(),
    wordReadings: new Map([["八幡の不知藪", ["やわたのやぶしらず"]]]),
    internalKanaAnchors: false,
  });
  assert.deepEqual(disabled("八幡の不知藪", "やわたのやぶしらず").segments, [
    ["八幡の不知藪", "やわたのやぶしらず"],
  ]);
});

test("internal anchors do not assign an unwritten particle to a single kanji", () => {
  const options = {
    characterReadings: new Map([
      ["人", ["ひと"]],
      ["聞", ["き.く"]],
      ["悪", ["わる.い"]],
      ["後", ["あと"]],
      ["引", ["ひ.く"]],
      ["呉", ["くれ"]],
      ["母", ["も"]],
    ]),
    wordReadings: new Map([
      ["人聞き悪い", ["ひとぎきのわるい"]],
      ["人聞きの悪い", ["ひとぎきのわるい"]],
      ["後へ引く", ["あとへはひく", "あとへひく"]],
      ["呉の母", ["くれのおも"]],
    ]),
  };
  const localAlign = createAligner(options);
  assert.equal(
    localAlign("人聞き悪い", "ひとぎきのわるい").segments.some(
      (segment) => Array.isArray(segment) && segment[0] === "悪" && segment[1] === "のわる",
    ),
    false,
  );
  assert.equal(
    localAlign("後へ引く", "あとへはひく").segments.some(
      (segment) => Array.isArray(segment) && segment[0] === "引" && segment[1] === "はひ",
    ),
    false,
  );
  assert.deepEqual(localAlign("人聞き悪い", "ひとぎきのわるい").segments, [
    ["人", "ひと"],
    ["聞", "ぎ"],
    ["き悪", "きのわる"],
    "い",
  ]);
  assert.deepEqual(localAlign("後へ引く", "あとへはひく").segments, [
    ["後", "あと"],
    ["へ引", "へはひ"],
    "く",
  ]);
  assert.deepEqual(localAlign("呉の母", "くれのおも").segments, [
    ["呉", "くれ"],
    "の",
    ["母", "おも"],
  ]);
  const independentlyKnown = createAligner({
    ...options,
    characterReadings: new Map([...options.characterReadings, ["悪", ["のわる"]]]),
  });
  assert.deepEqual(independentlyKnown("人聞き悪い", "ひとぎきのわるい").segments, [
    ["人", "ひと"],
    ["聞", "ぎ"],
    "き",
    ["悪", "のわる"],
    "い",
  ]);
});

test("alternate spellings supply local readings only inside an exact contextual match", () => {
  const localAlign = createAligner({
    characterReadings,
    wordAlignments: new Map([
      ["取扱い", new Map([["とりあつかい", [["取", "とり"], ["扱", "あつか"], "い"]]])],
      ["取扱います", new Map([["とりあつかいます", [["取", "とり"], ["扱", "あつか"], "います"]]])],
    ]),
  });
  const result = localAlign("取扱い", "とりあつかい");
  assert.deepEqual(result.segments, [["取", "とり"], ["扱", "あつか"], "い"]);
  assert.equal(result.status, "aligned");
  assert.deepEqual(result.evidence[0].rules, ["alternate-spelling"]);
  assert.equal(result.evidence[0].type, "dictionary");
  assert.deepEqual(localAlign("取扱いの人", "とりあつかいのひと").segments, [
    ["取", "とり"],
    ["扱", "あつか"],
    "いの",
    ["人", "ひと"],
  ]);
  assert.deepEqual(localAlign("取扱い", "トリアツカイ").segments, [
    ["取", "トリ"],
    ["扱", "アツカ"],
    ["い", "イ"],
  ]);
  assert.equal(localAlign("取扱います", "とりあつかいます").status, "aligned");
  assert.equal(localAlign("取", "とり").status, "fallback");
  assert.equal(localAlign("取人", "とりひと").status, "fallback");
  assert.equal(localAlign("取扱い", "とりがつかい").status, "fallback");
});

test("alternate spelling groups do not override better supported character boundaries", () => {
  const localAlign = createAligner({
    characterReadings,
    wordAlignments: new Map([["山川", new Map([["やまがわ", [["山川", "やまがわ"]]]])]]),
  });
  assert.deepEqual(localAlign("山川", "やまがわ").segments, [
    ["山", "やま"],
    ["川", "がわ"],
  ]);
});

test("supplied alignments retain caller-provided provenance through compound voicing", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["腕", ["うで"]],
      ["時", ["ジ"]],
      ["計", ["ケイ"]],
    ]),
    wordAlignments: new Map([
      [
        "時計",
        new Map([
          [
            "とけい",
            [
              ["時", "と"],
              ["計", "けい"],
            ],
          ],
        ]),
      ],
    ]),
    wordAlignmentRules: new Map([["時計", new Map([["とけい", ["phonetic-ateji"]]])]]),
  });
  assert.deepEqual(localAlign("時計", "とけい").evidence[0].rules, ["phonetic-ateji"]);
  assert.deepEqual(localAlign("腕時計", "うでどけい").evidence[1].rules, [
    "phonetic-ateji",
    "compound-voicing",
  ]);
});

test("supplied continuatives apply weakly at omitted-okurigana compound boundaries", () => {
  const localCharacters = new Map([
    ...characterReadings,
    ["植", ["ショク", "う.える"]],
    ["木", ["モク", "き"]],
    ["鉢", ["ハチ"]],
    ["書", ["ショ", "か.く"]],
    ["替", ["タイ", "か.える"]],
  ]);
  const localWords = new Map([
    ["植木", ["うえき"]],
    ["植木鉢", ["うえきばち"]],
    ["書替え", ["かきかえ"]],
  ]);
  const continuativeReadings = new Map([
    ["植", ["うえ"]],
    ["書", ["かき"]],
    ["木", ["き"]],
  ]);
  const localAlign = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
    continuativeReadings,
  });
  const result = localAlign("植木鉢", "うえきばち");
  assert.deepEqual(result.segments, [
    ["植", "うえ"],
    ["木", "き"],
    ["鉢", "ばち"],
  ]);
  assert.deepEqual(result.evidence[0].rules, ["continuative-stem"]);
  assert.equal(result.evidence[0].type, "phonological");
  assert.equal(result.evidence[1].type, "character");
  assert.deepEqual(localAlign("書替え", "かきかえ").segments, [["書", "かき"], ["替", "か"], "え"]);
  assert.deepEqual(localAlign("お植木", "おうえき").segments, ["お", ["植", "うえ"], ["木", "き"]]);
  assert.deepEqual(localAlign("植え木", "うえき").segments, [["植", "う"], "え", ["木", "き"]]);
  assert.equal(localAlign("植", "うえ").status, "fallback");
  assert.equal(localAlign("植山", "うえやま").status, "fallback");
  assert.equal(
    localAlign("書人", "かきひと").evidence.some((part) =>
      part.rules.includes("continuative-stem"),
    ),
    false,
  );
  assert.equal(
    createAligner({ characterReadings: localCharacters, continuativeReadings })("植木", "うえき")
      .status,
    "fallback",
  );
});

test("weak character evidence can resolve one missing reading inside an attested compound", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["甲", ["こう"]],
      ["乙", ["おつ"]],
    ]),
    wordReadings: new Map([["甲乙", ["きのと", "こうのと"]]]),
    weakCharacterReadings: new Map([
      ["甲", ["き", "こう"]],
      ["乙", ["のと"]],
    ]),
  });
  const result = localAlign("甲乙", "こうのと");
  assert.deepEqual(result.segments, [
    ["甲", "こう"],
    ["乙", "のと"],
  ]);
  assert.equal(result.evidence[0].type, "character");
  assert.equal(result.evidence[1].type, "dictionary");
  assert.deepEqual(result.evidence[1].rules, ["weak-character-reading"]);
  assert.deepEqual(localAlign("甲乙", "きのと").segments, [["甲乙", "きのと"]]);
  assert.equal(localAlign("乙", "のと").status, "fallback");
  assert.equal(localAlign("乙甲", "のとこう").status, "fallback");
});

test("weak readings can undergo noninitial rendaku without becoming strong readings", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["腕", ["うで"]],
      ["時", ["ジ", "とき"]],
      ["計", ["ケイ"]],
    ]),
    wordReadings: new Map([
      ["腕時計", ["うでどけい"]],
      ["時計", ["とけい", "どけい"]],
    ]),
    weakCharacterReadings: new Map([["時", ["と"]]]),
  });
  const result = localAlign("腕時計", "うでどけい");
  assert.deepEqual(result.segments, [
    ["腕", "うで"],
    ["時", "ど"],
    ["計", "けい"],
  ]);
  assert.deepEqual(result.evidence[1].rules, ["weak-character-reading", "rendaku"]);
  assert.equal(
    localAlign("時計", "どけい").evidence.some((part) =>
      part.rules.includes("weak-character-reading"),
    ),
    false,
  );
});

test("explicit irregular pairs block weak extrapolation without blocking stronger sound evidence", () => {
  const options = {
    characterReadings: new Map([
      ["明", ["あ.かるい"]],
      ["日", ["ニチ", "ひ"]],
      ["今", ["コン"]],
    ]),
    wordReadings: new Map([
      ["明日", ["あす"]],
      ["今明日", ["こんあす"]],
    ]),
    weakCharacterReadings: new Map([["日", ["す"]]]),
    irregularWordReadings: new Map([["明日", ["あす"]]]),
  };
  assert.deepEqual(createAligner(options)("明日", "あす").segments, [["明日", "あす"]]);
  assert.deepEqual(createAligner(options)("今明日", "こんあす").segments, [
    ["今", "こん"],
    ["明日", "あす"],
  ]);
  const primary = createAligner({
    ...options,
    characterReadings: new Map([...options.characterReadings, ["日", ["す"]]]),
  });
  assert.deepEqual(primary("明日", "あす").segments, [
    ["明", "あ"],
    ["日", "す"],
  ]);
  const sibling = createAligner({
    ...options,
    wordAlignments: new Map([
      [
        "明日",
        new Map([
          [
            "あす",
            [
              ["明", "あ"],
              ["日", "す"],
            ],
          ],
        ]),
      ],
    ]),
  });
  assert.deepEqual(sibling("明日", "あす").segments, [
    ["明", "あ"],
    ["日", "す"],
  ]);
});

test("optional unvoicing is weak and confined to attested nonirregular compounds", () => {
  const options = {
    characterReadings: new Map([
      ["部", ["ブ", "-べ"]],
      ["屋", ["や"]],
      ["阿", ["ア"]],
      ["房", ["ボウ"]],
    ]),
    wordReadings: new Map([
      ["部屋", ["へや"]],
      ["阿房", ["あほう"]],
    ]),
    dictionaryUnvoicing: true,
  };
  const localAlign = createAligner(options);
  const result = localAlign("部屋", "へや");
  assert.deepEqual(result.segments, [
    ["部", "へ"],
    ["屋", "や"],
  ]);
  assert.deepEqual(result.evidence[0].rules, ["dictionary-supported-unvoicing"]);
  assert.equal(result.score.cost, 12);
  assert.deepEqual(localAlign("阿房", "あほう").segments, [
    ["阿", "あ"],
    ["房", "ほう"],
  ]);
  assert.deepEqual(
    createAligner({ ...options, dictionaryUnvoicing: false })("部屋", "へや").segments,
    [["部屋", "へや"]],
  );
  assert.deepEqual(
    createAligner({ ...options, irregularWordReadings: options.wordReadings })("部屋", "へや")
      .segments,
    [["部屋", "へや"]],
  );
  assert.equal(localAlign("部", "へ").status, "fallback");
  assert.equal(localAlign("部阿", "へあ").status, "fallback");
});

test("optional nasal loss is weak on-reading evidence confined to exact nonirregular compounds", () => {
  const options = {
    characterReadings: new Map([
      ["饂", ["ウン"]],
      ["飩", ["ドン"]],
      ["暖", ["ノン"]],
      ["簾", ["レン"]],
      ["本", ["ホン"]],
      ["意", ["イ"]],
      ["人", ["ひと"]],
      ["朔", ["ついたち"]],
      ["日", ["ち"]],
    ]),
    wordReadings: new Map([
      ["饂飩", ["うどん"]],
      ["暖簾", ["のれん"]],
      ["本人", ["ほんひと"]],
      ["本意", ["ほい"]],
      ["朔日", ["ついたち"]],
    ]),
    dictionaryNasalLoss: true,
  };
  const localAlign = createAligner(options);
  const result = localAlign("饂飩", "うどん");
  assert.deepEqual(result.segments, [
    ["饂", "う"],
    ["飩", "どん"],
  ]);
  assert.deepEqual(result.evidence[0].rules, ["dictionary-supported-nasal-loss"]);
  assert.equal(result.score.cost, 12);
  assert.deepEqual(localAlign("暖簾", "ノレン").segments, [
    ["暖", "ノ"],
    ["簾", "レン"],
  ]);
  assert.deepEqual(localAlign("本意", "ほい").segments, [
    ["本", "ほ"],
    ["意", "い"],
  ]);
  assert.deepEqual(localAlign("朔日", "ついたち").segments, [["朔日", "ついたち"]]);
  assert.deepEqual(
    createAligner({ ...options, dictionaryNasalLoss: undefined })("饂飩", "うどん").segments,
    [["饂飩", "うどん"]],
  );
  assert.deepEqual(
    createAligner({ ...options, phonologicalAlternations: false })("饂飩", "うどん").segments,
    [["饂飩", "うどん"]],
  );
  const irregular = createAligner({ ...options, irregularWordReadings: options.wordReadings });
  assert.deepEqual(irregular("暖簾", "のれん").segments, [["暖簾", "のれん"]]);
  assert.deepEqual(irregular("暖簾意", "のれんい").segments, [
    ["暖簾", "のれん"],
    ["意", "い"],
  ]);
  assert.equal(localAlign("本", "ほ").status, "fallback");
  assert.equal(localAlign("本人", "ほひと").status, "fallback");
  assert.equal(localAlign("本飩", "ほどん").status, "fallback");
});

test("optional initial voicing preserves every on-reading sound except its initial voicing", () => {
  const options = {
    characterReadings: new Map([
      ["絆", ["ハン"]],
      ["創", ["ソウ"]],
      ["膏", ["コウ"]],
      ["焙", ["ハイ"]],
      ["煎", ["セン"]],
      ["茶", ["チャ"]],
      ["髪", ["ハツ"]],
      ["反", ["ハン"]],
      ["鼻", ["ビ"]],
      ["母", ["はは"]],
      ["屋", ["や"]],
    ]),
    wordReadings: new Map([
      ["絆創膏", ["ばんそうこう"]],
      ["焙煎", ["ばいせん"]],
      ["茶髪", ["ちゃぱつ"]],
      ["反鼻", ["はんぴ"]],
      ["母屋", ["ばはや"]],
    ]),
    dictionaryInitialVoicing: true,
  };
  const localAlign = createAligner(options);
  const result = localAlign("絆創膏", "ばんそうこう");
  assert.deepEqual(result.segments, [
    ["絆", "ばん"],
    ["創", "そう"],
    ["膏", "こう"],
  ]);
  assert.deepEqual(result.evidence[0].rules, ["dictionary-supported-initial-voicing"]);
  assert.equal(result.score.cost, 12);
  assert.deepEqual(localAlign("焙煎", "バイセン").segments, [
    ["焙", "バイ"],
    ["煎", "セン"],
  ]);
  assert.deepEqual(localAlign("茶髪", "ちゃぱつ").segments, [
    ["茶", "ちゃ"],
    ["髪", "ぱつ"],
  ]);
  assert.deepEqual(localAlign("反鼻", "はんぴ").segments, [
    ["反", "はん"],
    ["鼻", "ぴ"],
  ]);
  assert.deepEqual(localAlign("母屋", "ばはや").segments, [["母屋", "ばはや"]]);
  assert.deepEqual(
    createAligner({ ...options, dictionaryInitialVoicing: undefined })("焙煎", "ばいせん").segments,
    [["焙煎", "ばいせん"]],
  );
  assert.deepEqual(
    createAligner({ ...options, phonologicalAlternations: false })("焙煎", "ばいせん").segments,
    [["焙煎", "ばいせん"]],
  );
  assert.deepEqual(
    createAligner({ ...options, irregularWordReadings: options.wordReadings })("焙煎", "ばいせん")
      .segments,
    [["焙煎", "ばいせん"]],
  );
  assert.equal(localAlign("焙", "ばい").status, "fallback");
  assert.equal(localAlign("焙膏", "ばいこう").status, "fallback");
  assert.equal(localAlign("焙煎", "ぼいせん").status, "fallback");
});

test("optional renjo adds a nasal initial only to on readings after a compound nasal", () => {
  const options = {
    characterReadings: new Map([
      ["観", ["カン"]],
      ["音", ["オン", "おと"]],
      ["天", ["テン"]],
      ["王", ["オウ"]],
      ["因", ["イン"]],
      ["縁", ["エン"]],
    ]),
    wordReadings: new Map([
      ["観音", ["かんのん", "かんのと"]],
      ["天王", ["てんのう"]],
      ["因縁", ["いんねん"]],
    ]),
    dictionaryRenjo: true,
  };
  const localAlign = createAligner(options);
  const result = localAlign("観音", "かんのん");
  assert.deepEqual(result.segments, [
    ["観", "かん"],
    ["音", "のん"],
  ]);
  assert.deepEqual(result.evidence[1].rules, ["dictionary-supported-renjo"]);
  assert.deepEqual(localAlign("天王", "てんのう").segments, [
    ["天", "てん"],
    ["王", "のう"],
  ]);
  assert.deepEqual(localAlign("因縁", "インネン").segments, [
    ["因", "イン"],
    ["縁", "ネン"],
  ]);
  assert.deepEqual(localAlign("観音", "かんのと").segments, [["観音", "かんのと"]]);
  assert.deepEqual(
    createAligner({ ...options, dictionaryRenjo: false })("観音", "かんのん").segments,
    [["観音", "かんのん"]],
  );
  assert.deepEqual(
    createAligner({ ...options, irregularWordReadings: options.wordReadings })("観音", "かんのん")
      .segments,
    [
      ["観", "かん"],
      ["音", "のん"],
    ],
  );
  assert.equal(localAlign("観王", "かんのう").status, "fallback");
  assert.equal(localAlign("音", "のん").status, "fallback");
});

test("only the spans affected by equally supported splits are merged", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ["甲", ["か", "かき"]],
      ["乙", ["きく", "く"]],
      ["丙", ["け"]],
    ]),
  });
  const result = localAlign("甲乙丙", "かきくけ");
  assert.deepEqual(result.segments, [
    ["甲乙", "かきく"],
    ["丙", "け"],
  ]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.optimalPathCount, "2");
  assert.equal(result.evidence[0].type, "ambiguous");
  assert.equal(result.evidence[1].type, "character");
});

test("unsupported spans preserve anchors without arbitrarily assigning readings", () => {
  assertAlignment("未知の山", "みちのやま", [["未知", "みち"], "の", ["山", "やま"]], "fallback");
  assertAlignment(
    "甲乙の山",
    "あいうのやま",
    [["甲乙", "あいう"], "の", ["山", "やま"]],
    "fallback",
  );
  assertAlignment("甲の乙", "あののい", [["甲の乙", "あののい"]], "fallback");
});

test("normalization never changes the original spelling or reading projection", () => {
  assert.equal(normalizeKana("ｶﾞッコウ"), "がっこう");
  assertAlignment("学校", "ガッコウ", [
    ["学", "ガッ"],
    ["校", "コウ"],
  ]);
  assertAlignment("学校", "ｶﾞｯｺｳ", [
    ["学", "ｶﾞｯ"],
    ["校", "ｺｳ"],
  ]);
  assertAlignment("ガ", "か\u3099", [["ガ", "か\u3099"]]);
  assertAlignment("かな", "かな", ["かな"]);
  assertAlignment("", "", []);
  assertAlignment("山", "", [["山", ""]], "fallback");
  assertAlignment("", "やま", [["", "やま"]], "fallback");
});

test("heuristics can be disabled independently for comparison", () => {
  const withoutContraction = createAligner({
    characterReadings,
    wordReadings,
    terminalContraction: false,
  });
  assert.deepEqual(withoutContraction("日本", "にほん").segments, [["日本", "にほん"]]);
  assert.deepEqual(withoutContraction("日本", "にっぽん").segments, [
    ["日", "にっ"],
    ["本", "ぽん"],
  ]);
  const withoutPhonology = createAligner({
    characterReadings,
    wordReadings,
    phonologicalAlternations: false,
  });
  assert.deepEqual(withoutPhonology("日本", "にっぽん").segments, [["日本", "にっぽん"]]);
  assert.deepEqual(withoutPhonology("日本", "にほん").segments, [
    ["日", "に"],
    ["本", "ほん"],
  ]);
});

test("terminal contraction requires the exact compound's attested reading", () => {
  const localAlign = createAligner({ characterReadings });
  const result = localAlign("日本", "にほん");
  assert.equal(result.status, "fallback");
  assert.equal(
    result.evidence.some((part) =>
      part.rules.includes("dictionary-supported-terminal-contraction"),
    ),
    false,
  );
});

test("terminal contraction never deletes the end of a kun reading", () => {
  const localAlign = createAligner({
    characterReadings: new Map([
      ...characterReadings,
      ["朔", ["サク", "ついたち"]],
      ["初", ["ショ", "はじ.め"]],
    ]),
    wordReadings: new Map([...wordReadings, ["日", ["ち"]], ["朔日", ["ついたち"]]]),
  });
  assert.deepEqual(localAlign("朔日", "ついたち").segments, [["朔日", "ついたち"]]);
  assert.deepEqual(localAlign("初朔日", "しょついたち").segments, [
    ["初", "しょ"],
    ["朔日", "ついたち"],
  ]);
  assert.deepEqual(localAlign("日本", "にほん").segments, [
    ["日", "に"],
    ["本", "ほん"],
  ]);
});

test("rendaku can voice an attested dictionary compound after another word", () => {
  const localCharacters = new Map([...characterReadings, ["花", ["カ", "はな"]]]);
  const localWords = new Map([
    ["相撲", ["すもう"]],
    ["花相撲", ["はなずもう"]],
  ]);
  const localAlign = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
  });
  const result = localAlign("花相撲", "はなずもう");
  assert.deepEqual(result.segments, [
    ["花", "はな"],
    ["相撲", "ずもう"],
  ]);
  assert.deepEqual(result.evidence[1].rules, ["compound-voicing"]);
  assert.deepEqual(localAlign("花相撲の人", "はなずもうのひと").segments, [
    ["花", "はな"],
    ["相撲", "ずもう"],
    "の",
    ["人", "ひと"],
  ]);
  assert.deepEqual(localAlign("花相撲", "ハナズモウ").segments, [
    ["花", "ハナ"],
    ["相撲", "ズモウ"],
  ]);
  assert.equal(localAlign("相撲", "ずもう").status, "fallback");
  const withoutVoicing = createAligner({
    characterReadings: localCharacters,
    wordReadings: localWords,
    compoundVoicing: false,
  });
  assert.deepEqual(withoutVoicing("花相撲", "はなずもう").segments, [["花相撲", "はなずもう"]]);
});

test("voiced supplied compounds retain their attested internal boundaries", () => {
  const options = {
    characterReadings: new Map([
      ["腕", ["うで"]],
      ["時", ["ジ", "とき"]],
      ["計", ["ケイ"]],
    ]),
    wordReadings: new Map([
      ["時計", ["とけい"]],
      ["腕時計", ["うでどけい"]],
    ]),
    wordAlignments: new Map([
      [
        "時計",
        new Map([
          [
            "とけい",
            [
              ["時", "と"],
              ["計", "けい"],
            ],
          ],
        ]),
      ],
    ]),
  };
  const localAlign = createAligner(options);
  const result = localAlign("腕時計", "うでどけい");
  assert.deepEqual(result.segments, [
    ["腕", "うで"],
    ["時", "ど"],
    ["計", "けい"],
  ]);
  assert.deepEqual(result.evidence[1].rules, ["alternate-spelling", "compound-voicing"]);
  assert.deepEqual(localAlign("腕時計", "ウデドケイ").segments, [
    ["腕", "ウデ"],
    ["時", "ド"],
    ["計", "ケイ"],
  ]);
  assert.equal(localAlign("時計", "どけい").status, "fallback");
  assert.deepEqual(
    createAligner({ ...options, compoundVoicing: false })("腕時計", "うでどけい").segments,
    [["腕時計", "うでどけい"]],
  );
});

test("long expressions retain repeated supported boundaries", () => {
  const result = align("日本語".repeat(30), "にほんご".repeat(30));
  assert.equal(result.status, "aligned");
  assert.equal(result.segments.length, 90);
  assert.equal(result.segments.map((segment) => segment[0]).join(""), "日本語".repeat(30));
  assert.equal(result.segments.map((segment) => segment[1]).join(""), "にほんご".repeat(30));
});

test("invalid API inputs fail explicitly", () => {
  assert.throws(() => createAligner(), TypeError);
  assert.throws(() => createAligner({ characterReadings: {} }), TypeError);
  assert.throws(() => createAligner({ characterReadings: new Map([["山", "やま"]]) }), TypeError);
  assert.throws(() => createAligner({ characterReadings, wordAlignments: {} }), TypeError);
  assert.throws(() => createAligner({ characterReadings, wordAlignmentRules: {} }), TypeError);
  assert.throws(
    () =>
      createAligner({
        characterReadings,
        wordAlignmentRules: new Map([["山", new Map([["やま", "source"]])]]),
      }),
    TypeError,
  );
  assert.throws(() => createAligner({ characterReadings, continuativeReadings: {} }), TypeError);
  assert.throws(() => createAligner({ characterReadings, weakCharacterReadings: {} }), TypeError);
  assert.throws(
    () => createAligner({ characterReadings, wordAlignments: new Map([["山", ["やま"]]]) }),
    TypeError,
  );
  assert.throws(
    () =>
      createAligner({
        characterReadings,
        wordAlignments: new Map([["山", new Map([["やま", [["山", "さん"]]]])]]),
      }),
    /projections/u,
  );
  assert.throws(() => align("山", undefined), TypeError);
});

test("an unsupported remainder keeps its attested word group", () => {
  const align = createAligner({
    characterReadings: new Map([["甲", ["あ"]]]),
    wordReadings: new Map([["甲乙", ["あい"]]]),
  });
  const result = align("甲乙", "あい");
  assert.deepEqual(result.segments, [["甲乙", "あい"]]);
  assert.equal(result.status, "aligned");
});
