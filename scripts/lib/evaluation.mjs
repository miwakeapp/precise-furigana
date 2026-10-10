import { isDeepStrictEqual } from "node:util";
import { evaluationProvenance } from "../../src/dataset.mjs";
import { boundaries, validateAlignment } from "../../src/segments.mjs";

export async function evaluateDataset(dataset, goldText) {
  const provenance = await evaluationProvenance(dataset, goldText);
  const gold = JSON.parse(goldText);
  const results = [];
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const example of gold) {
    validateAlignment(example.written, example.reading, example.segments);
    // Evaluate the algorithm directly; reviewed annotations cannot conceal regressions.
    const actual = dataset.align(example.written, example.reading);
    validateAlignment(example.written, example.reading, actual.segments);
    const expectedBoundaries = new Set(boundaries(example.segments));
    const actualBoundaries = new Set(boundaries(actual.segments));
    for (const boundary of actualBoundaries) {
      if (expectedBoundaries.has(boundary)) ++truePositive;
      else ++falsePositive;
    }
    for (const boundary of expectedBoundaries) {
      if (!actualBoundaries.has(boundary)) ++falseNegative;
    }
    results.push({ ...example, actual: actual.segments, status: actual.status, pass: isDeepStrictEqual(example.segments, actual.segments) });
  }
  const summary = {
    note: "Hand-authored regression set, not an estimate of corpus accuracy. An aligned status indicates algorithmic support, not human verification.",
    examples: results.length,
    passed: results.filter(result => result.pass).length,
    boundaryPrecision: truePositive / (truePositive + falsePositive || 1),
    boundaryRecall: truePositive / (truePositive + falseNegative || 1),
    truePositive, falsePositive, falseNegative
  };
  return { provenance, summary, results };
}
