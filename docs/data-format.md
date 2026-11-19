# Data format

[schema.json](../schema.json) is the authoritative structure. The database is UTF-8 JSON; the `.gz` file holds the same bytes.

<!-- oxfmt-ignore -->
```json
{
  "version": "1.20261116.0",
  "schemaVersion": 1,
  "jmdictDate": "2026-11-16",
  "license": "CC-BY-SA-4.0",
  "attribution": "Based on JMdict and KANJIDIC2, copyright EDRDG, …",
  "entries": {
    "1582710": [
      { "spelling": "日本", "reading": "にほん", "segments": [["日", "に"], ["本", "ほん"]] }
    ]
  }
}
```

`version` is `<schema version>.<JMdict date>.<revision>`. The major changes only when consumers' code must; the minor is the dictionary date as eight digits; the revision counts releases for that date, starting at 0, and goes up when a generator or data fix is released without a new dictionary. `schemaVersion` and `jmdictDate` restate the first two parts. A local build that is not a release has the revision `0-dev`.

`entries` maps each JMdict ID to its records: one per permitted spelling/reading pair, plus any synthesized pairs. No two records in an entry share both spelling and reading. A spelling/reading pair that appears in several entries has the same segments in each, though its `pairing` can differ. Kana-only words, and kana forms JMdict marks `[nokanji]`, get a record whose spelling is the kana and whose only segment is that kana.

Within an entry, the records for one spelling are in JMdict's reading order, followed by any synthesized record. JMdict lists more common readings first and search-only readings last, so a consumer choosing a reading for a spelling can take the first record, after setting aside `"mismatched"` ones. Order is otherwise unspecified: look records up by ID, spelling, and reading, not by position.

## Segments

A string segment is shown without ruby. A `[base, ruby]` segment shows `ruby` over `base`; both are nonempty.

Invariants, all checked by `npm run validate`:

- Concatenating every segment's text (strings and bases) gives `spelling` exactly.
- Concatenating every segment's sound gives `reading`, comparing kana after folding katakana into hiragana and dropping punctuation. A string's sound is its kana; non-kana strings, such as the dots in <ruby>士<rt>し</rt></ruby>・<ruby>農<rt>のう</rt></ruby>, are silent.
- Kana the reading repeats is never under ruby, including at the edges of a ruby group: <ruby>君<rt>きみ</rt></ruby>の<ruby>名<rt>な</rt></ruby>は。, not <ruby>君の<rt>きみの</rt></ruby>.
- Kana the reading contradicts is under ruby carrying the reading's kana: 宣ふ read のたまう is <ruby>宣<rt>のたま</rt></ruby><ruby>ふ<rt>う</rt></ruby>.
- Adjacent strings are merged.
- A punctuation mark that the spelling writes is shown as plain text beside the ruby: Ｓ・Ｍ read エス・エム is <ruby>Ｓ<rt>エス</rt></ruby>・<ruby>Ｍ<rt>エム</rt></ruby>. It stays inside a ruby base only when the mark is itself read, as the dot of ２．５ is in にてんご, or when the group cannot be divided at it, as in <ruby>Ｗｉ-Ｆｉ<rt>ワイファイ</rt></ruby>. A mark that only the reading has cannot be plain text, since the spelling has no such character, so it stays in the ruby text, and that pair is mismatched: ＳＦ read エス・エフ is <ruby>Ｓ<rt>エス・</rt></ruby><ruby>Ｆ<rt>エフ</rt></ruby>. Outside mismatched pairs, ruby text holds no punctuation. Symbols that are read aloud, such as ％ and ＆, are characters, not punctuation: <ruby>１００<rt>ひゃく</rt></ruby><ruby>％<rt>パーセント</rt></ruby>.
- A positional numeral is divided at each nonzero digit, which carries its place word; the zeros after a digit stay with it: <ruby>１<rt>せん</rt></ruby><ruby>９<rt>きゅうひゃく</rt></ruby><ruby>８<rt>はちじゅう</rt></ruby><ruby>２<rt>に</rt></ruby>, <ruby>８<rt>はちまん</rt></ruby><ruby>４０００<rt>よんせん</rt></ruby>, <ruby>三〇<rt>さんじゅう</rt></ruby>. Digits read one by one are separate: <ruby>７<rt>しち</rt></ruby><ruby>５<rt>ご</rt></ruby><ruby>３<rt>さん</rt></ruby>.

A multi-character ruby group means the characters' individual sounds are unresolved, or an unwritten particle sits between them (<ruby>五<rt>ご</rt></ruby><ruby>重塔<rt>じゅうのとう</rt></ruby>). Explicit evidence can give a small kana to its own character, as in <ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る.

## Pairing

`pairing` is absent for an ordinary JMdict pair.

- `"mismatched"`: a JMdict pair whose reading contradicts its spelling. A consumer choosing a reading for a spelling should avoid these records; every spelling has at least one record that is not mismatched. The reading contradicts the spelling when:
  - the spelling's kana differ from the reading's. Usually one of the forms is search-only (`sK` or `sk`), which JMdict cannot restrict, as in 気持ちよい read きもちいい (<ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ち<ruby>よ<rt>い</rt></ruby>い). Otherwise the two follow different kana conventions, as in historical 宣ふ read のたまう (<ruby>宣<rt>のたま</rt></ruby><ruby>ふ<rt>う</rt></ruby>) or 税金ドロボー read ぜいきんどろぼう. Such a pair gives the true pronunciation, but its ruby sits over kana.
  - the reading fits only by giving a kanji a sound that belongs to the kana: けも耳 read けものみみ would need 耳 read のみみ, and is segmented け<ruby>も<rt>もの</rt></ruby><ruby>耳<rt>みみ</rt></ruby>.
  - a search-only spelling omits a particle that the reading keeps, as in そっぽ向く read そっぽをむく.
  - the reading has punctuation the spelling does not write: ＳＦ read エス・エフ is <ruby>Ｓ<rt>エス・</rt></ruby><ruby>Ｆ<rt>エフ</rt></ruby>, and the reading to use is エスエフ.
- `"synthesized"`: not a JMdict pair. Every spelling has at least one record whose reading fits its kana; where JMdict has none, the spelling's own reading is added from [data/synthesized-pairs.json](../data/synthesized-pairs.json), as in 気持ちよい read きもちよい (<ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちよい).

## Releases

A release publishes only `precise-furigana.json` and `precise-furigana.json.gz`. Its tag is `v` followed by the database's `version`. Its notes name the jmdict-simplified release used, and its tag points at the source commit, whose schema and [NOTICE.md](../NOTICE.md) apply. Builds are deterministic for the same inputs and Node.js version; compressed bytes can differ across zlib versions, so compare records, not files, across Node.js upgrades.

`npm run inspect -- <spelling> <reading> --explain` shows how any record was derived; derivations are not part of the release.
