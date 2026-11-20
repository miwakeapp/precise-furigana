import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { defaultConfiguration, digest, generatorDigest } from "../src/dataset.ts";
import type { EvaluationProvenance } from "../src/dataset.ts";
import { defaultLockPath } from "../src/sources.ts";
import type { SourceLock } from "../src/sources.ts";
import type { Database } from "../src/types.ts";
import {
  databaseFile,
  databaseVersion,
  parseDatabaseVersion,
  releaseFiles,
  stampVersion,
} from "./lib/database-files.ts";
import type { Manifest } from "./lib/database-files.ts";
import type { Evaluation, EvaluationResult, GoldExample } from "./lib/evaluation.ts";
import { renderReleaseNotes } from "./lib/release-notes.ts";

export interface ReleaseDescriptor {
  tag: string;
  title: string;
  notes: string;
}

/** The parts of an evaluation that a release checks. */
export interface CheckedEvaluation {
  provenance: EvaluationProvenance;
  summary: Pick<Evaluation["summary"], "examples" | "passed">;
  results: (GoldExample & Pick<EvaluationResult, "actual" | "pass">)[];
}

/** A tag, as GitHub's matching-refs API lists it. */
export interface GitHubRef {
  ref: string;
}

/** A release, as GitHub's API describes it. */
export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  assets: { name: string; state: string; url: string }[];
}

/** The file a stamping run leaves the previous release's database in, for the notes to compare. */
const previousFile = "previous.json";

/**
 * A release's tag, title and notes. `previous` is the database of the release before it, and
 * `previousURL` that release's page.
 */
export function releaseDescriptor(
  database: Database,
  lock: Pick<SourceLock, "release">,
  previous?: Database,
  previousURL?: string,
): ReleaseDescriptor {
  return {
    tag: `v${database.version}`,
    title: `Precise Furigana ${database.version}`,
    notes: renderReleaseNotes(database, lock, previous, previousURL),
  };
}

/** The revisions already released for a version's schema and dictionary date, from its tags. */
export function releasedRevisions(refs: GitHubRef[], jmdictDate: string): number[] {
  const prefix = `refs/tags/v${databaseVersion(jmdictDate, "")}`;
  return refs
    .map(({ ref }) => ref)
    .filter((ref) => ref.startsWith(prefix) && /^(0|[1-9]\d*)$/u.test(ref.slice(prefix.length)))
    .map((ref) => Number(ref.slice(prefix.length)))
    .sort((left, right) => left - right);
}

/** Bind the regression results to the inputs being released. */
export function verifyEvaluation(
  evaluation: CheckedEvaluation,
  goldText: string | Buffer,
  current: Pick<EvaluationProvenance, "generatorSHA256" | "sourcesSHA256" | "annotationsSHA256">,
): void {
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
  // The checksum above is of the fixture's bytes as given; only parsing needs them decoded.
  const gold: GoldExample[] = JSON.parse(
    typeof goldText === "string" ? goldText : goldText.toString("utf8"),
  );
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
export function verifyExistingRelease(release: GitHubRelease, names: string[]): void {
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

async function github(path: string, { missing }: { missing?: boolean } = {}): Promise<unknown> {
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

/** Download a release asset through the API, which also works for a private repository. */
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/octet-stream",
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Give the built database the next unreleased revision for its dictionary date, and leave the
 * latest release's database beside it for the notes to compare. Returns false, leaving that
 * release's version on the database, when the release already holds the same data.
 */
async function stamp(directory: string, jmdictDate: string): Promise<boolean> {
  const previousPath = join(directory, previousFile);
  await rm(previousPath, { force: true });
  const release = (await github("releases/latest", { missing: true })) as GitHubRelease | undefined;
  if (release !== undefined) {
    verifyExistingRelease(release, releaseFiles);
    const asset = release.assets.find((candidate) => candidate.name === releaseFiles[1])!;
    const previous = zstdDecompressSync(await download(asset.url)).toString("utf8");
    await writeFile(previousPath, previous);
    const version = release.tag_name.replace(/^v/u, "");
    if (parseDatabaseVersion(version).jmdictDate === jmdictDate) {
      // Stamped with that release's version, an unchanged database is the same text.
      await stampVersion(directory, version);
      if ((await readFile(join(directory, databaseFile), "utf8")) === previous) {
        console.log(`Release ${release.tag_name} already holds this database; nothing to publish.`);
        return false;
      }
    }
  }
  const refs = (await github(
    `git/matching-refs/tags/v${databaseVersion(jmdictDate, "")}`,
  )) as GitHubRef[];
  const latest = releasedRevisions(refs, jmdictDate).at(-1);
  const manifest = await stampVersion(directory, databaseVersion(jmdictDate, (latest ?? -1) + 1));
  console.log(`Stamped version ${manifest.version}.`);
  return true;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stamp: { type: "boolean", default: false },
      publish: { type: "boolean", default: false },
      directory: { type: "string", default: "dist" },
      // The database to describe changes from; a stamping run leaves the latest release's here.
      previous: { type: "string" },
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
  const lock: SourceLock = JSON.parse(await readFile(defaultLockPath, "utf8"));
  if (values.stamp) {
    const publish = await stamp(values.directory, lock.sources.jmdict.dictDate!);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
    return;
  }
  const manifest: Manifest = JSON.parse(
    await readFile(join(values.directory, "manifest.json"), "utf8"),
  );
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(values.directory, name));
    assert.equal(digest(bytes), expected.sha256, `${name}: SHA256`);
  }
  const evaluation: Evaluation = JSON.parse(
    await readFile(join(values.directory, "evaluation.json"), "utf8"),
  );
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
  const database: Database = JSON.parse(
    await readFile(join(values.directory, databaseFile), "utf8"),
  );
  const previousPath = values.previous ?? join(values.directory, previousFile);
  const previous: Database | undefined = existsSync(previousPath)
    ? JSON.parse(await readFile(previousPath, "utf8"))
    : undefined;
  const descriptor = releaseDescriptor(
    database,
    lock,
    previous,
    previous && process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/v${previous.version}`
      : undefined,
  );
  const notesPath = join(values.directory, "release-notes.md");
  await writeFile(notesPath, descriptor.notes);
  console.log(`${descriptor.tag}: ${descriptor.title}\n\n${descriptor.notes}`);
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
      process.env.GITHUB_REPOSITORY!,
      "--target",
      revision!,
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
