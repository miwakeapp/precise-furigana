import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { digest, loadDataset, schemaVersion } from "../src/dataset.mjs";
import { pairKey, recordKey, validateAlignment } from "../src/segments.mjs";
import { displaySegments } from "../src/display.mjs";
import { isMismatched, planSynthesizedPairs } from "../src/pairings.mjs";
import { databaseFiles, databaseVersion, writeDatabase } from "./lib/database-files.mjs";
import { evaluateDataset } from "./lib/evaluation.mjs";
import { parseGeneratorOptions } from "./lib/options.mjs";

const {
  output: outputDirectory,
  configuration,
  updateSynthesizedPairs,
} = parseGeneratorOptions("dist");
const synthesizedPairsURL = new URL("../data/synthesized-pairs.json", import.meta.url);
const dataset = await loadDataset(configuration);
const goldText = await readFile(new URL("../test/fixtures/gold.json", import.meta.url), "utf8");
const evaluation = await evaluateDataset(dataset, goldText);
console.log(JSON.stringify(evaluation.summary, undefined, 2));
if (evaluation.summary.passed !== evaluation.summary.examples) {
  for (const failure of evaluation.results.filter((result) => !result.pass)) {
    console.error(
      `${failure.spelling}/${failure.reading}: expected ${JSON.stringify(failure.segments)}, got ${JSON.stringify(failure.actual)}`,
    );
  }
  console.error("Regression evaluation failed; generated artifacts are not releasable");
  process.exitCode = 1;
}
const entries = {};
const seen = new Set();
const counts = { entries: 0, pairs: 0, synthesized: 0 };
const drops = dataset.omittedParticles?.drops ?? new Map();
const records = [];
for (const pair of dataset.pairs()) {
  const key = recordKey(pair.id, pair.spelling, pair.reading);
  if (seen.has(key)) continue;
  seen.add(key);
  const { segments } = dataset.alignPair(pair);
  const record = {
    spelling: pair.spelling,
    reading: pair.reading,
    segments: displaySegments(segments),
  };
  records.push({
    id: pair.id,
    spelling: pair.spelling,
    reading: pair.reading,
    segments,
    displaySegments: record.segments,
  });
  if (isMismatched(pair, drops.get(pairKey(pair.spelling, pair.reading)), record.segments))
    record.pairing = "mismatched";
  (entries[pair.id] ??= []).push(record);
  ++counts.pairs;
}

// Every spelling keeps at least one pair that fits its kana; where JMdict has none, the reviewed list supplies one.
const reviewed = existsSync(synthesizedPairsURL)
  ? JSON.parse(await readFile(synthesizedPairsURL, "utf8"))
  : [];
const jmdictPairs = new Set(
  records.map((record) => `${record.id}\t${record.spelling}\t${record.reading}`),
);
const plan = planSynthesizedPairs(records, drops, reviewed, jmdictPairs);
if (updateSynthesizedPairs) {
  // Keep every listed entry, even one with a problem, unless it is obsolete; problems are fixed by hand.
  const kept = reviewed.filter((item) => !plan.obsolete.includes(item));
  const next = [...kept, ...plan.missing].sort(
    (left, right) => left.id.localeCompare(right.id) || left.spelling.localeCompare(right.spelling),
  );
  await writeFile(synthesizedPairsURL, JSON.stringify(next, undefined, 2) + "\n");
  console.log(
    `Wrote ${next.length} synthesized pairs, ${plan.missing.length} of them new and unreviewed`,
  );
} else if (plan.problems.length) {
  for (const problem of plan.problems) console.error(problem);
  console.error(
    "Synthesized pairs need review; run the build with --update-synthesized-pairs to add missing ones",
  );
  process.exitCode = 1;
}
for (const item of plan.pairs) {
  const { segments } = dataset.alignPair(item);
  validateAlignment(item.spelling, item.reading, segments);
  const key = recordKey(item.id, item.spelling, item.reading);
  if (seen.has(key)) throw new Error(`Synthesized pair duplicates an existing record: ${key}`);
  seen.add(key);
  (entries[item.id] ??= []).push({
    spelling: item.spelling,
    reading: item.reading,
    segments: displaySegments(segments),
    pairing: "synthesized",
  });
  ++counts.synthesized;
}
for (const key of dataset.annotations.keys()) {
  if (!seen.has(key)) throw new Error(`Stale annotation absent from source dictionary: ${key}`);
}
counts.entries = Object.keys(entries).length;
const jmdictDate = dataset.lock.sources.jmdict.dictDate;
// A release stamps its own revision over this development version.
const version = databaseVersion(jmdictDate);
await mkdir(outputDirectory, { recursive: true });
const files = await writeDatabase(outputDirectory, {
  version,
  schemaVersion,
  jmdictDate,
  license: "CC-BY-SA-4.0",
  attribution:
    "Based on JMdict and KANJIDIC2, copyright EDRDG, with Unicode Unihan and reviewed Wiktionary and JmdictFurigana data. See NOTICE in the source repository.",
  entries,
});
const evaluationBytes = Buffer.from(JSON.stringify(evaluation, undefined, 2) + "\n");
await writeFile(join(outputDirectory, "evaluation.json"), evaluationBytes);
files["evaluation.json"] = { bytes: evaluationBytes.length, sha256: digest(evaluationBytes) };
const manifest = { version, schemaVersion, counts, files };
await writeFile(
  join(outputDirectory, "manifest.json"),
  JSON.stringify(manifest, undefined, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      ...counts,
      bytes: files[databaseFiles[0]].bytes,
      gzipBytes: files[databaseFiles[1]].bytes,
    },
    undefined,
    2,
  ),
);
