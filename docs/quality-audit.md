# Quality audit

## Accepted corpus comparison

Under the reviewed source judgments, the accepted local v28r1 build has **at least 368 fewer total boundary errors** than the frozen Lorenzi generator on the jointly valid portion of the complete pinned corpus. This is a development result based on independently reviewed source judgments, with every unresolved difference scored against the candidate. It is not per-word dominance, a blind accuracy estimate, or a claim about future dictionaries.

Both generators received all 324,992 permitted spelling/reading pairs from jmdict-simplified `3.6.2+20261005200550`. The reference is a frozen same-input run of upstream commit `dda498d0fd7531c9ebdb97740589e00749696789`, rather than the incomplete historical export. Canonical comparison normalizes kana script and exposes literal-kana boundaries for both systems.

| Candidate relation to reference | Pairs |
| --- | ---: |
| Same boundaries | 321,029 |
| Finer | 1,309 |
| Coarser | 721 |
| Conflicting | 311 |
| Reference fails the output contract | 1,622 |
| Total | 324,992 |

All candidate records reconstruct their written form and reading with nonempty segments. Reference failures comprise 1,204 reading reconstructions, 417 empty-base representations, and one written-form reconstruction. Of these, 1,070 omit only middle dots: they are formatting differences, not linguistic wins. None of the 1,622 failures contributes to the boundary-loss bound; the remaining 552 also receive no linguistic boundary judgment.

For each of the 323,370 jointly valid pairs, let `C` and `R` be the candidate and reference boundary sets, and `T` a compatible target under the finest-supported-alignment policy. The target includes every positively supported cut compatible with the other supported cuts; competing supported allocations remain unresolved for this comparison. Boundary loss counts missing and incorrect boundaries equally: `|C △ T|`. The measured difference is the sum of `|R △ T| − |C △ T|`. Common boundaries and boundaries omitted by both cancel; absolute correctness of the agreeing outputs is unnecessary for this relative calculation.

A supported candidate-only boundary or a demonstrably wrong reference-only boundary contributes +1. Every other differential boundary contributes −1 to the lower bound, including unresolved ownership and competing licensed alternatives. A positive label is retained only when the reviewed row geometry still matches exactly. Merely supporting the candidate does not prove the competing reference boundary wrong.

| Differential boundary judgment | Boundaries | Conservative contribution |
| --- | ---: | ---: |
| Supported candidate-only boundaries | 1,770 | +1,770 |
| Wrong reference-only boundaries | 92 | +92 |
| Unresolved differences, all charged against the candidate | 1,494 | −1,494 |
| Lower bound | 3,356 | **+368** |

The 3,356 differing points consist of 2,107 candidate-only and 1,249 reference-only boundaries. Reviewed labels include 1,474 supported cuts from the complete historical finer-output census and 388 favorable judgments from the conflict review. New or changed geometries without a transferable judgment remain unresolved for scoring, including five formerly supported cuts whose complete row changed. All 34 differential points associated with competing licensed alternatives remain charged against the candidate.

These selected examples illustrate the reviewed differences; they are not an accuracy sample. All were checked against the accepted full build.

