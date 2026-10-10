import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { alignmentPoints, compareScores, locateTarget, scoreTarget } from "./lib/audit.mjs";
import { canonicalizeSegments, normalizeKana, parseReferenceLine, referenceKey } from "../src/reference.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    audit: { type: "string", default: ".cache/holdout-v1" },
    baseline: { type: "string", default: ".cache/experiments/superiority-base/precise-furigana.json" },
    reference: { type: "string", default: ".cache/reference/furigana.txt" },
    output: { type: "string", default: ".cache/holdout-v1/evaluation" }
  }
});
if (positionals.length !== 1) throw new Error("Usage: node scripts/evaluate-holdout.mjs FROZEN-DATASET.json [--audit DIRECTORY] [--output DIRECTORY]");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const lines = bytes => bytes.toString().trim().split("\n").filter(Boolean).map(JSON.parse);
const readJSON = async path => JSON.parse(await readFile(path, "utf8"));
const freeze = await readJSON(join(values.audit, "adjudication.frozen.json"));
const labelBytes = await readFile(join(values.audit, "labels.jsonl"));
if (hash(labelBytes) !== freeze.labelSHA256) throw new Error("Labels differ from frozen adjudication checkpoint");
const labels = new Map(lines(labelBytes).map(row => [row.auditId, row]));
const packet = lines(await readFile(join(values.audit, "blind-packet.jsonl")));
const manifest = new Map((await readJSON(join(values.audit, "manifest.sealed.json"))).map(row => [row.auditId, row]));
const selection = await readJSON(join(values.audit, "summary.json"));
const excluded = new Set((await readJSON(join(values.audit, "preexposure-exclusions.json"))).map(row => row.auditId));
const baselineBytes = await readFile(values.baseline);
if (hash(baselineBytes) !== selection.datasetSHA256) throw new Error("Baseline differs from the frozen selection baseline");
const candidateBytes = await readFile(positionals[0]);
const baseline = JSON.parse(baselineBytes);
const candidate = JSON.parse(candidateBytes);
const wanted = new Set(packet.map(row => referenceKey(row.context.id, row.context.written, row.context.reading)));
const references = new Map();
const referenceHash = createHash("sha256");
const referenceInput = createReadStream(values.reference);
referenceInput.on("data", chunk => referenceHash.update(chunk));
for await (const line of createInterface({ input: referenceInput, crlfDelay: Infinity })) {
  const row = parseReferenceLine(line);
  if (!row) continue;
  const key = referenceKey(row.id, row.written, row.reading);
  if (wanted.has(key)) {
    const matches = references.get(key) ?? [];
    matches.push(row);
    references.set(key, matches);
  }
}

function record(database, context) {
  const matches = (database.entries[context.id] ?? []).filter(row => row.written === context.written && normalizeKana(row.reading) === normalizeKana(context.reading));
  const signatures = new Set(matches.map(row => JSON.stringify(alignmentPoints(row.segments))));
  return signatures.size === 1 ? matches[0] : undefined;
}

function referenceRecord(context) {
  const matches = (references.get(referenceKey(context.id, context.written, context.reading)) ?? [])
    .map(row => canonicalizeSegments(row.segments, { reference: true }));
  if (!matches.length) return { reason: "absent" };
  if (matches.some(row => !row.comparable)) return { reason: "ambiguous-empty-base" };
  const signatures = new Set(matches.map(row => JSON.stringify(alignmentPoints(row.segments))));
  if (signatures.size !== 1) return { reason: "multiple-reference-alignments" };
  return matches[0];
}

