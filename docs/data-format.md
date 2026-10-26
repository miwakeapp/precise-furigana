# Data format

The canonical distribution is UTF-8 JSON. Gzip contains exactly the same bytes. A standard format makes lookup, corrections, and schema evolution straightforward; compression handles repeated property names without a custom delimiter language.

```json
{
  "schemaVersion": 2,
  "metadata": {},
  "entries": {
    "1582710": [
      {
        "written": "日本",
        "reading": "にほん",
        "segments": [["日", "に"], ["本", "ほん"]],
        "status": "aligned",
        "evidence": ["phonological", "character"]
      }
    ]
  }
}
```

This example omits metadata and the entry's other reading. [schema.json](../schema.json) describes the complete structure.

## Records and segments

Keys in `entries` are original JMdict IDs represented as strings. Values contain every permitted spelling/reading pair for that entry, including search-only spellings. Reading restrictions exclude invalid combinations. Kana-only entries and explicitly standalone kana readings receive literal records.

Segments describe how to display the spelling. A string segment is text shown without ruby. A two-element array is `[written text, reading]`, both nonempty, shown as ruby. Rendering HTML needs nothing else:

```js
const html = segments.map(segment => typeof segment === "string" ? segment : `<ruby>${segment[0]}<rt>${segment[1]}</rt></ruby>`).join("");
```

Concatenating the written sides reconstructs `written` exactly. String segments that are kana are pronounced as written; other string segments, such as the dots in 士[し]・農[のう]・工[こう]・商[しょう], are silent. Kana that differs from the reading only in script is a string, so 親ネコ/おやねこ is `[["親", "おや"], "ネコ"]`. Adjacent strings are always merged. The exact reading, including its script and any punctuation, is the record's `reading`.

A segment can contain several characters when their individual sound ownership is unresolved. A small kana can belong to a separate character when explicit lexical evidence supports that assignment, as in 端[はし]折[ょ]る.

Entry and record order follows stable upstream enumeration. Consumers should look up by ID, spelling, and reading rather than assuming a fixed array position across source releases.

## Support labels

| Status | Meaning |
| --- | --- |
| `aligned` | Supported by the model, including dictionary-backed whole-word groups. |
| `ambiguous` | Best paths disagree, or a kana spelling differs from the reading in an unresolved way. |
| `fallback` | Some character has no supported reading. None occur in the current release, because every JMdict pair can at least be grouped as a whole word. |
| `reviewed` | An exact annotation supplies the alignment for this entry, spelling, and reading. |

`evidence` contains one label per segment: `literal`, `character`, `phonological`, `dictionary`, `ambiguous`, `fallback`, or `reviewed`. These labels describe how the result was produced. They are not calibrated confidence scores or certification by a human reviewer. Detailed witnesses are available through the generator's inspection command; the release retains compact labels.

## Provenance and assets

`metadata` records the algorithm version, generator digest, configuration, annotation digest, source lock, license, attribution, and counts. The generator digest includes the maintained lexical evidence. Source locks contain dictionary versions, original download URLs, archive hashes, extracted-content hashes, and bundled-source hashes.

A release contains:

- `precise-furigana.json` and `precise-furigana.json.gz`: database.
- `manifest.json`: byte sizes and SHA-256 hashes of the other assets.
- `sources.lock.json`: exact upstream and bundled inputs.
- `evaluation.json`: regression results bound to this generator, configuration, sources, annotations, and fixtures.
- `schema.json` and `NOTICE`: format and attribution.

No build timestamp is inserted. Rebuilding with the same inputs and runtime produces deterministic files. Compression can depend on the runtime's zlib version; record equality is the relevant comparison when changing Node.js versions.
