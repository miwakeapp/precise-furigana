import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { makePairedAuditPacket } from "../prepare-paired-audit.mjs";
import { alignmentPoints, compareScores, scoreTarget } from "./audit.mjs";
import { buildPairedFrame, pairedAuditQuotas, pairedAuditSeed, selectPairedAudit } from "./paired-audit.mjs";
import { estimatePairedAccuracy } from "./paired-evaluation.mjs";
import { canonicalizeSegments, normalizeKana, parseReferenceLine, referenceKey } from "../../src/reference.mjs";
import { segmentReading, segmentText } from "../../src/segments.mjs";
import { defaultCacheDirectory, enumeratePairs, loadSources } from "../../src/sources.mjs";

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, undefined, 2) + "\n";
const jsonLines = rows => rows.map(row => JSON.stringify(row) + "\n").join("");
const signature = segments => JSON.stringify(alignmentPoints(segments));
const dependencyPaths = [
  "scripts/prepare-paired-audit.mjs", "scripts/lib/paired-audit.mjs", "scripts/lib/audit.mjs",
  "scripts/lib/paired-evaluation.mjs", "scripts/evaluate-paired-audit.mjs",
  "scripts/score-paired-audit.mjs", "scripts/lib/paired-scoring.mjs",
  "src/reference.mjs", "src/segments.mjs", "src/sources.mjs", "src/kana.mjs"
];
const disagreements = ["coarser", "finer", "incompatible"];
const confidences = ["high", "moderate", "low"];
const conventions = new Set(["positional-numeral", "particle-attachment"]);

function requireEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}

function requireHash(value, name) {
  if (typeof value !== "string" || !/^[\da-f]{64}$/u.test(value)) throw new Error(`${name} must be an externally recorded SHA256`);
}

function nonempty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a nonempty string`);
}

function keys(value, allowed, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${name} contains an unknown field; labels must not contain system outputs or scores`);
}

function verifyBytes(bytes, fingerprint, name) {
  if (!Number.isSafeInteger(fingerprint?.bytes) || fingerprint.bytes < 0) throw new Error(`${name} requires a pinned byte count`);
  requireHash(fingerprint.sha256, `${name} hash`);
  if (bytes.length !== fingerprint.bytes || hash(bytes) !== fingerprint.sha256) throw new Error(`${name} checksum or size mismatch`);
}

function parseJSON(bytes, name) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error(`Invalid JSON in ${name}`, { cause: error }); }
}

function evidenceOutcome(label) {
  return JSON.stringify([label.status, label.accepted?.map(signature).sort() ?? null]);
}

function validateAnnotator(annotator) {
  keys(annotator, ["id", "kind", "description"], "annotator");
  nonempty(annotator.id, "annotator id");
  nonempty(annotator.description, "annotator description");
  if (!["human", "ai"].includes(annotator.kind)) throw new Error("Annotator kind must disclose human or ai");
}

function validateAccepted(segments, packet, conventionTags) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("An accepted alignment must be a complete, nonempty segment array");
  for (const segment of segments) {
    if (typeof segment === "string") {
      if (!segment.length) throw new Error("Literal segments must be nonempty");
    }
    else if (!Array.isArray(segment) || segment.length !== 2 || typeof segment[0] !== "string" || !segment[0].length || typeof segment[1] !== "string") {
      throw new Error("Accepted ruby requires a nonempty written span and a string reading");
    } else if (!segment[1].length && conventionTags.length === 0) {
      throw new Error("A silent written span requires an explicit numeral or particle convention and evidence");
    }
  }
  if (segments.map(segmentText).join("") !== packet.written || normalizeKana(segments.map(segmentReading).join("")) !== packet.reading) {
    throw new Error(`Accepted alignment does not reconstruct the complete pair ${packet.auditId}`);
  }
  return canonicalizeSegments(segments).segments;
}

