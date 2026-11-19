import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { defaultConfiguration, digest, generatorDigest } from "../src/dataset.mjs";
import { defaultLockPath } from "../src/sources.mjs";
import {
  databaseFile,
  databaseVersion,
  parseDatabaseVersion,
  releaseFiles,
  stampVersion,
} from "./lib/database-files.mjs";

/** The line of a release's notes that identifies its database, whatever compressed it. */
const checksumLine = (manifest) =>
  `\`${databaseFile}\` SHA-256: \`${manifest.files[databaseFile].sha256}\``;

export function releaseDescriptor(manifest, lock) {
  const { counts, version } = manifest;
  const { jmdictDate } = parseDatabaseVersion(version);
  const count = (value) => value.toLocaleString("en-US");
  return {
    tag: `v${version}`,
    title: `Precise Furigana ${version}`,
    notes: [
      `Furigana for ${count(counts.pairs)} spelling/reading pairs across ${count(counts.entries)} JMdict entries, from JMdict ${jmdictDate} ([jmdict-simplified ${lock.release.tag}](${lock.release.url})).`,
      `- \`${releaseFiles[0]}\` holds \`${databaseFile}\` with its schema, notices and license.\n- \`${releaseFiles[1]}\` is \`${databaseFile}\` alone, compressed with Zstandard.`,
      checksumLine(manifest),
      "The data is under CC BY-SA 4.0, based on JMdict and KANJIDIC2, copyright James William Breen and EDRDG. `NOTICE.md` in the archive has full attribution.",
    ]
      .join("\n\n")
      .concat("\n"),
  };
}

/** The revisions already released for a version's schema and dictionary date, from its tags. */
export function releasedRevisions(refs, jmdictDate) {
  const prefix = `refs/tags/v${databaseVersion(jmdictDate, "")}`;
  return refs
    .map(({ ref }) => ref)
    .filter((ref) => ref.startsWith(prefix) && /^(0|[1-9]\d*)$/u.test(ref.slice(prefix.length)))
    .map((ref) => Number(ref.slice(prefix.length)))
    .sort((left, right) => left - right);
}

/** Bind the regression results to the inputs being released. */
export function verifyEvaluation(evaluation, goldText, current) {
  const { provenance } = evaluation;
  assert.deepEqual(
    provenance.configuration,
    defaultConfiguration,
    "Experimental configurations must not be published",
  );
  assert.equal(provenance.generatorSHA256, current.generatorSHA256);
  assert.equal(provenance.sourcesSHA256, current.sourcesSHA256);
  assert.equal(provenance.annotationsSHA256, current.annotationsSHA256);
  assert.equal(provenance.goldSHA256, digest(goldText));
  const gold = JSON.parse(goldText);
  assert.ok(gold.length > 0);
  assert.equal(evaluation.results.length, gold.length);
  for (const [index, example] of gold.entries()) {
    const result = evaluation.results[index];
    for (const key of Object.keys(example)) assert.deepEqual(result[key], example[key]);
    assert.ok(
      result.pass && isDeepStrictEqual(result.actual, example.segments),
      `Regression failed: ${example.spelling}/${example.reading}`,
    );
  }
  assert.equal(evaluation.summary.examples, gold.length);
  assert.equal(
    evaluation.summary.passed,
    gold.length,
    "All regression examples must pass before release",
  );
}

/**
 * Check that a release which already holds this database finished uploading. The files are not
 * compared byte for byte: a newer compressor can pack the same database differently.
 */
export function verifyExistingRelease(release, names) {
  assert.equal(
    release.draft,
    false,
    "An incomplete draft release exists; inspect it before retrying",
  );
  for (const name of names) {
    const asset = release.assets.find((candidate) => candidate.name === name);
    assert.ok(asset, `Existing release is incomplete: missing ${name}`);
    assert.equal(asset.state, "uploaded", `${name} upload is incomplete`);
  }
}

async function github(path, { missing } = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 404 && missing) return undefined;
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status} for ${path}`);
  return response.json();
}

/**
 * Give the built database the next unreleased revision for its dictionary date. Returns false,
 * leaving the latest release's version on it, when that release already holds the same data.
 */
async function stamp(directory, jmdictDate) {
  const refs = await github(`git/matching-refs/tags/v${databaseVersion(jmdictDate, "")}`);
  const latest = releasedRevisions(refs, jmdictDate).at(-1);
  if (latest !== undefined) {
    // Stamped with the latest revision, an unchanged database has the checksum that release's
    // notes record.
    const manifest = await stampVersion(directory, databaseVersion(jmdictDate, latest));
    const release = await github(`releases/tags/v${manifest.version}`, { missing: true });
    if (release?.body?.includes(checksumLine(manifest))) {
      verifyExistingRelease(release, releaseFiles);
      console.log(`Release v${manifest.version} already holds this database; nothing to publish.`);
      return false;
    }
  }
  const manifest = await stampVersion(directory, databaseVersion(jmdictDate, (latest ?? -1) + 1));
  console.log(`Stamped version ${manifest.version}.`);
  return true;
}

async function main() {
  const { values } = parseArgs({
    options: {
      stamp: { type: "boolean", default: false },
      publish: { type: "boolean", default: false },
      directory: { type: "string", default: "dist" },
    },
  });
  if (values.stamp || values.publish) {
    assert.match(
      process.env.GITHUB_REPOSITORY ?? "",
      /^[\w.-]+\/[\w.-]+$/u,
      "Set GITHUB_REPOSITORY to owner/repository",
    );
    assert.ok(process.env.GH_TOKEN, "Set GH_TOKEN");
  }
  const lock = JSON.parse(await readFile(defaultLockPath, "utf8"));
  if (values.stamp) {
    const publish = await stamp(values.directory, lock.sources.jmdict.dictDate);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
    return;
  }
  const manifest = JSON.parse(await readFile(join(values.directory, "manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(values.directory, name));
    assert.equal(digest(bytes), expected.sha256, `${name}: SHA256`);
  }
  const evaluation = JSON.parse(await readFile(join(values.directory, "evaluation.json"), "utf8"));
  assert.ok(manifest.files["evaluation.json"], "Run build with matching inputs before release");
  verifyEvaluation(
    evaluation,
    await readFile(new URL("../test/fixtures/gold.json", import.meta.url)),
    {
      generatorSHA256: await generatorDigest(),
      sourcesSHA256: digest(JSON.stringify(lock)),
      annotationsSHA256: digest(
        await readFile(new URL("../data/annotations.json", import.meta.url)),
      ),
    },
  );
  const descriptor = releaseDescriptor(manifest, lock);
  const notesPath = join(values.directory, "release-notes.md");
  await writeFile(notesPath, descriptor.notes);
  console.log(JSON.stringify(descriptor, undefined, 2));
  if (!values.publish) return;

  const revision = process.env.GITHUB_SHA;
  assert.match(revision ?? "", /^[a-f0-9]{40}$/u, "Set GITHUB_SHA to the source commit");
  assert.notEqual(
    parseDatabaseVersion(manifest.version).revision,
    undefined,
    "Run with --stamp first; a development build cannot be published",
  );
  execFileSync(
    "gh",
    [
      "release",
      "create",
      descriptor.tag,
      "--repo",
      process.env.GITHUB_REPOSITORY,
      "--target",
      revision,
      "--title",
      descriptor.title,
      "--notes-file",
      notesPath,
      ...releaseFiles.map((name) => join(values.directory, name)),
    ],
    { stdio: "inherit" },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
