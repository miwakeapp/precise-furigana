import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { algorithmVersion, compileAnnotations, defaultConfiguration, digest, generatorDigest, schemaVersion } from "../src/dataset.mjs";
import { recordKey, validateAlignment } from "../src/segments.mjs";
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
assert.equal(output.metadata.algorithmVersion, algorithmVersion);
assert.equal(output.metadata.generatorSHA256, await generatorDigest(), "Output uses the current generator code");
assert.deepEqual(output.metadata.configuration, { ...defaultConfiguration, ...output.metadata.configuration });
assert.deepEqual(output.metadata.sources, lock, "Output uses the locked input release");
assert.equal(output.metadata.annotationsSHA256, digest(annotationsText));
const expected = new Set([...enumeratePairs(jmdict)].map(pair => recordKey(pair.id, pair.written, pair.reading)));
for (const key of annotations.keys()) assert.ok(expected.has(key), `Stale annotation absent from source dictionary: ${key}`);
let count = 0;
for (const [id, records] of Object.entries(output.entries)) {
  assert.ok(/^\d+$/u.test(id));
  assert.ok(records.length > 0);
  for (const record of records) {
    const key = recordKey(id, record.written, record.reading);
    assert.ok(expected.delete(key), `Unexpected or duplicated pair: ${key}`);
    assert.ok(["aligned", "ambiguous", "fallback", "reviewed"].includes(record.status));
    assert.equal(record.evidence.length, record.segments.length);
    assert.ok(record.evidence.every(type => ["literal", "character", "phonological", "dictionary", "ambiguous", "fallback", "reviewed"].includes(type)));
    validateAlignment(record.written, record.reading, record.segments);
    ++count;
  }
}
assert.equal(expected.size, 0, "Every permitted JMdict spelling/reading pair is present");
assert.equal(count, output.metadata.counts.pairs);
assert.equal(Object.keys(output.entries).length, output.metadata.counts.entries);
console.log(`Validated ${count} pairs across ${Object.keys(output.entries).length} JMdict entries, exact reconstruction, input provenance, gzip, and artifact checksums.`);