/** Validate blind judgments before any system outcomes are computed. */
export function validatePairedLabels(document, packet, { role, checkpointSHA256, blindPacketSHA256, protocolSHA256, initialLabelSHA256 } = {}) {
  keys(document, ["schemaVersion", "role", "checkpointSHA256", "blindPacketSHA256", "protocolSHA256", "annotator", "declarations", "initialLabelSHA256", "labels"], "label document");
  if (document.schemaVersion !== 1 || document.role !== role || !["initial", "reconciliation"].includes(role)) throw new Error("Invalid label schema or role");
  for (const [field, expected] of Object.entries({ checkpointSHA256, blindPacketSHA256, protocolSHA256 })) {
    requireEqual(document[field], expected, `Label ${field} does not match the frozen audit`);
  }
  validateAnnotator(document.annotator);
  if (role === "initial") {
    requireEqual(document.declarations, { blindedToSystemOutputs: true, independentOfOtherInitialLabels: true }, "Initial labels must attest independent blind preparation");
    if (document.initialLabelSHA256 !== undefined) throw new Error("Initial judges must not receive the other initial label set");
  } else {
    requireEqual(document.declarations, { blindedToSystemOutputs: true, initialLabelsReviewed: true }, "Reconciliation must attest blind review of both initial label sets");
    requireEqual(document.initialLabelSHA256, initialLabelSHA256, "Reconciliation does not bind both frozen initial label sets in order");
  }
  if (!Array.isArray(document.labels) || document.labels.length !== packet.length) throw new Error("Every selected pair must have exactly one label, including unresolved judgments");
  const packets = new Map(packet.map(row => [row.auditId, row]));
  const labels = new Map();
  for (const label of document.labels) {
    keys(label, ["auditId", "status", "accepted", "confidence", "rationale", "evidence", "conventions"], "label");
    const row = packets.get(label.auditId);
    if (row === undefined || labels.has(label.auditId)) throw new Error("Label IDs must match the entire selected sample exactly once");
    if (!["resolved", "unresolved"].includes(label.status) || !confidences.includes(label.confidence)) throw new Error("Labels require resolved/unresolved status and high/moderate/low confidence");
    nonempty(label.rationale, "label rationale");
    if (!Array.isArray(label.evidence) || label.evidence.some(value => typeof value !== "string" || !value.trim()) || label.status === "resolved" && label.evidence.length === 0) throw new Error("Resolved labels require independent evidence; every evidence item must be nonempty");
    if (!Array.isArray(label.conventions) || label.conventions.some(value => !conventions.has(value)) || new Set(label.conventions).size !== label.conventions.length) throw new Error("Invalid or duplicate convention tags");
    let accepted = null;
    if (label.status === "unresolved") {
      if (label.accepted !== null) throw new Error("Unresolved judgments require accepted: null, never a guessed alignment");
    } else {
      if (!Array.isArray(label.accepted) || label.accepted.length === 0) throw new Error("Resolved judgments require explicit complete accepted alternatives");
      accepted = label.accepted.map(segments => validateAccepted(segments, row, label.conventions));
      if (new Set(accepted.map(signature)).size !== accepted.length) throw new Error("Accepted alternatives contain equivalent duplicates");
    }
    labels.set(label.auditId, { ...label, accepted });
  }
  return { annotator: document.annotator, labels };
}

