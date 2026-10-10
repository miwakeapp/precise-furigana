import test from "node:test";
import assert from "node:assert/strict";
import { extractCharacterReadings, makeCharacterReadingBundle, serializeCharacterReadingBundle } from "../scripts/lib/character-readings.mjs";

test("imports explicit on and kun readings while preserving source forms and tags", () => {
  const records = extractCharacterReadings({ lang_code: "ja", word: "魚", forms: [
    { form: "ぎょ", tags: ["transliteration", "kan-on"] },
    { form: "ナ", tags: ["transliteration", "kun"] }
  ] });
  assert.deepEqual(records, [
    { character: "魚", reading: "ギョ", kind: "on", originalForm: "ぎょ", tags: ["kan-on", "transliteration"] },
    { character: "魚", reading: "な", kind: "kun", originalForm: "ナ", tags: ["kun", "transliteration"] }
  ]);
});

test("withholds unknown types, historical forms, name readings, and okurigana derivations", () => {
  const forms = [
    { form: "しく", tags: ["transliteration", "ko-kun"] },
    { form: "ほ", tags: ["transliteration", "nanori"] },
    { form: "ほ-ぐ", tags: ["transliteration", "kun"] },
    { form: "ほ.ぐ", tags: ["transliteration", "kun"] },
    { form: "ほぐ", tags: ["transliteration"] },
    { form: "ほぐ", tags: ["transliteration", "kun", "on"] },
    { form: "ほぐ", tags: ["transliteration", "kun", "archaic"] }
  ];
  assert.deepEqual(extractCharacterReadings({ lang_code: "ja", word: "祝", forms }), []);
  assert.deepEqual(extractCharacterReadings({ lang_code: "zh", word: "祝", forms: [{ form: "シュク", tags: ["transliteration", "on"] }] }), []);
  assert.deepEqual(extractCharacterReadings({ lang_code: "ja", word: "言祝", forms: [{ form: "ことほぐ", tags: ["transliteration", "kun"] }] }), []);
});

test("deduplicates repeated entries deterministically without losing distinct source tags", () => {
  const first = extractCharacterReadings({ lang_code: "ja", word: "司", forms: [{ form: "シ", tags: ["transliteration", "go-on"] }] })[0];
  const second = { ...first, tags: ["kan-on", "transliteration"] };
  const forward = makeCharacterReadingBundle([first, second, first]);
  const reverse = makeCharacterReadingBundle([second, first]);
  assert.equal(forward.readings.length, 2);
  assert.equal(serializeCharacterReadingBundle(forward), serializeCharacterReadingBundle(reverse));
  assert.deepEqual(JSON.parse(serializeCharacterReadingBundle(forward)), forward);
});
