# Data format

[schema.json](../schema.json) is the authoritative structure, and validation checks the database against it. The database is UTF-8 JSON.

<div lang="ja">

<!-- oxfmt-ignore -->
```json
{
  "version": "1.20261116.0",
  "schemaVersion": 1,
  "jmdictDate": "2026-11-16",
  "entries": {
    "1582710": [
      { "spelling": "日本", "reading": "にほん", "segments": [["日", "に"], ["本", "ほん"]] }
    ]
  }
}
```

</div>

`version` is `<schema version>.<JMdict date>.<revision>`. The major changes only when consumers' code must; the minor is the dictionary date as eight digits; the revision counts releases for that date, starting at 0, and goes up when a generator or data fix is released without a new dictionary. `schemaVersion` and `jmdictDate` restate the first two parts. A local build that is not a release has the revision `0-dev`.

`entries` maps each JMdict ID to its records: one per permitted spelling/reading pair, plus any synthesized pairs. No two records in an entry share both spelling and reading. A spelling/reading pair that appears in several entries has the same segments in each, though its `pairing` can differ. Kana-only words, and kana forms JMdict marks `[nokanji]`, get a record whose spelling is the kana and whose only segment is that kana.

Within an entry, the records for one spelling are in JMdict's reading order, followed by any synthesized record. JMdict lists more common readings first and search-only readings last, so a consumer choosing a reading for a spelling can take the first record, after setting aside `"mispaired"` ones. Order is otherwise unspecified: look records up by ID, spelling, and reading, not by position.

## Segments

A string segment is shown without ruby. A `[base, ruby]` segment shows `ruby` over `base`; both are nonempty.

Invariants, all checked by `npm run validate`:

- Concatenating every segment's text (strings and bases) gives `spelling` exactly.
- Concatenating every segment's sound gives `reading`, comparing kana after folding katakana into hiragana and dropping punctuation. A string's sound is its kana; non-kana strings, such as the dots in <span lang="ja"><ruby>士<rt>し</rt></ruby>・<ruby>農<rt>のう</rt></ruby></span>, are silent.
- Kana the reading repeats is never under ruby, including at the edges of a ruby group: <span lang="ja"><ruby>君<rt>きみ</rt></ruby>の<ruby>名<rt>な</rt></ruby>は。</span>, not <span lang="ja"><ruby>君の<rt>きみの</rt></ruby></span>.
- Kana the reading contradicts is under ruby carrying the reading's kana: <span lang="ja">宣ふ</span> read <span lang="ja">のたまう</span> is <span lang="ja"><ruby>宣<rt>のたま</rt></ruby><ruby>ふ<rt>う</rt></ruby></span>.
- Adjacent strings are merged.
- A punctuation mark that the spelling writes is shown as plain text beside the ruby: <span lang="ja">Ｓ・Ｍ</span> read <span lang="ja">エス・エム</span> is <span lang="ja"><ruby>Ｓ<rt>エス</rt></ruby>・<ruby>Ｍ<rt>エム</rt></ruby></span>. It stays inside a ruby base only when the mark is itself read, as the dot of <span lang="ja">２</span>．<span lang="ja">５</span> is in <span lang="ja">にてんご</span>, or when the group cannot be divided at it, as in <span lang="ja"><ruby>Ｗｉ-Ｆｉ<rt>ワイファイ</rt></ruby></span>. A mark that only the reading has cannot be plain text, since the spelling has no such character, so it stays in the ruby text, and that pair is mispaired: <span lang="ja">ＳＦ</span> read <span lang="ja">エス・エフ</span> is <span lang="ja"><ruby>Ｓ<rt>エス・</rt></ruby><ruby>Ｆ<rt>エフ</rt></ruby></span>. Outside mispaired pairs, ruby text holds no punctuation. Symbols that are read aloud, such as ％ and ＆, are characters, not punctuation: <span lang="ja"><ruby>１００<rt>ひゃく</rt></ruby><ruby>％<rt>パーセント</rt></ruby></span>.
- A positional numeral is divided at each nonzero digit, which carries its place word; the zeros after a digit stay with it: <span lang="ja"><ruby>１<rt>せん</rt></ruby><ruby>９<rt>きゅうひゃく</rt></ruby><ruby>８<rt>はちじゅう</rt></ruby><ruby>２<rt>に</rt></ruby></span>, <span lang="ja"><ruby>８<rt>はちまん</rt></ruby><ruby>４０００<rt>よんせん</rt></ruby></span>, <span lang="ja"><ruby>三〇<rt>さんじゅう</rt></ruby></span>. Digits read one by one are separate: <span lang="ja"><ruby>７<rt>しち</rt></ruby><ruby>５<rt>ご</rt></ruby><ruby>３<rt>さん</rt></ruby></span>.

