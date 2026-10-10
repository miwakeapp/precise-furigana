import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  characterReadingKey, extractEnglishCharacterReadings, makeEnglishCharacterReadingBundle,
  makeExistingCharacterReadingKeys, serializeEnglishCharacterReadingBundle, verifyEnglishWiktionaryInput
} from "./lib/english-character-readings.mjs";

const { values } = parseArgs({ options: {
  input: { type: "string" }, frame: { type: "string" }, kanjidic: { type: "string" },
  unihan: { type: "string" }, "japanese-bundle": { type: "string" }, output: { type: "string" },
  check: { type: "boolean", default: false }
} });
if (["input", "frame", "kanjidic", "unihan", "japanese-bundle", "output"].some(name => !values[name])) {
  throw new Error("Usage: node scripts/import-english-character-readings.mjs --input PAGES.jsonl --frame FRAME.json --kanjidic KANJIDIC.json --unihan READINGS.txt --japanese-bundle BUNDLE.json --output OUTPUT.json [--check]");
}
const inputs = {};
for (const [name, option] of [["rawPages", "input"], ["characterFrame", "frame"], ["kanjidic", "kanjidic"], ["unihan", "unihan"], ["japaneseBundle", "japanese-bundle"]]) {
  const bytes = await readFile(values[option]);
  verifyEnglishWiktionaryInput(name, bytes);
  inputs[name] = bytes.toString();
}
const frame = JSON.parse(inputs.characterFrame);
const characters = new Set(frame.characters);
if (characters.size !== frame.selectedCharacters || characters.size !== 6017) throw new Error("Invalid frozen character frame");
const seen = new Set();
const records = [];
let sourceLine = 0;
for (const line of inputs.rawPages.split("\n")) {
  ++sourceLine;
  if (!line.trim()) continue;
  let page;
  try { page = JSON.parse(line); }
  catch (error) { throw new Error(`Invalid source JSON at line ${sourceLine}`, { cause: error }); }
  if (!characters.has(page.title)) continue;
  if (seen.has(page.title)) throw new Error(`Duplicate selected character page ${page.title}`);
  seen.add(page.title);
  records.push(...extractEnglishCharacterReadings(page, { sourceLine }));
}
if (seen.size !== characters.size) throw new Error("The raw pages do not cover the complete frozen frame");
const existingReadings = makeExistingCharacterReadingKeys({
  kanjidic: JSON.parse(inputs.kanjidic), unihanText: inputs.unihan,
  japaneseBundle: JSON.parse(inputs.japaneseBundle)
});
const bundle = makeEnglishCharacterReadingBundle(records, existingReadings);
const output = serializeEnglishCharacterReadingBundle(bundle);
if (values.check) {
  if (await readFile(values.output, "utf8") !== output) throw new Error("The English character-reading bundle differs from the pinned extraction");
} else {
  await writeFile(values.output, output);
}
console.log(JSON.stringify({
  file: values.output, pages: seen.size, records: bundle.readings.length,
  uniqueReadings: new Set(bundle.readings.map(record => characterReadingKey(record.character, record.reading))).size,
  characters: new Set(bundle.readings.map(record => record.character)).size,
  bytes: Buffer.byteLength(output), sha256: createHash("sha256").update(output).digest("hex"), checked: values.check
}));
