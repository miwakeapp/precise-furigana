import assert from "node:assert/strict";
import test from "node:test";
import { compileAlignmentPipeline, defaultConfiguration } from "../src/dataset.mjs";

function fixtures() {
  const word = (id, spelling, reading, tags = []) => ({
    id,
    kanji: [{ text: spelling, tags }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
    sense: []
  });
  const jmdict = { words: [
    word("1", "甲乙", "かこ", ["ateji"]),
    word("2", "甲乙丙", "かこくぐ")
  ] };
  const readings = new Map([["甲", ["カ", "カコ"]], ["乙", ["ク"]], ["丙", ["ク", "クグ"]]]);
  const kanjidic = { characters: [...readings].map(([literal, values]) => ({
    literal,
    readingMeaning: { groups: [{ readings: values.map(value => ({ type: "ja_on", value })) }] }
  })) };
  return { jmdict, kanjidic };
}

test("phonetic subword transfers cannot move accepted boundaries in a longer word", () => {
  const { jmdict, kanjidic } = fixtures();
  const baseline = compileAlignmentPipeline(jmdict, kanjidic, { phoneticAteji: false });
  const transferred = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(baseline.align("甲乙", "かこ").segments, [["甲乙", "かこ"]]);
  assert.deepEqual(transferred.align("甲乙", "かこ").segments, [["甲", "か"], ["乙", "こ"]]);
  assert.equal(transferred.phoneticAteji.length, 1);

  // The transferred `乙[こ]` edge would otherwise undercut the final rendaku
  // and shift both existing boundaries to `甲[か] 乙[こ] 丙[くぐ]`.
  const expected = [["甲", "かこ"], ["乙", "く"], ["丙", "ぐ"]];
  assert.deepEqual(baseline.align("甲乙丙", "かこくぐ").segments, expected);
  assert.deepEqual(transferred.align("甲乙丙", "かこくぐ").segments, expected);
  assert.deepEqual(transferred.align("甲乙丙", "かこくぐ").evidence.at(-1).rules, ["rendaku"]);
});

test("undefined pipeline options retain defaults while false disables a feature", () => {
  const { jmdict, kanjidic } = fixtures();
  const options = Object.fromEntries(Object.keys(defaultConfiguration).map(name => [name, undefined]));
  const defaults = compileAlignmentPipeline(jmdict, kanjidic, options);
  assert.deepEqual(defaults.configuration, defaultConfiguration);
  assert.deepEqual(defaults.align("甲乙", "かこ").segments, [["甲", "か"], ["乙", "こ"]]);

  const disabled = compileAlignmentPipeline(jmdict, kanjidic, { ...options, phoneticAteji: false });
  assert.equal(disabled.configuration.phoneticAteji, false);
  assert.deepEqual(disabled.align("甲乙", "かこ").segments, [["甲乙", "かこ"]]);
});

test("final sound refinements are independently switchable and cannot propagate to unattested compounds", () => {
  const pairs = [["心地", "ここち"], ["贔屓", "ひいき"], ["御御様", "おごうさま"]];
  const jmdict = { words: pairs.map(([spelling, reading], index) => ({
    id: String(index), kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: []
  })) };
  const readings = new Map([["心", ["こころ"]], ["地", ["チ"]], ["贔", ["ヒ"]], ["屓", ["キ"]], ["御", ["お"]], ["様", ["さま"]]]);
  const kanjidic = { characters: [...readings].map(([literal, values]) => ({
    literal, readingMeaning: { groups: [{ readings: values.map(value => ({
      type: /^[ァ-ヺ]/u.test(value) ? "ja_on" : "ja_kun", value
    })) }] }
  })) };
  const sources = { unihanReadings: new Map([["贔", ["ヒ"]], ["御", ["ゴ"]]]) };
  const baseline = compileAlignmentPipeline(jmdict, kanjidic, { nativeCompounds: false, unihanOnLengthening: false }, sources);
  const refined = compileAlignmentPipeline(jmdict, kanjidic, {}, sources);
  const nativeOnly = compileAlignmentPipeline(jmdict, kanjidic, { unihanOnLengthening: false }, sources);
  const lengthenedOnly = compileAlignmentPipeline(jmdict, kanjidic, { nativeCompounds: false }, sources);
  assert.deepEqual(baseline.align("心地", "ここち").segments, [["心地", "ここち"]]);
  assert.deepEqual(baseline.align("御御様", "おごうさま").segments, [["御御様", "おごうさま"]]);
  assert.deepEqual(baseline.align("贔屓", "ひいき").segments, [["贔屓", "ひいき"]]);
  assert.equal(baseline.align("贔屓", "ひいき").status, "aligned");
  assert.deepEqual(refined.align("心地", "ここち").segments, [["心", "ここ"], ["地", "ち"]]);
  assert.deepEqual(refined.align("贔屓", "ひいき").segments, [["贔", "ひい"], ["屓", "き"]]);
  assert.deepEqual(refined.align("御御様", "おごうさま").segments, [["御", "お"], ["御", "ごう"], ["様", "さま"]]);
  assert.deepEqual(nativeOnly.align("贔屓", "ひいき").segments, baseline.align("贔屓", "ひいき").segments);
  assert.deepEqual(lengthenedOnly.align("心地", "ここち").segments, baseline.align("心地", "ここち").segments);
  assert.equal(nativeOnly.align("贔屓", "ひいき").status, "aligned");
  assert.equal(lengthenedOnly.align("心地", "ここち").status, "aligned");
  for (const [spelling, reading] of [["心心", "ここここ"], ["贔心", "ひいこころ"]]) {
    assert.deepEqual(refined.align(spelling, reading).segments, baseline.align(spelling, reading).segments);
  }
  assert.equal(refined.nativeCompounds.length, 1);
  assert.equal(refined.unihanOnLengthening.length, 2);
});

test("listed phonology honors both source and correspondence switches", () => {
  const jmdict = { words: [{
    id: "1", kanji: [{ text: "愛惜", tags: [] }],
    kana: [{ text: "あいじゃく", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [{
    literal: "愛", readingMeaning: { groups: [{ readings: [{ type: "ja_on", value: "アイ" }] }] }
  }] };
  const sources = { englishCharacterReadingBundle: {
    schemaVersion: 1,
    source: { name: "English fixture", publisher: "English Wiktionary", version: "1", sha256: "a".repeat(64) },
    readings: [{ character: "惜", reading: "シャク", kind: "on", originalForm: "しゃく", tags: ["on", "transliteration"] }]
  } };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic, {}, sources);
  assert.deepEqual(enabled.align("愛惜", "あいじゃく").segments, [["愛", "あい"], ["惜", "じゃく"]]);
  for (const options of [{ englishCharacterReadings: false }, { listedPhonology: false }, { unihanVoicing: false }]) {
    const result = compileAlignmentPipeline(jmdict, kanjidic, options, sources).align("愛惜", "あいじゃく");
    assert.deepEqual(result.segments, [["愛惜", "あいじゃく"]]);
  }
  assert.deepEqual(enabled.align("愛愛惜", "あいあいじゃく").segments, [["愛", "あい"], ["愛惜", "あいじゃく"]]);
});

test("reviewed target facts constrain variant transfers before protected boundaries are created", () => {
  const jmdict = { words: [{
    id: "1", kanji: [{ text: "玄人", tags: [] }],
    kana: ["くろと", "くろうと"].map(text => ({ text, tags: [], appliesToKanji: ["*"] })), sense: []
  }, {
    id: "2", kanji: [{ text: "一昨日", tags: [] }],
    kana: [{ text: "おととい", tags: ["gikun"], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [["玄", "くろ"], ["人", "と"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_kun", value }] }] }
  })) };
  const lexicalEvidence = [
    { id: "expert", spelling: "玄人", reading: "くろうと", segments: [["玄", "くろ"], ["人", "うと"]] },
    { id: "day", spelling: "一昨日", reading: "おととい", segments: [["一昨", "おとと"], ["日", "い"]] }
  ].map(fact => ({ ...fact, reason: "Independently reviewed exact target sound ownership", sources: [{ url: "https://example.test/source" }] }));
  const enabled = compileAlignmentPipeline(jmdict, kanjidic, {}, { lexicalEvidence });
  assert.deepEqual(enabled.align("玄人", "くろうと").segments, [["玄", "くろ"], ["人", "うと"]]);
  assert.deepEqual(enabled.align("玄人", "くろと").segments, [["玄", "くろ"], ["人", "と"]]);
  assert.deepEqual(enabled.align("一昨日", "おととい").segments, [["一昨", "おとと"], ["日", "い"]]);
  assert.equal(enabled.readingVariants.some(witness => witness.spelling === "玄人" && witness.reading === "くろうと"), false);

  const disabled = compileAlignmentPipeline(jmdict, kanjidic, { reviewedLexicalEvidence: false }, { lexicalEvidence });
  assert.deepEqual(disabled.align("玄人", "くろうと").segments, [["玄", "くろう"], ["人", "と"]]);
  assert.deepEqual(disabled.align("一昨日", "おととい").segments, [["一昨日", "おととい"]]);
  // The exact fact never supplies a global `人[うと]` character reading.
  assert.deepEqual(enabled.align("人人", "うとうと").segments, disabled.align("人人", "うとうと").segments);
});

test("on-reading spelling is a final exact-pair refinement with an independent off switch", () => {
  const jmdict = { words: [{
    id: "1", kanji: [{ text: "警察", tags: [] }],
    kana: [{ text: "ケーサツ", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [["警", "ケイ"], ["察", "サツ"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] }
  })) };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic);
  const disabled = compileAlignmentPipeline(jmdict, kanjidic, { onReadingSpelling: false });
  assert.deepEqual(enabled.align("警察", "ケーサツ").segments, [["警", "ケー"], ["察", "サツ"]]);
  assert.deepEqual(disabled.align("警察", "ケーサツ").segments, [["警察", "ケーサツ"]]);
  assert.equal(enabled.onReadingSpelling.length, 1);
  assert.equal(disabled.onReadingSpelling.length, 0);
  assert.equal(enabled.align("警察", "ケーサツ").status, "aligned");
  assert.deepEqual(enabled.align("警察", "ケーサツ").evidence[0].rules, ["on-long-vowel-notation-equivalence"]);
  // Default weak-sound protection must not run this late stage early and
  // hide its witness before the complete pipeline reaches the final pass.
  assert.equal(enabled.configuration.dictionaryNasalLoss, true);
  for (const [spelling, reading] of [["警察警察", "ケーサツケーサツ"], ["警察", "けーさつ"]]) {
    assert.deepEqual(enabled.align(spelling, reading), disabled.align(spelling, reading));
  }
});

test("on-reading spelling respects each optional typed source flag", () => {
  const jmdict = { words: [{
    id: "1", kanji: [{ text: "警察", tags: [] }],
    kana: [{ text: "ケーサツ", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [{
    literal: "察", readingMeaning: { groups: [{ readings: [{ type: "ja_on", value: "サツ" }] }] }
  }] };
  const bundle = {
    schemaVersion: 1,
    source: { name: "Typed fixture", version: "1", sha256: "b".repeat(64) },
    readings: [{ character: "警", reading: "ケイ", kind: "on", originalForm: "ケイ", tags: ["on", "transliteration"] }]
  };
  for (const [source, flag] of [["characterReadingBundle", "listedCharacterReadings"], ["englishCharacterReadingBundle", "englishCharacterReadings"]]) {
    const sources = { [source]: bundle };
    const enabled = compileAlignmentPipeline(jmdict, kanjidic, {}, sources);
    assert.deepEqual(enabled.align("警察", "ケーサツ").segments, [["警", "ケー"], ["察", "サツ"]]);
    for (const options of [{ [flag]: false }, { onReadingSpelling: false }]) {
      const result = compileAlignmentPipeline(jmdict, kanjidic, options, sources).align("警察", "ケーサツ");
      assert.deepEqual(result.segments, [["警察", "ケーサツ"]]);
    }
  }
});

function lateEvidenceFixture() {
  const word = (id, spelling, readings) => ({
    id, kanji: [{ text: spelling, tags: [] }],
    kana: readings.map(text => ({ text, tags: [], appliesToKanji: ["*"] })), sense: []
  });
  const bundle = (name, records) => ({
    schemaVersion: 1, source: { name, version: "1", sha256: "c".repeat(64) },
    readings: records.map(([character, reading, kind]) => ({
      character, reading, kind, originalForm: reading, tags: [kind, "transliteration"]
    }))
  });
  const fact = (id, spelling, reading, segments) => ({
    id, spelling, reading, segments, reason: "Reviewed local sound boundaries",
    sources: [{ url: "https://example.test/local-reading" }]
  });
  const options = { ...Object.fromEntries(Object.keys(defaultConfiguration).map(name => [name, false])),
    weakReadings: true, listedCharacterReadings: true, englishCharacterReadings: true, reviewedLexicalEvidence: true,
    internalKanaAnchors: true
  };
  // The actual source relationship: primary 自じ, weak/JP 刀と, and the
  // independently listed English-source 母おも/あも readings.
  const kanjidic = { characters: [
    { literal: "母", readingMeaning: { groups: [{ readings: [
      { type: "ja_on", value: "ボ" }, { type: "ja_kun", value: "はは" }, { type: "ja_kun", value: "も" }
    ] }] } },
    { literal: "刀", readingMeaning: { nanori: ["と"], groups: [{ readings: [{ type: "ja_on", value: "トウ" }] }] } },
    { literal: "自", readingMeaning: { groups: [{ readings: [{ type: "ja_on", value: "ジ" }] }] } }
  ] };
  const sources = {
    characterReadingBundle: bundle("Japanese fixture", [["刀", "ト", "on"]]),
    englishCharacterReadingBundle: bundle("English fixture", [["母", "おも", "kun"], ["母", "あも", "kun"]]),
    lexicalEvidence: ["おも", "あも"].map(reading => fact(`mother-${reading}`, "母刀自", `${reading}とじ`, [["母", reading], ["刀自", "とじ"]]))
  };
  return { word, bundle, fact, options, kanjidic, sources };
}

test("coarse lexical facts cannot erase finer independently witnessed character boundaries", () => {
  const { word, options, kanjidic, sources } = lateEvidenceFixture();
  const jmdict = { words: [word("1", "母刀自", ["おもとじ", "あもとじ"])] };
  const baseline = compileAlignmentPipeline(jmdict, kanjidic, { ...options, reviewedLexicalEvidence: false }, sources);
  const refined = compileAlignmentPipeline(jmdict, kanjidic, options, sources);
  for (const reading of ["おも", "あも"]) {
    const expected = [["母", reading], ["刀", "と"], ["自", "じ"]];
    assert.deepEqual(baseline.align("母刀自", `${reading}とじ`).segments, expected);
    assert.deepEqual(refined.align("母刀自", `${reading}とじ`).segments, expected);
  }
  assert.equal(refined.englishCharacterReadings.length, 2);
  assert.ok(refined.englishCharacterReadings.every(witness =>
    witness.lexicalContexts.length === 1 && witness.lexicalContexts[0] === "without-lexical-refinement"
  ));
  const withoutEnglish = compileAlignmentPipeline(jmdict, kanjidic, { ...options, englishCharacterReadings: false }, sources);
  assert.deepEqual(withoutEnglish.align("母刀自", "おもとじ").segments, [["母", "おも"], ["刀自", "とじ"]]);
  assert.equal(withoutEnglish.englishCharacterReadings.length, 0);
});

test("independent and lexical paths union disjoint cuts with their source attribution", () => {
  const { word, fact, options, kanjidic, sources } = lateEvidenceFixture();
  const spelling = "母刀自で甲乙", reading = "おもとじでこうおつ";
  const jmdict = { words: [word("1", spelling, [reading])] };
  sources.lexicalEvidence.push(fact("right", "甲乙", "こうおつ", [["甲", "こう"], ["乙", "おつ"]]));
  const independent = compileAlignmentPipeline(jmdict, kanjidic, { ...options, reviewedLexicalEvidence: false }, sources);
  const result = compileAlignmentPipeline(jmdict, kanjidic, options, sources).align(spelling, reading);
  assert.deepEqual(independent.align(spelling, reading).segments, [["母", "おも"], ["刀", "と"], ["自", "じ"], "で", ["甲乙", "こうおつ"]]);
  assert.deepEqual(result.segments, [["母", "おも"], ["刀", "と"], ["自", "じ"], "で", ["甲", "こう"], ["乙", "おつ"]]);
  assert.ok(result.evidence[1].rules.includes("english-listed-character-evidence"));
  assert.ok(result.evidence.at(-1).rules.includes("reviewed-lexical-unit"));
  assert.ok(!result.evidence.at(-1).rules.includes("english-listed-character-evidence"));
  assert.ok(!result.evidence.at(-1).supportingSpans.some(span => span.rules.includes("english-listed-character-evidence")));
  assert.ok(result.evidence.at(-1).supportingSpans.some(span => span.context === "with-lexical-refinement" && span.facts?.includes("right")));
  assert.ok(result.evidence[1].supportingSpans.some(span => span.context === "without-lexical-refinement"));
});

test("conflicting independent cuts cannot override a reviewed local boundary", () => {
  const { word, bundle, fact, options } = lateEvidenceFixture();
  const jmdict = { words: [word("1", "甲乙丙", ["かきくけ"])] };
  const kanjidic = { characters: [["甲", "カキ"], ["乙", "ク"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] }
  })) };
  const sources = {
    englishCharacterReadingBundle: bundle("English fixture", [["丙", "ケ", "on"]]),
    lexicalEvidence: [fact("contrary", "甲乙", "かきく", [["甲", "か"], ["乙", "きく"]])]
  };
  const independent = compileAlignmentPipeline(jmdict, kanjidic, { ...options, reviewedLexicalEvidence: false }, sources);
  const integrated = compileAlignmentPipeline(jmdict, kanjidic, options, sources);
  assert.deepEqual(independent.align("甲乙丙", "かきくけ").segments, [["甲", "かき"], ["乙", "く"], ["丙", "け"]]);
  assert.deepEqual(integrated.align("甲乙丙", "かきくけ").segments, [["甲", "か"], ["乙丙", "きくけ"]]);
});

test("a conflicting region cannot erase compatible independent cuts beyond shared anchors", () => {
  const { word, fact, options, kanjidic, sources } = lateEvidenceFixture();
  const spelling = "甲乙丙で母刀自", reading = "かきくけでおもとじ";
  const jmdict = { words: [word("1", spelling, [reading])] };
  for (const [literal, value] of [["甲", "カキ"], ["乙", "ク"]]) {
    kanjidic.characters.push({ literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] } });
  }
  sources.englishCharacterReadingBundle.readings.push({ character: "丙", reading: "ケ", kind: "on", originalForm: "ケ", tags: ["on", "transliteration"] });
  sources.lexicalEvidence.push(fact("left", "甲乙", "かきく", [["甲", "か"], ["乙", "きく"]]));
  const independent = compileAlignmentPipeline(jmdict, kanjidic, { ...options, reviewedLexicalEvidence: false }, sources);
  assert.deepEqual(independent.align(spelling, reading).segments, [["甲", "かき"], ["乙", "く"], ["丙", "け"], "で", ["母", "おも"], ["刀", "と"], ["自", "じ"]]);
  const integrated = compileAlignmentPipeline(jmdict, kanjidic, options, sources).align(spelling, reading);
  assert.deepEqual(integrated.segments, [["甲", "か"], ["乙丙", "きくけ"], "で", ["母", "おも"], ["刀", "と"], ["自", "じ"]]);
  assert.ok(integrated.evidence.at(-1).rules.includes("english-listed-character-evidence"));
  assert.ok(integrated.evidence[0].rules.includes("reviewed-lexical-unit"));
  assert.ok(!integrated.evidence[0].rules.includes("english-listed-character-evidence"));
});

test("disabled sources cannot supply positive companion readings to another listed source", () => {
  const { word, bundle } = lateEvidenceFixture();
  const jmdict = { words: [word("1", "甲乙", ["かき"])] }, kanjidic = { characters: [] };
  const options = Object.fromEntries(Object.keys(defaultConfiguration).map(name => [name, false]));
  const cases = [
    {
      sources: { characterReadingBundle: bundle("Japanese", [["甲", "カ", "on"]]), englishCharacterReadingBundle: bundle("English", [["乙", "キ", "on"]]) },
      enabled: { listedCharacterReadings: true, englishCharacterReadings: true }, disabled: "listedCharacterReadings"
    },
    {
      sources: { unihanReadings: new Map([["甲", ["カ"]]]), englishCharacterReadingBundle: bundle("English", [["乙", "キ", "on"]]) },
      enabled: { unihanReadings: true, englishCharacterReadings: true }, disabled: "unihanReadings"
    },
    {
      sources: { unihanReadings: new Map([["甲", ["カ"]]]), characterReadingBundle: bundle("Japanese", [["乙", "キ", "on"]]) },
      enabled: { unihanReadings: true, listedCharacterReadings: true }, disabled: "unihanReadings"
    }
  ];
  for (const { sources, enabled, disabled } of cases) {
    assert.deepEqual(compileAlignmentPipeline(jmdict, kanjidic, { ...options, ...enabled }, sources).align("甲乙", "かき").segments, [["甲", "か"], ["乙", "き"]]);
    assert.deepEqual(compileAlignmentPipeline(jmdict, kanjidic, { ...options, ...enabled, [disabled]: false }, sources).align("甲乙", "かき").segments, [["甲乙", "かき"]]);
  }
});

test("disabled optional sources cannot affect native competing-reading guards", () => {
  const { word, bundle } = lateEvidenceFixture();
  const jmdict = { words: [word("1", "甲乙", ["あいえき"])] };
  const kanjidic = { characters: [["甲", ["あいう"]], ["乙", ["エキ", "イエキ"]]].map(([literal, values]) => ({
    literal, readingMeaning: { groups: [{ readings: values.map(value => ({ type: literal === "甲" ? "ja_kun" : "ja_on", value })) }] }
  })) };
  const options = { ...Object.fromEntries(Object.keys(defaultConfiguration).map(name => [name, false])), nativeCompounds: true };
  for (const [sources, flag] of [
    [{ unihanReadings: new Map([["甲", ["あ"]]]) }, "unihanReadings"],
    [{ characterReadingBundle: bundle("Japanese", [["甲", "あ", "kun"]]) }, "listedCharacterReadings"]
  ]) {
    assert.deepEqual(compileAlignmentPipeline(jmdict, kanjidic, options, sources).align("甲乙", "あいえき").segments, [["甲", "あい"], ["乙", "えき"]]);
    const enabled = compileAlignmentPipeline(jmdict, kanjidic, { ...options, [flag]: true }, sources);
    assert.deepEqual(enabled.align("甲乙", "あいえき").segments, [["甲", "あ"], ["乙", "いえき"]]);
    assert.equal(enabled.nativeCompounds.length, 0);
  }
});

test("source-unit transfers refine attested compounds and honor source switches", () => {
  const jmdict = { words: [["禍津日", "まがつひ"], ["禍津日神", "まがつひのかみ"]].map(([spelling, reading], index) => ({
    id: String(index), kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: []
  })) };
  const kanjidic = { characters: [["津", "つ"], ["日", "ひ"], ["神", "かみ"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_kun", value }] }] }
  })) };
  const sources = { characterReadingBundle: {
    schemaVersion: 1,
    source: { name: "Japanese fixture", publisher: "Japanese Wiktionary", version: "fixture", sha256: "a".repeat(64), url: "https://example.test/readings" },
    readings: [{ character: "禍", reading: "まが", kind: "kun", originalForm: "まが", tags: ["kun", "transliteration"] }]
  } };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic, {}, sources);
  const disabled = compileAlignmentPipeline(jmdict, kanjidic, { sourceUnitTransfers: false }, sources);
  assert.deepEqual(disabled.align("禍津日神", "まがつひのかみ").segments, [["禍津日神", "まがつひのかみ"]]);
  assert.deepEqual(enabled.align("禍津日神", "まがつひのかみ").segments, [["禍", "まが"], ["津", "つ"], ["日神", "ひのかみ"]]);
  assert.equal(enabled.sourceUnitTransfers.length, 1);
  assert.ok(enabled.align("禍津日神", "まがつひのかみ").evidence.every(span => span.rules.includes("independently-supported-word-unit")));
  assert.deepEqual(compileAlignmentPipeline(jmdict, kanjidic, { listedCharacterReadings: false }, sources).align("禍津日神", "まがつひのかみ").segments, [["禍津日神", "まがつひのかみ"]]);
});

test("separator transfers use restricted same-entry sources and an independent raw aligner", () => {
  const jmdict = { words: [{
    id: "1", kanji: ["甲乙丙", "甲乙・丙"].map(text => ({ text, tags: [] })),
    kana: [{ text: "かがな", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [["甲", "カ"], ["乙", "カ"], ["丙", "ナ"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] }
  })) };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(enabled.align("甲乙・丙", "かがな").segments, [["甲", "か"], ["乙・", "が"], ["丙", "な"]]);
  assert.equal(enabled.separatorTransfers.length, 1);
  assert.deepEqual(Object.keys(enabled.separatorTransfers[0].rawAlignerOptions).sort(), [
    "compoundVoicing", "internalKanaAnchors", "kanaRunCorrespondence", "phonologicalAlternations", "terminalContraction"
  ]);
  for (const options of [{ separatorTransfers: false }, { phonologicalAlternations: false }]) {
    const disabled = compileAlignmentPipeline(jmdict, kanjidic, { ...options, sharedRunTransfers: false });
    assert.deepEqual(disabled.align("甲乙・丙", "かがな").segments, [["甲乙・丙", "かがな"]]);
    assert.equal(disabled.separatorTransfers.length, 0);
  }
});

test("virtual separator sources require exact independent allocation and preserve provenance", () => {
  const jmdict = { words: [{
    id: "1", kanji: [{ text: "甲乙・丙", tags: [] }],
    kana: [{ text: "あいう", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [["甲", "ア"], ["乙", "イ"], ["丙", "ウ"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] }
  })) };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(enabled.align("甲乙・丙", "あいう").segments, [["甲", "あ"], ["乙・", "い"], ["丙", "う"]]);
  assert.equal(enabled.separatorTransfers.length, 1);
  const witness = enabled.separatorTransfers[0];
  assert.equal(witness.virtualSource.attestedInSameEntry, false);
  assert.equal(witness.virtualSource.wholePairAttestationUsed, false);
  assert.equal(witness.sourceAttestation, undefined);
  assert.equal(witness.completeExactAllocation.length, 3);
  for (const options of [{ separatorTransfers: false }, { virtualSeparatorSources: false }]) {
    const disabled = compileAlignmentPipeline(jmdict, kanjidic, options);
    assert.deepEqual(disabled.align("甲乙・丙", "あいう").segments, [["甲乙・丙", "あいう"]]);
    assert.equal(disabled.separatorTransfers.length, 0);
  }
});

test("shared runs recover supported internal cuts and honor both variant switches", () => {
  const jmdict = { words: [{
    id: "1", kanji: ["寧楽時代", "奈良時代"].map(text => ({ text, tags: [] })),
    kana: [{ text: "ならじだい", tags: [], appliesToKanji: ["*"] }], sense: []
  }] };
  const kanjidic = { characters: [["奈", "ナ"], ["良", "ラ"], ["時", "ジ"], ["代", "ダイ"]].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: "ja_on", value }] }] }
  })) };
  const enabled = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(enabled.align("寧楽時代", "ならじだい").segments, [["寧楽時", "ならじ"], ["代", "だい"]]);
  assert.equal(enabled.sharedRunTransfers.length, 1);
  assert.equal(enabled.sharedRunTransfers[0].units[0].sourcePair.spelling, "奈良時代");
  assert.deepEqual(Object.keys(enabled.sharedRunTransfers[0].units[0].rawAlignerOptions).sort(), [
    "compoundVoicing", "internalKanaAnchors", "kanaRunCorrespondence", "phonologicalAlternations", "terminalContraction"
  ]);
  for (const options of [{ sharedRunTransfers: false }, { variantTransfers: false }]) {
    const disabled = compileAlignmentPipeline(jmdict, kanjidic, options);
    assert.deepEqual(disabled.align("寧楽時代", "ならじだい").segments, [["寧楽時代", "ならじだい"]]);
    assert.equal(disabled.sharedRunTransfers.length, 0);
  }
});

test("the pipeline never guesses an unsupported character reading", () => {
  const jmdict = { words: [{ id: "1", kanji: [{ text: "甲乙", tags: [] }], kana: [{ text: "あぬ", tags: [], appliesToKanji: ["*"] }], sense: [] }] };
  const kanjidic = { characters: [{ literal: "甲", readingMeaning: { groups: [{ readings: [{ type: "ja_kun", value: "あ" }] }] } }] };
  const result = compileAlignmentPipeline(jmdict, kanjidic).align("甲乙", "あぬ");
  assert.deepEqual(result.segments, [["甲乙", "あぬ"]]);
  assert.equal(result.status, "aligned");
});
