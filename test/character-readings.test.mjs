import assert from "node:assert/strict";
import test from "node:test";
import { deriveCharacterBundleAlignments } from "../src/character-readings.mjs";
import { boundaries } from "../src/segments.mjs";

const source = { name: "Japanese Wiktionary fixture", version: "fixture-1", sha256: "a".repeat(64) };
const bundle = readings => ({ schemaVersion: 1, source, readings });
const form = (character, reading, kind = "on", originalForm = reading) => ({ character, reading, kind, originalForm, tags: [kind, "transliteration"] });
const grouped = (spelling, reading) => ({ status: "aligned", segments: [[spelling, reading]] });
const entry = (id, spelling, reading, tags = []) => ({ id, kanji: [{ text: spelling, tags: [] }], kana: [{ text: reading, tags, appliesToKanji: ["*"] }] });

test("exact bundle readings preserve input script and carry Wiktionary form provenance", () => {
  const jmdict = { words: [entry("1", "余所", "ヨソ")] };
  const original = form("所", "ソ", "on", "そ");
  const result = deriveCharacterBundleAlignments(jmdict, new Map([["余", ["ヨ"]], ["所", ["ショ"]]]), bundle([original]), grouped);
  assert.deepEqual(result.wordAlignments.get("余所").get("ヨソ"), [["余", "ヨ"], ["所", "ソ"]]);
  assert.deepEqual(result.witnesses[0].characters, [{
    character: "所", spelling: "所", reading: "ソ", codepoint: "U+6240",
    source: "Japanese Wiktionary", sourceName: source.name, sourceVersion: source.version, sourceSHA256: source.sha256,
    field: "forms", title: "所", forms: [{ originalForm: "そ", reading: "ソ", kind: "on", tags: ["on", "transliteration"] }]
  }]);
  assert.equal(JSON.stringify(result.witnesses).includes("kJapanese"), false);
});

test("English source prefixes retain their complete raw parameter and revision provenance", () => {
  const jmdict = { words: [entry("1", "言祝", "ことほ")] };
  const original = {
    ...form("祝", "ほ", "kun"), rawSourceForm: "ほ-ぐ", sourceParameter: "kun",
    sourcePageURL: "https://en.wiktionary.org/wiki/祝#Japanese",
    revisionURL: "https://en.wiktionary.org/w/index.php?oldid=123", revisionId: 123,
    revisionTimestamp: "2026-10-01T00:00:00Z", boundaryStatus: "explicit-prefix",
    currentForm: "ほ-ぐ", sourceSuffix: "ぐ", historicalForms: [], sourceTemplates: ["{{ja-readings|kun=ほ-ぐ}}"]
  };
  const records = { ...bundle([original]), source: { ...source, publisher: "English Wiktionary", field: "ja-readings" } };
  const result = deriveCharacterBundleAlignments(jmdict, new Map([["言", ["こと"]]]), records, grouped);
  assert.deepEqual(result.wordAlignments.get("言祝").get("ことほ"), [["言", "こと"], ["祝", "ほ"]]);
  const witness = result.witnesses[0].characters[0];
  assert.equal(witness.source, "English Wiktionary");
  assert.equal(witness.field, "ja-readings");
  assert.equal(witness.forms[0].originalForm, "ほ");
  assert.equal(witness.forms[0].rawSourceForm, "ほ-ぐ");
  assert.equal(witness.forms[0].revisionId, 123);
  assert.equal(witness.forms[0].currentForm, original.currentForm);
  assert.equal(witness.forms[0].sourceSuffix, "ぐ");
  assert.deepEqual(witness.forms[0].sourceTemplates, original.sourceTemplates);
  assert.deepEqual(witness.forms[0].historicalForms, []);
  for (const field of ["publisher", "field"]) {
    assert.throws(() => deriveCharacterBundleAlignments(jmdict, new Map(), {
      ...records, source: { ...records.source, [field]: null }
    }, grouped), /nonempty strings/u);
  }
});

test("exact Unihan and weak readings can assist only a genuinely new bundle reading", () => {
  const jmdict = { words: [entry("1", "甲乙丙丁", "あかきく")] };
  const primary = new Map([["甲", ["ア"]]]);
  const unihanReadings = new Map([["乙", ["カ"]]]);
  const weakCharacterReadings = new Map([["丙", ["き"]]]);
  const records = bundle([form("乙", "カ"), form("丙", "キ"), form("丁", "ク")]);
  const result = deriveCharacterBundleAlignments(jmdict, primary, records, grouped, { unihanReadings, weakCharacterReadings });
  assert.deepEqual(result.wordAlignments.get("甲乙丙丁").get("あかきく"), [["甲", "あ"], ["乙", "か"], ["丙", "き"], ["丁", "く"]]);
  assert.deepEqual(result.witnesses[0].characters.map(record => record.character), ["丁"]);
  assert.equal(deriveCharacterBundleAlignments(jmdict, primary, records, grouped, {
    unihanReadings: new Map([...unihanReadings, ["丁", ["ク"]]]), weakCharacterReadings
  }).wordAlignments.size, 0);
  assert.deepEqual([...unihanReadings], [["乙", ["カ"]]]);
});

