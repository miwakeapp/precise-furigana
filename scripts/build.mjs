import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { algorithmVersion, digest, evaluationProvenance, loadDataset, schemaVersion } from "../src/dataset.mjs";
import { recordKey } from "../src/segments.mjs";

const { values } = parseArgs({ options: {
  output: { type: "string", default: "dist" },
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
const configuration = {
  terminalContraction: !values["no-contraction"],
  phonologicalAlternations: !values["no-phonology"],
  variantTransfers: !values["no-variants"],
  compoundVoicing: !values["no-compound-voicing"] && !values["no-phonology"],
  continuativeStems: !values["no-continuatives"],
  learnReadings: values["learn-readings"],
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
};
const dataset = await loadDataset(configuration);
const goldText = await readFile(new URL("../test/fixtures/gold.json", import.meta.url), "utf8");
const provenance = await evaluationProvenance(dataset, goldText);
const entries = {};
const seen = new Set();
const counts = { entries: 0, pairs: 0, aligned: 0, ambiguous: 0, fallback: 0, reviewed: 0, literal: 0, grouped: 0, split: 0 };
for (const pair of dataset.pairs()) {
  const key = recordKey(pair.id, pair.written, pair.reading);
  if (seen.has(key)) continue;
  seen.add(key);
  const result = dataset.alignPair(pair);
  const record = {
    written: pair.written, reading: pair.reading, segments: result.segments, status: result.status,
    evidence: result.evidence?.map(part => part.type) ?? result.segments.map(() => "reviewed")
  };
  (entries[pair.id] ??= []).push(record);
  ++counts.pairs;
  if (!(result.status in counts)) throw new Error(`Unknown status: ${result.status}`);
  ++counts[result.status];
  if (result.segments.every(segment => typeof segment === "string")) ++counts.literal;
  else if (result.segments.length === 1) ++counts.grouped;
  else ++counts.split;
}
for (const key of dataset.annotations.keys()) {
  if (!seen.has(key)) throw new Error(`Stale annotation absent from source dictionary: ${key}`);
}
counts.entries = Object.keys(entries).length;
const metadata = {
  algorithmVersion,
  generatorSHA256: provenance.generatorSHA256,
  configuration,
  license: "CC-BY-SA-4.0",
  attribution: "Based on JMdict and KANJIDIC2, copyright EDRDG, with Unicode Unihan and reviewed Wiktionary and JmdictFurigana data. See NOTICE.",
  sources: dataset.lock,
  annotationsSHA256: dataset.annotationsSHA256,
  counts
};
const output = JSON.stringify({ schemaVersion, metadata, entries }) + "\n";
const compressed = gzipSync(output, { level: 9 });
await mkdir(values.output, { recursive: true });
await writeFile(join(values.output, "precise-furigana.json"), output);
await writeFile(join(values.output, "precise-furigana.json.gz"), compressed);
await writeFile(join(values.output, "sources.lock.json"), JSON.stringify(dataset.lock, undefined, 2) + "\n");
const notice = await readFile(new URL("../NOTICE", import.meta.url));
await writeFile(join(values.output, "NOTICE"), notice);
await writeFile(join(values.output, "schema.json"), await readFile(new URL("../schema.json", import.meta.url)));
const manifest = { schemaVersion, algorithmVersion, counts, files: {} };
const files = ["precise-furigana.json", "precise-furigana.json.gz", "sources.lock.json", "NOTICE", "schema.json"];
try {
  const evaluation = JSON.parse(await readFile(join(values.output, "evaluation.json"), "utf8"));
  if (isDeepStrictEqual(evaluation.provenance, provenance)) files.push("evaluation.json");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const name of files) {
  const bytes = await readFile(join(values.output, name));
  manifest.files[name] = { bytes: bytes.length, sha256: digest(bytes) };
}
await writeFile(join(values.output, "manifest.json"), JSON.stringify(manifest, undefined, 2) + "\n");
console.log(JSON.stringify({ ...counts, bytes: Buffer.byteLength(output), gzipBytes: compressed.length }, undefined, 2));
