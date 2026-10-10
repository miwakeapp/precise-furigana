import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildPairedFrame, pairedAuditQuotas, pairedAuditSeed, selectPairedAudit } from "../scripts/lib/paired-audit.mjs";
import { preparePairedAudit } from "../scripts/prepare-paired-audit.mjs";
import { parseReferenceLine } from "../src/reference.mjs";

const record = (written, reading, segments = [[written, reading]]) => ({ written, reading, segments, status: "aligned" });
const references = (...lines) => lines.map(parseReferenceLine);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const lines = bytes => bytes.toString().trim().split("\n").filter(Boolean).map(JSON.parse);

test("the pair frame collapses script duplicates and equivalent literal subdivisions only", () => {
  const dataset = { entries: { "1": [
    record("ヤブ蚊", "やぶか", [["ヤ", "や"], ["ブ", "ぶ"], ["蚊", "か"]]),
    record("ヤブ蚊", "ヤブカ", ["ヤブ", ["蚊", "カ"]]),
    record("ヤブ蚊", "やぶっか", [["ヤブ", "やぶ"], ["蚊", "っか"]])
  ] } };
  const result = buildPairedFrame(dataset, references("1;ヤブ.蚊;やぶ.か", "1;ヤブ..蚊;ヤブ.っ.か"));
  assert.equal(result.summary.rawRecords, 3);
  assert.equal(result.summary.distinctPairs, 2);
  assert.equal(result.summary.collapsedRecords, 1);
  assert.deepEqual(result.summary.counts, { exact: 2 });
  assert.deepEqual(result.frame.map(row => row.equivalentRecords).sort(), [1, 2]);
  assert.deepEqual(result.frame.find(row => row.reading === "やぶか").candidate, [["ヤブ", "やぶ"], ["蚊", "か"]]);
});

test("conflicting normalized candidate or reference alignments stay outside the comparison", () => {
  const dataset = { entries: {
    "1": [record("日本", "にほん", [["日", "に"], ["本", "ほん"]]), record("日本", "ニホン")],
    "2": [record("日本", "にほん")],
    "3": [record("日の本", "ひのもと", [["日", "ひ"], "の", ["本", "もと"]])],
    "4": [record("日本", "にっぽん")],
    "5": [record("今日", "きょう")]
  } };
  const result = buildPairedFrame(dataset, references(
    "1;日.本;に.ほん", "2;日.本;に.ほん", "2;日本;ニホン",
    "3;日.の..本;ひ.の.も.と", "4;日本;にほん"
  ));
  assert.deepEqual(Object.fromEntries(result.frame.map(row => [row.id, row.reason])), {
    "1": "multiple-candidate-alignments", "2": "multiple-reference-alignments",
    "3": "ambiguous-reference-segment", "4": "missing-reference-pair", "5": "missing-reference-entry"
  });
  assert.deepEqual(result.summary.counts, { uncomparable: 3, absent: 2 });
  assert.equal(Object.values(result.summary.exclusions).reduce((sum, count) => sum + count, 0), 5);
  assert.equal(selectPairedAudit(result.frame).selected.length, 0);
});

test("boundary strata do not stand for correctness and all relatives remain separate pairs", () => {
  const split = [["日", "に"], ["本", "ほん"]];
  const dataset = { entries: {
    "1": [record("日本", "にほん", split), record("二本", "にほん", [["二", "に"], ["本", "ほん"]])],
    "2": [record("日本", "にほん", split)],
    "3": [record("日本", "にほん")],
    "4": [record("日本", "にほん", [["日", "にほ"], ["本", "ん"]])]
  } };
  const result = buildPairedFrame(dataset, references("1;日本;にほん", "1;二本;にほん", "2;日.本;に.ほん", "3;日.本;に.ほん", "4;日.本;に.ほん"));
  assert.deepEqual(result.summary.counts, { finer: 2, exact: 1, coarser: 1, incompatible: 1 });
  const sample = selectPairedAudit(result.frame);
  assert.equal(sample.selected.length, 5);
  assert.equal(sample.selected.filter(row => row.familyId === "JMdict:1").length, 2);
  assert.equal(new Set(sample.selected.map(row => row.pairId)).size, 5);
});

