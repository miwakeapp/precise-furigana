import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { defaultConfiguration, digest, generatorDigest } from "../src/dataset.mjs";

export function releaseDescriptor(database, manifest) {
  const date = database.metadata.sources.sources.jmdict.dictDate;
  const hash = digest(JSON.stringify(manifest));
  const tag = `data-${date}-v${database.metadata.algorithmVersion}-${hash.slice(0, 12)}`;
  const counts = database.metadata.counts;
  const source = database.metadata.sources.release;
  return {
    tag,
    title: `Precise furigana · ${date}`,
    notes: `Furigana alignments for ${counts.entries.toLocaleString("en-US")} JMdict entries and ${counts.pairs.toLocaleString("en-US")} permitted spelling/reading pairs, based on [jmdict-simplified ${source.tag}](${source.url}).\n\nDownload \`precise-furigana.json.gz\` for the compressed database. The JSON is indexed by JMdict ID; plain strings are shown without ruby and two-element arrays are [written text, reading] ruby segments. The manifest contains SHA256 digests.\n\nAlgorithm ${database.metadata.algorithmVersion}, schema ${database.schemaVersion}. Statuses describe model support, not measured accuracy. Irregular or unresolved spans may remain grouped; ${counts.ambiguous} pairs have tied boundaries or unresolved kana correspondence. The accompanying evaluation is a regression suite, not a representative accuracy estimate.\n\nDictionary-derived data: CC BY-SA 4.0, based on JMdict and KANJIDIC2, copyright James William Breen and EDRDG. See NOTICE and sources.lock.json for attribution, source versions, and checksums.\n`
  };
}

export function verifyEvaluation(database, evaluation, goldText, currentGeneratorSHA256) {
  assert.deepEqual(database.metadata.configuration, defaultConfiguration, "Experimental configurations must not be published");
  assert.equal(evaluation.provenance.generatorSHA256, database.metadata.generatorSHA256);
  assert.equal(evaluation.provenance.generatorSHA256, currentGeneratorSHA256);
  assert.equal(evaluation.provenance.algorithmVersion, database.metadata.algorithmVersion);
  assert.equal(evaluation.provenance.sourcesSHA256, digest(JSON.stringify(database.metadata.sources)));
  assert.equal(evaluation.provenance.annotationsSHA256, database.metadata.annotationsSHA256);
  assert.deepEqual(evaluation.provenance.configuration, database.metadata.configuration);
  assert.equal(evaluation.provenance.goldSHA256, digest(goldText));
  const gold = JSON.parse(goldText);
  assert.ok(gold.length > 0);
  assert.equal(evaluation.results.length, gold.length);
  for (const [index, example] of gold.entries()) {
    const result = evaluation.results[index];
    for (const key of Object.keys(example)) assert.deepEqual(result[key], example[key]);
    assert.ok(result.pass && isDeepStrictEqual(result.actual, example.segments), `Regression failed: ${example.written}/${example.reading}`);
  }
  assert.equal(evaluation.summary.examples, gold.length);
  assert.equal(evaluation.summary.passed, gold.length, "All regression examples must pass before release");
}

export function verifyExistingRelease(release, assets) {
  assert.equal(release.draft, false, "An incomplete draft release exists; inspect it before retrying");
  for (const [name, expected] of Object.entries(assets)) {
    const asset = release.assets.find(candidate => candidate.name === name);
    assert.ok(asset, `Existing release is incomplete: missing ${name}`);
    assert.equal(asset.state, "uploaded", `${name} upload is incomplete`);
    assert.equal(asset.size, expected.bytes, `${name} has an unexpected size`);
    if (asset.digest !== undefined && asset.digest !== null) assert.equal(asset.digest, `sha256:${expected.sha256}`, `${name} checksum`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    publish: { type: "boolean", default: false },
    directory: { type: "string", default: "dist" }
  } });
  const manifest = JSON.parse(await readFile(join(values.directory, "manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(values.directory, name));
    assert.equal(digest(bytes), expected.sha256, `${name}: SHA256`);
  }
  const database = JSON.parse(await readFile(join(values.directory, "precise-furigana.json"), "utf8"));
  const evaluation = JSON.parse(await readFile(join(values.directory, "evaluation.json"), "utf8"));
  assert.ok(manifest.files["evaluation.json"], "Run build with matching inputs before release");
  verifyEvaluation(database, evaluation, await readFile(new URL("../test/fixtures/gold.json", import.meta.url)), await generatorDigest());
  const descriptor = releaseDescriptor(database, manifest);
  const notesPath = join(values.directory, "release-notes.md");
  await writeFile(notesPath, descriptor.notes);
  console.log(JSON.stringify(descriptor, undefined, 2));
  if (!values.publish) return;

  const repository = process.env.GITHUB_REPOSITORY;
  const revision = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN;
  assert.match(repository ?? "", /^[\w.-]+\/[\w.-]+$/u, "Set GITHUB_REPOSITORY to owner/repository");
  assert.match(revision ?? "", /^[a-f0-9]{40}$/u, "Set GITHUB_SHA to the source commit");
  assert.ok(token, "Set GH_TOKEN");
  const existing = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(descriptor.tag)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000)
  });
  if (existing.ok) {
    const assets = { ...manifest.files };
    const manifestBytes = await readFile(join(values.directory, "manifest.json"));
    assets["manifest.json"] = { bytes: manifestBytes.length, sha256: digest(manifestBytes) };
    verifyExistingRelease(await existing.json(), assets);
    console.log(`Release ${descriptor.tag} already exists; no changes published.`);
    return;
  }
  if (existing.status !== 404) throw new Error(`Release lookup failed: HTTP ${existing.status}`);
  const files = ["precise-furigana.json", "precise-furigana.json.gz", "manifest.json", "sources.lock.json", "NOTICE", "evaluation.json", "schema.json"];
  execFileSync("gh", ["release", "create", descriptor.tag, "--repo", repository, "--target", revision,
    "--title", descriptor.title, "--notes-file", notesPath, ...files.map(name => join(values.directory, name))], { stdio: "inherit" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
