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
      { "written": "日本", "reading": "にほん", "segments": [["日", "に"], ["本", "ほん"]] }
    ]
  }
}
```

This example shortens the attribution and omits the entry's other reading. [schema.json](../schema.json) describes the complete structure. `jmdictDate` is the date of the JMdict release the data was generated from.

## Records and segments

Keys in `entries` are original JMdict IDs represented as strings. Values contain every permitted spelling/reading pair for that entry, including search-only spellings. Reading restrictions exclude invalid combinations. Kana-only entries and explicitly standalone kana readings receive literal records.

Segments describe only how to display the spelling. A string segment is text shown without ruby. A two-element array is `[written text, reading]`, both nonempty, shown as ruby. Rendering HTML needs nothing else:

```js
const html = segments.map(segment => typeof segment === "string" ? segment : `<ruby>${segment[0]}<rt>${segment[1]}</rt></ruby>`).join("");
```

Concatenating the written sides reconstructs `written` exactly. String segments that are not kana, such as the dots in <ruby>士<rt>し</rt></ruby>・<ruby>農<rt>のう</rt></ruby>・<ruby>工<rt>こう</rt></ruby>・<ruby>商<rt>しょう</rt></ruby>, are silent. Kana is shown as written, so 親ネコ/おやねこ is `[["親", "おや"], "ネコ"]`. That holds even where JMdict pairs a spelling with a reading its kana contradict, usually a search-only spelling: 気持ちよい/きもちいい is <ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちよい. Ruby over kana is kept only for ヶ, ヵ, and ケ read as counters, as in <ruby>何<rt>なん</rt></ruby><ruby>ヶ<rt>か</rt></ruby><ruby>月<rt>げつ</rt></ruby>, and for the pun <ruby>怪<rt>あや</rt></ruby><ruby>レ<rt>し</rt></ruby>い<ruby>日<rt>に</rt></ruby><ruby>本<rt>ほん</rt></ruby><ruby>語<rt>ご</rt></ruby>. Adjacent strings are always merged. Ruby follows the reading, but plain kana need not spell it out, so take pronunciation from `reading`, which keeps the exact script and punctuation.

A segment can contain several characters when their individual sound ownership is unresolved. A small kana can belong to a separate character when explicit lexical evidence supports that assignment, as in <ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る.

Entry and record order follows stable upstream enumeration. Consumers should look up by ID, spelling, and reading rather than assuming a fixed array position across source releases.

How each segment was derived is not part of the release. `npm run inspect -- <written> <reading> --explain` shows the generator's evidence for any pair.

## Releases

A release contains only `precise-furigana.json` and the same file gzip-compressed as `precise-furigana.json.gz`. Its notes name the jmdict-simplified release the data was generated from, and its tag points at the source commit, whose [schema.json](../schema.json) and [NOTICE](../NOTICE) apply to it.

No build timestamp is inserted. Rebuilding with the same inputs and runtime produces deterministic files. Compression can depend on the runtime's zlib version; record equality is the relevant comparison when changing Node.js versions.
