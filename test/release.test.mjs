import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { defaultConfiguration, digest, schemaVersion } from "../src/dataset.mjs";
import {
  databaseVersion,
  parseDatabaseVersion,
  stampVersion,
  writeDatabase,
} from "../scripts/lib/database-files.mjs";
import {
  releaseDescriptor,
  releasedRevisions,
  verifyEvaluation,
  verifyExistingRelease,
} from "../scripts/release.mjs";

function fixture() {
  const goldText = JSON.stringify([
    {
      spelling: "日本",
      reading: "にほん",
      segments: [
        ["日", "に"],
        ["本", "ほん"],
      ],
    },
  ]);
  const current = {
    generatorSHA256: "generator",
    sourcesSHA256: "sources",
    annotationsSHA256: "annotations",
  };
  const evaluation = {
    provenance: {
      configuration: { ...defaultConfiguration },
      ...current,
      goldSHA256: digest(goldText),
    },
    summary: { examples: 1, passed: 1 },
    results: JSON.parse(goldText).map((example) => ({
      ...example,
      actual: example.segments,
      pass: true,
    })),
  };
  return { goldText, current, evaluation };
}

test("release evaluation is bound to source, generator, configuration, and gold fixtures", () => {
  const { current, evaluation, goldText } = fixture();
  verifyEvaluation(evaluation, goldText, current);
  for (const key of ["generatorSHA256", "annotationsSHA256", "sourcesSHA256", "goldSHA256"]) {
    const stale = structuredClone(evaluation);
    stale.provenance[key] = "stale";
    assert.throws(() => verifyEvaluation(stale, goldText, current));
  }
  assert.throws(() =>
    verifyEvaluation(evaluation, goldText, { ...current, generatorSHA256: "new-generator" }),
  );
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
  const release = {
    draft: false,
    assets: [{ name: "database.json", size: 3, state: "uploaded", digest: "sha256:abc" }],
  };
  verifyExistingRelease(release, assets);
  assert.throws(() => verifyExistingRelease({ ...release, draft: true }, assets));
  assert.throws(() => verifyExistingRelease({ ...release, assets: [] }, assets));
  assert.throws(() =>
    verifyExistingRelease({ ...release, assets: [{ ...release.assets[0], size: 1 }] }, assets),
  );
  assert.throws(() =>
    verifyExistingRelease(
      { ...release, assets: [{ ...release.assets[0], digest: "sha256:def" }] },
      assets,
    ),
  );
  assert.throws(() =>
    verifyExistingRelease({ ...release, assets: [{ ...release.assets[0], digest: null }] }, assets),
  );
});

test("a version is the schema version, the dictionary date, and a revision", async () => {
  assert.equal(databaseVersion("2026-11-16", 3), `${schemaVersion}.20261116.3`);
  assert.equal(databaseVersion("2026-11-16"), `${schemaVersion}.20261116.0-dev`);
  assert.deepEqual(parseDatabaseVersion("1.20261116.12"), {
    schemaVersion: 1,
    jmdictDate: "2026-11-16",
    revision: 12,
  });
  assert.equal(parseDatabaseVersion("1.20261116.0-dev").revision, undefined);
  for (const invalid of ["1.2026-11-16.0", "1.20261116", "1.20261116.01", "v1.20261116.0"]) {
    assert.throws(() => parseDatabaseVersion(invalid));
  }
  // The package is private; its major only restates the schema version.
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(Number(version.split(".")[0]), schemaVersion);
});

test("released revisions are read from tags for the same schema and date", () => {
  const refs = [
    "refs/tags/v1.20261116.0",
    "refs/tags/v1.20261116.10",
    "refs/tags/v1.20261116.2",
    "refs/tags/v1.20261116.0-dev",
    "refs/tags/v1.20261116.1x",
  ].map((ref) => ({ ref }));
  assert.deepEqual(releasedRevisions(refs, "2026-11-16"), [0, 2, 10]);
  assert.deepEqual(releasedRevisions([], "2026-11-16"), []);
});

test("stamping a version rewrites both files and the manifest consistently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "precise-furigana-"));
  try {
    const database = { version: "1.20261116.0-dev", schemaVersion: 1, entries: {} };
    const files = await writeDatabase(directory, database);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ version: database.version, files: { ...files, "evaluation.json": {} } }),
    );
    const manifest = await stampVersion(directory, "1.20261116.4");
    assert.equal(manifest.version, "1.20261116.4");
    assert.deepEqual(manifest.files["evaluation.json"], {});
    const json = await readFile(join(directory, "precise-furigana.json"));
    assert.deepEqual(JSON.parse(json), { ...database, version: "1.20261116.4" });
    assert.deepEqual(Object.keys(JSON.parse(json)), Object.keys(database));
    assert.deepEqual(gunzipSync(await readFile(join(directory, "precise-furigana.json.gz"))), json);
    assert.deepEqual(manifest.files["precise-furigana.json"], {
      bytes: json.length,
      sha256: digest(json),
    });
    // Stamping the same version again reproduces the same bytes, which is how a rerun
    // recognizes a database that is already released.
    const again = await stampVersion(directory, "1.20261116.4");
    assert.deepEqual(again.files, manifest.files);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a release is tagged with its version", () => {
  const lock = { release: { tag: "source-tag", url: "https://example.com/release" } };
  const manifest = {
    version: "1.20261116.2",
    counts: { entries: 1, pairs: 1 },
    files: { "precise-furigana.json": { sha256: "1234567890abcdef" } },
  };
  const descriptor = releaseDescriptor(manifest, lock);
  assert.equal(descriptor.tag, "v1.20261116.2");
  assert.equal(descriptor.title, "Precise Furigana 1.20261116.2");
  assert.match(descriptor.notes, /JMdict 2026-11-16/u);
  assert.match(descriptor.notes, /1234567890abcdef/u);
});
