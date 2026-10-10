# Reference research and behavioral requirements

Research snapshot: 2026-10-09. This document describes observed behavior and independently stated requirements. Upstream source files and generated data were inspected only for research; they are excluded from the implementation and release inputs. No upstream exception list was imported.

## Findings

Lorenzi's implementation combines kana anchors, a reading dictionary covering characters and compounds, phonological variants, and explicit corrections. It can preserve compound units while splitting surrounding characters. Its allowance for unmatched residual reading also creates false precision: a plausible reading for one character can leave an implausible reading assigned to its neighbor. An independent implementation should require evidence for boundaries and retain unresolved spans when that evidence is insufficient. [Generator source](https://github.com/hlorenzi/jisho-open/blob/main/common/src/furigana.ts), [import pipeline](https://github.com/hlorenzi/jisho-open/blob/main/backend/src/importing/jmdict.ts).

The exported reference is a partial index, not a complete list of dictionary pairs. It omits results containing only one segment, including legitimate whole-word readings. It also includes JMnedict names. Absence from this file cannot establish a generation failure. [Export source](https://github.com/hlorenzi/jisho-open/blob/main/backend/src/importing/furigana_output.ts).

The retrieved [furigana.txt](https://jisho.hlorenzi.com/furigana.txt) snapshot identifies its generation time as `2026-10-03T21:17:09.672Z`. It has 33,608,985 bytes and 871,010 data records. Of these, 232,040 have IDs below 5,000,000; this numeric partition is only a rough JMdict filter, not a substitute for joining actual JMdict IDs. There are 5,819 empty base segments across the entire reference, and no mismatched base/reading segment counts. These measurements describe the downloaded snapshot and are not accuracy estimates.

## Regression requirements from reported defects

Here `字[かな]` means that the reading belongs to that exact base span; unmarked kana should remain unannotated. Exact original spelling and reading must still be recoverable from the data representation.

| Spelling / reading | Intended alignment | Reason |
| --- | --- | --- |
| 日本 / にほん | 日[に]本[ほん] | Character name readings can support a useful boundary. |
| 日本 / にっぽん | 日[にっ]本[ぽん] | Gemination and semi-voicing must work together. |
| 一突き / ひとつき | 一[ひと]突[つ]き | The alternate spelling ひと突き confirms the boundary. |
| 一向 / ひたすら | 一向[ひたすら] | Pair-specific irregular reading. |
| 一向 / ひたぶる | 一向[ひたぶる] | Pair-specific irregular reading. |
| 抽斗 / ひきだし | 抽斗[ひきだし] | Do not invent ひきだ for 抽 and し for 斗. |
| 欠片 / かけら | 欠[かけ]片[ら] | Independently reviewed word-local evidence supports both components. |
| ひと欠片 / ひとかけら | ひと + 欠[かけ]片[ら] | Preserve the supported word-local components in a larger expression. |
| 一欠片 / ひとかけら | 一[ひと]欠[かけ]片[ら] | Preserve the supported word-local components in a larger expression. |
| ヤブ蚊 / やぶっか | ヤブ + 蚊[っか] | Preserve literal kana before inserted sokuon. |
| ママ子 / ままっこ | ママ + 子[っこ] | Preserve literal kana before inserted sokuon. |
| 作家 / さっか | 作[さっ]家[か] | Ordinary all-kanji sokuon placement stays on the first character. |

The 日本 requirement reflects the user's stated precision goal; the competing project explicitly favors an indivisible reading. [Doublevil issue #25](https://github.com/Doublevil/JmdictFurigana/issues/25).

The 一突き, 一向, 抽斗, and 欠片 cases are documented in [Lorenzi PR #8](https://github.com/hlorenzi/jisho-open/pull/8). Reading-level `gikun` metadata cannot always express the distinction: 頓 shares the readings of 一向, and 欠けら shares the reading of 欠片. A reading tag must not override pair-specific evidence indiscriminately.

The initial research retained 欠片 as a group. Subsequent review found a local かけ／ら division in [Nikkoku](https://kotobank.jp/word/欠片-2021384), an individual nonstandard-reading marker on 片 in [Progressive](https://kotobank.jp/jeword/欠片), and the attested 欠けら counterpart. The current requirements above incorporate that evidence without inventing a reusable 片[ら] reading. Phonetic ateji is eligible for precise splitting whenever its components have support.

The literal-kana cases come from [PR #6](https://github.com/hlorenzi/jisho-open/pull/6), which was closed in favor of exceptions. The downloaded reference represents inserted sokuon with empty base segments, such as `ヤブ..蚊;ヤブ.っ.か`. That representation is an observation, not a requirement for this project. The same report identifies メンド臭い / めんどうくさい as a genuine kana-reading mismatch: ド corresponds to どう, so script normalization alone must not erase it.

## Coverage requirements

- Respect each reading's spelling restrictions and the distinction between kana-only readings and readings associated with kanji spellings.
- Include search-only spellings. These occur in real text; previous omissions included 石鹼, 蠟燭, 囊胞, 冒瀆的, and 繫がる. Search-only spellings may also be especially difficult to align. [PR #5](https://github.com/hlorenzi/jisho-open/pull/5).
- Retain single-segment outcomes explicitly. They can represent valid indivisible readings as well as unresolved alignment.
- Preserve original Unicode strings. Kana script equivalence is useful for matching, but it must not destroy the original reading or spelling.
- Distinguish unsupported boundaries from supported boundaries. A high percentage of split records does not demonstrate accuracy.
- Treat reference disagreement as a review queue, not as an automatic failure. The reference has known defects, missing records, and older dictionary content.

Additional independently proposed adversarial families include repeated kana anchors; 々 with voiced readings; kun readings containing okurigana markers; mixed kana scripts; punctuation and Latin letters; small kana that must stay with the preceding mora; supplementary-plane kanji; and compounds containing an irregular unit. Examples to verify include 黄色い声 / きいろいこえ, 召し上がる / めしあがる, 手紙 / てがみ, 学校 / がっこう, 時々 / ときどき, 紅葉 / もみじ versus / こうよう, and 大人買い / おとながい. These are proposed challenges, not an imported answer set.

## Representation and reproducibility

Lorenzi's format uses one line per ID–spelling–reading record, semicolons between fields, and periods between aligned segments. Literal periods and semicolons are changed to full-width characters, so the encoding is not an exact round trip for arbitrary input. It has no explicit schema version, alignment evidence, or source-dictionary version. [Encoding source](https://github.com/hlorenzi/jisho-open/blob/main/common/src/furigana.ts).

JSON is a better initial interchange format: preserve JMdict IDs and exact strings, make segmentation boundaries explicit, version the schema, and record source versions and checksums. Gzip supplies compact distribution without inventing delimiter escaping. Confidence or evidence metadata should distinguish unresolved records from ordinary whole-word ruby; metadata is useful only if its meaning is documented and tested.

The release schedule should depend on the dictionary release, and identify that exact input. The upstream JSON conversion project schedules releases on Mondays. [jmdict-simplified README](https://github.com/scriptin/jmdict-simplified#readme).

## Licensing and maintenance observations

Lorenzi's README says the repository has no selected code license and limits use to personal reference. [README license section](https://github.com/hlorenzi/jisho-open#license). Its generated-data license request remains unanswered in [issue #10](https://github.com/hlorenzi/jisho-open/issues/10). The implementation and release inputs here should therefore come from independently written code and clearly licensed dictionary sources; the reference remains an optional local research comparator.

EDRDG identifies JMdict and KANJIDIC-derived dictionary data as covered by CC BY-SA 4.0 and describes attribution requirements. The generated database should carry that data license and attribution independently of the original code's license. [EDRDG license statement](https://www.edrdg.org/edrdg/licence.html), [jmdict-simplified licensing](https://github.com/scriptin/jmdict-simplified#license).

The maintenance issue is more specific than an absent schedule: the maintainer reports an existing three-day regeneration job, but server crashes can interrupt a database refresh that takes up to seven hours. An isolated, reproducible batch generator avoids coupling dictionary releases to an application server. [Issue #7](https://github.com/hlorenzi/jisho-open/issues/7).