/** Reconstruct the frozen design instead of trusting user-entered weights. */
export async function verifyPairedAudit({ auditDirectory, checkpointSHA256, cacheDirectory = defaultCacheDirectory }) {
  nonempty(auditDirectory, "audit directory");
  requireHash(checkpointSHA256, "Checkpoint trust anchor");
  const checkpointBytes = await readFile(join(auditDirectory, "checkpoint.json"));
  if (hash(checkpointBytes) !== checkpointSHA256) throw new Error("Audit checkpoint differs from the supplied trust anchor");
  const checkpoint = parseJSON(checkpointBytes, "checkpoint");
  if (checkpoint.schemaVersion !== 1) throw new Error("Unsupported checkpoint schema");
  requireEqual(Object.keys(checkpoint.dependencies ?? {}).sort(), [...dependencyPaths].sort(), "Checkpoint must freeze the complete scoring dependency set");
  for (const path of dependencyPaths) {
    requireEqual(checkpoint.dependencies[path].path, path, "Unexpected dependency path");
    verifyBytes(await readFile(join(projectDirectory, path)), checkpoint.dependencies[path], path);
  }
  requireEqual(checkpoint.runtime, { node: process.version, versions: process.versions }, "Scoring requires the frozen Node/Unicode runtime");
  const protocolPath = "docs/paired-evaluation-protocol.md";
  requireEqual(checkpoint.protocol?.path, protocolPath, "Unexpected frozen protocol path");
  verifyBytes(await readFile(join(projectDirectory, protocolPath)), checkpoint.protocol, "protocol");
  const inputBytes = {};
  for (const name of ["candidate", "reference", "sourceLock"]) {
    const fingerprint = checkpoint.inputs?.[name];
    nonempty(fingerprint?.path, `${name} path`);
    inputBytes[name] = await readFile(fingerprint.path);
    verifyBytes(inputBytes[name], fingerprint, name);
  }
  const sources = await loadSources({ cacheDirectory, lockPath: checkpoint.inputs.sourceLock.path });
  requireEqual(sources.lock, checkpoint.inputs.verifiedSources, "Verified dictionaries differ from the checkpoint source lock");
  requireEqual(parseJSON(inputBytes.sourceLock, "source lock"), sources.lock, "Source lock changed during verification");
  const candidate = parseJSON(inputBytes.candidate, "candidate");
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported candidate schema");
  requireEqual(candidate.metadata?.sources, sources.lock, "Candidate source identity differs from the verified dictionaries");
  const references = inputBytes.reference.toString("utf8").split(/\r?\n/u).map(parseReferenceLine).filter(row => row !== undefined);
  const { frame, summary: frameSummary } = buildPairedFrame(candidate, references);
  const expectedPairs = new Set([...enumeratePairs(sources.jmdict)].map(pair => JSON.stringify([pair.id, pair.written, normalizeKana(pair.reading)])));
  if (frame.length !== expectedPairs.size || frame.some(row => !expectedPairs.has(row.pairId))) throw new Error("Frozen candidate does not cover the complete JMdict pair population");
  const frameBytes = await readFile(join(auditDirectory, "frame.sealed.jsonl"));
  if (checkpoint.frame?.file !== "frame.sealed.jsonl") throw new Error("Unexpected frame path");
  verifyBytes(frameBytes, checkpoint.frame, "complete frame");
  requireEqual(frameBytes.toString("utf8"), jsonLines(frame), "Frozen frame differs from the complete candidate/reference comparison");
  requireEqual(checkpoint.sampling, {
    seed: pairedAuditSeed, quotas: pairedAuditQuotas,
    method: "Lowest SHA256 ranks of JSON [seed, selection, category, pairId] within each complete stratum, without replacement",
    tieBreak: "Lexicographic pairId by JavaScript string code units",
    packetOrder: "SHA256 of JSON [seed, packet-order, pairId], with the same tie break",
    convenienceExclusions: false
  }, "Frozen sampling specification differs from the predeclared design");
  requireEqual(checkpoint.familyRule, "JMdict entry ID only; orthographic relatives across entries are not grouped. Every distinct pair remains eligible, including relatives and previously discussed cases.", "Unexpected family definition");
  const { selected, populations } = selectPairedAudit(frame);
  const manifestBytes = await readFile(join(auditDirectory, "manifest.sealed.jsonl"));
  requireEqual(manifestBytes.toString("utf8"), jsonLines(selected), "Selected manifest differs from the complete frozen probability sample");
  const packet = makePairedAuditPacket(selected, sources);
  const packetBytes = await readFile(join(auditDirectory, "blind-packet.jsonl"));
  requireEqual(packetBytes.toString("utf8"), jsonLines(packet), "Blind packet differs from the frozen selected pairs and independent sources");
  const comparablePairs = Object.keys(pairedAuditQuotas).reduce((sum, category) => sum + (frameSummary.counts[category] ?? 0), 0);
  const referenceKeys = new Set(references.map(row => referenceKey(row.id, row.written, row.reading)));
  const frameReferenceKeys = new Set(frame.map(row => referenceKey(row.id, row.written, row.reading)));
  const population = {
    ...frameSummary, comparablePairs, outsideComparisonPairs: frame.length - comparablePairs,
    families: new Set(frame.map(row => row.familyId)).size,
    referenceRecords: references.length, distinctReferencePairs: referenceKeys.size,
    referencePairsOutsideFrame: [...referenceKeys].filter(key => !frameReferenceKeys.has(key)).length
  };
  requireEqual(checkpoint.frame, { file: "frame.sealed.jsonl", sha256: hash(frameBytes), bytes: frameBytes.length, ...population }, "Checkpoint population counts differ from the verified frame");
  const summary = parseJSON(await readFile(join(auditDirectory, "summary.json")), "preparation summary");
  requireEqual(summary.population, population, "Preparation population differs from the verified frame");
  requireEqual(summary.strata, populations, "Preparation strata differ from the verified sampling design");
  requireEqual(summary.quotas, pairedAuditQuotas, "Preparation quotas differ from the predeclared quotas");
  if (summary.schemaVersion !== 1 || summary.seed !== pairedAuditSeed || summary.selectedPairs !== selected.length || summary.selectedFamilies !== new Set(selected.map(row => row.familyId)).size) throw new Error("Preparation selection totals differ from the verified sample");
  requireEqual(summary.hashes, {
    checkpoint: checkpointSHA256, frame: hash(frameBytes), manifest: hash(manifestBytes), blindPacket: hash(packetBytes),
    candidate: hash(inputBytes.candidate), reference: hash(inputBytes.reference), sourceLock: hash(inputBytes.sourceLock), protocol: checkpoint.protocol.sha256
  }, "Preparation artifact hashes differ from the verified audit");
  return { checkpoint, checkpointSHA256, selected, packet, population, populations, hashes: summary.hashes };
}