A multi-character ruby group means the characters' individual sounds are unresolved, or an unwritten particle sits between them (<span lang="ja"><ruby>五<rt>ご</rt></ruby><ruby>重塔<rt>じゅうのとう</rt></ruby></span>). Explicit evidence can give a small kana to its own character, as in <span lang="ja"><ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る</span>.

## Pairing

`pairing` is absent for an ordinary JMdict pair.

- `"mispaired"`: a JMdict pair whose reading contradicts its spelling in a way that helps no reader. Never choose one for a spelling; a record that fits always exists. The kinds:
  - the reading belongs to another spelling in the entry, as in <span lang="ja">気持ちよい</span> read <span lang="ja">きもちいい</span> (<span lang="ja"><ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ち<ruby>よ<rt>い</rt></ruby>い</span>). Most involve a search-only (`sK` or `sk`) form, which JMdict cannot restrict;
  - the reading fits only by giving a kanji a sound that belongs to the kana: <span lang="ja">けも耳</span> read <span lang="ja">けものみみ</span> would need <span lang="ja">耳</span> read <span lang="ja">のみみ</span>, and is segmented <span lang="ja">け<ruby>も<rt>もの</rt></ruby><ruby>耳<rt>みみ</rt></ruby></span>;
  - a search-only spelling omits a particle that the reading keeps, as in <span lang="ja">そっぽ向く</span> read <span lang="ja">そっぽをむく</span>;
  - the reading has punctuation the spelling does not write: <span lang="ja">ＳＦ</span> read <span lang="ja">エス・エフ</span> is <span lang="ja"><ruby>Ｓ<rt>エス・</rt></ruby><ruby>Ｆ<rt>エフ</rt></ruby></span>, and the reading to use is <span lang="ja">エスエフ</span>;
  - the reading only spells the same sound another way, as in <span lang="ja">税金ドロボー</span> read <span lang="ja">ぜいきんどろぼう</span>, where <span lang="ja">う</span> over <span lang="ja">ー</span> tells a reader nothing.
- `"phonetic"`: a JMdict pair whose reading gives the sound of kana that the spelling writes another way: historical kana, as in <span lang="ja">宣ふ</span> read <span lang="ja">のたまう</span> (<span lang="ja"><ruby>宣<rt>のたま</rt></ruby><ruby>ふ<rt>う</rt></ruby></span>); the particle <span lang="ja">は</span>, as in <span lang="ja">今日は</span> read <span lang="ja">こんにちわ</span>; or full-size kana for small ones, as in <span lang="ja">坊つちやん</span> read <span lang="ja">ぼっちゃん</span>. The ruby over those kana is a real pronunciation aid. Use the record to annotate pronunciation; to annotate only kanji, use the spelling's other record, which leaves the kana alone. The kana that count are <span lang="ja">ふ</span>, <span lang="ja">ひ</span>, <span lang="ja">へ</span>, <span lang="ja">ほ</span>, <span lang="ja">は</span>, <span lang="ja">ゐ</span> and <span lang="ja">ゑ</span> read <span lang="ja">う</span>, <span lang="ja">い</span>, <span lang="ja">え</span>, <span lang="ja">お</span>, <span lang="ja">わ</span>, <span lang="ja">い</span> and <span lang="ja">え</span>, <span lang="ja">つ</span>, <span lang="ja">や</span>, <span lang="ja">ゆ</span> and <span lang="ja">よ</span> read small, and an <span lang="ja">い</span>-row kana before <span lang="ja">う</span> read with <span lang="ja">ゅ</span>, as in <span lang="ja">同じうする</span> read <span lang="ja">おなじゅうする</span>. A pair is not phonetic when JMdict also gives the spelling its face-value reading, other than as a search-only one: <span lang="ja">しようが無い</span> read <span lang="ja">しょうがない</span> is mispaired, because <span lang="ja">しようがない</span> is how that spelling is said.
- `"synthesized"`: not a JMdict pair. Every spelling has at least one record whose reading fits its kana; where JMdict has none, the spelling's own reading is added from [data/synthesized-pairs.json](../data/synthesized-pairs.json), as in <span lang="ja">気持ちよい</span> read <span lang="ja">きもちよい</span> (<span lang="ja"><ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちよい</span>).

## Releases

A release publishes two files. `precise-furigana.zip` holds `precise-furigana.json` with `schema.json`, `NOTICE.md` and `LICENSE.md`. `precise-furigana.json.zst` is the database alone, compressed with Zstandard, for programs that fetch it. Both hold the same bytes. Its tag is `v` followed by the database's `version`. Its notes name the jmdict-simplified release used, give the database's statistics, and from the second release on say what changed since the release before: entries and records added and removed, and existing records that are divided differently. Its tag points at the source commit, whose schema and [NOTICE.md](../NOTICE.md) apply. Builds are deterministic for the same inputs and Node.js version; compressed bytes can differ across zlib versions, so compare records, not files, across Node.js upgrades.

`npm run inspect -- <spelling> <reading> --explain` shows how any record was derived; derivations are not part of the release.
