import assert from "node:assert/strict";
import test from "node:test";
import { deriveContinuativeReadings } from "../src/morphology.mjs";

function entry(id, spelling, reading, partOfSpeech, readingTags = []) {
  return {
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, appliesToKanji: ["*"], tags: readingTags }],
    sense: [{ partOfSpeech: [partOfSpeech], appliesToKanji: ["*"], appliesToKana: ["*"] }]
  };
}

test("regular ichidan and godan classes produce the continuative form", () => {
  const words = [
    entry("1000000", "植える", "うえる", "v1"),
    entry("1000001", "書く", "かく", "v5k"),
    entry("1000002", "泳ぐ", "およぐ", "v5g"),
    entry("1000003", "遊ぶ", "あそぶ", "v5b"),
    entry("1000004", "読む", "よむ", "v5m"),
    entry("1000005", "死ぬ", "しぬ", "v5n"),
    entry("1000006", "帰る", "かえる", "v5r"),
    entry("1000007", "話す", "はなす", "v5s"),
    entry("1000008", "待つ", "まつ", "v5t"),
    entry("1000009", "買う", "かう", "v5u")
  ];
  const { readings, witnesses } = deriveContinuativeReadings({ words });
  for (const [character, expected] of [
    ["植", "うえ"], ["書", "かき"], ["泳", "およぎ"], ["遊", "あそび"], ["読", "よみ"],
    ["死", "しに"], ["帰", "かえり"], ["話", "はなし"], ["待", "まち"], ["買", "かい"]
  ]) assert.deepEqual(readings.get(character), [expected]);
  assert.deepEqual(witnesses.find(witness => witness.spelling === "植える"), { id: "1000000", spelling: "植える", reading: "うえる", stem: "うえ" });
});

test("irregular classes, adjectives, nouns, expressions, and suspect readings are excluded", () => {
  const words = [
    entry("1000000", "来る", "くる", "vk"), entry("1000001", "行く", "いく", "v5k-s"),
    entry("1000002", "有る", "ある", "v5r-i"), entry("1000003", "呉れる", "くれる", "v1-s"),
    entry("1000004", "問う", "とう", "v5u-s"), entry("1000005", "得る", "うる", "v5uru"),
    entry("1000006", "母", "ふくろ", "n"), entry("1000007", "俄か", "にわか", "adj-na"),
    entry("1000008", "書く", "かく", "v5k", ["ik"]), entry("1000009", "植える", "ウエル", "v1", ["sk"])
  ];
  const expression = entry("1000010", "目がある", "めがある", "v5r");
  expression.sense[0].partOfSpeech.push("exp");
  words.push(expression);
  assert.equal(deriveContinuativeReadings({ words }).readings.size, 0);
});

test("sense restrictions control the conjugation class of each exact pair", () => {
  const word = entry("1000000", "着る", "きる", "v1");
  word.kanji.push({ text: "切る", tags: [] });
  word.sense = [
    { partOfSpeech: ["v1"], appliesToKanji: ["着る"], appliesToKana: ["きる"] },
    { partOfSpeech: ["v5r"], appliesToKanji: ["切る"], appliesToKana: ["きる"] }
  ];
  const { readings } = deriveContinuativeReadings({ words: [word] });
  assert.deepEqual(readings.get("着"), ["き"]);
  assert.deepEqual(readings.get("切"), ["きり"]);
  word.sense.push({ partOfSpeech: ["v5r"], appliesToKanji: ["着る"], appliesToKana: ["きる"] });
  assert.equal(deriveContinuativeReadings({ words: [word] }).readings.has("着"), false);
});

test("multi-kanji and kana-prefixed forms cannot supply single-character readings", () => {
  const words = [
    entry("1000000", "取り扱う", "とりあつかう", "v5u"),
    entry("1000001", "引取る", "ひきとる", "v5r"),
    entry("1000002", "ひき取る", "ひきとる", "v5r"),
    entry("1000003", "𠮟る", "しかる", "v5r")
  ];
  assert.deepEqual([...deriveContinuativeReadings({ words }).readings], [["𠮟", ["しかり"]]]);
});

test("a compound's kana spelling is rejected when its reading also applies to a multi-kanji spelling", () => {
  const word = entry("1000000", "受けとる", "うけとる", "v5r");
  word.kanji.push({ text: "受け取る", tags: [] });
  assert.equal(deriveContinuativeReadings({ words: [word] }).readings.size, 0);
});

test("attested verb components also identify a compound whose second verb is written only in kana", () => {
  const words = [
    entry("1000000", "押す", "おす", "v5s"), entry("1000001", "除ける", "のける", "v1"),
    entry("1000002", "押しのける", "おしのける", "v1")
  ];
  const { readings, witnesses } = deriveContinuativeReadings({ words });
  assert.deepEqual(readings.get("押"), ["おし"]);
  assert.equal(witnesses.some(witness => witness.spelling === "押しのける"), false);
});

test("written okurigana and verb endings must agree with the reading and class", () => {
  const words = [
    entry("1000000", "植える", "うわる", "v1"), entry("1000001", "書く", "かく", "v5r"),
    entry("1000002", "食べる", "べる", "v1")
  ];
  assert.equal(deriveContinuativeReadings({ words }).readings.size, 0);
});

test("normalized stems retain exact source witnesses and deduplicate equivalent spellings", () => {
  const words = [entry("1000000", "植エル", "ウエル", "v1"), entry("1000001", "植える", "うえる", "v1")];
  const { readings, witnesses } = deriveContinuativeReadings({ words });
  assert.deepEqual(readings.get("植"), ["うえ"]);
  assert.equal(witnesses.length, 2);
  assert.ok(witnesses.some(witness => witness.spelling === "植エル" && witness.reading === "ウエル"));
});