const results = [];
for (const row of packet) {
  const label = labels.get(row.auditId);
  if (!label) throw new Error(`Missing label ${row.auditId}`);
  const result = { auditId: row.auditId, entryId: row.context.id, written: row.written, reading: row.reading, confidence: label.confidence, stratum: manifest.get(row.auditId).stratum };
  if (excluded.has(row.auditId)) { results.push({ ...result, excluded: "prior-exposure" }); continue; }
  if (!label.accepted?.length) { results.push({ ...result, excluded: "unresolved-label" }); continue; }
  const old = record(baseline, row.context);
  if (!old) throw new Error(`Missing or ambiguous baseline record ${row.auditId}`);
  const origins = locateTarget(row, old.segments);
  if (origins.length !== 1) { results.push({ ...result, excluded: "ambiguous-target-location", locations: origins.length }); continue; }
  const current = record(candidate, row.context);
  const reference = referenceRecord(row.context);
  const score = segments => scoreTarget(segments, origins[0], row.written, label.accepted);
  result.baseline = score(old.segments);
  result.generator = current ? score(current.segments) : { status: "uncomparable-record" };
  result.reference = reference.segments ? score(reference.segments) : { status: "uncomparable-reference", reason: reference.reason };
  result.generatorVersusReference = compareScores(result.generator, result.reference);
  result.generatorVersusBaseline = compareScores(result.generator, result.baseline);
  results.push(result);
}

function counts(rows) {
  const result = { families: rows.length, entries: new Set(rows.map(row => row.entryId)).size, exclusions: {}, systems: {}, generatorVersusReference: {}, generatorVersusBaseline: {} };
  for (const row of rows) {
    if (row.excluded) {
      result.exclusions[row.excluded] = (result.exclusions[row.excluded] ?? 0) + 1;
      continue;
    }
    for (const name of ["generator", "reference", "baseline"]) {
      const score = row[name];
      const system = result.systems[name] ??= { statuses: {}, unsupportedBoundaries: 0, missedBoundaries: 0 };
      system.statuses[score.status] = (system.statuses[score.status] ?? 0) + 1;
      system.unsupportedBoundaries += score.unsupported?.length ?? 0;
      system.missedBoundaries += score.missed?.length ?? 0;
    }
    for (const name of ["generatorVersusReference", "generatorVersusBaseline"]) result[name][row[name]] = (result[name][row[name]] ?? 0) + 1;
  }
  return result;
}

function entryComparisons(rows, comparison) {
  const entries = new Map();
  for (const row of rows) if (!row.excluded && row[comparison] !== "unscored") {
    const values = entries.get(row.entryId) ?? new Set();
    values.add(row[comparison]);
    entries.set(row.entryId, values);
  }
  const result = {};
  for (const values of entries.values()) {
    const outcome = values.size === 1 && values.has("tied") ? "tied" :
      [...values].every(value => ["left-dominates", "tied"].includes(value)) ? "generator-dominates" :
      [...values].every(value => ["right-dominates", "tied"].includes(value)) ? "comparator-dominates" : "mixed-or-tradeoff";
    result[outcome] = (result[outcome] ?? 0) + 1;
  }
  return result;
}

const summary = {
  notice: "AI-adjudicated, deliberately stratified diagnostic holdout; not a corpus accuracy estimate. Unsupported means unsupported by the frozen accepted labels, not independently proven linguistic error. Entry aggregation reduces repeated-entry dependence but does not remove every related-family dependency.",
  datasetSHA256: hash(candidateBytes), baselineSHA256: hash(baselineBytes), referenceSHA256: referenceHash.digest("hex"), labelSHA256: hash(labelBytes),
  all: counts(results),
  highConfidence: counts(results.filter(row => row.confidence === "high")),
  byStratum: Object.fromEntries([...new Set(results.map(row => row.stratum))].map(stratum => [stratum, counts(results.filter(row => row.stratum === stratum))])),
  byConfidence: Object.fromEntries([...new Set(results.map(row => row.confidence))].map(confidence => [confidence, counts(results.filter(row => row.confidence === confidence))])),
  entryComparisons: {
    reference: entryComparisons(results, "generatorVersusReference"),
    baseline: entryComparisons(results, "generatorVersusBaseline"),
    highConfidenceReference: entryComparisons(results.filter(row => row.confidence === "high"), "generatorVersusReference")
  }
};
await mkdir(values.output, { recursive: true });
await writeFile(join(values.output, "cases.jsonl"), results.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeFile(join(values.output, "summary.json"), JSON.stringify(summary, undefined, 2) + "\n");
console.log(JSON.stringify({ datasetSHA256: summary.datasetSHA256, all: summary.all, highConfidence: summary.highConfidence, entryComparisons: summary.entryComparisons }, undefined, 2));
