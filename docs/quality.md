# Alignment quality

The project favors precise supported sound ownership. Complete coverage and exact reconstruction are mechanical guarantees checked across every generated record. Linguistic correctness is harder: dictionary inventories are incomplete, several allocations can be defensible, and plausible sound changes can still be wrong for a particular word.

The regression suite deliberately targets difficult cases; it is not a random accuracy sample. Development reviews were performed by AI agents using cited sources, not certified by human lexicographers. Agreement with another generator is useful for finding cases, but neither agreement nor a finer split proves correctness.

## Representative decisions

| Word | Output | Why |
| --- | --- | --- |
| 日本 | 日[に]本[ほん]; 日[にっ]本[ぽん] | Listed sounds and restricted contraction/gemination agree with the [explicit word table](https://en.wiktionary.org/w/index.php?oldid=93472794#Japanese). |
| 時計 | 時[と]計[けい] | A phonetic assignment is useful even when tagged ateji; [the table assigns both sounds](https://en.wiktionary.org/w/index.php?oldid=92257101#Japanese). |
| 蕎麦 | 蕎[そ]麦[ば] | [The explicit allocation in 晦蕎麦](https://en.wiktionary.org/w/index.php?oldid=92161504#Japanese) supports these sounds despite grouped ruby elsewhere. |
| 海老 | 海[え]老[び] | Both exact sounds occur in the pinned KANJIDIC2 nanori inventory. Whole-word ruby elsewhere does not negate them. |
| 尻尾 | 尻[しっ]尾[ぽ] | [The word table](https://en.wiktionary.org/w/index.php?oldid=92237397#Japanese) explicitly assigns the contracted sounds. |
| 命の綱 | 命[いのち]の綱[つな] | Complete character readings establish which の is the literal particle. Matching kana greedily would put it inside 命's reading. |
| メーカ希望価格 | メー / カ[カー] / 希[き]望[ぼう]価[か]格[かく] | The same JMdict entry's spelling variants keep the extra vowel with カ, rather than attaching it to 希望価格. |
| 達磨 | 達[だる]磨[ま] | [The lexical allocation](https://en.wiktionary.org/w/index.php?oldid=92643544#Japanese) supplies the unusual local reading of 達. |
| 端折る | 端[はし]折[ょ]る | [Explicit local ownership](https://en.wiktionary.org/w/index.php?oldid=86463303#Japanese) supports the small kana on 折. The two ruby readings still concatenate exactly. |

These explain the examples in the README, not a ranking of entire dictionaries. JmdictFurigana has also supplied useful licensed candidate data; selected assignments were reviewed and retained with attribution. No third-party comparison tooling is needed to build or maintain this database.

## Unresolved and competing allocations

Some familiar words remain grouped: 海女[あま], 硝子[ガラス], 金糸雀[カナリア], and 寄席[よせ]. Their complete pronunciations are known, but the reviewed inventories and word evidence do not establish all proposed individual sounds. Grouping is provisional; a valid new source can justify a finer split. The presence of whole-word ruby alone is not a reason to reject such evidence.

河[かわ]原[ら] has [explicit word-local support](https://en.wiktionary.org/w/index.php?oldid=92246152#Japanese), while listed character sounds also permit 河[か]原[わら]. A difference of that kind need not have a uniquely correct winner under a phonetic policy.

For 幼馴染み[おさなじみ], knowing the longer おさななじみ form does not alone determine which character owns the contracted な. Similarly, [the dictionary's なみ‐あし analysis](https://kotobank.jp/word/%E4%B8%A6%E8%B6%B3-589744) does not by itself establish the character allocation for 常歩. Both are useful targets for better evidence, not reasons to invent a general deletion rule.

Numerals have a rendering convention as well as pronunciation. In 三〇日, the output keeps 三〇[さんじゅう] together and splits 日[にち]; it does not give the zero placeholder the standalone sound じゅう. Other positional allocations are admitted only through specifically reviewed local evidence.

寿府 stays grouped for both ジュネーブ and ジュネーヴ. [The pinned source](https://en.wiktionary.org/w/index.php?oldid=86487136#Japanese) supplies whole-word pronunciations but does not establish 府ネーブ or 府ネーヴ. Both readings therefore withhold unsupported residual inference, while remaining open to future supported splits.

Residual inference is a remaining source of risk. For example, 土筆[つくづくし] currently gives 土[つく]筆[づくし] with `fallback` status; that status must not be read as a verified character reading. For 下放れ[したっぱなれ], KANJIDIC’s explicit 放 prefix `-っぱな.し` supports 下[した]放[っぱな]れ under the character-reading policy, though this does not prove a competing したっ/ぱな rendering wrong. An `aligned` label is model support, not proof of a uniquely correct boundary.

A source update or correction can alter related words, so maintenance always includes a complete comparison between builds. The useful publication criterion is a reproducible, validated dataset with clear evidence and limitations—not the absence of every unresolved word.
