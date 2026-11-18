# How alignment works

The input is a spelling and its complete reading. The generator divides the reading among consecutive parts of the spelling, preserving both strings exactly.

## Policy

- Split as finely as evidence supports. Regular readings, nanori, and explicit word-local allocations all justify a boundary. Labels such as ateji or jukujikun, etymology, or whole-word ruby elsewhere do not forbid a finer split.
- Knowing a word's pronunciation does not establish how its characters divide it. Without evidence, characters stay grouped.
- Never assign a remainder by subtraction. When all characters but one have supported readings, giving the rest to the last one was wrong too often (<ruby>一<rt>つき</rt></ruby><ruby>日<rt>たち</rt></ruby>, <ruby>木<rt>ゆ</rt></ruby><ruby>綿<rt>う</rt></ruby>).
- When equally good alignments disagree, keep only the boundaries they share.
- Evidence stays as local as its source. A word-local allocation never becomes a character reading usable elsewhere unless a lexical fact explicitly marks it reusable.

## Pipeline

[src/align.mjs](../src/align.mjs) finds the cheapest path through a graph over positions in the spelling and reading. Edges are literal kana, character readings, attested whole words (so every pair has some path), and restricted sound changes such as voicing, gemination, and contraction. On and kun readings get different sound-change permissions; truncating arbitrary readings produces plausible wrong splits. Costs only rank alternatives within one word.

[src/dataset.mjs](../src/dataset.mjs) layers further evidence passes over that aligner. Each pass may refine an unresolved group but must not erase a boundary a stronger stage established. Each has its own module and tests because each has different permissions:

| Evidence                                                                                | Modules                                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| KANJIDIC2 nanori and full kun forms; single-kanji JMdict spellings                      | `sources`, `lexicon`, `weak-readings`                                             |
| Verb continuatives supplying omitted okurigana (<ruby>植<rt>うえ</rt></ruby> in 植木鉢) | `morphology`                                                                      |
| Sibling spellings and readings in the same entry                                        | `variants`, `reading-variants`                                                    |
| Numeric and fullwidth spellings                                                         | `numerals`                                                                        |
| Phonetic ateji and foreign readings                                                     | `ateji`, `loan-readings`, `korean-readings`                                       |
| Unihan and Wiktionary character readings                                                | `unihan`, `character-readings`, `exact-character-allocation`                      |
| Restricted transformations of listed readings (ケー for ケイ)                           | `unihan-phonology`, `listed-phonology`, `on-reading-spelling`, `native-compounds` |
| Cuts inside longer words and alternate spellings                                        | `source-units`, `separator-alignments`, `shared-run-alignments`                   |
| Reviewed word-local facts                                                               | `lexical-evidence`                                                                |

Constraints that apply across passes:

- Transfers come only from restriction-valid source pairs. Conflicting or ambiguous witnesses are dropped, not resolved.
- Omitted okurigana joins the preceding character: 行来 follows 行き来 as <ruby>行<rt>いき</rt></ruby><ruby>来<rt>き</rt></ruby>.
- An omitted particle belongs to neither neighbor. Where a sibling spelling writes の, を, or が between two kanji that the reading pronounces, a final pass groups the two kanji: <ruby>五<rt>ご</rt></ruby><ruby>重塔<rt>じゅうのとう</rt></ruby>. It runs last because several earlier passes can independently cut beside the particle.
- Silent middle dots join a neighboring segment and are shown without ruby; cuts transfer from the undotted spelling only when its character allocation is complete and unambiguous.
- A lexical fact contributes only its internal cuts. Its outer edges are not transferred, so an unwritten particle between words cannot become part of a neighbor's reading.
- Some passes run twice, with and without lexical refinement, and keep compatible cuts from both, so a coarse lexical fact cannot suppress an independently supported finer split. Adding or changing a fact can therefore affect other words; compare the whole corpus after any data change.
- Optional weak sound changes (dictionary nasal loss and initial voicing) can shift the evidence that spelling transfers rely on, so the pipeline also compiles a reduced copy of itself without them and keeps the boundaries that copy establishes. This roughly doubles the early stages' cost.
- No pass feeds inferred readings back into the character inventories. The `learnReadings` experiment, which would, is off by default because its candidates were too permissive.

## After alignment

- [src/display.mjs](../src/display.mjs) converts generator segments, which reconstruct both strings exactly, into release segments: kana the reading repeats becomes plain text, and silent punctuation leaves ruby. A ruby group containing a kanji only loses kana when its whole leading or trailing kana run matches, because a partial match can be coincidental (in 近からずとも遠からず read ちかからずとおからず, peeling と would leave 遠 with お). A kana-only group sheds any matching edge kana.
- [src/pairings.mjs](../src/pairings.mjs) decides which pairs contradict their spelling, flags the search-only ones as mismatched, and plans synthesized pairs.
- `data/annotations.json` replaces the complete result for one exact ID, spelling, and reading. Regression fixtures test the generator without annotations, so an annotation never hides a generator regression.