test("selection uses fixed per-stratum quotas and is invariant to frame order", () => {
  assert.equal(pairedAuditSeed, "precise-furigana-paired-alljmdict-2026-10-09-v1");
  assert.deepEqual(pairedAuditQuotas, { coarser: 400, finer: 400, incompatible: 400, exact: 100 });
  const frame = Object.keys(pairedAuditQuotas).flatMap(category => Array.from({ length: 450 }, (_, index) => ({
    pairId: `${category}:${index}`, familyId: `JMdict:${index % 5}`, category
  })));
  const sample = selectPairedAudit(frame);
  assert.deepEqual(sample, selectPairedAudit([...frame].reverse()));
  assert.equal(sample.selected.length, 1300);
  for (const [category, quota] of Object.entries(pairedAuditQuotas)) {
    assert.deepEqual(sample.populations[category], { pairs: 450, sample: quota });
  }
  assert.equal(new Set(sample.selected.map(row => row.auditId)).size, 1300);
  assert.notDeepEqual(sample.selected, selectPairedAudit(frame, { seed: "synthetic-alternate-seed" }).selected);
});

test("malformed candidates, duplicate pair IDs, and invalid sample specifications fail explicitly", () => {
  assert.throws(() => buildPairedFrame({ entries: { "1": [record("日本", "にほん", [["日本", "にっぽん"]])] } }, []), /reconstruct/u);
  assert.throws(() => selectPairedAudit([{ pairId: "a" }, { pairId: "a" }]), /Duplicate/u);
  assert.throws(() => selectPairedAudit([], { seed: "" }), /seed/u);
  assert.throws(() => selectPairedAudit([], { quotas: { finer: -1 } }), /nonnegative/u);
  assert.throws(() => selectPairedAudit([], { quotas: { absent: 1 } }), /stratum/u);
  assert.throws(() => selectPairedAudit([], { quotas: { exact: 1.5 } }), /integers/u);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "precise-paired-synthetic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const word = (id, text, reading) => ({
    id, kanji: [{ text, tags: [] }], kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
    sense: [{ gloss: [{ lang: "eng", text: "synthetic context" }], partOfSpeech: ["n"] }]
  });
  const dictionaries = {
    jmdict: { commonOnly: false, words: [word("1", "日本", "にほん"), word("2", "心地", "ここち")] },
    kanjidic: { characters: [{ literal: "日", readingMeaning: { groups: [{ readings: [{ type: "ja_on", value: "ニチ" }] }], nanori: ["に"] } }] }
  };
  const lock = { schemaVersion: 1, sources: {} };
  for (const [name, dictionary] of Object.entries(dictionaries)) {
    const bytes = Buffer.from(JSON.stringify(dictionary));
    lock.sources[name] = { file: name + ".json", jsonSHA256: hash(bytes) };
    await writeFile(join(directory, name + ".json"), bytes);
  }
  const unihanText = "U+65E5\tkJapanese\tニチ ジツ\nU+65E5\tkMandarin\tri4\n";
  lock.lexicalSources = { unihan: { file: "Unihan.txt", textSHA256: hash(unihanText) } };
  await writeFile(join(directory, "Unihan.txt"), unihanText);
  const lockPath = join(directory, "sources.lock.json");
  await writeFile(lockPath, JSON.stringify(lock));
  const dataset = { schemaVersion: 1, metadata: { sources: lock }, entries: {
    "1": [record("日本", "にほん", [["日", "に"], ["本", "ほん"]])],
    "2": [record("心地", "ここち")]
  } };
  const datasetPath = join(directory, "candidate.json");
  await writeFile(datasetPath, JSON.stringify(dataset));
  const referencePath = join(directory, "synthetic-reference.txt");
  await writeFile(referencePath, "1;日本;にほん\n2;心.地;ここ.ち\n");
  return { directory, dataset, lock, options: { datasetPath, referencePath, cacheDirectory: directory, lockPath, outputDirectory: join(directory, "audit") } };
}

