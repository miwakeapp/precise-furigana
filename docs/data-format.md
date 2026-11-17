# Data format

The database is UTF-8 JSON; the `.gz` file contains exactly the same bytes.

```json
{
  "schemaVersion": 2,
  "jmdictDate": "2026-10-05",
  "license": "CC-BY-SA-4.0",
  "attribution": "Based on JMdict and KANJIDIC2, copyright EDRDG, …",
  "entries": {
    "1582710": [
      { "spelling": "日本", "reading": "にほん", "segments": [["日", "に"], ["本", "ほん"]] }
    ]
  }
}
```

This example shortens the attribution and omits the entry's other reading. [schema.json](../schema.json) describes the complete structure. `jmdictDate` is the date of the JMdict release the data was generated from.

## Records and segments

Keys in `entries` are original JMdict IDs represented as strings. Values contain every permitted spelling/reading pair for that entry, including search-only spellings, plus the synthesized pairs described [below](#pairing). Reading restrictions exclude invalid combinations. Kana-only entries and explicitly standalone kana readings receive literal records.

Segments describe only how to display the spelling. A string segment is text shown without ruby. A two-element array is `[base, ruby]`, both nonempty: base text shown with ruby text over it. Rendering HTML needs nothing else:

```js
const html = segments.map(segment => typeof segment === "string" ? segment : `<ruby>${segment[0]}<rt>${segment[1]}</rt></ruby>`).join("");
```

Concatenating the strings and ruby bases reconstructs `spelling` exactly, and concatenating the readings of ruby segments and kana strings spells out `reading`, up to script and the long-vowel mark. String segments that are not kana, such as the dots in <ruby>士<rt>し</rt></ruby>・<ruby>農<rt>のう</rt></ruby>・<ruby>工<rt>こう</rt></ruby>・<ruby>商<rt>しょう</rt></ruby>, are silent. Kana that the reading repeats is shown without ruby, so 親ネコ/おやねこ is `[["親", "おや"], "ネコ"]`, and kana at the edge of a ruby group stays outside it, so 君の名は。/きみのなは is <ruby>君<rt>きみ</rt></ruby>の<ruby>名<rt>な</rt></ruby>は。. Kana the reading contradicts gets ruby with the reading's kana: 宣ふ/のたまう is <ruby>宣<rt>のたま</rt></ruby><ruby>ふ<rt>う</rt></ruby>. An unwritten particle between two kanji belongs to neither, so they share one ruby: 五重塔/ごじゅうのとう is <ruby>五<rt>ご</rt></ruby><ruby>重塔<rt>じゅうのとう</rt></ruby>. Adjacent strings are always merged.

### Pairing

JMdict does not restrict which readings go with search-only spellings and readings, so it permits some pairs whose reading contradicts the spelling. Every such pair is still included, marked `"pairing": "mismatched"`, with segments that spell out its reading: 気持ちよい/きもちいい is <ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ち<ruby>よ<rt>い</rt></ruby>い, and そっぽ向く/そっぽをむく, which omits a particle, is そっぽ<ruby>向<rt>をむ</rt></ruby>く.

Every spelling also has at least one record whose reading fits its kana. Where JMdict has none, the database adds a pair with the spelling's own reading, marked `"pairing": "synthesized"`: 気持ちよい/きもちよい is <ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちよい, and 宣ふ/のたまふ is <ruby>宣<rt>のたま</rt></ruby>ふ. Synthesized readings are kept in [data/synthesized-pairs.json](../data/synthesized-pairs.json); some are pronunciations JMdict lacks, and others only read a misspelling, kana variant, or historical spelling as written.

Records without `pairing` are JMdict pairs whose reading fits the spelling, or visible pairs such as 宣ふ/のたまう whose kana differ only by orthographic convention. A consumer that has only a spelling and chooses a reading should prefer those records and synthesized ones, and avoid mismatched records when another exists.

A segment can contain several characters when their individual sound ownership is unresolved. A small kana can belong to a separate character when explicit lexical evidence supports that assignment, as in <ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る.

Entry and record order follows stable upstream enumeration. Consumers should look up by ID, spelling, and reading rather than assuming a fixed array position across source releases.

How each segment was derived is not part of the release. `npm run inspect -- <spelling> <reading> --explain` shows the generator's evidence for any pair.

## Releases

A release contains only `precise-furigana.json` and the same file gzip-compressed as `precise-furigana.json.gz`. Its notes name the jmdict-simplified release the data was generated from, and its tag points at the source commit, whose [schema.json](../schema.json) and [NOTICE](../NOTICE) apply to it.

No build timestamp is inserted. Rebuilding with the same inputs and runtime produces deterministic files. Compression can depend on the runtime's zlib version; record equality is the relevant comparison when changing Node.js versions.
