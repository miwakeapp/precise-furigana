import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { preparePairedAudit } from "../scripts/prepare-paired-audit.mjs";
import { scorePairedAudit, validatePairedLabels } from "../scripts/lib/paired-scoring.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, undefined, 2) + "\n";
const parseLines = bytes => bytes.toString().trim().split("\n").filter(Boolean).map(JSON.parse);
const clone = value => structuredClone(value);
const origin = { checkpointSHA256: "a".repeat(64), blindPacketSHA256: "b".repeat(64), protocolSHA256: "c".repeat(64) };
const annotator = id => ({ id, kind: "ai", description: "Synthetic independent judge for tests" });
const resolved = (auditId, accepted, confidence = "moderate", conventions = []) => ({ auditId, status: "resolved", accepted, confidence, rationale: "Synthetic independently supported sound correspondence.", evidence: ["Synthetic pinned dictionary evidence"], conventions });
const unresolved = auditId => ({ auditId, status: "unresolved", accepted: null, confidence: "low", rationale: "Synthetic independent evidence does not distinguish the alternatives.", evidence: [], conventions: [] });
const initialDocument = (labels, id = "judge-a", context = origin) => ({ schemaVersion: 1, role: "initial", ...context, annotator: annotator(id), declarations: { blindedToSystemOutputs: true, independentOfOtherInitialLabels: true }, labels });

test("blind labels require complete mappings, explicit alternatives, and every selected row", () => {
  const packet = [{ auditId: "P1", written: "甲乙", reading: "こうおつ" }, { auditId: "P2", written: "カナ", reading: "かな" }];
  const document = initialDocument([resolved("P1", [[["甲", "こう"], ["乙", "おつ"]]]), unresolved("P2")]);
  assert.equal(validatePairedLabels(document, packet, { ...origin, role: "initial" }).labels.size, 2);
  const reject = (change, pattern) => {
    const modified = clone(document);
    change(modified);
    assert.throws(() => validatePairedLabels(modified, packet, { ...origin, role: "initial" }), pattern);
  };
  reject(value => value.labels.pop(), /Every selected pair/u);
  reject(value => value.labels[1].auditId = "P1", /exactly once/u);
  reject(value => value.labels[0].candidateExact = true, /system outputs/u);
  reject(value => value.labels[0].accepted = [[["甲", "こう"]]], /complete pair/u);
  reject(value => value.labels[0].evidence = [], /independent evidence/u);
  reject(value => value.labels[1].accepted = [], /accepted: null/u);
  reject(value => value.declarations.independentOfOtherInitialLabels = false, /independent blind/u);
  reject(value => value.labels[0].accepted.push(clone(value.labels[0].accepted[0])), /equivalent duplicates/u);
});

test("numeral and particle conventions remain explicit complete mappings", () => {
  const packet = [{ auditId: "P1", written: "２４", reading: "にじゅうよん" }, { auditId: "P2", written: "甲の乙", reading: "こうおつ" }];
  const document = initialDocument([
    resolved("P1", [[["２４", "にじゅうよん"]], [["２", "にじゅう"], ["４", "よん"]]], "high", ["positional-numeral"]),
    resolved("P2", [[["甲", "こう"], ["の", ""], ["乙", "おつ"]]], "moderate", ["particle-attachment"])
  ]);
  assert.equal(validatePairedLabels(document, packet, { ...origin, role: "initial" }).labels.get("P2").accepted[0][1][1], "");
  document.labels[1].conventions = [];
  assert.throws(() => validatePairedLabels(document, packet, { ...origin, role: "initial" }), /silent written span/u);
});

