# Maintenance

## Build and check

Use Node.js 22.2 or later. The complete pipeline needs a 4 GiB V8 heap limit and additional process overhead; the npm scripts provide the heap setting. No npm packages, research caches, reference datasets, or network access are needed after fetching the locked inputs.

```sh
npm ci
npm run fetch
npm test
npm run build
npm run validate
node scripts/release.mjs
```

`build` compiles the pipeline once, evaluates the regression fixtures, and generates the corpus. It writes `evaluation.json` alongside the database and includes its digest in the manifest. A regression failure makes the command fail; its diagnostic artifacts remain available for inspection. `validate` checks source coverage, restrictions, duplicate pairs, reconstruction, labels, provenance, gzip, and checksums. The release command defaults to a local check and writes `dist/release-notes.md`.

To evaluate the generator without emitting a full database, use `npm run evaluate`. This still compiles the complete evidence pipeline, so it is not a substitute for the fast unit tests.

## Update dictionaries

```sh
npm run fetch -- --update
npm test
npm run build
npm run validate
```

Updating resolves the latest jmdict-simplified release, verifies its published archive digests, and replaces `data/sources.lock.json` after successful download and verification. Supplemental character bundles and Unihan remain separately pinned. Without `--update`, fetching restores the exact locked inputs.

Keep the previous database before rebuilding if changes need review:

```sh
cp dist/precise-furigana.json .cache/before.json
npm run build
npm run compare -- .cache/before.json dist/precise-furigana.json
```

The comparison command writes every changed pair to `dist/changes.jsonl`, classifying additions, removals, finer or coarser boundaries, incompatible allocations, and status changes. These are differences, not automatic correctness judgments. Inspect all removed or moved boundaries and check related spelling/reading families, even when a change appears local.

## Investigate and correct an alignment

```sh
npm run inspect -- 日本 にほん
npm run inspect -- 日本 にほん --database .cache/before.json
npm run inspect -- 日本 にほん --explain
```

Ordinary inspection reads the generated database quickly. `--explain` compiles the generator and shows detailed algorithmic evidence, final records, and any exact annotation; it takes as long as pipeline initialization.

Choose the narrowest justified change:

- Fix an incorrect source restriction or general rule in code when it affects a coherent class of words.
- Add a sourced local fact to `data/lexical-evidence.json` when ownership is specific to a word. Include the original sound assignment, source URL or revision, and why it supports each boundary. Keep readings local unless separate evidence justifies `reusableSegments`.
- Add an exact annotation to `data/annotations.json` when an existing boundary must be replaced. Include the JMdict ID, spelling, reading, full segments, reason, and source links. A source update removing that pair deliberately fails the build so the annotation is reviewed.
- Add a residual deferral when an unsupported inference has been investigated and remains unjustified. It withholds that inference for permitted spellings in the named entry/reading family and does not block separately supported refinements. Check alternate readings explicitly; a review of one pronunciation does not automatically cover another.

Add a regression example to `test/fixtures/gold.json` for generator behavior, or a focused unit test for a general rule. Exact annotations do not mask failures in the generator's regression set. Run tests, build, validate, and compare the complete output before accepting a correction.

For rule experiments, build and evaluation share switches in `scripts/lib/options.mjs`. For example:

```sh
npm run build -- --no-variants --output .cache/without-variants
npm run compare -- dist/precise-furigana.json .cache/without-variants/precise-furigana.json
```

Experimental configurations and failing evaluations cannot be released. The global reading-learning experiment is disabled by default; its candidates are too permissive to become unconditional character readings.

## Weekly releases

The GitHub workflow runs every Tuesday at 03:17 UTC and also supports manual dispatch from the default branch. It tests the code, refreshes the dictionary lock in the job's checkout, builds, validates, and publishes the seven assets documented in the [data format](data-format.md). The resulting source lock is included in the release; the workflow does not push a lockfile commit to the default branch.

The release tag combines the dictionary date, algorithm version, and a manifest hash. A retry verifies an existing release's assets instead of overwriting them. A changed generator or reviewed dataset can therefore produce another release for the same dictionary date.

Publishing is an explicit `--publish` action requiring `GITHUB_REPOSITORY`, `GITHUB_SHA`, and `GH_TOKEN`. Until publication is authorized, use the command without that flag. A local dry run does not test GitHub permissions, asset uploads, or scheduled execution.

To reproduce a release with a different dictionary pin, check out its source commit and replace `data/sources.lock.json` with the released lock, then fetch and build. The commit supplies the bundled evidence; the released lock supplies the exact upstream input versions.