test("bundle readings cannot move complete baseline boundaries or choose an ambiguous allocation", () => {
  const jmdict = { words: [entry("1", "前余所", "ぜんよそ"), entry("2", "甲乙", "あいき")] };
  const primary = new Map([["前", ["ゼン"]], ["余", ["ヨ"]], ["甲", ["あい"]], ["乙", ["き"]]]);
  const records = bundle([form("所", "ソ"), form("甲", "あ", "kun"), form("乙", "いき", "kun")]);
  const align = (spelling, reading) => spelling === "前余所" ? { status: "aligned", segments: [["前", "ぜん"], ["余所", "よそ"]] } : grouped(spelling, reading);
  const result = deriveCharacterBundleAlignments(jmdict, primary, records, align);
  const segments = result.wordAlignments.get("前余所").get("ぜんよそ");
  assert.deepEqual(segments, [["前", "ぜん"], ["余", "よ"], ["所", "そ"]]);
  assert.ok(boundaries(segments).includes("1:2"));
  assert.equal(result.wordAlignments.has("甲乙"), false);
});

test("irregular word ranges block both new bundle readings and supplemental companions", () => {
  const jmdict = { words: [entry("1", "明日", "あす", ["gikun"]), entry("2", "甲明日", "こうあす")] };
  const primary = new Map([["甲", ["カ"]]]);
  const records = bundle([form("甲", "コウ"), form("明", "あ", "kun")]);
  const unihanReadings = new Map([["日", ["す"]]]);
  assert.equal(deriveCharacterBundleAlignments(jmdict, primary, records, grouped, { unihanReadings }).wordAlignments.size, 0);
});

test("listed sokuon-final bundle readings require a following voiceless obstruent", () => {
  const jmdict = { words: [
    entry("1", "甲子", "かっし"), entry("2", "甲亜", "かっあ"), entry("3", "甲名", "かっな"),
    entry("4", "乙甲", "おつかっ"), entry("5", "乙甲子", "おつかっし")
  ] };
  const primary = new Map([["子", ["シ"]], ["亜", ["ア"]], ["名", ["ナ"]], ["乙", ["オツ"]]]);
  const records = bundle([form("甲", "カッ")]);
  const align = (spelling, reading) => spelling === "乙甲子" ? { status: "aligned", segments: [["乙甲", "おつかっ"], ["子", "し"]] } : grouped(spelling, reading);
  const result = deriveCharacterBundleAlignments(jmdict, primary, records, align);
  assert.deepEqual(result.wordAlignments.get("甲子").get("かっし"), [["甲", "かっ"], ["子", "し"]]);
  assert.deepEqual(result.wordAlignments.get("乙甲子").get("おつかっし"), [["乙", "おつ"], ["甲", "かっ"], ["子", "し"]]);
  for (const spelling of ["甲亜", "甲名", "乙甲"]) assert.equal(result.wordAlignments.has(spelling), false);
});

test("plain kun forms remain exact without shortening, inflection, or voicing guesses", () => {
  const jmdict = { words: [entry("1", "真魚", "まな"), entry("2", "甲乙", "がき"), entry("3", "丙乙", "あつめき")] };
  const primary = new Map([["真", ["ま"]], ["乙", ["キ"]]]);
  const records = bundle([form("魚", "な", "kun", "ナ"), form("甲", "カ"), form("丙", "あつめる", "kun")]);
  const result = deriveCharacterBundleAlignments(jmdict, primary, records, grouped);
  assert.deepEqual(result.wordAlignments.get("真魚").get("まな"), [["真", "ま"], ["魚", "な"]]);
  assert.equal(result.wordAlignments.has("甲乙"), false);
  assert.equal(result.wordAlignments.has("丙乙"), false);
});

test("malformed, untyped, historical, or marked source forms fail explicitly", () => {
  const invalid = [
    { ...form("甲", "カ"), kind: "name" },
    { ...form("甲", "カ"), tags: ["transliteration"] },
    { ...form("甲", "カ"), tags: ["on", "kun", "transliteration"] },
    { ...form("甲", "カ"), tags: ["on", "archaic", "transliteration"] },
    form("甲乙", "カ"), form("々", "カ"), form("甲", "カ", "kun"),
    form("甲", "か.り", "kun"), form("甲", "かり", "kun", "か.り"),
    form("甲", "かり", "kun", "か-り"), form("甲", "カ", "on", "キ")
  ];
  for (const record of invalid) assert.throws(() => deriveCharacterBundleAlignments({ words: [] }, new Map(), bundle([record]), grouped), TypeError);
  assert.throws(() => deriveCharacterBundleAlignments({ words: [] }, new Map(), { ...bundle([]), schemaVersion: 2 }, grouped), /schema/u);
  assert.throws(() => deriveCharacterBundleAlignments({ words: [] }, new Map(), { ...bundle([]), source: { ...source, sha256: "unverified" } }, grouped), /SHA256/u);
});
