import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { compareReferenceRecord, parseReferenceLine, referenceKey } from "../src/reference.mjs";

const [datasetPath = "dist/precise-furigana.json", referencePath = ".cache/reference/furigana.txt", outputPath = "dist/reference-differences.jsonl"] = process.argv.slice(2);
const datasetBytes = await readFile(datasetPath);
const dataset = JSON.parse(datasetBytes.toString("utf8"));
const ids = new Set(Object.keys(dataset.entries));
const index = new Map();
const referenceIds = new Set();
const summary = {
  notice: "Reference agreement is not an accuracy measurement. Reference omissions and known defects are expected.",
  datasetSHA256: createHash("sha256").update(datasetBytes).digest("hex"),
  generatorSHA256: dataset.metadata?.generatorSHA256 ?? null,
  source: dataset.metadata?.sources ?? dataset.source ?? dataset.sources ?? null,
  referenceGeneratedAt: null,
  referenceRows: 0,
  ignoredReferenceRows: 0,
  referenceRowsWithinBuild: 0,
  normalizedReferenceCollisions: 0,
  records: 0,
  counts: { exact: 0, finer: 0, coarser: 0, incompatible: 0, uncomparable: 0, absent: 0 },
  absence: { missingID: 0, missingPair: 0 },
  byStatus: {},
  normalization: {},
  samples: {}
};
const referenceHash = createHash("sha256");
const referenceStream = createReadStream(referencePath);
referenceStream.on("data", chunk => referenceHash.update(chunk));
const lines = createInterface({ input: referenceStream, crlfDelay: Infinity });
let lineNumber = 0;
for await (const line of lines) {
  lineNumber++;
  if (line.startsWith("# Generated: ")) summary.referenceGeneratedAt = line.slice("# Generated: ".length);
  let reference;
  try {
    reference = parseReferenceLine(line);
  } catch (error) {
    throw new Error(`Invalid reference line ${lineNumber}: ${error.message}`, { cause: error });
  }
  if (!reference) continue;
  summary.referenceRows++;
  if (!ids.has(reference.id)) {
    summary.ignoredReferenceRows++;
    continue;
  }
  summary.referenceRowsWithinBuild++;
  referenceIds.add(reference.id);
  const key = referenceKey(reference.id, reference.written, reference.reading);
  const matches = index.get(key);
  if (matches) {
    matches.push(reference);
    summary.normalizedReferenceCollisions++;
  } else {
    index.set(key, [reference]);
  }
}
summary.referenceSHA256 = referenceHash.digest("hex");

await mkdir(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { encoding: "utf8" });
const outputDone = once(output, "finish");
const matchedKeys = new Set();
const sampleLimit = 5;
const sampleCandidates = new Map();
for (const id of Object.keys(dataset.entries).sort()) {
  const records = [...dataset.entries[id]].sort((left, right) => {
    const leftKey = referenceKey(id, left.written, left.reading);
    const rightKey = referenceKey(id, right.written, right.reading);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (const record of records) {
    summary.records++;
    const key = referenceKey(id, record.written, record.reading);
    const matches = index.get(key);
    let result;
    if (matches) {
      matchedKeys.add(key);
      result = compareReferenceRecord(record, matches);
    } else {
      const reason = referenceIds.has(id) ? "missingPair" : "missingID";
      summary.absence[reason]++;
      result = { category: "absent", reason, flags: [] };
    }
    summary.counts[result.category]++;
    const status = record.status ?? "unspecified";
    summary.byStatus[status] ??= {};
    summary.byStatus[status][result.category] = (summary.byStatus[status][result.category] ?? 0) + 1;
    for (const flag of result.flags) summary.normalization[flag] = (summary.normalization[flag] ?? 0) + 1;
    if (result.category === "exact") continue;
    const difference = {
      id,
      written: record.written,
      reading: record.reading,
      status,
      ...result,
      actual: record.segments,
      reference: matches?.map(reference => reference.segments) ?? []
    };
    if (!output.write(`${JSON.stringify(difference)}\n`)) await once(output, "drain");
    const rank = createHash("sha256").update(key).digest("hex");
    const candidates = sampleCandidates.get(result.category) ?? [];
    candidates.push({ rank, difference });
    candidates.sort((left, right) => left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0);
    if (candidates.length > sampleLimit) candidates.pop();
    sampleCandidates.set(result.category, candidates);
  }
}
output.end();
await outputDone;
summary.referencePairsAbsentFromBuild = index.size - matchedKeys.size;
for (const category of Object.keys(summary.counts)) {
  if (sampleCandidates.has(category)) summary.samples[category] = sampleCandidates.get(category).map(candidate => candidate.difference);
}
const summaryPath = outputPath.replace(/(?:\.jsonl)?$/u, ".summary.json");
await writeFile(summaryPath, `${JSON.stringify(summary, undefined, 2)}\n`);
console.log(JSON.stringify({ records: summary.records, counts: summary.counts, outputPath, summaryPath }, undefined, 2));
