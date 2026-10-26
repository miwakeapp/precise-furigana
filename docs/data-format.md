# Data format

The canonical distribution is UTF-8 JSON. Gzip contains exactly the same bytes. A standard format makes lookup, corrections, and schema evolution straightforward; compression handles repeated property names without a custom delimiter language.

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

Segments describe how to display the spelling. A string segment is text shown without ruby. A two-element array is `[written text, reading]`, both nonempty, shown as ruby. Rendering HTML needs nothing else:

```js
const html = segments.map(segment => typeof segment === "string" ? segment : `<ruby>${segment[0]}<rt>${segment[1]}</rt></ruby>`).join("");
```

Concatenating the written sides reconstructs `written` exactly. String segments that are kana are pronounced as written; other string segments, such as the dots in <ruby>士<rt>し</rt></ruby>・<ruby>農<rt>のう</rt></ruby>・<ruby>工<rt>こう</rt></ruby>・<ruby>商<rt>しょう</rt></ruby>, are silent. Kana that differs from the reading only in script is a string, so 親ネコ/おやねこ is `[["親", "おや"], "ネコ"]`. Adjacent strings are always merged. The exact reading, including its script and any punctuation, is the record's `reading`.

A segment can contain several characters when their individual sound ownership is unresolved. A small kana can belong to a separate character when explicit lexical evidence supports that assignment, as in <ruby>端<rt>はし</rt></ruby><ruby>折<rt>ょ</rt></ruby>る.

Entry and record order follows stable upstream enumeration. Consumers should look up by ID, spelling, and reading rather than assuming a fixed array position across source releases.

How each segment was derived is not part of the release. `npm run inspect -- <written> <reading> --explain` shows the generator's evidence for any pair.

## Release assets

- `precise-furigana.json` and `precise-furigana.json.gz`: database.
- `manifest.json`: algorithm version, record counts, and byte sizes and SHA-256 hashes of the other assets.
- `sources.lock.json`: exact upstream and bundled inputs, including dictionary versions, download URLs, and archive, content, and bundle hashes.
- `evaluation.json`: regression results, with the generator digest, configuration, and source, annotation, and fixture digests they were produced from. The generator digest includes the maintained lexical evidence.
- `schema.json` and `NOTICE`: format and attribution.

No build timestamp is inserted. Rebuilding with the same inputs and runtime produces deterministic files. Compression can depend on the runtime's zlib version; record equality is the relevant comparison when changing Node.js versions.
