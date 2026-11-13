# Maintenance

## Build and check

Use Node.js 22.2 or later. The complete pipeline needs a 4 GiB V8 heap limit and additional process overhead; the npm scripts provide the heap setting. Nothing else, including network access, is needed after fetching the locked inputs.

```sh
npm ci
npm run fetch
npm test
npm run build
npm run validate
node scripts/release.mjs
```

`build` compiles the pipeline once, evaluates the regression fixtures, and generates the corpus. It writes `evaluation.json` alongside the database and records both in `manifest.json`. These files let `validate` and the release command check the build; only the database is published. A regression failure makes the command fail; its diagnostic artifacts remain available for inspection. `validate` checks source coverage, restrictions, duplicate pairs, reconstruction, provenance, gzip, and checksums. The release command defaults to a local check and writes `dist/release-notes.md`.

To evaluate the generator without emitting a full database, use `npm run evaluate`. This still compiles the complete evidence pipeline, so it is not a substitute for the fast unit tests.

## Update dictionaries

```sh
npm run fetch -- --update
npm test
npm run build
npm run validate
```

Updating resolves the latest jmdict-simplified release, verifies its published archive digests, and replaces `data/sources.lock.json` after successful download and verification. `--update --release <tag>` resolves a specific jmdict-simplified release instead. Supplemental character bundles and Unihan remain separately pinned. Without `--update`, fetching restores the exact locked inputs.

Keep the previous database before rebuilding if changes need review:

```sh
cp dist/precise-furigana.json .cache/before.json
npm run build
npm run compare -- .cache/before.json dist/precise-furigana.json
```

The comparison command writes every changed pair to `dist/changes.jsonl`, classifying additions, removals, finer or coarser boundaries, incompatible allocations, and ruby changes at unchanged boundaries. Inspect all removed or moved boundaries and check related spelling/reading families, even when a change appears local.

## Investigate and correct an alignment

```sh
npm run inspect -- 日本 にほん
npm run inspect -- 日本 にほん --database .cache/before.json
npm run inspect -- 日本 にほん --explain
```

Ordinary inspection reads the generated database quickly. `--explain` compiles the generator and shows detailed algorithmic evidence, final records, and any exact annotation; it takes as long as pipeline initialization.

Choose the narrowest justified change:

- Fix an incorrect source restriction or general rule in code when it affects a coherent class of words.
- Add a sourced local fact to `data/lexical-evidence.json` when ownership is specific to a word. Include the original sound assignment, source URL or revision, and why it supports each boundary. Keep readings local unless separate evidence justifies `reusableSegments`, and then list the JMdict entries that evidence came from in `jmdictEntries`.
- Add an exact annotation to `data/annotations.json` when an existing boundary must be replaced. Include the JMdict ID, spelling, reading, full segments, reason, and source links. A source update removing that pair deliberately fails the build so the annotation is reviewed.

Add a regression example to `test/fixtures/gold.json` for generator behavior, or a focused unit test for a general rule. Exact annotations do not mask failures in the generator's regression set. Run tests, build, validate, and compare the complete output before accepting a correction.

For rule experiments, build and evaluation share switches in `scripts/lib/options.mjs`. For example:

```sh
npm run build -- --no-variants --output .cache/without-variants
npm run compare -- dist/precise-furigana.json .cache/without-variants/precise-furigana.json
```

Experimental configurations and failing evaluations cannot be released. The global reading-learning experiment is disabled by default; its candidates are too permissive to become unconditional character readings.

## Weekly releases

The GitHub workflow runs every Tuesday at 03:17 UTC and also supports manual dispatch from the default branch. It tests the code, refreshes the dictionary lock in the job's checkout, builds, validates, and publishes the two database files. The release notes name the jmdict-simplified release; the workflow does not push a lockfile commit to the default branch.

The release tag combines the dictionary date, algorithm version, and a hash of the database. A retry verifies an existing release's files against GitHub's recorded SHA-256 digests instead of overwriting them. A generator or reviewed-data change that alters the output can therefore produce another release for the same dictionary date.

Without `--publish`, the release command is a local dry run. `--publish` requires `GITHUB_REPOSITORY`, `GITHUB_SHA`, and `GH_TOKEN`.

To reproduce a release, check out its tag, run `npm run fetch -- --update --release <tag>` with the jmdict-simplified tag from the release notes, then build. The commit supplies the generator and bundled evidence; jmdict-simplified's published digests verify the upstream archives.
