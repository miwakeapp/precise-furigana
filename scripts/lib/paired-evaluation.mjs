function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer`);
  return value;
}

function identifier(value, name) {
  if (typeof value !== "string" || !value.length) throw new Error(`${name} must be a nonempty string`);
  return value;
}

function exactBounds(value, name) {
  if (value === null) return [0, 1];
  if (typeof value !== "boolean") throw new Error(`${name} must be true, false, or null for unresolved`);
  return [Number(value), Number(value)];
}

export function pairedExactBounds(row) {
  const candidate = exactBounds(row.candidateExact, "candidateExact");
  const reference = exactBounds(row.referenceExact, "referenceExact");
  return [candidate[0] - reference[1], candidate[1] - reference[0]];
}

// The minimum of the two valid moment-generating-function bounds in
// Bardenet and Maillard (2015), Propositions 2.2 and 2.3.
function finitePopulationFactor(sampleSize, populationSize) {
  if (sampleSize === populationSize) return 0;
  return Math.min(1 - (sampleSize - 1) / populationSize,
    (1 - sampleSize / populationSize) * (1 + 1 / sampleSize));
}

/**
 * Estimate a paired exact-acceptance difference after independent simple random
 * sampling without replacement within each frozen disagreement stratum.
 * `null` labels remain unresolved; callers must retain every selected pair.
 * Families describe annotation sensitivity and never change sampling weights.
 */
export function estimatePairedAccuracy({ sharedPairs, strata, outsideComparisonPairs = 0, alpha = 0.05 }) {
  count(sharedPairs, "sharedPairs");
  count(outsideComparisonPairs, "outsideComparisonPairs");
  if (!Array.isArray(strata)) throw new Error("strata must be an array");
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error("alpha must lie strictly between zero and one");

  const stratumIds = new Set();
  const pairIds = new Set();
  const families = new Map();
  let disagreementPairs = 0;
  const prepared = strata.map(stratum => {
    const id = identifier(stratum.id, "stratum id");
    if (stratumIds.has(id)) throw new Error(`Duplicate stratum ${id}`);
    stratumIds.add(id);
    const populationPairs = count(stratum.populationPairs, `${id} populationPairs`);
    disagreementPairs += populationPairs;
    if (!Array.isArray(stratum.samples)) throw new Error(`${id} samples must be an array`);
    if (stratum.samples.length > populationPairs) throw new Error(`Sample exceeds population in ${id}`);

    const samples = stratum.samples.map(row => {
      const pairId = identifier(row.pairId, "pairId");
      const familyId = identifier(row.familyId, "familyId");
      if (pairIds.has(pairId)) throw new Error(`Duplicate sampled pair ${pairId}`);
      pairIds.add(pairId);
      const bounds = pairedExactBounds(row);
      return { familyId, bounds };
    });
    return { id, populationPairs, samples };
  });

  const comparablePairs = count(sharedPairs + disagreementPairs, "comparablePairs");
  if (!comparablePairs) throw new Error("The comparison population must be nonempty");
  count(comparablePairs + outsideComparisonPairs, "allPairs");
  const differenceLimit = disagreementPairs / comparablePairs;
  const estimatedTotals = [0, 0];
  const feasibleTotals = [0, 0];
  let varianceProxy = 0;
  let designVariance = 0;
  let pointIdentified = true;
  let varianceIdentified = true;
  const byStratum = [];

  for (const { id, populationPairs, samples } of prepared) {
    const sampleSize = samples.length;
    const weight = populationPairs / comparablePairs;
    const totals = [0, 0];
    const outcomes = { candidateWins: 0, referenceWins: 0, ties: 0, unresolved: 0 };
    for (const { familyId, bounds } of samples) {
      totals[0] += bounds[0];
      totals[1] += bounds[1];
      const outcome = bounds[0] !== bounds[1] ? "unresolved" : bounds[0] === 1 ? "candidateWins" : bounds[0] === -1 ? "referenceWins" : "ties";
      ++outcomes[outcome];
      const pairWeight = weight / sampleSize;
      const family = families.get(familyId) ?? { sampledPairs: 0, estimatedCorpusShare: 0, lowerEstimateReduction: 0 };
      ++family.sampledPairs;
      family.estimatedCorpusShare += pairWeight;
      family.lowerEstimateReduction += pairWeight * (bounds[0] + 1);
      families.set(familyId, family);
    }

    const range = sampleSize ? totals.map(total => total / sampleSize) : populationPairs ? [-1, 1] : [0, 0];
    estimatedTotals[0] += sampleSize ? totals[0] * (populationPairs / sampleSize) : -populationPairs;
    estimatedTotals[1] += sampleSize ? totals[1] * (populationPairs / sampleSize) : populationPairs;
    const unsampled = populationPairs - sampleSize;
    feasibleTotals[0] += totals[0] - unsampled;
    feasibleTotals[1] += totals[1] + unsampled;
    const resolved = outcomes.unresolved === 0 && (sampleSize > 0 || populationPairs === 0);
    pointIdentified &&= resolved;
    const factor = sampleSize ? finitePopulationFactor(sampleSize, populationPairs) : 0;
    varianceProxy += sampleSize ? weight ** 2 * factor / sampleSize : 0;

    let variance = null;
    if (resolved && sampleSize === populationPairs) variance = 0;
    else if (resolved && sampleSize >= 2) {
      const sampleVariance = samples.reduce((sum, { bounds }) => sum + (bounds[0] - range[0]) ** 2, 0) / (sampleSize - 1);
      variance = (1 - sampleSize / populationPairs) * sampleVariance / sampleSize;
    }
    if (variance === null && populationPairs) varianceIdentified = false;
    else designVariance += weight ** 2 * (variance ?? 0);

    byStratum.push({
      id, populationPairs, sampleSize, populationWeight: weight,
      inclusionProbability: populationPairs ? sampleSize / populationPairs : null,
      inverseProbabilityWeight: sampleSize ? populationPairs / sampleSize : null,
      outcomes, pointEstimate: resolved ? range[0] : null, estimatedRange: range,
      contributionRange: range.map(value => weight * value),
      designStandardError: variance === null ? null : Math.sqrt(variance)
    });
  }

  // Each paired outcome lies in [-1, 1]. Independent stratum draws let their
  // moment-generating-function bounds multiply; the two tails share `alpha`.
  // Unsampled strata already contribute their full [-weight, weight] range.
  const estimatedRange = estimatedTotals.map(total => total / comparablePairs);
  const feasibleRange = feasibleTotals.map(total => total / comparablePairs);
  const radius = Math.sqrt(2 * Math.log(2 / alpha) * varianceProxy);
  const confidenceInterval = [
    Math.max(-differenceLimit, feasibleRange[0], estimatedRange[0] - radius),
    Math.min(differenceLimit, feasibleRange[1], estimatedRange[1] + radius)
  ];
  const familyValues = [...families.values()];
  const maximumFamilyReduction = familyValues.reduce((maximum, family) => Math.max(maximum, family.lowerEstimateReduction), 0);

  return {
    estimand: "Candidate minus reference exact accepted alignment rate among comparable pairs",
    comparablePairs, sharedPairs, disagreementPairs, outsideComparisonPairs,
    pointEstimate: pointIdentified ? estimatedRange[0] : null,
    estimatedRange,
    confidence: { level: 1 - alpha, method: "Independent stratified SRS without replacement; Hoeffding–Serfling bound", interval: confidenceInterval, radius },
    designStandardError: varianceIdentified ? Math.sqrt(designVariance) : null,
    candidateAdvantageEstablished: confidenceInterval[0] > 0,
    referenceAdvantageEstablished: confidenceInterval[1] < 0,
    byStratum,
    familySensitivity: {
      sampledFamilies: families.size,
      largestSampledFamily: familyValues.reduce((maximum, family) => Math.max(maximum, family.sampledPairs), 0),
      largestEstimatedCorpusShare: familyValues.reduce((maximum, family) => Math.max(maximum, family.estimatedCorpusShare), 0),
      lowerEstimateIfOneSampledFamilyBecomesUnresolved: estimatedRange[0] - maximumFamilyReduction,
      notice: "Descriptive annotation sensitivity, not a confidence interval. Family assignments must be frozen before labels; a sampled relative never substitutes for unreviewed pairs."
    },
    notice: "Bounds require frozen systems, fixed sample sizes, independent random samples within strata, complete sample retention, and correct accepted-label judgments. They cover sampling and explicitly unresolved labels, not systematic annotation errors. Shared alignments are paired ties, not certified correct. Rows outside the comparison population are not counted as reference errors."
  };
}
