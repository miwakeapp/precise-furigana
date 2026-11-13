# Alignment quality

Coverage and exact reconstruction are checked mechanically for every record. Linguistic correctness is harder: dictionary inventories are incomplete, several allocations can be defensible, and a plausible sound change can still be wrong for a particular word. The regression suite targets difficult cases rather than sampling randomly, and the evidence was reviewed by AI agents citing sources, not by a lexicographer.

## Representative decisions

| Word | Output | Why |
| --- | --- | --- |
| 日本 | <ruby>日<rt>に</rt></ruby><ruby>本<rt>ほん</rt></ruby>, <ruby>日<rt>にっ</rt></ruby><ruby>本<rt>ぽん</rt></ruby> | Listed sounds and restricted contraction/gemination agree with the [explicit word table](https://en.wiktionary.org/w/index.php?oldid=93472794#Japanese). |
| 時計 | <ruby>時<rt>と</rt></ruby><ruby>計<rt>けい</rt></ruby> | A phonetic assignment is useful even when tagged ateji; [the table assigns both sounds](https://en.wiktionary.org/w/index.php?oldid=92257101#Japanese). |
| 蕎麦 | <ruby>蕎<rt>そ</rt></ruby><ruby>麦<rt>ば</rt></ruby> | [The explicit allocation in 晦蕎麦](https://en.wiktionary.org/w/index.php?oldid=92161504#Japanese) supports these sounds despite grouped ruby elsewhere. |
| 海老 | <ruby>海<rt>え</rt></ruby><ruby>老<rt>び</rt></ruby> | Both exact sounds occur in the pinned KANJIDIC2 nanori inventory. Whole-word ruby elsewhere does not negate them. |
| 尻尾 | <ruby>尻<rt>しっ</rt></ruby><ruby>尾<rt>ぽ</rt></ruby> | [The word table](https://en.wiktionary.org/w/index.php?oldid=92237397#Japanese) explicitly assigns the contracted sounds. |
| 命の綱 | <ruby>命<rt>いのち</rt></ruby>の<ruby>綱<rt>つな</rt></ruby> | Complete character readings establish which の is the literal particle. Matching kana greedily would put it inside 命's reading. |
| メーカ希望価格 | メーカ<ruby>希<rt>き</rt></ruby><ruby>望<rt>ぼう</rt></ruby><ruby>価<rt>か</rt></ruby><ruby>格<rt>かく</rt></ruby> | The same JMdict entry's spelling variants put the reading's extra vowel with カ, so it is not attached to 希望価格. The written kana show no ruby. |
| 達磨 | <ruby>達<rt>だる</rt></ruby><ruby>磨<rt>ま</rt></ruby> | [The lexical allocation](https://en.wiktionary.org/w/index.php?oldid=92643544#Japanese) supplies the unusual local reading of 達. |
| 端折る | <ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る | [Explicit local ownership](https://en.wiktionary.org/w/index.php?oldid=86463303#Japanese) supports the small kana on 折. |

## Unresolved and competing allocations

Some familiar words remain grouped: <ruby>海女<rt>あま</rt></ruby>, <ruby>硝子<rt>ガラス</rt></ruby>, <ruby>金糸雀<rt>カナリア</rt></ruby>, and <ruby>寄席<rt>よせ</rt></ruby>. Their pronunciations are known, but the evidence does not establish each character's sound. A new source could justify a finer split.

<ruby>河<rt>かわ</rt></ruby><ruby>原<rt>ら</rt></ruby> has [explicit word-local support](https://en.wiktionary.org/w/index.php?oldid=92246152#Japanese), and the output follows it, although listed character sounds would also permit <ruby>河<rt>か</rt></ruby><ruby>原<rt>わら</rt></ruby>.

For <ruby>幼<rt>おさな</rt></ruby><ruby>馴染<rt>じ</rt></ruby>み, knowing the longer おさななじみ form does not alone determine which character owns the contracted な. Similarly, [the dictionary's なみ‐あし analysis](https://kotobank.jp/word/%E4%B8%A6%E8%B6%B3-589744) does not by itself establish the character allocation for 常歩.

Numerals have a rendering convention as well as pronunciation. In 三〇日, the output is <ruby>三〇<rt>さんじゅう</rt></ruby><ruby>日<rt>にち</rt></ruby>; it does not give the zero placeholder the standalone sound じゅう.

Words whose characters lack individually supported readings stay grouped, even when subtracting the known readings would suggest a split: <ruby>寿府<rt>ジュネーブ</rt></ruby>, <ruby>土筆<rt>つくづくし</rt></ruby>, <ruby>一日<rt>つきたち</rt></ruby>. For 下放れ, KANJIDIC’s explicit 放 prefix `-っぱな.し` supports <ruby>下<rt>した</rt></ruby><ruby>放<rt>っぱな</rt></ruby>れ under the character-reading policy, though this does not prove the competing <ruby>下<rt>したっ</rt></ruby><ruby>放<rt>ぱな</rt></ruby>れ wrong.
