import test from "node:test";
import assert from "node:assert/strict";
import {
  characterReadingKey, englishWiktionaryInputs, extractEnglishCharacterReadings,
  makeEnglishCharacterReadingBundle, makeExistingCharacterReadingKeys,
  serializeEnglishCharacterReadingBundle, verifyEnglishWiktionaryInput
} from "../scripts/lib/english-character-readings.mjs";

function page(character, content) {
  return { title: character, retrievedAt: "2026-10-09T00:00:00Z", revisions: [{
    revid: 123, timestamp: "2026-10-01T00:00:00Z", slots: { main: { content } }
  }] };
}

test("English templates preserve complete readings and documented character prefixes", () => {
  const records = extractEnglishCharacterReadings(page("光", "==Japanese==\n{{ja-readings|goon=こう<くわう|kun=ひかり-, ひか-る}}"));
  assert.deepEqual(records.map(record => [record.reading, record.kind, record.originalForm]), [
    ["コウ", "on", "こう"], ["ひかり", "kun", "ひかり"], ["ひか", "kun", "ひか"]
  ]);
  assert.deepEqual(records[0].historicalForms, ["くわう"]);
  assert.equal(records[0].rawSourceForm, "こう<くわう");
  assert.equal(records[2].rawSourceForm, "ひか-る");
  assert.equal(records[2].sourceSuffix, "る");
  assert.equal(records[2].boundaryStatus, "explicit-character-prefix");
  assert.equal(records[2].revisionURL, "https://en.wiktionary.org/w/index.php?oldid=123");
  assert.equal(records[2].sourceParameter, "kun");
});

test("a marked lexical suffix never becomes an inferred reading or inflection", () => {
  const records = extractEnglishCharacterReadings(page("三", "==Japanese==\n{{ja-readings|kun=しゃ-みせん}}"));
  assert.equal(records.length, 1);
  assert.equal(records[0].reading, "しゃ");
  assert.equal(records[0].sourceSuffix, "みせん");
});

test("English extraction rejects unsupported current and historical syntax", () => {
  const records = extractEnglishCharacterReadings(page("光", "==Japanese==\n{{ja-readings|goon=こう<くわう、かく<くわく, こう<, こ.う, [[こう]], こう<くわ.う|kun=ひかり, -る, ひか-る-な, ひ.か-る|nanori=あきら}}"));
  assert.deepEqual(records, []);
});

test("English extraction confines templates to rendered Japanese language content", () => {
  const records = extractEnglishCharacterReadings(page("光", `==Chinese==
{{ja-readings|on=こう}}
==Japanese==
<!-- {{ja-readings|on=か}} -->
<nowiki>{{ja-readings|on=き}}</nowiki>
<pre>{{ja-readings|on=く}}</pre>
{{wrapper|{{ja-readings|on=け}}}}
{{ja-<nowiki/>readings|on=こ}}
{{ja-readings|on=こう}}
==Korean==
{{ja-readings|on=さ}}
`));
  assert.deepEqual(records.map(record => record.reading), ["コウ"]);
  assert.deepEqual(extractEnglishCharacterReadings(page("光", "==Japanese==\n<!-- {{ja-readings|on=こう}}")), []);
  assert.deepEqual(extractEnglishCharacterReadings(page("光", "==Japanese==\n<nowiki>{{ja-readings|on=こう}}")), []);
});

test("ambiguous template identity and duplicate parameters are withheld", () => {
  for (const content of [
    "{{ja-readings|on=こう|on=か}}", "{{ja-readings|pagename=魚|on=こう}}",
    "{{ja-readings|on={{l|ja|こう}}}}", "{{ja-readings|on=こう"
  ]) assert.deepEqual(extractEnglishCharacterReadings(page("光", "==Japanese==\n" + content)), []);
  assert.deepEqual(extractEnglishCharacterReadings(page("光明", "==Japanese==\n{{ja-readings|on=こうめい}}")), []);
});

test("incremental inventory exclusions include marked KANJIDIC forms without promoting them", () => {
  const inputs = {
    kanjidic: { characters: [{ literal: "光", readingMeaning: {
      groups: [{ readings: [{ type: "ja_kun", value: "ひか.る" }, { type: "ja_on", value: "コウ" }, { type: "pinyin", value: "guang1" }] }], nanori: ["あきら"]
    } }] },
    unihanText: "# source\nU+5149\tkJapanese\tひかり\nU+5149\tkJapaneseOn\tKOU\n",
    japaneseBundle: { readings: [{ character: "光", reading: "ヒカル" }] }
  };
  const before = structuredClone(inputs);
  const keys = makeExistingCharacterReadingKeys(inputs);
  assert.deepEqual(inputs, before);
  for (const reading of ["ひか", "ひかる", "こう", "あきら", "ひかり"]) assert.ok(keys.has(characterReadingKey("光", reading)));
  assert.equal(keys.has(characterReadingKey("光", "guang1")), false);
  assert.equal(keys.has(characterReadingKey("光", "KOU")), false);
  const records = extractEnglishCharacterReadings(page("光", "==Japanese==\n{{ja-readings|on=こう, こ|kun=ひか-る}}"));
  assert.deepEqual(makeEnglishCharacterReadingBundle(records, keys).readings.map(record => record.reading), ["コ"]);
});

test("complete evidence suppresses duplicate prefix evidence without dropping context", () => {
  const first = extractEnglishCharacterReadings(page("光", "==Japanese==\n{{ja-readings|on=こう|kun=ひか-る, ひか-}}"));
  const second = extractEnglishCharacterReadings(page("光", "==Japanese==\n{{ja-readings|on=こう}}"));
  const forward = makeEnglishCharacterReadingBundle([...first, ...second, ...first], new Set());
  const reverse = makeEnglishCharacterReadingBundle([...second, ...first].reverse(), new Set());
  assert.equal(forward.readings.length, 2);
  assert.equal(forward.readings.find(record => record.reading === "ひか").boundaryStatus, "explicit-complete-reading");
  assert.equal(forward.readings.find(record => record.reading === "コウ").sourceTemplates.length, 2);
  assert.equal(serializeEnglishCharacterReadingBundle(forward), serializeEnglishCharacterReadingBundle(reverse));
  assert.deepEqual(JSON.parse(serializeEnglishCharacterReadingBundle(forward)), forward);
  assert.throws(() => makeEnglishCharacterReadingBundle(first), /supplied explicitly/);
});

test("pinned importer inputs reject corruption and unknown inventory identities", () => {
  assert.throws(() => verifyEnglishWiktionaryInput("rawPages", Buffer.from("changed source")), /checksum mismatch/);
  assert.throws(() => verifyEnglishWiktionaryInput("unknown", Buffer.alloc(0)), /Unknown/);
  assert.equal(englishWiktionaryInputs.rawPages.sha256, "168070d2cfa2da11bed52773cef17bb6fcc71e2d713d845cdeb811b083dc0d1a");
});
