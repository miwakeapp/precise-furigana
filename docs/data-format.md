# Data format

The canonical distribution is UTF-8 JSON. Gzip contains exactly the same bytes. A standard format makes lookup, corrections, and schema evolution straightforward; compression handles repeated property names without a custom delimiter language.

```json
{
  "schemaVersion": 1,
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

A string segment represents identical text on both sides. A two-element array represents `[written text, reading]`, both nonempty. Concatenating the written sides reconstructs `written`; concatenating the reading sides reconstructs `reading`. No normalization is applied to the stored strings. For example, katakana spelling with hiragana reading uses a tuple even when the sounds match.

A segment can contain several characters when their individual sound ownership is unresolved. Unpronounced punctuation must share a segment with text that has a reading, because empty segments are forbidden. A small kana can belong to a separate character when explicit lexical evidence supports that assignment, as in 端[はし]折[ょ]る.

Entry and record order follows stable upstream enumeration. Consumers should look up by ID, spelling, and reading rather than assuming a fixed array position across source releases.

## Support labels

| Status | Meaning |
| --- | --- |
| `aligned` | Supported by the model, including dictionary-backed whole-word groups. |
| `ambiguous` | Best paths disagree, or a kana spelling differs from the reading in an unresolved way. |
| `fallback` | At least one assignment lacks dictionary or sound-change support. |
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
