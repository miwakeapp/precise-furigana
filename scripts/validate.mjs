import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { algorithmVersion, compileAnnotations, defaultConfiguration, digest, generatorDigest, schemaVersion } from "../src/dataset.mjs";
import { pairKey, recordKey } from "../src/segments.mjs";
import { deriveOmittedParticles } from "../src/variants.mjs";
import { validateDisplayAlignment } from "../src/display.mjs";
import { contradictsSpelling, fitsSpelling, isMismatched } from "../src/pairings.mjs";
import { enumeratePairs, loadSources, makeCharacterReadings } from "../src/sources.mjs";

const { values } = parseArgs({ options: { directory: { type: "string", default: "dist" } } });
const bytes = await readFile(join(values.directory, "precise-furigana.json"));
const output = JSON.parse(bytes);
assert.equal(output.schemaVersion, schemaVersion);
assert.deepEqual(gunzipSync(await readFile(join(values.directory, "precise-furigana.json.gz"))), bytes);
const manifest = JSON.parse(await readFile(join(values.directory, "manifest.json"), "utf8"));
for (const [name, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(join(values.directory, name));
  assert.equal(contents.length, expected.bytes, `${name}: size`);
  assert.equal(digest(contents), expected.sha256, `${name}: SHA256`);
}
// Validation needs the input population and provenance, not a rebuilt aligner.
const { jmdict, kanjidic, lock } = await loadSources();
const { drops } = deriveOmittedParticles(jmdict, makeCharacterReadings(kanjidic));
const annotationsText = await readFile(new URL("../data/annotations.json", import.meta.url), "utf8");
const synthesized = new Map(JSON.parse(await readFile(new URL("../data/synthesized-pairs.json", import.meta.url), "utf8"))
  .map(item => [recordKey(item.id, item.written, item.reading), item]));
const annotations = compileAnnotations(JSON.parse(annotationsText));
assert.deepEqual(Object.keys(output), ["schemaVersion", "jmdictDate", "license", "attribution", "entries"]);
assert.equal(output.jmdictDate, lock.sources.jmdict.dictDate, "Output uses the locked input release");
// The manifest binds the evaluation to this database; its provenance records the build inputs.
const { provenance } = JSON.parse(await readFile(join(values.directory, "evaluation.json"), "utf8"));
assert.ok(manifest.files["evaluation.json"], "The manifest covers the evaluation");
assert.equal(provenance.algorithmVersion, algorithmVersion);
assert.equal(provenance.generatorSHA256, await generatorDigest(), "Output uses the current generator code");
assert.deepEqual(provenance.configuration, { ...defaultConfiguration, ...provenance.configuration });
assert.equal(provenance.sourcesSHA256, digest(JSON.stringify(lock)), "Output uses the locked input release");
assert.equal(provenance.annotationsSHA256, digest(annotationsText));
const jmdictPairs = new Map([...enumeratePairs(jmdict)].map(pair => [recordKey(pair.id, pair.written, pair.reading), pair]));
const expected = new Set(jmdictPairs.keys());
for (const key of annotations.keys()) assert.ok(expected.has(key) || synthesized.has(key), `Stale annotation absent from source dictionary: ${key}`);
let count = 0, synthesizedCount = 0;
const fitting = new Set(), spellings = new Set();
for (const [id, records] of Object.entries(output.entries)) {
  assert.ok(/^\d+$/u.test(id));
  assert.ok(records.length > 0);
  for (const record of records) {
    const key = recordKey(id, record.written, record.reading);
    validateDisplayAlignment(record.written, record.reading, record.segments);
    spellings.add(`${id}\t${record.written}`);
    if (record.pairing === "synthesized") {
      assert.deepEqual(Object.keys(record), ["written", "reading", "segments", "pairing"]);
      assert.ok(synthesized.delete(key) && !expected.has(key), `Synthesized pair is not a reviewed, non-JMdict pair: ${key}`);
      assert.ok(fitsSpelling(record.written, record.reading), `Synthesized pair does not fit its spelling: ${key}`);
      fitting.add(`${id}\t${record.written}`);
      ++synthesizedCount;
      continue;
    }
    assert.ok(expected.delete(key), `Unexpected or duplicated pair: ${key}`);
    const recordDrops = drops.get(pairKey(record.written, record.reading));
    const mismatched = isMismatched(jmdictPairs.get(key), recordDrops);
    assert.deepEqual(Object.keys(record), mismatched ? ["written", "reading", "segments", "pairing"] : ["written", "reading", "segments"]);
    if (mismatched) assert.equal(record.pairing, "mismatched");
    if (!contradictsSpelling(record.written, record.reading, recordDrops)) fitting.add(`${id}\t${record.written}`);
    ++count;
  }
}
assert.equal(expected.size, 0, "Every permitted JMdict spelling/reading pair is present");
assert.equal(synthesized.size, 0, `Every reviewed synthesized pair is present: ${[...synthesized.keys()].join(", ")}`);
for (const spelling of spellings) assert.ok(fitting.has(spelling), `No pair fits the spelling: ${spelling}`);
assert.equal(count, manifest.counts.pairs);
assert.equal(synthesizedCount, manifest.counts.synthesized);
assert.equal(Object.keys(output.entries).length, manifest.counts.entries);
console.log(`Validated ${count} pairs across ${Object.keys(output.entries).length} JMdict entries, spelling reconstruction, reading coverage, input provenance, gzip, and artifact checksums.`);
