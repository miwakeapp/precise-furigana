import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { algorithmVersion, compileAnnotations, defaultConfiguration, digest, generatorDigest, schemaVersion } from "../src/dataset.mjs";
import { recordKey } from "../src/segments.mjs";
import { validateDisplayAlignment } from "../src/display.mjs";
import { enumeratePairs, loadSources } from "../src/sources.mjs";

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
const { jmdict, lock } = await loadSources();
const annotationsText = await readFile(new URL("../data/annotations.json", import.meta.url), "utf8");
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
const expected = new Set([...enumeratePairs(jmdict)].map(pair => recordKey(pair.id, pair.written, pair.reading)));
for (const key of annotations.keys()) assert.ok(expected.has(key), `Stale annotation absent from source dictionary: ${key}`);
let count = 0;
for (const [id, records] of Object.entries(output.entries)) {
  assert.ok(/^\d+$/u.test(id));
  assert.ok(records.length > 0);
  for (const record of records) {
    const key = recordKey(id, record.written, record.reading);
    assert.ok(expected.delete(key), `Unexpected or duplicated pair: ${key}`);
    assert.deepEqual(Object.keys(record), ["written", "reading", "segments"]);
    validateDisplayAlignment(record.written, record.reading, record.segments);
    ++count;
  }
}
assert.equal(expected.size, 0, "Every permitted JMdict spelling/reading pair is present");
assert.equal(count, manifest.counts.pairs);
assert.equal(Object.keys(output.entries).length, manifest.counts.entries);
console.log(`Validated ${count} pairs across ${Object.keys(output.entries).length} JMdict entries, spelling reconstruction, reading coverage, input provenance, gzip, and artifact checksums.`);