async function loadJudgments(audit, adjudicationPath, adjudicationSHA256) {
  requireHash(adjudicationSHA256, "Adjudication trust anchor");
  const freezeBytes = await readFile(adjudicationPath);
  if (hash(freezeBytes) !== adjudicationSHA256) throw new Error("Adjudication checkpoint differs from the supplied trust anchor");
  const freeze = parseJSON(freezeBytes, "adjudication checkpoint");
  keys(freeze, ["schemaVersion", "checkpointSHA256", "blindPacketSHA256", "protocolSHA256", "frozenBeforeSystemOutputsRevealed", "initialLabels", "reconciliation"], "adjudication checkpoint");
  const context = { checkpointSHA256: audit.checkpointSHA256, blindPacketSHA256: audit.hashes.blindPacket, protocolSHA256: audit.hashes.protocol };
  if (freeze.schemaVersion !== 1 || freeze.frozenBeforeSystemOutputsRevealed !== true) throw new Error("Adjudication must be frozen before any system output is revealed");
  for (const [key, value] of Object.entries(context)) requireEqual(freeze[key], value, `Adjudication ${key} does not match the frozen audit`);
  if (!Array.isArray(freeze.initialLabels) || freeze.initialLabels.length !== 2) throw new Error("Exactly two independently prepared initial label sets are required");
  const seen = new Set();
  async function readJudgment(fingerprint, role) {
    keys(fingerprint, ["file", "bytes", "sha256"], `${role} fingerprint`);
    if (typeof fingerprint.file !== "string" || !/^[\w.-]+\.json$/u.test(fingerprint.file) || seen.has(fingerprint.file)) throw new Error("Judgment files require distinct local JSON file names");
    seen.add(fingerprint.file);
    const bytes = await readFile(join(dirname(adjudicationPath), fingerprint.file));
    verifyBytes(bytes, fingerprint, `${role} labels`);
    return validatePairedLabels(parseJSON(bytes, `${role} labels`), audit.packet, {
      ...context, role, ...(role === "reconciliation" ? { initialLabelSHA256: freeze.initialLabels.map(item => item.sha256) } : {})
    });
  }
  const first = await readJudgment(freeze.initialLabels[0], "initial");
  const second = await readJudgment(freeze.initialLabels[1], "initial");
  if (first.annotator.id === second.annotator.id) throw new Error("The two initial annotators must have distinct identities");
  const reconciled = await readJudgment(freeze.reconciliation, "reconciliation");
  return { first, second, reconciled, freeze, adjudicationSHA256 };
}

function summarizeCases(rows) {
  const result = { pairs: rows.length, resolved: 0, unresolved: 0, confidence: { high: 0, moderate: 0, low: 0 }, candidate: { exact: 0, coarser: 0, unsupported: 0, unsupportedBoundaries: 0, missedBoundaries: 0 }, reference: { exact: 0, coarser: 0, unsupported: 0, unsupportedBoundaries: 0, missedBoundaries: 0 }, comparisons: {} };
  for (const row of rows) {
    ++result.confidence[row.confidence];
    if (row.candidateExact === null) { ++result.unresolved; continue; }
    ++result.resolved;
    for (const system of ["candidate", "reference"]) {
      ++result[system][row[system].status];
      result[system].unsupportedBoundaries += row[system].unsupported.length;
      result[system].missedBoundaries += row[system].missed.length;
    }
    result.comparisons[row.comparison] = (result.comparisons[row.comparison] ?? 0) + 1;
  }
  return result;
}

async function writeFrozen(path, contents) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(contents); await file.sync(); }
  finally { await file.close(); }
}