test("blind reconciliation must bind both original label files in their frozen order", () => {
  const packet = [{ auditId: "P1", written: "甲", reading: "こう" }];
  const initialLabelSHA256 = ["d".repeat(64), "e".repeat(64)];
  const document = {
    ...initialDocument([resolved("P1", [[["甲", "こう"]]])]), role: "reconciliation",
    declarations: { blindedToSystemOutputs: true, initialLabelsReviewed: true }, initialLabelSHA256
  };
  assert.equal(validatePairedLabels(document, packet, { ...origin, role: "reconciliation", initialLabelSHA256 }).labels.size, 1);
  document.initialLabelSHA256 = [...initialLabelSHA256].reverse();
  assert.throws(() => validatePairedLabels(document, packet, { ...origin, role: "reconciliation", initialLabelSHA256 }), /bind both frozen initial/u);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "precise-score-synthetic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rows = [
    ["1", "甲乙", "こうおつ", [["甲", "こう"], ["乙", "おつ"]]],
    ["2", "丙丁", "へいてい", [["丙丁", "へいてい"]]],
    ["3", "戊己", "ぼき", [["戊", "ぼ"], ["己", "き"]]],
    ["4", "庚辛", "こうしん", [["庚", "こうし"], ["辛", "ん"]]],
    ["5", "甲", "こう", [["甲", "こう"]]]
  ];
  const jmdict = { commonOnly: false, words: rows.map(([id, written, reading]) => ({ id, kanji: [{ text: written, tags: [] }], kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: [{ gloss: [{ lang: "eng", text: "Synthetic test context" }] }] })) };
  const dictionaries = { jmdict, kanjidic: { characters: [] } };
  const lock = { schemaVersion: 1, sources: {} };
  for (const [name, dictionary] of Object.entries(dictionaries)) {
    const bytes = json(dictionary);
    lock.sources[name] = { file: name + ".json", jsonSHA256: hash(bytes) };
    await writeFile(join(directory, name + ".json"), bytes);
  }
  const lockPath = join(directory, "sources.lock.json");
  await writeFile(lockPath, json(lock));
  const candidate = { schemaVersion: 1, metadata: { sources: lock }, entries: Object.fromEntries(rows.map(([id, written, reading, segments]) => [id, [{ written, reading, segments, status: "aligned" }]])) };
  const datasetPath = join(directory, "candidate.json"), referencePath = join(directory, "reference.txt");
  await writeFile(datasetPath, json(candidate));
  await writeFile(referencePath, "1;甲乙;こうおつ\n2;丙.丁;へい.てい\n3;戊.己;ぼ.き\n4;庚.辛;こう.しん\n");
  const auditDirectory = join(directory, "audit");
  const summary = await preparePairedAudit({ datasetPath, referencePath, outputDirectory: auditDirectory, cacheDirectory: directory, lockPath });
  const packet = parseLines(await readFile(join(auditDirectory, "blind-packet.jsonl")));
  const accepted = {
    "甲乙": [[["甲", "こう"], ["乙", "おつ"]]], "丙丁": [[["丙", "へい"], ["丁", "てい"]]],
    "戊己": [[["戊", "ぼ"], ["己", "き"]]]
  };
  const labels = packet.map(row => accepted[row.written] ? resolved(row.auditId, accepted[row.written], row.written === "丙丁" ? "moderate" : "high") : unresolved(row.auditId));
  const context = { checkpointSHA256: summary.hashes.checkpoint, blindPacketSHA256: summary.hashes.blindPacket, protocolSHA256: summary.hashes.protocol };
  const first = initialDocument(labels, "judge-a", context), second = initialDocument(clone(labels), "judge-b", context);
  const reconciliation = { schemaVersion: 1, role: "reconciliation", ...context, annotator: { id: "reconciler", kind: "human", description: "Synthetic blind reconciliation" }, declarations: { blindedToSystemOutputs: true, initialLabelsReviewed: true }, initialLabelSHA256: [], labels: clone(labels) };
  const adjudicationPath = join(directory, "adjudication.frozen.json");
  const options = { auditDirectory, checkpointSHA256: summary.hashes.checkpoint, adjudicationPath, outputDirectory: join(directory, "scores"), cacheDirectory: directory };
  async function freeze() {
    const fingerprints = [];
    for (const [file, document] of [["initial-a.json", first], ["initial-b.json", second]]) {
      const bytes = json(document);
      await writeFile(join(directory, file), bytes);
      fingerprints.push({ file, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) });
    }
    reconciliation.initialLabelSHA256 = fingerprints.map(value => value.sha256);
    const reconciliationBytes = json(reconciliation);
    await writeFile(join(directory, "reconciliation.json"), reconciliationBytes);
    const adjudication = { schemaVersion: 1, ...context, frozenBeforeSystemOutputsRevealed: true, initialLabels: fingerprints, reconciliation: { file: "reconciliation.json", bytes: Buffer.byteLength(reconciliationBytes), sha256: hash(reconciliationBytes) } };
    const bytes = json(adjudication);
    await writeFile(adjudicationPath, bytes);
    options.adjudicationSHA256 = hash(bytes);
    return adjudication;
  }
  await freeze();
  return { directory, options, summary, packet, first, second, reconciliation, freeze };
}

