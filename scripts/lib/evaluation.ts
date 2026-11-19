import { isDeepStrictEqual } from "node:util";
import { evaluationProvenance } from "../../src/dataset.ts";
import type { Dataset, EvaluationProvenance } from "../../src/dataset.ts";
import { boundaries, validateAlignment } from "../../src/segments.ts";
import type { AlignmentStatus, Segment } from "../../src/types.ts";

/** An example in `test/fixtures/gold.json`: a pair, and the segments it should divide into. */
export interface GoldExample {
  spelling: string;
  reading: string;
  segments: Segment[];
  /** What else the example records, such as its category. Results carry these through. */
  [field: string]: unknown;
}

export interface EvaluationResult extends GoldExample {
  /** The segments the generator produced. */
  actual: Segment[];
  status: AlignmentStatus;
  pass: boolean;
}

export interface EvaluationSummary {
  note: string;
  examples: number;
  passed: number;
  boundaryPrecision: number;
  boundaryRecall: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export interface Evaluation {
  provenance: EvaluationProvenance;
  summary: EvaluationSummary;
  results: EvaluationResult[];
}

/** What an evaluation needs of a dataset: its provenance, and its aligner without annotations. */
export type EvaluatedDataset = Parameters<typeof evaluationProvenance>[0] & Pick<Dataset, "align">;

export async function evaluateDataset(
  dataset: EvaluatedDataset,
  goldText: string,
): Promise<Evaluation> {
  const provenance = await evaluationProvenance(dataset, goldText);
  const gold: GoldExample[] = JSON.parse(goldText);
  const results: EvaluationResult[] = [];
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const example of gold) {
    validateAlignment(example.spelling, example.reading, example.segments);
    // Evaluate the algorithm directly; reviewed annotations cannot conceal regressions.
    const actual = dataset.align(example.spelling, example.reading);
    validateAlignment(example.spelling, example.reading, actual.segments);
    const expectedBoundaries = new Set(boundaries(example.segments));
    const actualBoundaries = new Set(boundaries(actual.segments));
    for (const boundary of actualBoundaries) {
      if (expectedBoundaries.has(boundary)) ++truePositive;
      else ++falsePositive;
    }
    for (const boundary of expectedBoundaries) {
      if (!actualBoundaries.has(boundary)) ++falseNegative;
    }
    results.push({
      ...example,
      actual: actual.segments,
      status: actual.status,
      pass: isDeepStrictEqual(example.segments, actual.segments),
    });
  }
  const summary: EvaluationSummary = {
    note: "Hand-authored regression set, not an estimate of corpus accuracy. An aligned status indicates algorithmic support, not human verification.",
    examples: results.length,
    passed: results.filter((result) => result.pass).length,
    boundaryPrecision: truePositive / (truePositive + falsePositive || 1),
    boundaryRecall: truePositive / (truePositive + falseNegative || 1),
    truePositive,
    falsePositive,
    falseNegative,
  };
  return { provenance, summary, results };
}
