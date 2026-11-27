# Maintenance

## Build and check

Node.js 22.2 or later. The npm scripts set the 4 GiB heap the pipeline needs. Nothing needs the network after `fetch`.

```sh
npm ci
npm run fetch                # restore the exact locked inputs
npm test                     # unit tests, seconds
npm run check                # formatting, lint and types; seconds
npm run fmt                  # reformat
npm run build                # about two minutes
npm run validate
node scripts/release.ts     # local dry run; writes dist/release-notes.md
                            # add --previous <database.json> to see the changes from it
```

`build` also evaluates the regression fixtures in `test/fixtures/gold.json` and fails if any regress; it writes `evaluation.json` and `manifest.json` next to the database for `validate` and the release script. `npm run evaluate` runs only the fixtures, but still compiles the whole pipeline.

## Update dictionaries

```sh
npm run fetch -- --update    # or --update --release <jmdict-simplified tag>
npm test && npm run build && npm run validate
```

This moves only the jmdict-simplified pin. If the update introduces a spelling that needs a synthesized pair, the build fails until you [review it](#synthesized-pairs). The [weekly update](#weekly-update) automates all of this.

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

`scripts/lib/options.ts` has switches for disabling individual passes, for experiments:

```sh
npm run build -- --no-variants --output .cache/without-variants
npm run compare -- dist/precise-furigana.json .cache/without-variants/precise-furigana.json
```

Non-default configurations cannot be released.

## Synthesized pairs

The build fails when a spelling has no fitting record and no entry in `data/synthesized-pairs.json`, when an entry's reading no longer fits its spelling or is still flagged `"unreviewed"`, when JMdict now has the pair, or when a listed spelling no longer needs one. To fix:

```sh
npm run build -- --update-reviewed-pairs
```

This drops obsolete entries and adds new ones, with the reading the spelling's kana imply, flagged `"unreviewed": true`. It also drops the entries of `data/mispaired-pairs.json` that no longer apply, because JMdict has dropped the pair or the build now marks it by rule. Check each new reading; the implied reading is only a starting point and can misplace kana where the generator grouped kana with kanji. Then write a short `note` as described in [data sources](data-sources.md#synthesized-pairs), remove the flag, and rebuild.

## Weekly update

`.github/workflows/update.yml` runs every Tuesday at 03:17 UTC, and on manual dispatch. It drives `scripts/update.ts`, which also runs locally:

```sh
node scripts/update.ts baseline   # build the database as it stands
node scripts/update.ts update     # move the pin, repair synthesized pairs, rebuild, report
node scripts/update.ts recheck    # rebuild and report again after editing data
```

The report compares the database before and after, and is written with a commit message and a status file to `.cache/update/`. The workflow commits the changed data to the `update-dictionaries` branch and opens a pull request with the report as its description. If a pull request is already open, the run continues on its branch, so review work there is kept.

The workflow has two jobs. The first moves the pin and, when the update needs review, runs Claude. That job reads the web, so it holds no credential that can write to the repository. The second job receives only `data/`, `test/fixtures/`, the report and the commit message from the first, and commits them from a checkout of its own using `UPDATE_TOKEN`. An update merges itself only if it was clean before the review ran and the review left it exactly as it was. The first job takes a fingerprint of the data files, the fixtures and the commit message before the review, and the second job compares it with what it is about to commit, so a review can add nothing to an unattended merge.

An update is clean when it builds and validates, changes only the pin and removes synthesized pairs that JMdict now has and reviewed mispaired pairs that no longer apply, makes no existing segmentation coarser or incompatible, and adds no record whose kanji share furigana. A clean update merges itself once CI passes. Anything else waits for a person: Claude first tries to resolve it, following the next section, and its changes and notes are in the pull request.

New pairs that may be mispaired without any kana showing it do not make an update wait, but they do get looked at: Claude reviews them even when the update is otherwise clean. If it lists none of them, the update still merges itself, with Claude's notes in its description. If it lists one, that is a change to the data, and the update waits for a person.

### Review a dictionary update

These are the instructions for whoever reviews an update, in CI or locally. A review runs when an update needs resolving, and also when a clean update brings new pairs worth a look; if the report lists nothing that applies, change nothing. Read `.cache/update/report.md` first. Edit only files in `data/` and `test/fixtures/`. Do not use git or contact GitHub; the workflow commits your changes.

- New synthesized pairs flagged `"unreviewed"` in `data/synthesized-pairs.json`: check each reading against the entry's spellings and readings, correct it if the implied reading misplaced kana, write a `note` as [data sources](data-sources.md#synthesized-pairs) describes, and remove the flag.
- A stale annotation, whose pair has left JMdict: remove it from `data/annotations.json`, or move it to the pair's new ID or spelling if the entry was only renumbered or respelled.
- A segmentation that became coarser or incompatible: use `npm run inspect -- <spelling> <reading> --explain` to find out why. If the new result is wrong, fix it with a lexical fact or an annotation as in [Correct an alignment](#correct-an-alignment). If it is right, or you cannot tell, say so in the notes and change nothing.
- A regression fixture that fails: investigate, but do not edit the fixture unless JMdict removed its pair.
- New records with kanji sharing furigana: these are words the generator could not divide, and this review is the only time each is looked at. Look each one up, in Kotobank's dictionaries and Wiktionary first. Where a source documents how the reading divides, by the standard in [data sources](data-sources.md#lexical-facts), add a fact to `data/lexical-evidence.json` with the source's URL, giving it an `id` of `U<JMdict date>-<number>`. Leave the word grouped when nothing documents a split, when the group is a single unit such as a jukujikun or a name, or when an unwritten particle sits between the characters. Check a fact's effect with `npm run inspect`, and say in the notes what you decided for each word and why.

- New pairs of a search-only form with one of several partners, and new pairs whose reading may belong to a sibling spelling: JMdict cannot restrict search-only forms, and sometimes lacks a restriction on ordinary ones, so some of these pairs are wrong. For each, decide whether the reading can belong to the spelling, by the standard in [data sources](data-sources.md#mispaired-pairs). Look the ordinary ones up in a dictionary; the characters alone mislead in both directions. When you list a pair in which neither form is search-only, say in the notes that JMdict lacks a restriction there and which one, so that a person can propose it; you cannot submit it yourself. List the ones that cannot in `data/mispaired-pairs.json` with a `note`, and leave a pair alone when in doubt. If that leaves a spelling with no fitting record, the build asks for a synthesized pair for it.

Afterwards run `npm run build` and `npm run validate` until both pass, then write `.cache/update/review.md`: what you changed and why, and anything you were unsure of, for the person who will merge. Keep it short. The notes become part of the pull request's description, under a heading of their own, so use paragraphs and lists and no headings, and wrap Japanese text in `<span lang="ja">`; otherwise some readers' browsers draw its kanji in their Chinese shapes.

### One-time setup

- `UPDATE_TOKEN` secret: a fine-grained personal access token for this repository with read and write access to contents and pull requests. Pull requests opened with it trigger CI, which GitHub's built-in token does not.
- `CLAUDE_CODE_OAUTH_TOKEN` secret: from `claude setup-token`, so the review step runs on a Claude subscription.
- Repository settings: allow auto-merge, and protect the default branch with the CI `test` check required. Without a required check, GitHub will not enable auto-merge.

## Releases

`.github/workflows/release.yml` runs on every push to the default branch, and on manual dispatch. It builds from that commit's pinned inputs, validates, and publishes the two database files. Every release therefore corresponds to exactly one commit, lockfile included.

A build's database has the development version `<schema version>.<JMdict date>.0-dev`. `node scripts/release.ts --stamp` replaces it with the next unreleased revision for that date, read from the repository's tags, and the workflow validates the stamped files before `--publish` creates the release, tagged `v<version>`. `--stamp` also downloads the latest release's database to `dist/previous.json`, which the notes are compared against. The notes give the database's statistics and then everything that changed since that release: the commits made since it that touch what the build reads, which say why, leaving out routine dictionary updates, and the changed, added and removed records, in the same sections as an update's description, with every list folded. Since one release can follow several pull requests, the notes are the complete account of what changed between two published databases. To avoid publishing a duplicate, it first stamps that release's version when the dictionary date is the same: an unchanged database is then the same text as the downloaded one, and nothing is published. A generator or data change therefore publishes the next revision for the same dictionary date, and a push that leaves the database unchanged publishes nothing.

Bump the schema version, and the major of the private `package.json` version with it, only when consumers' code must change. There is no separate generator version: a release's tag points at the commit that generated it. `--stamp` and `--publish` need `GITHUB_REPOSITORY` and `GH_TOKEN`; `--publish` also needs `GITHUB_SHA`.

To reproduce a release, check out its tag, then run `npm run fetch` and `npm run build`.