/** Verify every frozen artifact and blind judgment before writing sealed scores. */
export async function scorePairedAudit({
  auditDirectory, checkpointSHA256, adjudicationPath, adjudicationSHA256, outputDirectory,
  cacheDirectory = defaultCacheDirectory
}) {
  nonempty(outputDirectory, "new scoring output directory");
  nonempty(adjudicationPath, "adjudication checkpoint path");
  await lstat(outputDirectory).then(() => { throw new Error("Refusing to overwrite an existing scoring directory"); }, error => { if (error.code !== "ENOENT") throw error; });
  const audit = await verifyPairedAudit({ auditDirectory, checkpointSHA256, cacheDirectory });
  const judgments = await loadJudgments(audit, adjudicationPath, adjudicationSHA256);
  const initialAgreement = { sameAcceptedOutcome: 0, differentAcceptedOutcome: 0, finalDiffersFromBoth: 0 };
  const cases = audit.selected.map(row => {
    const label = judgments.reconciled.labels.get(row.auditId);
    const first = judgments.first.labels.get(row.auditId), second = judgments.second.labels.get(row.auditId);
    const one = evidenceOutcome(first), two = evidenceOutcome(second), final = evidenceOutcome(label);
    ++initialAgreement[one === two ? "sameAcceptedOutcome" : "differentAcceptedOutcome"];
    if (final !== one && final !== two) ++initialAgreement.finalDiffersFromBoth;
    const score = segments => scoreTarget(segments, { x: 0, y: 0 }, row.written, label.accepted);
    const candidate = score(row.candidate), reference = score(row.reference);
    const candidateExact = label.status === "unresolved" ? null : candidate.status === "exact";
    const referenceExact = label.status === "unresolved" ? null : reference.status === "exact";
    if (row.category === "exact" && (signature(row.candidate) !== signature(row.reference) || candidateExact !== referenceExact)) throw new Error("Agreement controls violate the mechanical paired-tie invariant");
    return {
      auditId: row.auditId, pairId: row.pairId, familyId: row.familyId, stratum: row.category,
      confidence: label.confidence, conventions: label.conventions,
      candidateExact, referenceExact, candidate, reference, comparison: compareScores(candidate, reference)
    };
  });
  const analysisInput = {
    sharedPairs: audit.population.counts.exact ?? 0,
    outsideComparisonPairs: audit.population.outsideComparisonPairs,
    alpha: 0.05,
    strata: disagreements.map(id => ({
      id, populationPairs: audit.population.counts[id] ?? 0,
      samples: cases.filter(row => row.stratum === id).map(({ pairId, familyId, candidateExact, referenceExact }) => ({ pairId, familyId, candidateExact, referenceExact }))
    }))
  };
  const primary = estimatePairedAccuracy(analysisInput);
  const scoresText = jsonLines(cases), analysisText = json(analysisInput);
  const report = {
    schemaVersion: 1,
    notice: "Verified frozen paired audit. Confidence bounds cover sampling and explicitly unresolved labels, conditional on correct independent judgments. Hashes and declarations establish the artifact chain but cannot prove annotator independence or linguistic correctness. Individual judgments and scores remain sealed from implementation work.",
    hashes: { ...audit.hashes, adjudication: adjudicationSHA256, initialLabels: judgments.freeze.initialLabels.map(item => item.sha256), reconciliation: judgments.freeze.reconciliation.sha256, individualScores: hash(scoresText), analysisInput: hash(analysisText) },
    population: audit.population, strata: audit.populations, primary,
    annotation: { initial: [judgments.first.annotator, judgments.second.annotator], reconciliation: judgments.reconciled.annotator, initialAgreement, declarationsVerified: true },
    secondary: {
      notice: "Raw sampled-pair totals and high-confidence views are descriptive; they do not replace the weighted primary endpoint or carry additional inferential claims.",
      disagreements: summarizeCases(cases.filter(row => row.stratum !== "exact")),
      byStratum: Object.fromEntries(disagreements.map(id => [id, summarizeCases(cases.filter(row => row.stratum === id))])),
      highConfidence: summarizeCases(cases.filter(row => row.stratum !== "exact" && row.confidence === "high"))
    },
    agreementControls: { ...summarizeCases(cases.filter(row => row.stratum === "exact")), notice: "Shared alignments are paired zero regardless of correctness. These controls do not by themselves estimate or certify absolute corpus accuracy." }
  };
  await mkdir(dirname(resolve(outputDirectory)), { recursive: true });
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFrozen(join(outputDirectory, "scores.sealed.jsonl"), scoresText);
  await writeFrozen(join(outputDirectory, "analysis-input.sealed.json"), analysisText);
  await writeFrozen(join(outputDirectory, "report.json"), json(report));
  return report;
}
