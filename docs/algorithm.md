# How alignment works

The input is a spelling and its complete reading, not a sentence to tokenize. JMdict determines which pairs exist; the generator assigns consecutive portions of that reading to consecutive portions of the spelling. Every result must preserve both original strings exactly.

The policy is the finest supported assignment. Regular readings, nanori, and explicit word-local phonetic assignments can all justify a boundary. A label such as ateji or jukujikun, a native etymology, or whole-word ruby does not by itself prohibit a finer split. Conversely, knowing a word's pronunciation does not establish how its characters divide that sound.

## Dictionary graph

[src/align.mjs](../src/align.mjs) searches a weighted graph over positions in the spelling and reading. Its edges include literal kana, KANJIDIC2 readings, attested dictionary spans, and restricted pronunciation changes. The whole attested word is available as a grouped edge, so uncertainty does not prevent coverage.

Lower-cost paths prefer stronger evidence and useful detail. Sound changes include voicing, gemination, selected contractions, and compound-level alternations. On and kun readings have different permissions; arbitrary truncation of every character reading would produce convincing but incorrect splits. Kana inside a word must keep their sound ownership.

When equally good paths disagree, the result retains only boundaries common to all of them. Scores rank alternatives within a word; they are not probabilities.

## Supplemental readings and spelling witnesses

[src/dataset.mjs](../src/dataset.mjs) assembles the stages. Supplemental evidence is generally allowed to refine an opaque group while preserving stronger boundaries.

| Evidence | Purpose | Main modules |
| --- | --- | --- |
| KANJIDIC2 nanori, full kun forms, and single-kanji JMdict spellings | Recover exact sounds missing from the primary reading inventory | `sources`, `lexicon`, `weak-readings` |
| Regular verb continuatives | Supply omitted okurigana in attested compounds, such as <ruby>植<rt>うえ</rt></ruby> in 植木鉢 | `morphology` |
| Same-entry spelling and reading variants | Transfer supported ownership through omitted kana, spelling substitutions, and vowel-length variants | `variants`, `reading-variants` |
| Decimal and fullwidth forms | Relate equivalent numeric spellings and dictionary-backed foreign number names | `numerals` |
| Phonetic ateji and foreign readings | Test bounded correspondences against explicit source sounds | `ateji`, `loan-readings`, `korean-readings` |
| Unihan and Wiktionary readings | Fill character-inventory gaps without inventing new readings | `unihan`, `character-readings`, `exact-character-allocation` |
| Restricted transformations of listed readings | Recognize supported sound changes and long-vowel spelling, such as ケー for ケイ | `unihan-phonology`, `listed-phonology`, `on-reading-spelling`, `native-compounds` |

Transfers require restriction-valid source pairs. Conflicting witnesses and ambiguous placements are withheld. Source-language restrictions apply to foreign transcriptions; Korean correspondences exclude unsupported liaison and assimilation contexts. An exact word-local result does not become a globally available character pronunciation.

KANJIDIC's okurigana notation separates a character's sound from its following kana. The English Wiktionary bundle likewise distinguishes complete readings from explicitly marked character prefixes. Unmarked kun forms are not guessed to be prefixes.

## Local evidence and corrections

`data/lexical-evidence.json` contains named units with explicit sound allocations, rationales, and source links. [src/lexical-evidence.mjs](../src/lexical-evidence.mjs) places these units within a word and contributes their internal cuts. Outer edges are not automatically transferred: an unwritten particle between words must not become a fabricated reading of a neighboring character.

Facts remain local by default. A small selection of `reusableSegments` explicitly authorizes an independently supported complete character sound for reuse. Such a sound is never used for its own pair or for the JMdict entries in the fact's `jmdictEntries`, and no further pronunciations are derived from it.

Late evidence runs both with and without lexical refinement. Compatible cuts are combined so a coarser local fact does not suppress an independently supported finer allocation. Contradictory exact target evidence can veto an earlier transfer before that transfer becomes protected. This interaction is a real source of complexity: adding a grouped fact can affect nearby shorter units, so every data change needs a complete corpus comparison.

`data/annotations.json` is the final escape hatch. An annotation replaces the complete alignment for one JMdict ID, spelling, and reading. It requires a reason and source links, and a stale annotation absent from the input dictionary fails the build. Regression fixtures exercise the underlying generator without applying these exact overrides.

## Boundaries inside longer words

Supported source words and alternate spellings can expose further boundaries:

- `source-units` independently checks each source unit against raw character evidence before reusing its internal cuts.
- `separator-alignments` transfers cuts from the undotted spelling to one with silent middle dots. Each dot joins the preceding segment, or the following one when an earlier cut already put it there, and the release shows it without ruby. A generated undotted spelling is usable only with one complete raw-character allocation and independent aligner agreement.
- `shared-run-alignments` transfers cuts inside a uniquely placed shared spelling span. Changed kana must have independently established sound ownership.

These are bounded passes, not recursive learning. Inferred results do not feed back indefinitely into the evidence inventories.

## Unsupported remainders

When every character but one has a supported reading, the remainder could be assigned to that character by subtraction. The generator does not do this: such guesses were wrong too often, as in <ruby>一<rt>つき</rt></ruby><ruby>日<rt>たち</rt></ruby> or <ruby>木<rt>ゆ</rt></ruby><ruby>綿<rt>う</rt></ruby>. The word stays grouped until evidence supports a finer split.

## Complexity and limits

The engine uses several small modules because the evidence types have different permissions. Combining them into a single general transformation rule would hide restrictions rather than eliminate them. The largest modules are the graph search and pipeline composition; the supporting modules have direct tests for their linguistic constraints.

The main remaining risks are overconfident local evidence, interacting refinements, and source changes that invalidate assumptions. More splitting is not automatically better. Maintainable improvements come from an evidenced correction or a narrow rule whose complete effects can be reviewed, with unresolved ownership allowed to remain grouped.
