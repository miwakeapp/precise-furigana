import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfiguration, digest } from "../src/dataset.mjs";
import { releaseDescriptor, verifyEvaluation, verifyExistingRelease } from "../scripts/release.mjs";

function fixture() {
  const goldText = JSON.stringify([{ written: "日本", reading: "にほん", segments: [["日", "に"], ["本", "ほん"]] }]);
  const database = { schemaVersion: 1, metadata: {
    algorithmVersion: "0.1.0", generatorSHA256: "generator", configuration: { ...defaultConfiguration }, annotationsSHA256: "annotations",
    sources: { release: { tag: "source-tag", url: "https://example.com/release" }, sources: { jmdict: { dictDate: "2026-10-05" } } },
    counts: { entries: 1, pairs: 1, ambiguous: 0, fallback: 0 }
  } };
  const evaluation = {
    provenance: { algorithmVersion: "0.1.0", generatorSHA256: "generator", configuration: { ...defaultConfiguration }, annotationsSHA256: "annotations",
      sourcesSHA256: digest(JSON.stringify(database.metadata.sources)), goldSHA256: digest(goldText) },
    summary: { examples: 1, passed: 1 },
    results: JSON.parse(goldText).map(example => ({ ...example, actual: example.segments, pass: true }))
  };
  return { goldText, database, evaluation };
}

test("release evaluation is bound to source, generator, configuration, and gold fixtures", () => {
  const { database, evaluation, goldText } = fixture();
  verifyEvaluation(database, evaluation, goldText, "generator");
  for (const key of ["generatorSHA256", "annotationsSHA256", "sourcesSHA256", "goldSHA256", "algorithmVersion"]) {
    const stale = structuredClone(evaluation);
    stale.provenance[key] = "stale";
    assert.throws(() => verifyEvaluation(database, stale, goldText, "generator"));
  }
  assert.throws(() => verifyEvaluation(database, evaluation, goldText, "new-generator"));
  evaluation.provenance.configuration.learnReadings = true;
  assert.throws(() => verifyEvaluation(database, evaluation, goldText, "generator"));
});

test("passing summary cannot conceal missing results or failed alignments", () => {
  const { database, evaluation, goldText } = fixture();
  const missing = structuredClone(evaluation);
  missing.results = [];
  assert.throws(() => verifyEvaluation(database, missing, goldText, "generator"));
  evaluation.results[0].actual = [["日本", "にほん"]];
  assert.throws(() => verifyEvaluation(database, evaluation, goldText, "generator"));
});

test("release retries require complete published assets", () => {
  const assets = { "database.json": { bytes: 3, sha256: "abc" } };
  const release = { draft: false, assets: [{ name: "database.json", size: 3, state: "uploaded", digest: "sha256:abc" }] };
  verifyExistingRelease(release, assets);
  assert.throws(() => verifyExistingRelease({ ...release, draft: true }, assets));
  assert.throws(() => verifyExistingRelease({ ...release, assets: [] }, assets));
  assert.throws(() => verifyExistingRelease({ ...release, assets: [{ ...release.assets[0], size: 1 }] }, assets));
});

test("release tags change with data content and retain source date", () => {
  const { database } = fixture();
  const first = releaseDescriptor(database, { files: { "precise-furigana.json": { sha256: "1234567890abcdef" } } });
  const second = releaseDescriptor(database, { files: { "precise-furigana.json": { sha256: "fedcba0987654321" } } });
  assert.match(first.tag, /^data-2026-10-05-v0\.1\.0-/u);
  assert.notEqual(first.tag, second.tag);
});
