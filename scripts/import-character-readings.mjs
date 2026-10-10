import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { extractCharacterReadings, japaneseWiktionarySource, makeCharacterReadingBundle, serializeCharacterReadingBundle } from "./lib/character-readings.mjs";

const { values } = parseArgs({ options: {
  input: { type: "string" },
  output: { type: "string", default: "data/character-readings.json" },
  check: { type: "boolean", default: false }
} });
if (!values.input) throw new Error("Usage: node scripts/import-character-readings.mjs --input <pinned-ja-extract.jsonl.gz> [--output <bundle.json>] [--check]");

const input = await readFile(values.input);
const checksum = createHash("sha256").update(input).digest("hex");
if (input.length !== japaneseWiktionarySource.bytes || checksum !== japaneseWiktionarySource.sha256) {
  throw new Error("Japanese Wiktionary source checksum mismatch. This manual importer requires the pinned raw archive; review a new snapshot before changing its provenance.");
}

const records = [];
const source = createReadStream(values.input);
const gzip = createGunzip();
source.on("error", error => gzip.destroy(error));
const lines = createInterface({ input: source.pipe(gzip), crlfDelay: Infinity });
let lineNumber = 0;
for await (const line of lines) {
  ++lineNumber;
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid source JSON at line ${lineNumber}`, { cause: error });
  }
  records.push(...extractCharacterReadings(entry));
}
const bundle = makeCharacterReadingBundle(records);
const output = serializeCharacterReadingBundle(bundle);
if (values.check) {
  if (await readFile(values.output, "utf8") !== output) throw new Error("The character-reading bundle differs from the pinned extraction");
} else {
  await writeFile(values.output, output);
}
console.log(JSON.stringify({ file: values.output, readings: bundle.readings.length, characters: new Set(bundle.readings.map(reading => reading.character)).size, bytes: Buffer.byteLength(output), sha256: createHash("sha256").update(output).digest("hex"), checked: values.check }));