test("synthetic end-to-end scoring verifies the design and retains moderate and unresolved rows", async t => {
  const { options, summary } = await fixture(t);
  const report = await scorePairedAudit(options);
  assert.deepEqual(report.population, summary.population);
  assert.equal(report.primary.comparablePairs, 4);
  assert.equal(report.primary.outsideComparisonPairs, 1);
  assert.equal(report.primary.sharedPairs, 1);
  assert.equal(report.primary.pointEstimate, null);
  assert.deepEqual(report.primary.estimatedRange, [-0.25, 0.25]);
  assert.deepEqual(report.primary.confidence.interval, [-0.25, 0.25]);
  assert.equal(report.primary.confidence.level, 0.95);
  assert.equal(report.primary.byStratum.find(row => row.id === "coarser").outcomes.referenceWins, 1);
  assert.equal(report.secondary.disagreements.unresolved, 1);
  assert.equal(report.secondary.disagreements.confidence.moderate, 1);
  assert.equal(report.agreementControls.candidate.exact, 1);
  assert.equal(report.annotation.initial[0].kind, "ai");
  assert.equal(report.annotation.reconciliation.kind, "human");
  assert.deepEqual((await readdir(options.outputDirectory)).sort(), ["analysis-input.sealed.json", "report.json", "scores.sealed.jsonl"]);
  assert.equal((await stat(join(options.outputDirectory, "scores.sealed.jsonl"))).mode & 0o777, 0o600);
  assert.equal((await stat(options.outputDirectory)).mode & 0o777, 0o700);
  assert.equal(json(report).includes("pairId"), false);
  const analysis = JSON.parse(await readFile(join(options.outputDirectory, "analysis-input.sealed.json")));
  assert.equal(analysis.alpha, 0.05);
  assert.equal(analysis.strata.reduce((sum, row) => sum + row.samples.length, 0), 3);
  const repeat = { ...options, outputDirectory: options.outputDirectory + "-repeat" };
  await scorePairedAudit(repeat);
  for (const file of await readdir(options.outputDirectory)) assert.deepEqual(await readFile(join(options.outputDirectory, file)), await readFile(join(repeat.outputDirectory, file)));
  await assert.rejects(scorePairedAudit(options), /Refusing to overwrite/u);
});

test("the synthetic scoring CLI emits only the aggregate report", async t => {
  const { options } = await fixture(t);
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL("../scripts/score-paired-audit.mjs", import.meta.url).pathname, options.auditDirectory,
    "--checkpoint-sha256", options.checkpointSHA256, "--adjudication", options.adjudicationPath,
    "--adjudication-sha256", options.adjudicationSHA256, "--output", options.outputDirectory, "--cache", options.cacheDirectory
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.primary.comparablePairs, 4);
  assert.equal(stdout.includes("甲乙"), false);
  assert.equal(stdout.includes("P0001"), false);
});

test("tampered selected manifests and packet evidence fail before any scores are written", async t => {
  for (const file of ["manifest.sealed.jsonl", "blind-packet.jsonl"]) {
    await t.test(file, async inner => {
      const { options } = await fixture(inner);
      const path = join(options.auditDirectory, file);
      const rows = parseLines(await readFile(path));
      rows.pop();
      await writeFile(path, rows.map(row => JSON.stringify(row) + "\n").join(""));
      await assert.rejects(scorePairedAudit(options), /manifest differs|Blind packet differs/u);
      await assert.rejects(stat(options.outputDirectory), { code: "ENOENT" });
    });
  }
});

