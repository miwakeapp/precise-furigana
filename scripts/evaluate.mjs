import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { dirname } from "node:path";
import { evaluationProvenance, loadDataset } from "../src/dataset.mjs";
import { boundaries, validateAlignment } from "../src/segments.mjs";

const { values } = parseArgs({ options: {
  output: { type: "string", default: "dist/evaluation.json" },
  "no-contraction": { type: "boolean", default: false },
  "no-phonology": { type: "boolean", default: false },
  "no-variants": { type: "boolean", default: false },
  "no-compound-voicing": { type: "boolean", default: false },
  "no-continuatives": { type: "boolean", default: false },
  "learn-readings": { type: "boolean", default: false },
  "no-weak-readings": { type: "boolean", default: false },
  "no-kana-substitutions": { type: "boolean", default: false },
  "no-numerals": { type: "boolean", default: false },
  "no-reading-variants": { type: "boolean", default: false },
  "no-kana-correspondence": { type: "boolean", default: false },
  "no-internal-anchors": { type: "boolean", default: false },
  "no-han-substitutions": { type: "boolean", default: false },
  "no-unvoicing": { type: "boolean", default: false },
  "no-renjo": { type: "boolean", default: false },
  "no-phonetic-ateji": { type: "boolean", default: false },
  "no-counter-symbols": { type: "boolean", default: false },
  "no-latin-substitutions": { type: "boolean", default: false },
  "no-loan-readings": { type: "boolean", default: false },
  "no-untagged-katakana-loans": { type: "boolean", default: false },
  "no-nasal-loss": { type: "boolean", default: false },
  "no-initial-voicing": { type: "boolean", default: false },
  "no-unihan-readings": { type: "boolean", default: false },
  "no-foreign-numerals": { type: "boolean", default: false },
  "no-unihan-voicing": { type: "boolean", default: false },
  "no-unihan-yoon": { type: "boolean", default: false },
  "no-listed-character-readings": { type: "boolean", default: false },
  "no-reviewed-lexical-evidence": { type: "boolean", default: false },
  "no-unihan-on-lengthening": { type: "boolean", default: false },
  "no-native-compounds": { type: "boolean", default: false },
  "no-english-character-readings": { type: "boolean", default: false },
  "no-listed-phonology": { type: "boolean", default: false },
  "no-korean-readings": { type: "boolean", default: false },
  "no-untagged-katakana-korean": { type: "boolean", default: false },
  "no-on-reading-spelling": { type: "boolean", default: false },
  "no-source-unit-transfers": { type: "boolean", default: false },
  "no-separator-transfers": { type: "boolean", default: false },
  "no-virtual-separator-sources": { type: "boolean", default: false },
  "no-shared-run-transfers": { type: "boolean", default: false }
} });
const dataset = await loadDataset({
  terminalContraction: !values["no-contraction"], phonologicalAlternations: !values["no-phonology"],
  variantTransfers: !values["no-variants"], compoundVoicing: !values["no-compound-voicing"] && !values["no-phonology"],
  continuativeStems: !values["no-continuatives"], learnReadings: values["learn-readings"],
  weakReadings: !values["no-weak-readings"], kanaSubstitutions: !values["no-kana-substitutions"],
  numeralTransfers: !values["no-numerals"], readingVariants: !values["no-reading-variants"],
  kanaRunCorrespondence: !values["no-kana-correspondence"], internalKanaAnchors: !values["no-internal-anchors"], hanSubstitutions: !values["no-han-substitutions"],
  dictionaryUnvoicing: !values["no-unvoicing"], dictionaryRenjo: !values["no-renjo"], phoneticAteji: !values["no-phonetic-ateji"], counterSymbols: !values["no-counter-symbols"], latinSubstitutions: !values["no-latin-substitutions"],
  loanReadings: !values["no-loan-readings"], untaggedKatakanaLoans: !values["no-untagged-katakana-loans"],
  dictionaryNasalLoss: !values["no-nasal-loss"], dictionaryInitialVoicing: !values["no-initial-voicing"], unihanReadings: !values["no-unihan-readings"],
  foreignNumerals: !values["no-foreign-numerals"],
  unihanVoicing: !values["no-unihan-voicing"], unihanYoon: !values["no-unihan-yoon"],
  listedCharacterReadings: !values["no-listed-character-readings"], reviewedLexicalEvidence: !values["no-reviewed-lexical-evidence"],
  unihanOnLengthening: !values["no-unihan-on-lengthening"], nativeCompounds: !values["no-native-compounds"],
  englishCharacterReadings: !values["no-english-character-readings"],
  listedPhonology: !values["no-listed-phonology"],
  koreanReadings: !values["no-korean-readings"], untaggedKatakanaKorean: !values["no-untagged-katakana-korean"],
  onReadingSpelling: !values["no-on-reading-spelling"],
  sourceUnitTransfers: !values["no-source-unit-transfers"],
  separatorTransfers: !values["no-separator-transfers"],
  virtualSeparatorSources: !values["no-virtual-separator-sources"],
  sharedRunTransfers: !values["no-shared-run-transfers"]
});
const goldText = await readFile(new URL("../test/fixtures/gold.json", import.meta.url), "utf8");
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
await mkdir(dirname(values.output), { recursive: true });
await writeFile(values.output, JSON.stringify({ provenance, summary, results }, undefined, 2) + "\n");
console.log(JSON.stringify(summary, undefined, 2));
for (const failure of results.filter(result => !result.pass)) {
  console.log(`${failure.written}/${failure.reading}: expected ${JSON.stringify(failure.segments)}, got ${JSON.stringify(failure.actual)} (${failure.status})`);
}
if (summary.passed !== summary.examples) process.exitCode = 1;
