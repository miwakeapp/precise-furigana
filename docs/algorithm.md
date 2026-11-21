# How alignment works

The input is a spelling and its complete reading. The generator divides the reading among consecutive parts of the spelling, preserving both strings exactly.

## Policy

- Split as finely as evidence supports. Regular readings, nanori, and explicit word-local allocations all justify a boundary. Labels such as ateji or jukujikun, etymology, or whole-word ruby elsewhere do not forbid a finer split.
- Knowing a word's pronunciation does not establish how its characters divide it. Without evidence, characters stay grouped.
- Never assign a remainder by subtraction. When all characters but one have supported readings, giving the rest to the last one was wrong too often (<span lang="ja"><ruby>一<rt>つき</rt></ruby><ruby>日<rt>たち</rt></ruby></span>, <span lang="ja"><ruby>木<rt>ゆ</rt></ruby><ruby>綿<rt>う</rt></ruby></span>).
- When equally good alignments disagree, keep only the boundaries they share.
- Evidence stays as local as its source. A word-local allocation never becomes a character reading usable elsewhere unless a lexical fact explicitly marks it reusable.

## Pipeline

[src/align.ts](../src/align.ts) finds the cheapest path through a graph over positions in the spelling and reading. Edges are literal kana, character readings, attested whole words (so every pair has some path), and restricted sound changes such as voicing, gemination, and contraction. On and kun readings get different sound-change permissions; truncating arbitrary readings produces plausible wrong splits. Costs only rank alternatives within one word.

[src/dataset.ts](../src/dataset.ts) layers further evidence passes over that aligner. Each pass may refine an unresolved group but must not erase a boundary a stronger stage established. Each has its own module and tests because each has different permissions:

| Evidence                                                                                                                              | Modules                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| KANJIDIC2 nanori and full kun forms; single-kanji JMdict spellings                                                                    | `sources`, `lexicon`, `weak-readings`                         |
| Verb continuatives supplying omitted okurigana (<span lang="ja"><ruby>植<rt>うえ</rt></ruby></span> in <span lang="ja">植木鉢</span>) | `morphology`                                                  |
| Sibling spellings and readings in the same entry                                                                                      | `variants`, `reading-variants`                                |
| Numeric and fullwidth spellings                                                                                                       | `numerals`                                                    |
| Phonetic ateji and foreign readings                                                                                                   | `ateji`, `loan-readings`, `korean-readings`                   |
| Unihan and Wiktionary character readings                                                                                              | `unihan`, `character-readings`, `exact-character-allocation`  |
| Restricted transformations of listed readings (<span lang="ja">ケー</span> for <span lang="ja">ケイ</span>)                           | `unihan-phonology`, `listed-phonology`, `on-reading-spelling` |
| Cuts shared with an alternate spelling in the same entry                                                                              | `shared-run-alignments`                                       |
| Reviewed word-local facts                                                                                                             | `lexical-evidence`                                            |

Constraints that apply across passes:

- Transfers come only from restriction-valid source pairs. Conflicting or ambiguous witnesses are dropped, not resolved.
- Omitted okurigana joins the preceding character: <span lang="ja">行来</span> follows <span lang="ja">行き来</span> as <span lang="ja"><ruby>行<rt>いき</rt></ruby><ruby>来<rt>き</rt></ruby></span>.
- The sibling passes run twice. The first run feeds the aligner, so a transferred word can be found inside longer ones. The second runs after every other stage, because a split that a later stage establishes, such as a lexical fact's, would otherwise never reach the entry's other spellings and readings. The second run also carries boundaries between readings of one spelling that differ by a single kana, as <span lang="ja">バンコック</span> does from <span lang="ja">バンコク</span>; it requires that the changed kana could not have crossed a boundary ([src/reading-variants.ts](../src/reading-variants.ts)).
- An omitted particle belongs to neither neighbor. Where a sibling spelling writes <span lang="ja">の</span>, <span lang="ja">を</span>, or <span lang="ja">が</span> between two kanji that the reading pronounces, a final pass groups the two kanji: <span lang="ja"><ruby>五<rt>ご</rt></ruby><ruby>重塔<rt>じゅうのとう</rt></ruby></span>. It runs last because several earlier passes can independently cut beside the particle.
- Silent punctuation is set aside while aligning, on either side, so <span lang="ja">Ｓ・Ｍ</span> read <span lang="ja">エス・エム</span> divides as <span lang="ja">ＳＭ</span> read <span lang="ja">エスエム</span> does, and the boundaries this finds are added to the direct alignment's. A mark both sides share becomes its own segment; a spelling's mark joins the segment before it and is shown plain; a reading's mark joins a neighboring ruby segment and makes the pair mispaired.
- A positional numeral's reading is parsed into chunks, one per nonzero digit with its zeros ([src/numeral-chunks.ts](../src/numeral-chunks.ts)). A reading that does not parse that way, such as digits read one by one, keeps whatever division it had.
- A lexical fact contributes only its internal cuts. Its outer edges are not transferred, so an unwritten particle between words cannot become part of a neighbor's reading.
- Some passes run twice, with and without lexical refinement, and keep compatible cuts from both, so a coarse lexical fact cannot suppress an independently supported finer split. Adding or changing a fact can therefore affect other words; compare the whole corpus after any data change.
- No pass feeds inferred readings back into the character inventories.

## After alignment

- [src/display.ts](../src/display.ts) converts generator segments, which reconstruct both strings exactly, into release segments: kana the reading repeats becomes plain text, and silent punctuation leaves ruby. A ruby group containing a kanji only loses kana when its whole leading or trailing kana run matches, because a partial match can be coincidental (in <span lang="ja">近からずとも遠からず</span> read <span lang="ja">ちかからずとおからず</span>, peeling <span lang="ja">と</span> would leave <span lang="ja">遠</span> with <span lang="ja">お</span>). A kana-only group sheds any matching edge kana.
- [src/pairings.ts](../src/pairings.ts) decides which pairs contradict their spelling, flags each as mispaired or phonetic, and plans synthesized pairs.
- `data/annotations.json` replaces the complete result for one exact ID, spelling, and reading. Regression fixtures test the generator without annotations, so an annotation never hides a generator regression.
