# Dictionary sources

The database uses JMdict written forms and readings, together with Japanese on- and kun-readings from KANJIDIC2. These dictionaries are copyright James William Breen and the Electronic Dictionary Research and Development Group (EDRDG). We obtain their JSON conversions from [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified), whose release assets preserve the dictionaries' license.

The data is available under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/), subject to the [EDRDG dictionary license statement](https://www.edrdg.org/edrdg/licence.html). Generated alignment data is a derivative of these dictionaries and is distributed under the same license. Our additions do not replace EDRDG's copyright in the source material. The EDRDG statement also requires attribution, links to the source documentation and license, and a procedure for keeping dictionary data current. Source code licensing is separate from data licensing.

Project documentation: [JMdict](https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html), [KANJIDIC2](https://www.edrdg.org/wiki/KANJIDIC_Project.html), and [jmdict-simplified format](https://scriptin.github.io/jmdict-simplified/). The source lock records the exact release, download URLs, archive and extracted JSON SHA-256 hashes, dictionary dates, and entry counts. Release distributions should include this attribution and the applicable license information alongside the generated data.

## Reproducible acquisition

Run `npm run fetch` to download the exact release pinned in `data/sources.lock.json`. Run `npm run fetch -- --update` to explicitly resolve the latest upstream release and replace the lock after both dictionaries have been downloaded and verified. Downloaded archives and extracted JSON stay in `.cache/sources/`, outside version control. The acquisition script uses Node.js built-ins only.

Updates verify GitHub's published SHA-256 digests for release assets. Ordinary fetches verify the locked archive digests, sizes, and extracted JSON digests. Loading sources also verifies extracted JSON, so editing a cached dictionary cannot silently alter a build. A corrupt archive causes an error; removing it permits a fresh download. A corrupt extracted JSON file can be restored by running `npm run fetch` again. Updating the lock is the only acquisition operation that resolves a moving `latest` URL.

The complete `jmdict-all` asset is intentional: selecting English-only entries would omit entries that have no English sense. Translations do not determine corpus membership. Exact English definitions of standalone kana number words additionally provide evidence for numeral sounds, such as スリー meaning three. KANJIDIC2 uses the complete `kanjidic2-all` asset from the same release.

## Pair and evidence semantics

`enumeratePairs(jmdict)` yields exact `{ id, written, reading, kanjiIndex, readingIndex, kind, writtenTags, readingTags }` records. IDs remain strings, and source strings are not normalized. Source array indexes are zero-based. `kind` is `written` for written-form/reading pairs and `kana` for standalone kana forms; kana forms have `kanjiIndex: null` and identical written and reading strings.

The [documented reading restrictions](https://scriptin.github.io/jmdict-simplified/types/JMdictKana.html) govern pair generation: `appliesToKanji: ["*"]` permits every spelling, an explicit list permits only those spellings, and `[]` represents a kana form that does not read a written form. Entries without written forms also produce standalone kana records. Restrictions to unknown spellings fail the build. Sense restrictions constrain meanings, not whether a written-form/reading pair exists, and do not remove pairs. A reading attached to a written form is not duplicated as an additional standalone kana record.

`makeCharacterReadings(kanjidic)` returns a map from each character to its deduplicated Japanese on- and kun-reading strings. [KANJIDIC's annotations](https://scriptin.github.io/jmdict-simplified/types/Kanjidic2Reading.html), including dots before okurigana and hyphens marking affixes, remain intact. Name-only nanori and non-Japanese readings are excluded. Characters without Japanese readings contribute no evidence.

`makeWordReadings(jmdict)` returns exact, deduplicated, permitted written-form/reading pairs. It does not infer character readings, normalize kana, or discard uncommon forms. A multi-character word reading is evidence for that whole written span; it does not license arbitrary divisions inside that span. Further evidence filtering or inference belongs to the alignment algorithm and must be evaluated separately.

These word and character maps are extracted from dictionary sound data. Independently reviewed lexical alignments are a separate input described below. No upstream furigana implementation or Lorenzi data enters generation.

## Supplemental Unihan readings

The Unicode 18.0.0 Unihan database supplies additional exact Japanese character readings through `kJapanese`. The [Unihan documentation](https://www.unicode.org/reports/tr38/tr38-41.html) describes the versioned archive and its fields. Its [Unicode License V3](https://www.unicode.org/license.txt) permits reuse with preservation of the copyright and permission notice, which is included in `NOTICE` and release assets.

The `lexicalSources` section of the source lock pins the archive URL, version, size, archive SHA-256, extracted member, and extracted text SHA-256. Weekly `fetch --update` refreshes JMdict/KANJIDIC2 while retaining this separate annual version pin. Acquisition reads the named ZIP member in memory, verifies its CRC and pinned digest, and never extracts archive paths onto the filesystem. Loading rechecks the cached text digest.

Supplemental readings may refine an opaque span when every character has sound evidence and the full allocation is unique. Exact allocations take precedence over separately enabled, bounded voicing, gemination, and yōon correspondences. Existing boundaries remain intact, and explicit irregular contexts restrict weaker evidence. A character-reading inventory is evidence, not an assertion that every possible combination is the intended morphology of a word.

## Bundled character and lexical evidence

`data/character-readings.json` contains explicitly typed, plain Japanese on/kun forms extracted from Japanese Wiktionary through Kaikki. Original forms, tags, source archive hash, extraction date, attribution, and license are retained. The source lock pins the checked-in bundle's byte count and digest; both acquisition and loading verify it. Weekly JMdict updates retain this bundle. The importer can reproduce it from the pinned local raw archive without relying on an upstream mutable download remaining unchanged. See [additional sources](additional-sources.md) for the exact command and selection protocol.

Only unique complete allocations inside existing opaque groups are accepted. The final layer uses exact listed forms; historical/name forms, invented okurigana stems, and general sound substitutions are excluded. Listed sokuon-final readings require a following kanji with a voiceless obstruent. The original input script is preserved.

### English Wiktionary character readings

`data/english-character-readings.json` is an additional pinned bundle extracted directly from English Wiktionary's primary MediaWiki revision API. The reviewed snapshot covers all 6,017 characters in its pinned JMdict character frame. This bundle contains 3,560 distinct character/reading pairs across 2,243 characters, represented by 3,726 provenance records.

| Input | Size in bytes | SHA-256 |
| --- | ---: | --- |
| English bundle, revision v2 | 2,528,877 | `19de3d104423590dbcdc7afa68d4eb53f42727e4c35932532a541d8ecb206670` |
| Primary page snapshot | 27,720,517 | `168070d2cfa2da11bed52773cef17bb6fcc71e2d713d845cdeb811b083dc0d1a` |

The source version is `enwiktionary-api-20261009-6017-pages`. Each record retains the original parameter item, current and historical forms, reading type, template context, page revision ID and timestamp, source line, and exact revision URL. The interpretation of hyphens and historical spellings follows [the pinned `ja-readings` documentation revision](https://en.wiktionary.org/w/index.php?title=Template:ja-readings/documentation&oldid=89401685).

The importer selects plain current-orthography on-readings, kun forms explicitly marked as complete, and the exact prefix before one documented kun hyphen. For example, `ひかり-` supplies the complete reading `ひかり`, while `ひか-る` supplies `ひか` and retains `る` as source suffix metadata. A marked suffix can be lexical rather than inflectional, as in `しゃ-みせん`; the importer makes no grammatical claim about it. Current orthography does not establish present-day usage. Unmarked kun, nanori, historical values, malformed chains, unsupported markup, and inferred inflections are withheld.

Pinned KANJIDIC2 plain, stem, full, and nanori inventories, Unihan `kJapanese`, and the Japanese Wiktionary bundle exclude already available character/sound correspondences. They are comparison inputs for this extraction and do not thereby become new allocator evidence. Every extraction input has a checked size and digest in the importer; ordinary source loading also verifies the checked-in output through `data/sources.lock.json`.

Reproduce or check the bundle from the retained local snapshots:

```sh
node scripts/import-english-character-readings.mjs \
  --input .cache/lexical-research/english-character-survey/primary-pages-complete-frozen.jsonl \
  --frame .cache/lexical-research/english-character-survey/jmdict-character-frame.json \
  --kanjidic .cache/sources/kanjidic2-all-3.6.2+20261005200550.json \
  --unihan .cache/sources/Unihan-Readings-18.0.0.txt \
  --japanese-bundle data/character-readings.json \
  --output data/english-character-readings.json \
  --check
```

Omitting `--check` writes the deterministic output. The importer requires the reviewed frozen inputs and performs no network requests. Normal generation uses the checked-in bundle and does not require these raw research snapshots. Weekly JMdict updates retain this separate evidence pin; refreshing the bundle requires a new source review and pin.

The English pass supplies only exact listed character sounds inside existing opaque spans, with raw KANJIDIC2 and the existing weak, Unihan, and Japanese-bundle readings as companions. Complete allocation must be unique, source irregular-reading restrictions still apply, and every earlier boundary and original kana script is preserved. Reviewing development changes establishes support for those cases; it does not establish corpus-wide superiority or certify every source reading.

English Wiktionary contributors provide the source under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wiktionary's copyright statement](https://en.wiktionary.org/wiki/Wiktionary:Copyrights). The bundle records attribution and the filtering and normalization performed by this project. `NOTICE` preserves that attribution in generated distributions.

### Reviewed lexical units

`data/lexical-evidence.json` contains 1,900 named written/reading units selected from Wiktionary and JmdictFurigana data proposals and direct dictionary research. Each retains a rationale, source URLs, and component evidence. Two AI agents reviewed each selected unit; this is not certification by a human lexicographer. Some moderately supported facts rely on a single lexical source, so independent AI reviews do not imply independent dictionary corroboration. Unresolved sound ownership remains excluded from these positive facts. Adapted Wiktionary and JmdictFurigana material is covered by CC BY-SA 4.0, with attribution in `NOTICE`; independent dictionary links document corroborating facts without importing their definitions.

A lexical unit can refine an existing opaque group only when its written text and normalized reading have a unique compatible placement. The refiner checks whole placements for conflicts but emits only their internal boundaries. This prevents a known word's outer edge from assigning an unwritten particle to an adjacent kanji. Explicit cuts for an exact target pair also veto contradictory vowel-length transfers before those heuristic boundaries can become protected; this does not supply new transfer-source alignments. The exact lexical file contents are included in the generator digest, binding evaluation and release provenance to their reviewed version.

Character sounds remain local by default. An optional `reusableSegments` array names zero-based segment indices separately reviewed for exact reuse. The current selection contains 79 segments from 76 facts, supplying 76 distinct character sounds. Each selected segment must contain one ideograph and a complete kana reading. The existing exact allocator retains the fact and segment identity, source links, and a fact digest; it excludes the same normalized donor pair and identifiable JMdict donor families. It generates no additional pronunciations from these sounds. Directly printed Japanese ateji and voiced readings qualify, while raw foreign transcriptions and allocations that depend on adjacent sounds keep their existing context checks. A stronger documented allocation for the target word still takes precedence.

Phonetic ateji can receive character boundaries when independent sound evidence supports them, including an explicitly documented assignment local to one word. A whole-word reading label or a native etymology does not automatically require grouping. Local evidence preserves surrounding boundaries; only separately selected complete sounds become reusable, and neither mechanism establishes a general pronunciation rule.

The v25 batch of 51 local facts covers 25 negative or noun-form correspondences, 24 astronomical names, and two bird-name/particle contexts. The noun facts preserve literal も in documented もの/もん variants. Constellation facts combine explicitly documented individual mansion names with restriction-valid compound readings; they do not create a universal 宿ぼし reading. The 鳶 proverb facts establish the boundary before が without certifying previously emitted finer cuts inside the kana bird name. No reusable character sounds are added by this batch.

The v26 batch adds 44 local facts covering further noun and kana variants, independently read symbols, and exact component ownership. Twenty-five exact annotations replace incorrect boundaries, including 鶏冠と|さか, 長刀なぎ|なた, 敷詰めるしき|つ|める, and minimal grouping across omitted particles. The annotation families include affected spellings where both generators previously agreed. No reusable character sounds or runtime rules are added.

The v27r1 batch adds 29 exact numeral facts and four ownership corrections. The numeral policy permits locally evidenced positional groups such as １じゅう/１いち in １１; zero placeholders remain inside their larger number unit. Primary teaching materials document the tens/units composition and its pronunciation. These are finer supported renderings, not a claim that whole-number ruby is linguistically wrong. The corrections cover 此方こんた, 立直りいち, 郡造 and 木葉蟹. No new reusable character sounds are introduced.

The v28r1 batch adds 574 exact local facts and refines the existing 天鼠子 allocation using an explicit primary character assignment and its same-entry spelling sibling. Three annotations correct 八色姓 in two readings and みそひと文字みそじひともじ. Six proposed facts remain withheld because morphological or sibling-word evidence did not establish their individual character ownership. Two further 御座所 proposals are withheld because their grouped prefixes suppress an existing supported 御お boundary in the current engine. The moth fact is scoped to its intended アメリカ白灯蛾 entry, preserving standalone 白灯蛾 behavior. Every adopted effect received source and complete-corpus consequence review; no reusable character sound or runtime rule was added.

The same file separately retains 90 reviewed deferral records covering 87 entry/reading families. They withhold unsupported residual inference where source review did not settle sound ownership; they do not supply an alignment or reject a later independently supported split. Families expand only through currently permitted JMdict pairs, covering 192 pairs in the pinned release. Removed spellings and absent families remain historical records without blocking weekly builds. The existing lexical-evidence switch disables both the positive facts and these deferrals.

All acquisition, curation, and release preparation described here remain local development work. No public release or corpus-wide superiority claim follows from the source coverage or the number of accepted refinements.
