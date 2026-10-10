import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { algorithmVersion, digest, loadDataset, schemaVersion } from "../src/dataset.mjs";
import { recordKey } from "../src/segments.mjs";
import { evaluateDataset } from "./lib/evaluation.mjs";
import { parseGeneratorOptions } from "./lib/options.mjs";

const { output: outputDirectory, configuration } = parseGeneratorOptions("dist");
const dataset = await loadDataset(configuration);
const goldText = await readFile(new URL("../test/fixtures/gold.json", import.meta.url), "utf8");
const evaluation = await evaluateDataset(dataset, goldText);
console.log(JSON.stringify(evaluation.summary, undefined, 2));
if (evaluation.summary.passed !== evaluation.summary.examples) {
  for (const failure of evaluation.results.filter(result => !result.pass)) {
    console.error(`${failure.written}/${failure.reading}: expected ${JSON.stringify(failure.segments)}, got ${JSON.stringify(failure.actual)}`);
  }
  console.error("Regression evaluation failed; generated artifacts are not releasable");
  process.exitCode = 1;
}
const { provenance } = evaluation;
const entries = {};
const seen = new Set();
const counts = { entries: 0, pairs: 0, aligned: 0, ambiguous: 0, fallback: 0, reviewed: 0, literal: 0, grouped: 0, split: 0 };
for (const pair of dataset.pairs()) {
  const key = recordKey(pair.id, pair.written, pair.reading);
  if (seen.has(key)) continue;
  seen.add(key);
  const result = dataset.alignPair(pair);
  const record = {
    written: pair.written, reading: pair.reading, segments: result.segments, status: result.status,
    evidence: result.evidence?.map(part => part.type) ?? result.segments.map(() => "reviewed")
  };
  (entries[pair.id] ??= []).push(record);
  ++counts.pairs;
  if (!(result.status in counts)) throw new Error(`Unknown status: ${result.status}`);
  ++counts[result.status];
  if (result.segments.every(segment => typeof segment === "string")) ++counts.literal;
  else if (result.segments.length === 1) ++counts.grouped;
  else ++counts.split;
}
for (const key of dataset.annotations.keys()) {
  if (!seen.has(key)) throw new Error(`Stale annotation absent from source dictionary: ${key}`);
}
counts.entries = Object.keys(entries).length;
const metadata = {
  algorithmVersion,
  generatorSHA256: provenance.generatorSHA256,
  configuration,
  license: "CC-BY-SA-4.0",
  attribution: "Based on JMdict and KANJIDIC2, copyright EDRDG, with Unicode Unihan and reviewed Wiktionary and JmdictFurigana data. See NOTICE.",
  sources: dataset.lock,
  annotationsSHA256: dataset.annotationsSHA256,
  counts
};
const output = JSON.stringify({ schemaVersion, metadata, entries }) + "\n";
const compressed = gzipSync(output, { level: 9 });
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "evaluation.json"), JSON.stringify(evaluation, undefined, 2) + "\n");
await writeFile(join(outputDirectory, "precise-furigana.json"), output);
await writeFile(join(outputDirectory, "precise-furigana.json.gz"), compressed);
await writeFile(join(outputDirectory, "sources.lock.json"), JSON.stringify(dataset.lock, undefined, 2) + "\n");
const notice = await readFile(new URL("../NOTICE", import.meta.url));
await writeFile(join(outputDirectory, "NOTICE"), notice);
await writeFile(join(outputDirectory, "schema.json"), await readFile(new URL("../schema.json", import.meta.url)));
const manifest = { schemaVersion, algorithmVersion, counts, files: {} };
const files = ["precise-furigana.json", "precise-furigana.json.gz", "sources.lock.json", "NOTICE", "schema.json", "evaluation.json"];
for (const name of files) {
  const bytes = await readFile(join(outputDirectory, name));
  manifest.files[name] = { bytes: bytes.length, sha256: digest(bytes) };
}
await writeFile(join(outputDirectory, "manifest.json"), JSON.stringify(manifest, undefined, 2) + "\n");
console.log(JSON.stringify({ ...counts, bytes: Buffer.byteLength(output), gzipBytes: compressed.length }, undefined, 2));
