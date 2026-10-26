import assert from "node:assert/strict";
import test from "node:test";
import { algorithmVersion, defaultConfiguration, digest } from "../src/dataset.mjs";
import { releaseDescriptor, verifyEvaluation, verifyExistingRelease } from "../scripts/release.mjs";

function fixture() {
  const goldText = JSON.stringify([{ written: "日本", reading: "にほん", segments: [["日", "に"], ["本", "ほん"]] }]);
  const current = { generatorSHA256: "generator", sourcesSHA256: "sources", annotationsSHA256: "annotations" };
  const evaluation = {
    provenance: { algorithmVersion, configuration: { ...defaultConfiguration }, ...current, goldSHA256: digest(goldText) },
    summary: { examples: 1, passed: 1 },
    results: JSON.parse(goldText).map(example => ({ ...example, actual: example.segments, pass: true }))
  };
  return { goldText, current, evaluation };
}

test("release evaluation is bound to source, generator, configuration, and gold fixtures", () => {
  const { current, evaluation, goldText } = fixture();
  verifyEvaluation(evaluation, goldText, current);
  for (const key of ["generatorSHA256", "annotationsSHA256", "sourcesSHA256", "goldSHA256", "algorithmVersion"]) {
    const stale = structuredClone(evaluation);
    stale.provenance[key] = "stale";
    assert.throws(() => verifyEvaluation(stale, goldText, current));
  }
  assert.throws(() => verifyEvaluation(evaluation, goldText, { ...current, generatorSHA256: "new-generator" }));
  evaluation.provenance.configuration.learnReadings = true;
  assert.throws(() => verifyEvaluation(evaluation, goldText, current));
});

test("passing summary cannot conceal missing results or failed alignments", () => {
  const { current, evaluation, goldText } = fixture();
  const missing = structuredClone(evaluation);
  missing.results = [];
  assert.throws(() => verifyEvaluation(missing, goldText, current));
  evaluation.results[0].actual = [["日本", "にほん"]];
  assert.throws(() => verifyEvaluation(evaluation, goldText, current));
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
  const lock = { release: { tag: "source-tag", url: "https://example.com/release" }, sources: { jmdict: { dictDate: "2026-10-05" } } };
  const manifest = sha256 => ({ schemaVersion: 2, algorithmVersion: "0.1.0", counts: { entries: 1, pairs: 1 }, files: { "precise-furigana.json": { sha256 } } });
  const first = releaseDescriptor(manifest("1234567890abcdef"), lock);
  const second = releaseDescriptor(manifest("fedcba0987654321"), lock);
  assert.match(first.tag, /^data-2026-10-05-v0\.1\.0-/u);
  assert.notEqual(first.tag, second.tag);
});
