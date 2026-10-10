import test from "node:test";
import assert from "node:assert/strict";
import { estimatePairedAccuracy, pairedExactBounds } from "../scripts/lib/paired-evaluation.mjs";

const row = (pairId, difference, familyId = pairId) => ({
  pairId, familyId, candidateExact: difference === null ? null : difference >= 0,
  referenceExact: difference === null ? null : difference <= 0
});
const stratum = (id, populationPairs, differences) => ({
  id, populationPairs, samples: differences.map((difference, index) => row(`${id}-${index}`, difference))
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test("paired accuracy weights population strata and includes mechanical shared ties", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 80, strata: [
    stratum("large", 18, [1, 1]), stratum("small", 2, [-1, -1])
  ] });
  close(result.pointEstimate, 0.16);
  assert.equal(result.byStratum[0].inverseProbabilityWeight, 9);
  assert.equal(result.byStratum[1].inverseProbabilityWeight, 1);
  assert.equal(result.comparablePairs, 100);
  // Identical observed wins do not remove finite-sample uncertainty.
  assert.ok(result.confidence.radius > 0);
  assert.equal(result.designStandardError, 0);
});

test("a census has no sampling error and counts exact ties fairly", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 5, strata: [stratum("all", 5, [1, 1, -1, 0, 0])] });
  close(result.pointEstimate, 0.1);
  assert.deepEqual(result.confidence.interval, [0.1, 0.1]);
  assert.equal(result.confidence.radius, 0);
  assert.equal(result.candidateAdvantageEstablished, true);
  assert.deepEqual(result.byStratum[0].outcomes, { candidateWins: 2, referenceWins: 1, ties: 2, unresolved: 0 });
});

test("stratified censuses do not turn arithmetic rounding into an advantage", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 19, strata: [
    stratum("a", 7, [1, 1, 1, 0, 0, 0, 0]), stratum("b", 9, [-1, -1, -1, 0, 0, 0, 0, 0, 0])
  ] });
  assert.equal(result.pointEstimate, 0);
  assert.deepEqual(result.confidence.interval, [0, 0]);
  assert.equal(result.candidateAdvantageEstablished, false);
  assert.equal(result.referenceAdvantageEstablished, false);
});

test("unresolved rows widen the answer even in a census", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 8, strata: [stratum("all", 2, [1, null])] });
  assert.equal(result.pointEstimate, null);
  assert.deepEqual(result.estimatedRange, [0, 0.2]);
  assert.deepEqual(result.confidence.interval, [0, 0.2]);
  assert.equal(result.candidateAdvantageEstablished, false);
  assert.equal(result.byStratum[0].outcomes.unresolved, 1);
  assert.deepEqual(pairedExactBounds({ candidateExact: true, referenceExact: null }), [0, 1]);
  assert.deepEqual(pairedExactBounds({ candidateExact: null, referenceExact: true }), [-1, 0]);
});

test("no observations preserve the entire stratum uncertainty", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 80, strata: [stratum("unreviewed", 20, [])] });
  assert.equal(result.pointEstimate, null);
  assert.deepEqual(result.confidence.interval, [-0.2, 0.2]);
  assert.equal(result.designStandardError, null);
  assert.equal(result.candidateAdvantageEstablished, false);
});

test("reference coverage gaps do not count as errors or change the estimand", () => {
  const input = { sharedPairs: 8, strata: [stratum("all", 2, [1, -1])] };
  const result = estimatePairedAccuracy({ ...input, outsideComparisonPairs: 100 });
  assert.equal(result.outsideComparisonPairs, 100);
  assert.equal(result.comparablePairs, 10);
  assert.equal(result.pointEstimate, estimatePairedAccuracy(input).pointEstimate);
  assert.deepEqual(result.confidence.interval, [0, 0]);
});

test("family annotation sensitivity retains pair weights across strata", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 80, strata: [
    { id: "first", populationPairs: 18, samples: [row("a", 1, "relatives"), row("b", 1, "relatives")] },
    { id: "second", populationPairs: 2, samples: [row("c", 1, "relatives"), row("d", 1, "other")] }
  ] });
  assert.equal(result.familySensitivity.sampledFamilies, 2);
  assert.equal(result.familySensitivity.largestSampledFamily, 3);
  close(result.familySensitivity.largestEstimatedCorpusShare, 0.19);
  close(result.familySensitivity.lowerEstimateIfOneSampledFamilyBecomesUnresolved, -0.18);
});

test("finite-population standard error follows the actual pair sampling design", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 10, strata: [stratum("random", 10, [1, -1])] });
  close(result.designStandardError, Math.sqrt(0.2));
  close(result.confidence.radius, Math.sqrt(2 * Math.log(40) * 0.25 * 0.9 / 2));
  assert.ok(result.confidence.interval[0] >= -0.5);
  assert.ok(result.confidence.interval[1] <= 0.5);
});

test("strict sample validation rejects invalid labels and duplicate weighting", () => {
  const valid = { sharedPairs: 0, strata: [stratum("all", 2, [1, -1])] };
  assert.throws(() => estimatePairedAccuracy({ ...valid, alpha: 0 }), /alpha/);
  assert.throws(() => estimatePairedAccuracy({ ...valid, sharedPairs: -1 }), /sharedPairs/);
  assert.throws(() => estimatePairedAccuracy({ ...valid, strata: [stratum("all", 1, [1, -1])] }), /exceeds/);
  assert.throws(() => estimatePairedAccuracy({ ...valid, strata: [valid.strata[0], valid.strata[0]] }), /Duplicate stratum/);
  assert.throws(() => estimatePairedAccuracy({ sharedPairs: 0, strata: [{ id: "all", populationPairs: 2, samples: [row("same", 1), row("same", -1)] }] }), /Duplicate sampled pair/);
  assert.throws(() => pairedExactBounds({ candidateExact: true }), /referenceExact/);
  assert.throws(() => pairedExactBounds({ candidateExact: "true", referenceExact: false }), /candidateExact/);
});

test("all shared pairs imply a known paired tie without certifying accuracy", () => {
  const result = estimatePairedAccuracy({ sharedPairs: 100, strata: [] });
  assert.equal(result.pointEstimate, 0);
  assert.deepEqual(result.confidence.interval, [0, 0]);
  assert.equal(result.candidateAdvantageEstablished, false);
});