test("frozen hash anchors, inputs, population counts and code cannot be silently changed", async t => {
  const { options } = await fixture(t);
  await assert.rejects(scorePairedAudit({ ...options, checkpointSHA256: "a".repeat(64) }), /trust anchor/u);
  await assert.rejects(scorePairedAudit({ ...options, adjudicationSHA256: "b".repeat(64) }), /trust anchor/u);
  const checkpointPath = join(options.auditDirectory, "checkpoint.json");
  const checkpoint = JSON.parse(await readFile(checkpointPath));
  checkpoint.dependencies["scripts/lib/paired-scoring.mjs"].sha256 = "c".repeat(64);
  const changed = json(checkpoint);
  await writeFile(checkpointPath, changed);
  await assert.rejects(scorePairedAudit({ ...options, checkpointSHA256: hash(changed) }), /paired-scoring.mjs checksum/u);
});

test("input, frame, source and population tampering are independently rejected", async t => {
  const changes = [
    ["candidate", async ({ directory }) => writeFile(join(directory, "candidate.json"), "{}\n"), /candidate checksum/u],
    ["reference", async ({ directory }) => writeFile(join(directory, "reference.txt"), "1;甲乙;こうおつ\n"), /reference checksum/u],
    ["source lock", async ({ directory }) => writeFile(join(directory, "sources.lock.json"), "{}\n"), /sourceLock checksum/u],
    ["source dictionary", async ({ directory }) => writeFile(join(directory, "jmdict.json"), "{}\n"), /Checksum mismatch for cached jmdict/u],
    ["frame", async ({ options }) => writeFile(join(options.auditDirectory, "frame.sealed.jsonl"), "{}\n"), /complete frame checksum/u],
    ["population", async ({ options }) => {
      const path = join(options.auditDirectory, "summary.json");
      const summary = JSON.parse(await readFile(path));
      ++summary.population.counts.exact;
      await writeFile(path, json(summary));
    }, /Preparation population/u],
    ["runtime", async ({ options }) => {
      const path = join(options.auditDirectory, "checkpoint.json");
      const checkpoint = JSON.parse(await readFile(path));
      checkpoint.runtime.node = "different-runtime";
      const bytes = json(checkpoint);
      await writeFile(path, bytes);
      options.checkpointSHA256 = hash(bytes);
    }, /frozen Node\/Unicode runtime/u],
    ["protocol", async ({ options }) => {
      const path = join(options.auditDirectory, "checkpoint.json");
      const checkpoint = JSON.parse(await readFile(path));
      checkpoint.protocol.sha256 = "d".repeat(64);
      const bytes = json(checkpoint);
      await writeFile(path, bytes);
      options.checkpointSHA256 = hash(bytes);
    }, /protocol checksum/u]
  ];
  for (const [name, change, pattern] of changes) await t.test(name, async inner => {
    const state = await fixture(inner);
    await change(state);
    await assert.rejects(scorePairedAudit(state.options), pattern);
    await assert.rejects(stat(state.options.outputDirectory), { code: "ENOENT" });
  });
});

test("missing labels, shared judge identities and unblind reconciliation cannot pass a new freeze", async t => {
  const { options, first, second, reconciliation, freeze } = await fixture(t);
  const removed = first.labels.pop();
  await freeze();
  await assert.rejects(scorePairedAudit(options), /Every selected pair/u);
  first.labels.push(removed);
  second.annotator.id = first.annotator.id;
  await freeze();
  await assert.rejects(scorePairedAudit(options), /distinct identities/u);
  second.annotator.id = "judge-b";
  reconciliation.declarations.blindedToSystemOutputs = false;
  await freeze();
  await assert.rejects(scorePairedAudit(options), /blind review/u);
  await assert.rejects(stat(options.outputDirectory), { code: "ENOENT" });
});

test("initial label hashes remain bound even when a later reconciliation is well formed", async t => {
  const { directory, options } = await fixture(t);
  const path = join(directory, "initial-a.json");
  const document = JSON.parse(await readFile(path));
  document.labels[0].rationale += " Edited after freeze.";
  await writeFile(path, json(document));
  await assert.rejects(scorePairedAudit(options), /initial labels checksum/u);
});
