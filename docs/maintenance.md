# Maintenance

## Build and check

Node.js 22.2 or later. The npm scripts set the 4 GiB heap the pipeline needs. Nothing needs the network after `fetch`.

```sh
npm ci
npm run fetch                # restore the exact locked inputs
npm test                     # unit tests, seconds
npm run build                # about two minutes
npm run validate
node scripts/release.mjs     # local dry run; writes dist/release-notes.md
```

`build` also evaluates the regression fixtures in `test/fixtures/gold.json` and fails if any regress; it writes `evaluation.json` and `manifest.json` next to the database for `validate` and the release script. `npm run evaluate` runs only the fixtures, but still compiles the whole pipeline.

## Update dictionaries

```sh
npm run fetch -- --update    # or --update --release <jmdict-simplified tag>
npm test && npm run build && npm run validate
```

This moves only the jmdict-simplified pin. If the update introduces a spelling that needs a synthesized pair, the build fails until you [review it](#synthesized-pairs).

To review what changed:

```sh
cp dist/precise-furigana.json .cache/before.json
npm run build
npm run compare -- .cache/before.json dist/precise-furigana.json
```

`compare` writes every changed pair to `dist/changes.jsonl`, classified as added, removed, finer, coarser, incompatible, or ruby-only. Look at every removed or moved boundary, and at related spellings of the same words.

## Correct an alignment

```sh
npm run inspect -- 日本 にほん                 # read the built database
npm run inspect -- 日本 にほん --explain       # compile the generator and show its evidence
```

Make the narrowest justified change:

- A rule in code, when a coherent class of words is wrong.
- A fact in `data/lexical-evidence.json`, when the allocation is specific to a word. Cite the source's own allocation and say why it supports each boundary.
- An annotation in `data/annotations.json`, when one record needs a different result and no fact fits.

Add a regression fixture or unit test for any generator change, then build, validate, and compare the whole corpus: a fact can change other words.

`scripts/lib/options.mjs` has switches for disabling individual passes, for experiments:

```sh
npm run build -- --no-variants --output .cache/without-variants
npm run compare -- dist/precise-furigana.json .cache/without-variants/precise-furigana.json
```

Non-default configurations cannot be released.

## Synthesized pairs

The build fails when a spelling has no fitting record and no entry in `data/synthesized-pairs.json`, when an entry's reading no longer fits its spelling or is still `"unreviewed"`, when JMdict now has the pair, or when a listed spelling no longer needs one. To fix:

```sh
npm run build -- --update-synthesized-pairs
```

This drops obsolete entries and adds new ones, with the reading the spelling's kana imply, marked `"unreviewed"`. Check each new reading; the implied reading is only a starting point and can misplace kana where the generator grouped kana with kanji. Then set `upstream` and a short `note` as described in [data sources](data-sources.md#synthesized-pairs), and rebuild.

## Releases

`.github/workflows/release.yml` runs every Tuesday at 03:17 UTC, and on manual dispatch. It moves the dictionary pin in its own checkout (it never commits it), builds, validates, and publishes the two database files.

The tag is `data-<JMdict date>-v<algorithm version>-<database hash>`, so a generator or data change can publish a second release for the same dictionary date. Rerunning a release verifies the existing files against GitHub's recorded digests instead of overwriting them. `--publish` needs `GITHUB_REPOSITORY`, `GITHUB_SHA`, and `GH_TOKEN`.

To reproduce a release, check out its tag, run `npm run fetch -- --update --release <tag>` with the jmdict-simplified tag from its notes, and build.
