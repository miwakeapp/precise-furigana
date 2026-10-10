# Precise furigana

Fine-grained furigana for every permitted spelling/reading pair in [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), generated with Node.js and released as JSON indexed by JMdict ID.

The aim is the finest **supported** alignment: 日[に]本[ほん], 時[と]計[けい], and 珈[コー]琲[ヒー]. Phonetic ateji is welcome. Words such as 大人[おとな] stay grouped when individual character assignments lack support. Original spelling, kana script, and punctuation are preserved exactly.

## Use the data

The release artifacts are `precise-furigana.json` and its gzip-compressed equivalent, `precise-furigana.json.gz`. There is no npm package. The initial corpus contains about 325,000 spelling/reading pairs; the compressed database is about 8 MB.

```js
const records = database.entries["1582710"];
const nihon = records.find(record => record.reading === "にほん");
// nihon.segments: [["日", "に"], ["本", "ほん"]]
```

Each record has `written`, `reading`, `segments`, `status`, and `evidence`. String segments are literal text; arrays are `[written text, reading]`. Both sides reconstruct the original strings exactly. See the [data format](docs/data-format.md) and [JSON schema](schema.json).

Status reports the kind of support, not a probability of correctness. `fallback` marks unsupported local inference; `ambiguous` marks unresolved alternatives. Even an `aligned` record can contain a whole-word group. The [quality notes](docs/quality.md) explain limitations and reviewed examples.

## Build

Requires Node.js 22.2 or later. There are no npm dependencies. Allow roughly 4 GB of memory for the generator, plus runtime overhead; the scripts set the V8 heap limit accordingly.

```sh
npm ci
npm run fetch
npm test
npm run build
npm run validate
```

`fetch` downloads and verifies the pinned dictionaries. Subsequent builds work offline. `build` runs the full-generator regression fixtures and writes the database, evaluation, provenance, schema, and checksums to `dist/`. `validate` checks complete coverage and exact reconstruction throughout the corpus.

Inspect a generated record:

```sh
npm run inspect -- 日本 にほん
```

To update JMdict and KANJIDIC2, run `npm run fetch -- --update`, then build and validate again. The weekly GitHub Actions workflow follows this process. See [maintenance](docs/maintenance.md) for source updates, corrections, comparisons between builds, and release preparation.

## What makes the alignments precise?

The generator combines character readings, restricted sound changes, dictionary words, alternate spellings, and documented local allocations. A coarser dictionary reading does not veto a supported finer split. Ambiguous allocations keep only agreed boundaries, and inferred residual sounds never become evidence for unrelated words. The [algorithm guide](docs/algorithm.md) describes the stages and their safeguards.

Some illustrative differences from Lorenzi's `furigana.txt` generator during development:

| Word | Precise furigana | Lorenzi comparison |
| --- | --- | --- |
| 蕎麦 | 蕎[そ]麦[ば] | 蕎麦[そば] |
| 海老 | 海[え]老[び] | 海老[えび] |
| 尻尾 | 尻[しっ]尾[ぽ] | 尻尾[しっぽ] |
| 命の綱 | 命[いのち]の綱[つな] | 命[い]の綱[ちのつな] |
| メーカ希望価格 | メー / カ[カー] / 希[き]望[ぼう]価[か]格[かく] | メーカ / 希望価格[ーきぼうかかく] |

These are selected examples, not accuracy estimates. Grouped ruby can give the right pronunciation while omitting useful detail. The comparison used Lorenzi commit `dda498d0fd7531c9ebdb97740589e00749696789` on the same dictionary input. [Supporting evidence and remaining uncertain cases](docs/quality.md) explain the distinctions. Lorenzi's code and data are not generator inputs.

## Sources and license

Original code: [MIT](LICENSE). Dictionary-derived data: **CC BY-SA 4.0**, with attribution in [NOTICE](NOTICE).

Inputs include JMdict and KANJIDIC2 from EDRDG through [jmdict-simplified](https://github.com/scriptin/jmdict-simplified), Unicode Unihan, Wiktionary character readings, and reviewed lexical allocations, including selected JmdictFurigana data. The [source guide](docs/data-sources.md) explains provenance and scope. The generator, source locks, and maintained evidence are the source of truth; release JSON is the build product.
