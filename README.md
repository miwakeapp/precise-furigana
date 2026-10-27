# Precise furigana

Fine-grained furigana for every permitted spelling/reading pair in [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), generated with Node.js and released as JSON indexed by JMdict ID.

The aim is the finest **supported** alignment: <ruby>日<rt>に</rt></ruby><ruby>本<rt>ほん</rt></ruby>, <ruby>時<rt>と</rt></ruby><ruby>計<rt>けい</rt></ruby>, and <ruby>珈<rt>コー</rt></ruby><ruby>琲<rt>ヒー</rt></ruby>. Phonetic ateji is welcome. Words such as <ruby>大人<rt>おとな</rt></ruby> stay grouped when individual character assignments lack support. Original spelling, kana script, and punctuation are preserved exactly.

## Use the data

The release artifacts are `precise-furigana.json` and its gzip-compressed equivalent, `precise-furigana.json.gz`. There is no npm package. The initial corpus contains about 325,000 spelling/reading pairs; the compressed database is about 7 MB.

```js
const records = database.entries["1582710"];
const nihon = records.find(record => record.reading === "にほん");
// nihon.segments: [["日", "に"], ["本", "ほん"]]
```

Each record has `written`, `reading`, and `segments`. String segments are shown without ruby; arrays are `[written text, reading]` ruby. Joining the written text reconstructs the original spelling exactly. See the [data format](docs/data-format.md) and [JSON schema](schema.json).

Characters without a supported reading stay grouped with their neighbors instead of receiving a guessed one, so a record can contain a whole-word group. The [quality notes](docs/quality.md) explain limitations and reviewed examples.

## Build

Requires Node.js 22.2 or later. There are no npm dependencies. Allow roughly 4 GB of memory for the generator, plus runtime overhead; the scripts set the V8 heap limit accordingly.

```sh
npm ci
npm run fetch
npm test
npm run build
npm run validate
```

`fetch` downloads and verifies the pinned dictionaries. Subsequent builds work offline. `build` runs the full-generator regression fixtures and writes the database, its regression evaluation, and checksums to `dist/`. `validate` checks complete coverage and exact reconstruction throughout the corpus.

Inspect a generated record:

```sh
npm run inspect -- 日本 にほん
```

To update JMdict and KANJIDIC2, run `npm run fetch -- --update`, then build and validate again. The weekly GitHub Actions workflow follows this process. See [maintenance](docs/maintenance.md) for source updates, corrections, comparisons between builds, and release preparation.

## What makes the alignments precise?

The generator combines character readings, restricted sound changes, dictionary words, alternate spellings, and documented local allocations. A coarser dictionary reading does not veto a supported finer split. Ambiguous allocations keep only agreed boundaries, and characters without supported readings stay grouped rather than guessed. The [algorithm guide](docs/algorithm.md) describes the stages and their safeguards.

Some illustrative differences from Lorenzi's `furigana.txt` generator during development:

| Word | Precise furigana | Lorenzi comparison |
| --- | --- | --- |
| 蕎麦 | <ruby>蕎<rt>そ</rt></ruby><ruby>麦<rt>ば</rt></ruby> | <ruby>蕎麦<rt>そば</rt></ruby> |
| 海老 | <ruby>海<rt>え</rt></ruby><ruby>老<rt>び</rt></ruby> | <ruby>海老<rt>えび</rt></ruby> |
| 尻尾 | <ruby>尻<rt>しっ</rt></ruby><ruby>尾<rt>ぽ</rt></ruby> | <ruby>尻尾<rt>しっぽ</rt></ruby> |
| 命の綱 | <ruby>命<rt>いのち</rt></ruby>の<ruby>綱<rt>つな</rt></ruby> | <ruby>命<rt>い</rt></ruby><ruby>の綱<rt>ちのつな</rt></ruby> |
| メーカ希望価格 | メー<ruby>カ<rt>カー</rt></ruby><ruby>希<rt>き</rt></ruby><ruby>望<rt>ぼう</rt></ruby><ruby>価<rt>か</rt></ruby><ruby>格<rt>かく</rt></ruby> | メーカ<ruby>希望価格<rt>ーきぼうかかく</rt></ruby> |

These are selected examples, not accuracy estimates. Grouped ruby can give the right pronunciation while omitting useful detail. The comparison used Lorenzi commit `dda498d0fd7531c9ebdb97740589e00749696789` on the same dictionary input. [Supporting evidence and remaining uncertain cases](docs/quality.md) explain the distinctions. Lorenzi's code and data are not generator inputs.

## Sources and license

Original code: [MIT](LICENSE). Dictionary-derived data: **CC BY-SA 4.0**, with attribution in [NOTICE](NOTICE).

Inputs include JMdict and KANJIDIC2 from EDRDG through [jmdict-simplified](https://github.com/scriptin/jmdict-simplified), Unicode Unihan, Wiktionary character readings, and reviewed lexical allocations, including selected JmdictFurigana data. The [source guide](docs/data-sources.md) explains provenance and scope. The generator, source locks, and maintained evidence are the source of truth; release JSON is the build product.
