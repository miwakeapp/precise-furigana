# Sources and provenance

The generator uses the checked-in evidence below and checksum-locked dictionaries downloaded by `npm run fetch`. Release JSON is derived data, not a hand-edited source file.

| Input | Role | Update policy |
| --- | --- | --- |
| JMdict via jmdict-simplified | Permitted spelling/reading pairs, word spans, spelling variants, conjugation and source-language tags | Weekly source release |
| KANJIDIC2 via jmdict-simplified | Character readings, okurigana boundaries, nanori, and explicit foreign readings | Same source release |
| Unicode Unihan | Supplemental explicitly listed readings | Separately pinned archive |
| `character-readings.json` | Selected Japanese Wiktionary character readings | Reviewed bundle |
| `english-character-readings.json` | Selected English Wiktionary character readings | Reviewed bundle |
| `lexical-evidence.json` | Named local allocations and selected reusable sounds | Sourced corrections |
| `annotations.json` | Exact entry/spelling/reading overrides | Sourced corrections |

## Dictionary inputs

[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) are provided by the Electronic Dictionary Research and Development Group. JSON conversion comes from [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified). Archive and extracted-content hashes, source dates, entry counts, download URLs, and the release tag are retained in `data/sources.lock.json`, which every release includes. The database itself records only the JMdict date.

The [Unihan archive](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) is pinned independently of weekly updates. Its original readings and source restrictions remain distinguishable from Japanese dictionary evidence. See [Unicode's field documentation](https://www.unicode.org/reports/tr38/).

## Character bundles

The Japanese bundle was selected from a pinned [Kaikki/wiktextract](https://kaikki.org/dictionary/rawdata.html) extraction of Japanese Wiktionary. It retains source forms and tags; historical, obsolete, and ambiguous forms are excluded by the documented selection policy.

The English bundle contains 3,560 distinct character/reading pairs across 2,243 characters, represented by 3,726 source records. It was selected from pinned primary Wiktionary page revisions. Complete on readings, explicitly complete kun readings, and explicitly marked character prefixes are eligible. Unmarked kun forms and inferred truncations are excluded. Historical/current form distinctions are preserved; current orthography does not establish current lexical usage.

Bundle records retain original forms, source parameters, revision URLs or archive provenance, and modification details. The lock binds their contents by byte size and SHA-256. Weekly builds use the reviewed bundles directly, with no live Wiktionary dependency. Refreshing a bundle is a separate source review, not an automatic side effect of updating JMdict.

## Local allocations

Each positive fact in `lexical-evidence.json` names a spelling and reading, segments, rationale, source links, and supporting evidence. Sources include Wiktionary, direct dictionary research, and selected candidates from the licensed [Doublevil/JmdictFurigana dataset](https://github.com/Doublevil/JmdictFurigana). Candidate alignments were reviewed before adoption; another generator's output is not itself a general pronunciation rule.

A minimal lexical fact looks like this (illustrative; do not add a duplicate of an existing allocation):

```json
{
  "id": "clock-allocation",
  "written": "時計",
  "reading": "とけい",
  "segments": [["時", "と"], ["計", "けい"]],
  "reason": "The pinned word table explicitly assigns と to 時 and けい to 計.",
  "sources": [{
    "name": "English Wiktionary contributors",
    "url": "https://en.wiktionary.org/w/index.php?oldid=92257101#Japanese",
    "license": "CC-BY-SA-4.0"
  }]
}
```

A fact's `id` identifies the evidence record, not a JMdict entry. An annotation's `id`, in contrast, is the JMdict ID and scopes the override together with its spelling and reading. Facts may refine matching occurrences inside longer words; annotations match one exact pair. Optional `reusableSegments` values are zero-based segment indices and require separately documented complete character-reading evidence.

The initial inventory has 1,900 positive facts. Most remain word-local. The separately selected 79 reusable segments from 76 facts provide 76 distinct complete character sounds. Source provenance and donor exclusions stay attached to those readings. Exact corrections live in the much smaller annotations file.

Some provenance includes historical review IDs, cache paths, and content hashes. These identify the original review materials; the generator never opens those paths. The maintained records contain their rationale and public source references. AI reviews are development judgments, not human lexicographer certification; multiple reviewers also do not imply multiple independent lexical sources.

## Licensing and independence

Original software is MIT-licensed. Dictionary-derived distributions, reviewed evidence, annotations, and dictionary-derived test data use CC BY-SA 4.0, with EDRDG, Wiktionary, and JmdictFurigana attribution in [NOTICE](../NOTICE). Unihan's Unicode License V3 notice is also preserved there. Source-specific provenance records identify the adapted material and changes.

Lorenzi's implementation and `furigana.txt` are not generator inputs or distributed data. Development used behavior comparisons to identify cases needing investigation; accepted assignments are supported by the independent evidence recorded here.