test("the synthetic CLI freezes inputs and full frame before emitting a blind complete-pair packet", async t => {
  const { options } = await fixture(t);
  const run = outputDirectory => promisify(execFile)(process.execPath, [
    new URL("../scripts/prepare-paired-audit.mjs", import.meta.url).pathname,
    options.datasetPath, "--reference", options.referencePath, "--output", outputDirectory,
    "--cache", options.cacheDirectory, "--lock", options.lockPath
  ]);
  const { stdout } = await run(options.outputDirectory);
  const summary = JSON.parse(stdout);
  const files = await readdir(options.outputDirectory);
  assert.deepEqual(files.sort(), ["blind-packet.jsonl", "checkpoint.json", "frame.sealed.jsonl", "manifest.sealed.jsonl", "summary.json"]);
  const checkpointBytes = await readFile(join(options.outputDirectory, "checkpoint.json"));
  const checkpoint = JSON.parse(checkpointBytes);
  const frameBytes = await readFile(join(options.outputDirectory, "frame.sealed.jsonl"));
  const manifestBytes = await readFile(join(options.outputDirectory, "manifest.sealed.jsonl"));
  const packetBytes = await readFile(join(options.outputDirectory, "blind-packet.jsonl"));
  assert.equal(checkpoint.frame.sha256, hash(frameBytes));
  assert.equal(summary.hashes.checkpoint, hash(checkpointBytes));
  assert.equal(summary.hashes.manifest, hash(manifestBytes));
  assert.equal(summary.hashes.blindPacket, hash(packetBytes));
  assert.equal(checkpoint.inputs.candidate.sha256, hash(await readFile(options.datasetPath)));
  assert.deepEqual(checkpoint.sampling.quotas, pairedAuditQuotas);
  assert.equal(checkpoint.sampling.convenienceExclusions, false);
  for (const path of ["scripts/lib/paired-audit.mjs", "scripts/lib/audit.mjs", "scripts/lib/paired-evaluation.mjs", "src/reference.mjs", "src/segments.mjs", "src/kana.mjs"]) {
    assert.equal(checkpoint.dependencies[path].sha256, hash(await readFile(new URL("../" + path, import.meta.url))));
  }
  assert.equal(summary.population.comparablePairs, 2);
  assert.equal(summary.selectedPairs, 2);
  for (const row of lines(packetBytes)) {
    assert.deepEqual(Object.keys(row).sort(), ["auditId", "characters", "jmdict", "reading", "written"]);
    assert.ok(row.jmdict.sense[0].gloss[0].text);
  }
  const character = lines(packetBytes).find(row => row.written === "日本").characters[0];
  assert.equal(character.kanjidic.groups[0].readings[0].value, "ニチ");
  assert.deepEqual(character.unihan, [{ property: "kJapanese", value: "ニチ ジツ" }, { property: "kMandarin", value: "ri4" }]);
  const second = options.outputDirectory + "-repeat";
  await run(second);
  for (const file of files) assert.deepEqual(await readFile(join(second, file)), await readFile(join(options.outputDirectory, file)));
  await assert.rejects(run(options.outputDirectory), /Refusing to overwrite/u);
});

test("preparation rejects source mismatch and convenience subsets without freezing any sample", async t => {
  const { dataset, options } = await fixture(t);
  dataset.metadata.sources = { ...dataset.metadata.sources, changed: true };
  await writeFile(options.datasetPath, JSON.stringify(dataset));
  await assert.rejects(preparePairedAudit(options), /match the verified source lock/u);
  delete dataset.metadata.sources.changed;
  delete dataset.entries["2"];
  await writeFile(options.datasetPath, JSON.stringify(dataset));
  await assert.rejects(preparePairedAudit(options), /complete distinct JMdict/u);
  await assert.rejects(readdir(options.outputDirectory), { code: "ENOENT" });
});
