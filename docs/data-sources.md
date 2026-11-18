# Sources and provenance

The build reads only what `npm run fetch` downloads and the files in `data/`. Nothing in the release is edited by hand.

## Upstream dictionaries

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), from EDRDG, in the [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) JSON conversion. The weekly release moves this pin.
- The [Unihan archive](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) ([field documentation](https://www.unicode.org/reports/tr38/)), for a few more Japanese character readings. Pinned separately; updating it is a deliberate change.

`data/sources.lock.json` pins all of these by URL, size, and SHA-256, plus the hashes of the two Wiktionary files.

## Files in `data/`

| File                              | What it is                                                                                                                           | Reach                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `character-readings.json`         | On and kun readings from a pinned [Kaikki/wiktextract](https://kaikki.org/dictionary/rawdata.html) extraction of Japanese Wiktionary | The character, everywhere                                   |
| `english-character-readings.json` | On and kun readings, plus explicitly marked character prefixes, from pinned revisions of English Wiktionary character pages          | The character, everywhere                                   |
| `lexical-evidence.json`           | Reviewed word-level allocations                                                                                                      | The word, wherever it occurs, including inside longer words |
| `annotations.json`                | Complete replacement alignments                                                                                                      | One ID, spelling, and reading                               |
| `synthesized-pairs.json`          | Readings for spellings that JMdict pairs only with contradicting readings                                                            | One added record each                                       |

Both Wiktionary files keep only readings the source explicitly marks as on or kun; historical, nanori, and unmarked forms are excluded, and unmarked kun forms are never guessed to be prefixes. Each file's `source` header says where and when it was extracted. Refreshing them is a separate review, not part of the weekly update.

### Lexical facts

<!-- oxfmt-ignore -->
```json
{
  "id": "W0032",
  "spelling": "達磨",
  "reading": "だるま",
  "segments": [["達", "だる"], ["磨", "ま"]],
  "reason": "The table gives conventional Buddhist transliteration syllables in their established written sequence. …",
  "sources": [{ "name": "English Wiktionary contributors", "url": "https://en.wiktionary.org/w/index.php?title=%E9%81%94%E7%A3%A8&oldid=92643544#Japanese" }]
}
```

`id` is the fact's own name, not a JMdict ID. `reason` and `sources` are required. A fact contributes only the cuts inside it.

`reusableSegments` (zero-based segment indices) lets a single-character sound from the fact count as a character reading in other words. The sound never corroborates the fact's own pair, or the entries listed in its optional `jmdictEntries`, which name other entries the evidence came from.

The facts were compiled from Wiktionary word tables, Kotobank and other dictionaries, and reviewed [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) candidates. AI agents reviewed them against the cited sources; no lexicographer has.

### Annotations

Same fields as a lexical fact, except that `id` is the JMdict ID and `sources` is a list of URLs. An annotation whose pair has left JMdict fails the build, so it gets reviewed.

### Synthesized pairs

Each entry has `id`, `spelling`, `reading`, `upstream`, and `note`. `upstream` records whether the reading is worth proposing to JMdict as a search-only reading (`"propose"`), already exists but is restricted to other spellings (`"restricted"`), or only reads a misspelling, kana variant, or historical spelling as written (`"none"`). [Maintenance](maintenance.md#synthesized-pairs) covers keeping it current.
