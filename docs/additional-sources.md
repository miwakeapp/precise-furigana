# Additional licensed lexical evidence

Research snapshot: 2026-10-09. All measurements below use the frozen v3 candidate, SHA-256 `ff46c27a11ad425aa9524e8208419bbecd93d1f12e4ce75fbc21115889d4f7be`. Downloaded exploratory sources are quarantined in `.cache/lexical-research/`; this research does not add them to generation inputs. Development examples exclude every spelling–reading pair associated with a held-out entry.

## JmdictFurigana

The repository now gives its software an [MIT license](https://github.com/Doublevil/JmdictFurigana/blob/master/LICENSE), while the [README's resource license](https://github.com/Doublevil/JmdictFurigana#licence) follows JMdict's Creative Commons Attribution-ShareAlike license. These are separate permissions. Its documented maintenance schedule is monthly, on the 25th; the measured [2026-09-25 release](https://github.com/Doublevil/JmdictFurigana/releases/tag/2.3.1%2B2026-09-25) contains a 34,736,193-byte JSON file, available as a 5,270,897-byte compressed archive.

The downloaded data has 236,532 records. Every record reconstructs its spelling and kana-normalized reading. There are 37 normalized spelling–reading keys with conflicting segmentations; these are excluded from comparisons rather than resolved by choosing a convenient answer.

| Relation of JmdictFurigana to our output | All 324,992 records | The 5,418 records where our output is coarser than Lorenzi |
| --- | ---: | ---: |
| Same boundaries | 232,910 | 1,013 |
| Strictly finer | 1,502 | 908 |
| Strictly coarser | 2,804 | 71 |
| Incompatible boundaries | 51 | 0 |
| Conflicting normalized source records | 75 | 18 |
| No matching source record | 87,650 | 3,408 |

These are proposed refinements, not measured accuracy gains. For example, the source assigns ＩＳＯ感度 / イソかんど as Ｉ/イ, Ｓ/ソ, Ｏ/か, 感/ん, 度/ど. Exact reconstruction and preservation of existing boundaries would both permit that bad result when our baseline is grouped. The source also splits 西風 / にし as 西/に, 風/し, which requires independent phonetic evidence rather than simple subtraction.

There are 855 development-safe strictly finer residual proposals, covering 645 distinct refined spans. These form a useful review queue. Character or lexical evidence should corroborate accepted proposals, and ambiguous source records should remain excluded. Importing a curated result would require attribution to the resource and its contributors, a pinned release/checksum, and retained provenance for the accepted facts. The source's own README acknowledges erroneous splitting in some special expressions; generated output is not an expert gold standard.

## Unihan's kana reading field

[Unicode 18.0.0 Unihan](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) is an 8,340,649-byte archive, SHA-256 `4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e`. Its `kJapanese` field supplies kana readings for 51,583 characters. Unlike the older romanized `kJapaneseOn` and `kJapaneseKun` fields, it needs no romanization conversion. Unicode describes the field as provisional and identifies the Moji Jōhō Kiban database as its source. [UAX #38](https://www.unicode.org/reports/tr38/#kJapanese).

After removing KANJIDIC's main readings, nanori, and both stem and full dotted readings, the kana field adds 7,877 readings across 3,872 characters used by development pairs. This is lexical coverage, not alignment coverage. A minimal experiment tries exact character readings inside existing multi-kanji ruby spans, preserves every old boundary, and accepts only a unique complete path. New Unihan readings enable 351 records to split in that experiment, of which 335 are safe development records. The latter contain 233 distinct refinement families. No phonological transformations or alternative spelling transfers are included in this count.

The reviewed families mostly supply uncommon on readings, historical or Buddhist vocabulary, and lexical stems. Repeated examples include 提/ちょう + 灯/ちん, 暖/の + 簾/れん, and 高/こう + 麗/らい. These facts are promising additions, but the simple experiment does not demonstrate that unrestricted global use is safe. Unknown readings should remain weaker than established boundaries, competing paths should withhold a split, and any irregular-reading policy still applies.

The [Unicode License v3](https://www.unicode.org/license.txt) permits reuse and modification with its copyright and permission notice retained in copies or associated documentation. Keep that notice with the source record and release documentation. The source database is also available directly from [CITPC](https://moji.or.jp/mojikiban/mjlist/) under CC BY-SA 2.1 Japan with IPA attribution, although using the pinned Unihan distribution avoids acquiring and parsing its spreadsheet separately.

## Wiktionary

Both [English](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) and [Japanese](https://ja.wiktionary.org/wiki/Wiktionary:%E8%91%97%E4%BD%9C%E6%A8%A9) Wiktionary text is available under CC BY-SA 4.0. Page/revision provenance, contributor attribution through source links, license information, and identification of modifications should accompany any retained derivative facts. Lexical statements and manually supplied readings may be useful; copied quotations from third-party publications require separate care.

[Kaikki's raw extraction downloads](https://kaikki.org/dictionary/rawdata.html) avoid writing a MediaWiki parser. The Japanese-edition archive measured here is 64,974,760 bytes, SHA-256 `92b85a0c09e2013e9bad4258de9e0226d23e0a20011cb66c3ba7fed33d39ee90`. It contains 150,505 Japanese-language records covering 125,737 headwords, including 2,254 single-character records and 16,712 records carrying etymology text. A simple extraction of explicitly tagged kana reading forms adds 2,545 readings across 1,040 characters occurring in development. The same unique-path experiment as Unihan produces 337 newly refinable records, 330 safe for development. The Unihan and Wiktionary counts overlap and must not be added.

Reading tags matter: old readings, historical spellings, and regional readings should retain their labels. Explicit hyphenation is different from arbitrary truncation. For uncommon words, etymological prose can corroborate a contextual split without asserting that the corresponding reading applies everywhere.

The English-edition Japanese subset is larger, and its extracted canonical forms and lexical links can retain per-word ruby tuples. The measured 384,872,752-byte subset has 199,484 records and 46,196 records with etymology text. Reconstructing canonical forms yields 78,104 distinct spelling–reading keys. Conflicting segmentations are withheld. Against frozen v3, this source is strictly finer on 438 records, coarser on 487, and incompatible on 9; 1,245 matching records have conflicting source segmentations. Among the 5,418 residuals, 372 have a strictly finer proposal. These are again candidates, not validated improvements.

Wiktionary's [`ja-kanjitab` documentation](https://en.wiktionary.org/wiki/Template:ja-kanjitab/documentation) explicitly describes per-character reading parameters, grouped-character readings, and separate values for transformed readings. The source markup for 暖簾 specifies 暖 のん→の and 簾 れん, making the intended contextual correspondence independently visible. Rendered ruby still needs review: the extracted 従兄弟 / いとこ segmentation 従/い, 兄/と, 弟/こ does not by itself establish independent character readings. Distinguish explicit lexical evidence from merely reproducing a renderer's output.

The postprocessed download is deprecated and may include merged information from additional sources; the raw all-language extraction is much larger. A production acquisition path should preserve original Wiktionary page/revision evidence and extract only the intended source fields. A large record count alone does not establish useful independent readings: the inspected English character subset omits many plain reading lists while retaining ruby in derived-word links.

### Review of the English Wiktionary proposals

This section records the original, deliberately narrower source review. Later review distinguishes an unsupported etymological inference from an explicitly documented local spelling assignment: the latter can justify a boundary without establishing a reusable character reading. The current policy and expanded inventory are described in [dictionary sources](data-sources.md#reviewed-lexical-units) and the v9/v10 [experiments](experiments.md). Historical rejection and coverage counts below have not been rewritten.

The development-only review covered all 408 safe finer proposals, grouped into 348 distinct refined-span families. It inspected original wikitext for all 365 cited pages, retaining revision identifiers, explicit `ja-kanjitab` parameters, and a rationale for every family. The original-page snapshot has SHA-256 `1f959eef3531a5a00a9c44b84d357b4e955a88e2ecc518d0dc3235c7942f0655`; it corroborates a separate, older Kaikki extraction rather than pretending both snapshots are identical.

One AI reviewer judged 300 families acceptable as linguistic proposals, 9 rejected, and 39 uncertain. At the whole-proposal level, these correspond to 340 accepted, 12 rejected, and 56 uncertain records. These are development judgments, not independent accuracy measurements. Rejected examples include distributing 従兄弟 / いとこ into one kana per character, assigning the small ょ in 背負 / しょ to 負, and splitting 針孔 / めど into 針め and 孔ど. Semantic etymology alone is insufficient: deriving 眼鏡 from 目 and 金 does not independently establish 鏡がね in the current spelling.

The v5 snapshot, SHA-256 `8ea27fcfed68d59c2e43c915beb3bd877f580cbed708b5d9536d8ddb47575b02`, already matches 91 of the proposals. Of the remaining accepted finer proposals, 24 have separate character-dictionary witnesses, 47 have explicit etymological evidence on the source page, and 178 rely on the explicit table plus linguistic review. The latter group must not be presented as independently corroborated lexical facts. None of these counts is additive with Doublevil or the new algorithmic rules.

A narrower integration proposal retains only 58 families: 47 with exact character-reading witnesses and 11 with explicit phonetic history, such as 博士's historical borrowed syllables or 猪口's older ちょく form. It excludes semantic-only decompositions, table-only judgments, and unresolved particle attachment conventions. Its 77 complete word proposals include 40 still finer than v5, of which 23 do not overlap Doublevil. The files remain local research artifacts: `wiktionary-reviewed-subset-facts.jsonl`, `wiktionary-reviewed-subset-alignments.jsonl`, and their summary under `.cache/lexical-research/`. Facts carry raw dictionary witnesses, exact Wiktionary revision links, license and attribution metadata, and instructions to preserve existing boundaries. They are permissions for exact spelling–reading pairs, not global character-reading additions. The facts file has SHA-256 `99e385e6c3038e0bf42f3fe50098376ee70f6208c3bcc9b4f0fcce7edacaa45a`.

### Interpreting reading types

Unihan's current field description explicitly calls hiragana generally kun and katakana generally on; [MJ's source conventions](https://moji.or.jp/mojikiban/mjlist/) use the same distinction in principle. It is not an absolute type system. A [Unicode working-group investigation](https://www.unicode.org/L2/L2025/25213-katakana_kun-yomi.pdf) documents native taxonomic terms and non-Sino-Japanese loans in katakana, including measurement units. Some loan readings even have an on-like short shape. Retain explicit Wiktionary reading tags when available, and do not infer permission for arbitrary on-reading transformations from script alone.

### Bundled Japanese Wiktionary character readings

The reproducible selection in `data/character-readings.json` uses only Japanese-language single-ideograph entries with explicit, unmarked on or kun reading forms. It excludes untyped readings, nanori, historical reading tags, hyphenated okurigana, and inferred stems or sound changes. Original forms and tag sets are retained; the normalized reading uses katakana for on and hiragana for kun. The 5,688 records represent 5,105 distinct character–reading–type facts across 1,518 characters; multiple original tag sets explain the difference.

The pinned raw archive is [Kaikki's Japanese-edition extraction](https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz), 64,974,760 bytes with SHA-256 `92b85a0c09e2013e9bad4258de9e0226d23e0a20011cb66c3ba7fed33d39ee90`. Its [extraction log](https://kaikki.org/dictionary/downloads/ja/ja-extract.log) identifies the Japanese dump as `jawiktionary-20261001` and records extraction on 2026-10-01. The English dump date shown in Kaikki's general page footer does not describe this Japanese source. The bundle retains attribution to Japanese Wiktionary contributors and Kaikki/Wiktextract and carries CC BY-SA 4.0 provenance.

Regenerate the bundle from the retained raw archive with:

```sh
node scripts/import-character-readings.mjs --input .cache/lexical-research/ja-extract.jsonl.gz
```

Add `--check` to verify byte-for-byte reproduction. The importer rejects a changed checksum. Kaikki's URL is mutable, so archive the pinned input when updating this optional lexical source; weekly corpus generation consumes the checked-in bundle rather than depending on a fresh Kaikki download. Updating the snapshot requires reviewing its provenance and full output consequences. The current bundle is 674,862 bytes with SHA-256 `1433f551a99502fcfda5dce99d2240646c42e27c47a7caa4025fc79e4d8e68cd`.

Against the exact frozen v5 output, adding these listed readings through the existing conservative supplemental-reading path yields 162 strictly finer distinct pairs, with no coarsening or incompatible changes. An Unihan-only control produces no changes. All 158 development-safe changed pairs were independently inspected by two AI reviewers; neither found a clear false added boundary. Original Japanese Wiktionary wikitext corroborates all 39 newly used reading witnesses. Common gains include 魚な, 鼠す, 司す, 所そ, and 頭じゅう. These are listed lexical sounds, not readings inferred from our desired split. Fifty-seven safe gains overlap the separate Unihan voicing/yōon experiment, leaving 101 safe pairs outside that overlap; these counts must not be added blindly.

Two 体育 / たいく family rows involve a contraction convention: independently listed 体タ supports た/いく, but this does not uniquely prove historical ownership of the contracted vowel. The original 甲カッ field also states a following-voiceless-consonant condition which Kaikki's tags omit; all five observed 甲 refinements satisfy it. These limitations are retained in the research audit under `.cache/experiments/japanese-wiktionary/`. Development inspection and source corroboration do not replace a fresh blinded comparison or establish corpus-wide superiority.

## Practical order

- Prototype Unihan as weak lexical evidence. Its acquisition and parsing are small, stable, and directly licensed; the measured benefit is hundreds of candidate refinements.
- Review the licensed JmdictFurigana residual proposals by family, accepting independently corroborated facts. It covers some gaps that general character dictionaries miss, while also containing clear false precision.
- Assess Wiktionary's contextual ruby and etymological evidence separately from character-reading enrichment. Preserve source fields and historical tags, and measure overlap before estimating incremental coverage.

None of these sources currently establishes corpus-wide superiority. The next integrated candidate still needs a newly frozen independent evaluation after development choices are settled.
