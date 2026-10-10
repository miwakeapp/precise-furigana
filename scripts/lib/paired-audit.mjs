import { createHash } from "node:crypto";
import { alignmentPoints } from "./audit.mjs";
import { canonicalizeSegments, compareReferenceRecord, normalizeKana, referenceKey } from "../../src/reference.mjs";
import { validateAlignment } from "../../src/segments.mjs";

export const pairedAuditSeed = "precise-furigana-paired-alljmdict-2026-10-09-v1";
export const pairedAuditQuotas = Object.freeze({ coarser: 400, finer: 400, incompatible: 400, exact: 100 });
const hash = text => createHash("sha256").update(text).digest("hex");
const signature = segments => JSON.stringify(alignmentPoints(segments));
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Collapse only equivalent entry/spelling/normalized-reading records. */
export function buildPairedFrame(dataset, references) {
  if (!dataset?.entries || typeof dataset.entries !== "object" || Array.isArray(dataset.entries)) throw new TypeError("A candidate dataset must contain entries");
  const referenceIndex = new Map();
  const referenceIds = new Set();
  for (const row of references) {
    const key = referenceKey(row.id, row.written, row.reading);
    const values = referenceIndex.get(key) ?? [];
    values.push(row);
    referenceIndex.set(key, values);
    referenceIds.add(String(row.id));
  }
  const candidates = new Map();
  let rawRecords = 0;
  for (const [id, records] of Object.entries(dataset.entries)) {
    if (!/^\d+$/u.test(id) || !Array.isArray(records) || !records.length) throw new TypeError("Candidate entries require numeric IDs and nonempty record arrays");
    for (const record of records) {
      if (typeof record.written !== "string" || !record.written || typeof record.reading !== "string" || !record.reading) throw new TypeError("Candidate pairs require nonempty spelling and reading text");
      validateAlignment(record.written, record.reading, record.segments);
      ++rawRecords;
      const pairId = JSON.stringify([id, record.written, normalizeKana(record.reading)]);
      const rows = candidates.get(pairId) ?? [];
      rows.push(record);
      candidates.set(pairId, rows);
    }
  }
  const frame = [];
  const counts = {};
  const exclusions = {};
  for (const [pairId, records] of candidates) {
    const [id, written, reading] = JSON.parse(pairId);
    const candidate = records[0];
    const matches = referenceIndex.get(referenceKey(id, written, reading));
    const canonical = canonicalizeSegments(candidate.segments);
    const shapes = new Set(records.map(record => signature(canonicalizeSegments(record.segments).segments)));
    let result;
    if (shapes.size !== 1) result = { category: "uncomparable", reason: "multiple-candidate-alignments" };
    else if (matches === undefined) result = { category: "absent", reason: referenceIds.has(id) ? "missing-reference-pair" : "missing-reference-entry" };
    else result = compareReferenceRecord(candidate, matches);
    counts[result.category] = (counts[result.category] ?? 0) + 1;
    if (result.reason !== undefined) exclusions[result.reason] = (exclusions[result.reason] ?? 0) + 1;
    const reference = matches === undefined || result.category === "uncomparable" ? undefined :
      canonicalizeSegments(matches[0].segments, { reference: true }).segments;
    frame.push({
      pairId, familyId: `JMdict:${id}`, id, written, reading,
      equivalentRecords: records.length,
      category: result.category, ...(result.reason === undefined ? {} : { reason: result.reason }),
      flags: result.flags ?? [],
      candidate: canonical.segments, ...(reference === undefined ? {} : { reference })
    });
  }
  frame.sort((left, right) => compareText(left.pairId, right.pairId));
  return { frame, summary: { rawRecords, distinctPairs: frame.length, collapsedRecords: rawRecords - frame.length, counts, exclusions } };
}

/** Frozen hash ranks implement reproducible uniform sampling within strata. */
export function selectPairedAudit(frame, { seed = pairedAuditSeed, quotas = pairedAuditQuotas } = {}) {
  if (typeof seed !== "string" || seed.length === 0) throw new TypeError("The sampling seed must be a nonempty string");
  const selected = [];
  const populations = {};
  const seen = new Set();
  for (const row of frame) {
    if (typeof row.pairId !== "string" || !row.pairId.length) throw new TypeError("Every frame row requires a pair ID");
    if (seen.has(row.pairId)) throw new Error(`Duplicate frame pair ${row.pairId}`);
    seen.add(row.pairId);
  }
  for (const [category, quota] of Object.entries(quotas)) {
    if (!["coarser", "finer", "incompatible", "exact"].includes(category)) throw new Error(`Invalid comparison stratum ${category}`);
    if (!Number.isSafeInteger(quota) || quota < 0) throw new TypeError("Sampling quotas must be nonnegative integers");
    const rows = frame.filter(row => row.category === category).map(row => ({
      ...row, rank: hash(JSON.stringify([seed, "selection", category, row.pairId]))
    }));
    rows.sort((left, right) => compareText(left.rank, right.rank) || compareText(left.pairId, right.pairId));
    populations[category] = { pairs: rows.length, sample: Math.min(quota, rows.length) };
    selected.push(...rows.slice(0, quota));
  }
  selected.sort((left, right) => {
    const a = hash(JSON.stringify([seed, "packet-order", left.pairId]));
    const b = hash(JSON.stringify([seed, "packet-order", right.pairId]));
    return compareText(a, b) || compareText(left.pairId, right.pairId);
  });
  return {
    selected: selected.map((row, index) => ({ ...row, auditId: `P${String(index + 1).padStart(4, "0")}` })),
    populations
  };
}