| Word | Accepted output | Reference output | Supporting evidence |
| --- | --- | --- | --- |
| 蕎麦 | 蕎[そ]麦[ば] | 蕎麦[そば] | [Explicit component allocation in the pinned 晦蕎麦 source](https://en.wiktionary.org/w/index.php?oldid=92161504). |
| 海老 | 海[え]老[び] | 海老[えび] | Both exact sounds are listed as nanori in pinned [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project). |
| 尻尾 | 尻[しっ]尾[ぽ] | 尻尾[しっぽ] | [The pinned word table](https://en.wiktionary.org/w/index.php?oldid=92237397) explicitly allocates the contraction. |
| 命の綱 | 命[いのち]の綱[つな] | 命[い]の綱[ちのつな] | Complete 命いのち and 綱つな readings in pinned KANJIDIC2 locate the literal particle. |
| メーカ希望価格 | メー / カ[カー] / 希[き]望[ぼう]価[か]格[かく] | メーカ / 希望価格[ーきぼうかかく] | [Pinned JMdict spelling variants](https://github.com/scriptin/jmdict-simplified/releases/tag/3.6.2%2B20261005200550) keep the extra vowel in メーカ. |

The first three recover supported detail without making the grouped reference pronunciation wrong. The last two correct sound ownership. Competing allocations remain possible elsewhere: 河[かわ]原[ら] and 河[か]原[わら] both have listed character support, so that difference remains unresolved in the bound.

The bound is conditional on the linguistic judgments and the declared equal-cost boundary metric. Two AI reviewers are not two independent dictionary sources or human lexicographer certification. The conservative treatment of unknowns handles missing judgments; it cannot correct a mistaken positive source judgment. It also does not imply that each of the 721 coarser or 311 conflicting words is resolved.

The complete build matches the reviewed projection across all 324,992 records. It changes 580 records relative to v27r1: 889 explicit cuts added, three removed, and four status changes: three exact corrections and the newly supported owl name. All 404 tests, 113 full-generator regression fixtures, and 38 annotations pass, as do pair coverage, reconstruction, provenance, compression, checksums, and local release preparation. The regression suite is not an accuracy sample.

| Frozen artifact | SHA-256 |
| --- | --- |
| Accepted JSON | `cb83dc24e963f1aec0e45396aa0980942f0eff3104eed27e730e81006a6c633f` |
| Generator | `737156b0aa070ab3de51b71d3925393bbfc7b2797f969253c0d9dfea2101d0c8` |
| Same-input reference | `a5a796b3c628e28ab7ea674ae3839e271a1f6ca2d222f39ddbddb5514a4c605b` |
| Full-build comparison report | `46b2d1aec0e3510dbcd68426731aa2aa4cbcdb5dd2d6ec84bcddc69d6b1d41fc` |

Local artifacts are retained in `.cache/experiments/parity-integrated-v28r1/` and `.cache/experiments/parity-bound-v28/`. The latter contains the scorer, per-boundary contributions, source and geometry bindings, and independent recounts; it is a research artifact, not a generator dependency. Recompute the frozen comparison locally with:

```sh
node .cache/experiments/parity-bound-v28/score.mjs dist/precise-furigana.json .cache/experiments/parity-bound-v28/local-recount.json "accepted local build"
```

## Historical audits

The remaining sections describe earlier frozen checkpoints. Their original artifacts and scores remain unchanged. These panels were retired as holdouts during parity-first development on 2026-10-09; reviewed source evidence may inform development, but their historical scores do not estimate current accuracy. The [paired probability protocol](paired-evaluation-protocol.md) remains available for a future independent accuracy study. The complete-population conditional bound above answers a narrower finite-corpus comparison question.

## Historical frozen independent evaluation

The improved generator has fewer unsupported boundaries than Lorenzi's reference in the frozen diagnostic panel, while Lorenzi still provides more of the supported boundaries. This is a precision/coverage tradeoff, not demonstrated corpus-wide superiority. The [full aggregate results](evaluation-results.md) and [evaluation protocol](evaluation-protocol.md) record the method; individual cases were quarantined during that evaluation.

All 427 first-pass labels and 140 independent second-review labels were completed before candidate outputs were shown. After source-based reconciliation, two prior-exposure exclusions and 21 unresolved cases leave 404 scored spelling–reading span families across 396 JMdict entries. The panel was annotated by AI assistants, not human Japanese lexicographers.

| System | Exact accepted alignment | Coarser | Contains unsupported boundaries | Unsupported boundaries | Missed boundaries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Improved generator | 262 | 138 | 4 | 4 | 229 |
| Initial generator | 117 | 283 | 4 | 4 | 482 |
| Lorenzi reference | 326 | 11 | 67 | 72 | 87 |

Against the initial generator, the improvement wins on 151 families, ties on 253, and loses on none. Against Lorenzi, it wins on 66, loses on 125, ties on 209, and has four tradeoffs. A win requires no additional unsupported or missed boundary and a strict improvement in at least one count. “Unsupported” means absent from the accepted annotation, not independently proven linguistic error.

On the 281 eligible high-confidence cases, the improved generator has 213 exact, 68 coarser, and zero unsupported results, with 128 missed boundaries. Lorenzi has 217 exact, eight coarser, and 56 results containing 61 unsupported boundaries, with 78 missed boundaries. High-confidence family wins are 57 versus 56, with 164 ties and four tradeoffs; entry-level wins are 54 versus 54. All 60 exact-agreement controls match the accepted labels for both systems.

The selected strata were 300 initially coarser families, 60 incompatible families, seven initially finer families, and 60 agreement controls. This intentionally overrepresents rare incompatible boundaries relative to the much larger coarser population. Raw win counts and proportions therefore cannot establish corpus-wide accuracy. Remaining coverage requires further independently supported readings and kana correspondences; a fresh blind accuracy estimate would need a new independent holdout.

The frozen candidate SHA-256 is `ff46c27a11ad425aa9524e8208419bbecd93d1f12e4ce75fbc21115889d4f7be`; the initial candidate is `8472c2616b1fd67a8914ca6b1c5653af548d048066485db8ca35347b7b5008ff`; the reference is `1bb73eb2425f3813efed40ce67f0da65a6359c6fcb163d9304b9b3910f548b37`; and the reconciled labels are `8a2bc9c8cfa3bc508273be2d69de1383f5c6a3a6cff4859c07d35b09752a9530`. Run `node scripts/evaluate-holdout.mjs .cache/experiments/superiority-frozen-v3/precise-furigana.json` to reproduce the private diagnostic outputs.

## Historical initial audit

This is a diagnostic audit of the initial generated database, not an accuracy estimate or a claim that the project surpasses its reference. The baseline JSON SHA-256 is `cce82a1a7aab54c94462774e1c00f11128645a0a43bd62110ffc54305599b43d`. It contains 324,992 pairs from the `3.6.2+20261005200550` source release. Subsequent improvements can change every count below; use `npm run compare:reference` for the current build.

The comparator joins actual JMdict IDs and normalizes kana script for matching. It treats boundaries within literal kana as freely available, accounts for the reference's empty-base sokuon representation, and flags other empty-base insertions as ambiguous. Recent JMdict IDs can exceed 5,000,000, so an ID threshold cannot separate JMdict from JMnedict.

| Baseline relationship to the reference | Pairs |
| --- | ---: |
| Same boundaries | 215,415 |
| More boundaries | 46 |
| Fewer boundaries | 22,748 |
| Incompatible boundaries | 48 |
| Ambiguous reference representation | 373 |
| Pair absent from the reference | 86,362 |

The reference deliberately omits whole-word results, so the absent category includes expected omissions. Neither agreement nor disagreement establishes correctness.

## Method and findings

I reviewed 40 incompatible pairs, 15 coarser pairs, and 15 finer pairs, selected deterministically by hashing the ID, spelling, and reading within each category. The sample is deliberately stratified by disagreement and is not representative of the whole dictionary. Repeated words and spelling variants remain in the sample. Judgments are provisional linguistic review, supported by the pinned JMdict/KANJIDIC2 input and selected primary dictionary checks; they are not independently double-annotated gold labels.

The 70 reviewed pairs yielded 42 plausible improvements, 12 clear losses of precision, and 16 unresolved or mixed cases. These numbers describe only this selected baseline sample and must not be extrapolated into an accuracy percentage.

The most consequential weakness is grouping a known word together with literal kana: obvious boundaries disappear in 当り, 証し, 如何に, 遣す, and similar spellings. A second weakness is incomplete compound reading evidence: 花相撲 can preserve 花 and the voiced unit 相撲, while 植木鉢 can separate 植 and 木. Conversely, the generator repeatedly avoids the reference's unsupported transfer of one or more morae across an otherwise clear boundary, as in 赤海老, 前肢, 罪科, and 鬼婆.

## Incompatible sample

“Better” means the generated boundary is plausibly better than the conflicting reference boundary; it does not certify every segment of the word. JMdict alternate spellings provide particularly useful independent evidence for 鬼婆, 前肢, 袈裟懸, 手長海老, 笠懸, 笑翡翠, 弓懸, 赤寿司, 水澄まし, 御願い致します, and 魚子織.

| Spelling / reading | Judgment | Main reason |
| --- | --- | --- |
| 糞婆 / くそばばあ | Better | Keeps the boundary after くそ. |
| 北国赤海老 / ほっこくあかえび | Better | Preserves 赤 / あか and 海老 / えび. |
| 足萎え / あしなえ | Better | Preserves 足 / あし. |
| 鬼婆 / おにばばあ | Better | Matches the alternate spelling 鬼ばばあ. |
| 此処彼処 / ここかしこ | Better | Preserves the constituent words 此処 and 彼処. |
| 神南備 / かみなび | Better | Preserves 神 / かみ; compare 神奈備. |
| 袈裟懸 / けさがけ | Better | Preserves 袈裟 and the nominalized 懸. |
| 前肢 / まえあし | Better | Matches the same-entry forms 前足 and 前脚. |
| 天地 / あめつち | Better | Preserves 天 / あめ and 地 / つち. |
| 転た寝 / うたたね | Better, incomplete | Preserves 寝 / ね; the preceding literal た can still be exposed. |
| 手長海老 / てながえび | Better | Matches 手長エビ and preserves 海老. |
| 何に依らず / なにによらず | Better | Preserves 何 / なに and the following particle. |
| 大蟇 / おおひきがえる | Better | Preserves 大 / おお and the name of the animal. |
| 幸い茸 / さいわいたけ | Better | Keeps the written い aligned and 茸 / たけ intact. |
| 小海雀 / こうみすずめ | Better | Keeps 小 / こ and 海 / うみ separate. |
| 笠懸 / かさがけ | Better | Matches the alternate spelling 笠懸け. |
| 真赤 / まあか | Better | Preserves 赤 / あか after 真 / ま. |
| 笑翡翠 / わらいかわせみ | Better | Matches 笑い翡翠 and preserves 翡翠. |
| 弓懸 / ゆがけ | Better | Matches the alternate spelling 弓懸け. |
| 寒イボ / さぶいぼ | Better | Preserves the literal イボ. |
| 真穴蠔 / まあなごう | Uncertain | Plausible component readings, but this rare name needs specialist confirmation. |
| 罪科 / つみとが | Better | Preserves 罪 / つみ and 科 / とが. |
| 大石天狗堂 / おおいしてんぐどう | Better | Preserves 大 / おお and 石 / いし. |
| 宮古蟇 / みやこひきがえる | Better | Preserves the locality 宮古 and the animal name. |
| 赤寿司 / あかずし | Better | Matches same-entry 赤ずし. |
| 泥砂 / でいさ | Better | Preserves 泥 / でい and 砂 / さ. |
| 真穴子 / まあなご | Better | Preserves 真 / ま and 穴 / あな. |
| 小内刈り / こうちがり | Better | Preserves 小 / こ and 内 / うち. |
| 墨は餓鬼に磨らせ、筆は鬼に持たせよ / すみはがきにすらせ、ふではおににもたせよ | Better | Keeps the second 鬼 / おに separate from its particle and 持. |
| 赤海老 / あかえび | Better | Preserves 赤 / あか and 海老 / えび. |
| 水澄まし / みずすまし | Better | Matches same-entry 水すまし. |
| 糞婆 / クソばばあ | Better | Same boundary as the hiragana reading. |
| 人寄せ席 / ひとよせせき | Better | Preserves 寄 / よ, literal せ, and 席 / せき. |
| 亜細亜地潜り蛙 / アジアじむぐりがえる | Mixed | Improves the boundary after 亜細亜 but absorbs the written り into 地潜り. |
| 御願い致します / おねがいいたします | Better | Matches the same-entry partially kana spellings. |
| クソ婆 / クソばばあ | Better | Preserves クソ as a literal prefix. |
| クソ婆 / くそばばあ | Better | Same boundary despite kana-script difference. |
| 小馬座 / こうまざ | Better | Preserves 小 / こ and 馬 / うま. |
| 糞婆 / くそババア | Better | Same boundary as the hiragana reading. |
| 魚子織 / ななこおり | Better | Preserves 魚子 / ななこ and nominalized 織 / おり. |

The 神南備 judgment also agrees with the component discussion in the Japanese dictionaries published on [Kotobank's 神奈備 entry](https://kotobank.jp/word/%E7%A5%9E%E5%A5%88%E5%82%99-466553).

## Coarser sample

| Spelling / reading | Judgment | Main reason |
| --- | --- | --- |
| 可愛気 / かわいげ | Uncertain | Grouping 可愛 may avoid invented character readings; the preferred precision policy needs review. |
| 門前清 / メンゼンチン | Less precise | At least 門前 and 清 can be distinguished; borrowed readings need additional evidence. |
| 掻い掻い / かゆいかゆい | Less precise | Both written い characters can be anchored. |
| 一人暮し / ひとりぐらし | Less precise | Final literal し was absorbed into 暮し. |
| 壱越調 / いちこつちょう | Uncertain | Grouped 壱越 has lexicographic support; do not invent a general 越 / こつ rule from one word. |
| 植木鉢 / うえきばち | Less precise | The component 植 / うえ can be supported by licensed reading evidence. |
| 成吉思汗料理 / ジンギスカンりょうり | Uncertain | Foreign-name transcription needs explicit evidence before splitting every character. |
| 小龍包 / ショーロンポー | Less precise | The borrowed pronunciation still has identifiable character units. |
| 遅かりし由良之助 / おそかりしゆらのすけ | Less precise | Grouping the entire phrase hides the literal kana and obvious name boundaries. |
| 剣吞 / けんのん | Less precise | The boundary after 剣 / けん is credible, although 吞 / のん needs lexical evidence. |
| 体によい / からだにいい | Less precise | The known 体 reading and literal に survive the later よ / い mismatch. |
| 花相撲 / はなずもう | Less precise | Preserve 花 and the voiced compound unit 相撲. |
| 遣す / よこす | Less precise | Preserve the literal final す. |
| 積重ねる / つみかさねる | Less precise | Same-entry 積み重ねる and つみ重ねる support finer boundaries. |
| たん白源 / たんぱくげん | Less precise | Preserve initial literal たん and split 白 / ぱく from 源 / げん. |

[Kanjipedia explicitly groups 壱越 within 壱越調](https://www.kanjipedia.jp/kotoba/0000246900). The Japan Professional Mahjong League attests [門前 / メンゼン](https://www.ma-jan.or.jp/class_1/1552.html) and [門前清自摸和 / メンゼンチンツモホー](https://www.ma-jan.or.jp/activity/yaku.html); these support component investigation without treating an arbitrary Chinese-to-kana conversion as authoritative.

## Finer sample

| Spelling / reading | Judgment | Main reason |
| --- | --- | --- |
| ＧＮＵ一般公衆ライセンス / グヌーいっぱんこうしゅうライセンス | Better | Separates the acronym from ordinary kanji readings. |
| 薔薇油 / ばらゆ | Uncertain | See the conflicting 薔薇 evidence below. |
| 薔薇笛鯛 / ばらふえだい | Uncertain | Same 薔薇 policy question. |
| 薔薇窓 / ばらまど | Uncertain | Same 薔薇 policy question. |
| 薔薇鱮 / ばらたなご | Uncertain | Same 薔薇 policy question. |
| 木香薔薇 / もっこうばら | Uncertain | Same 薔薇 policy question. |
| 薔薇のつぼみ / ばらのつぼみ | Uncertain | Same 薔薇 policy question. |
| 薔薇輝石 / ばらきせき | Uncertain | Same 薔薇 policy question. |
| 旋毛曲がり / つむじまがり | Better | Preserves 旋毛 as a unit and separates 曲. |
| 公魚釣り / わかさぎづり | Better | Preserves 公魚 as a unit and separates 釣. |
| 薔薇薔薇 / バラバラ | Uncertain | Same 薔薇 policy question, repeated. |
| 薔薇族 / ばらぞく | Uncertain | Same 薔薇 policy question. |
| 案山子祭り / かかしまつり | Better | Preserves 案山子 as a unit and separates 祭. |
| 薔薇鰱 / ばらたなご | Uncertain | Same 薔薇 policy question. |
| 野薔薇 / のばら | Uncertain | Same 薔薇 policy question. |

KANJIDIC2 explicitly lists バ for 薔 and ラ for 薇, so the generated split follows the supplied character data. However, [Kanjipedia's 薔 entry](https://www.kanjipedia.jp/kanji/0003458400) does not list バ, and its [薔薇 entry](https://www.kanjipedia.jp/kotoba/0003458700) uses the grouping notation that its [editorial explanation](https://www.kanjipedia.jp/include/popup_kotoba.html) assigns to jukujikun and ateji. This is a conflict between lexical sources and precision conventions, not evidence that agreement with either corpus alone proves correctness. No bulk exception was imported to resolve it.

## Historical evaluation priorities

- Audit changes across the entire corpus whenever adding alternate-spelling inference or phonological rules; a handful of attractive improvements cannot reveal harmful generalization.
- Keep tests for the credible improvements above, so increasing coverage does not reintroduce unsupported residual assignments.
- Expand an independently reviewed test set, including ambiguous names, borrowed readings, and words where component readings are absent or misleading.
- Document which sources justify a boundary and distinguish a model-supported result from a linguistically reviewed one.

## Historical initial build and remaining limitations

The final generated JSON has SHA-256 `8472c2616b1fd67a8914ca6b1c5653af548d048066485db8ca35347b7b5008ff`. It retains all 324,992 source pairs across 218,863 entries. Subsequent corpus-wide experiments and adversarial review are documented in [the experiment report](experiments.md), including rejected heuristics and the exact final settings and hashes.

The final optional reference comparison reports 227,492 exact, 48 finer, 10,585 coarser, 132 incompatible, 373 uncomparable, and 86,362 absent pairs. These are boundary relationships, not accuracy labels. In one rejected intermediate build, fixing six false boundaries actually reduced reference agreement, illustrating why agreement cannot serve as the objective.

The user-reported cases are handled in the final corpus: 日本 / にほん splits 日 / に and 本 / ほん; 一突き splits 一 / ひと and 突 / つ; irregular 一向, 抽斗, and 欠片 stay grouped. ヤブ蚊 and ママ子 retain literal kana with inserted っ on the following kanji, while 藪蚊 and 薮蚊 put っ on the preceding kanji. メンド臭い retains ド / どう.

Useful precision remains missing. Some valid hiragana long-vowel variants, such as めんど臭い / めんどうくさい, are conservatively grouped to avoid transferring a vowel onto an adjacent kanji. Mixed kana/kanji residuals such as チョウチョウ結び / ちょうちょむすび remain imperfectly localized. Unusual names and readings with omitted particles can require larger groups; 薔薇 still exposes a conflict between lexical sources and grouping conventions. The 10,585 coarser reference relationships deserve further review, but some are preferable conservative decisions rather than losses.

The regression suite and reconstruction checks verify known behaviors and structural integrity. They do not substitute for a larger, independently annotated evaluation set. This is a reproducible, independently implemented first database with demonstrated improvements on specific cases, not a demonstrated claim of universally better alignment.
