# Linguistic evidence for candidate readings

Research snapshot: 2026-10-09. These findings concern development examples and published linguistic evidence. They do not use the sealed evaluation cases. Sources cited here inform independently written rules; no source's alignment table or implementation is imported.

## Nasal loss in Sino-Japanese readings

The development examples support lexical correspondences, but they do not establish that any on-reading ending in ん can lose that mora freely.

| Attested form | Evidence and limit |
| --- | --- |
| 饂飩 / うどん | Shogakukan records a change from うんどん. This supports 饂 / う in this lexical family. [Dictionary entry](https://kotobank.jp/word/%E9%A5%82%E9%A3%A9-441039). |
| 暖簾 / のれん | Shogakukan connects the form with のんれん or のうれん; 暖 has the 唐宋音 ノン. This is a historical lexical relation. [Dictionary entry](https://kotobank.jp/word/%E6%9A%96%E7%B0%BE-22945). |
| 本意 / ほい | Shogakukan specifically discusses historical omission of the nasal in writing. The written reading alone should not be described as proof of a universal phonological deletion process. [Dictionary entry](https://kotobank.jp/word/%E6%9C%AC%E6%84%8F-626773). |
| 昆布 / こぶ and こんぶ | Shogakukan cites medieval evidence for both forms and discusses competing etymologies. The entry supports coexistence, without establishing that one form must derive from the other. [Dictionary entry](https://kotobank.jp/word/%E6%98%86%E5%B8%83-503957). |

A possible implementation inference is to treat nasal loss as a weak candidate inside an independently attested spelling–reading pair, preserve stronger established boundaries, and audit every changed family. These citations do not justify adding shortened readings to an unrestricted global character dictionary.

## Native compound-vowel alternation

Research distinguishes a lexically restricted alternating stem from an arbitrary similar pronunciation. Salingre describes fixed alternants of a limited set of words: known alternating stems can occur in novel compounds, but new lexemes do not freely acquire this behavior. Compound position and structure also matter. The principal patterns are e/a, i/o, and i/u. [Salingre, 2022, section 3.1](https://www.ls-japan.org/modules/documents/LSJpapers/meeting/163/handouts/p/P-1_163.pdf).

Irwin and Labrune's experiment likewise starts from a closed set of native nouns, while finding that speakers can use their existing alternants in new compounds. Thus productivity of compounding does not imply that every kun reading may undergo a final-vowel substitution. [Irwin and Labrune, 2020, printed pages 41–52](https://www-hs.yamagata-u.ac.jp/wp-content/uploads/2020/09/d6eb4809647bb0f14150c2b93be9ceb2.pdf).

The pinned KANJIDIC already explicitly supplies common relevant readings, including 酒 さけ/さか-, 目 め/ま-, 雨 あめ/あま-, 船 ふね/ふな-, 木 き/こ-, and 白 しろ/しら-. Preserving those marked compound forms is stronger evidence than deriving arbitrary final-vowel changes. 白 should not automatically be analyzed as an instance of the three nominal alternation patterns merely because it also has two forms.

The implementation implication is lexical: accept independently recorded allomorphs in attested compounds, retain their provenance, and avoid a general edit-distance rule for final vowels. Missing marked allomorphs are a source-coverage problem that additional licensed lexical data may solve.

## Chinese loan readings and ateji

Modern Pinyin is useful evidence for Chinese-origin vocabulary, but it is not a deterministic Japanese reading system. Mandarin distinguishes aspirated and unaspirated consonants; its Pinyin b/d/g are not simply Japanese voiced stops. [Tokyo University of Foreign Studies pronunciation guide](https://www.tufs.ac.jp/common/fs/ilr/archive/chi/chn2.html), [Kansai University pronunciation guide](https://www2.itc.kansai-u.ac.jp/~ymzknk/fayin/fuyin.html).

Japanese lexical sources can retain different adaptations of the same Chinese component. For example, the Japan Professional Mahjong League gives 門前 as メンゼン and uses メンゼンチン in 門前清自摸和, whereas the Japan Mahjong Sports Association gives 門前清 as メンチィェンチン. Both are direct evidence of usage in their respective rule systems. [JPML terminology](https://www.ma-jan.or.jp/class_1/1552.html), [JPML winning hands](https://www.ma-jan.or.jp/activity/yaku.html), [JMSA rules](https://jmsa.jp/www/rule1.html).

JMdict's Chinese language-source metadata and KANJIDIC's Pinyin can therefore support bounded candidate correspondences for an attested loanword. They should not silently replace established native or Sino-Japanese readings of the same spelling. Historical and dialectal borrowing, Japanese adaptation, long vowels, and mixed native/borrowed components all require contextual evidence.
