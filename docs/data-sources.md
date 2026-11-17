# Sources and provenance

The generator reads the dictionaries that `npm run fetch` downloads and the files checked into `data/`. The release is built entirely from these; nothing in it is edited by hand.

## What's in `data/`

| File | Contents | Role |
| --- | --- | --- |
| `sources.lock.json` | The pinned jmdict-simplified release and Unihan archive, with URLs, sizes, and SHA-256 hashes, plus hashes of the two Wiktionary files | `npm run fetch` downloads and verifies exactly these inputs. The weekly release moves the jmdict-simplified pin. |
| `character-readings.json` | 5,688 single-character readings from Japanese Wiktionary | Fill gaps in KANJIDIC2's character readings |
| `english-character-readings.json` | 3,726 single-character readings from English Wiktionary, each linked to its page revision | Fill gaps in KANJIDIC2's character readings |
| `lexical-evidence.json` | 1,900 word-level facts, each a spelling, a reading, and how that reading divides among the characters | Split words whose division the character readings can't explain, such as <ruby>達<rt>だる</rt></ruby><ruby>磨<rt>ま</rt></ruby> |
| `annotations.json` | 38 complete alignments, each for one JMdict ID, spelling, and reading | Replace the generator's result for that one record |
| `synthesized-pairs.json` | 480 readings for spellings that JMdict pairs only with readings their kana contradict, each with whether it is worth proposing upstream | Add a `"synthesized"` record so every spelling has a reading that fits it |

The three kinds of hand-maintained evidence differ in reach. A character reading applies to its character everywhere. A lexical fact applies to its word wherever it appears, including inside longer words, but adds no character readings unless it marks `reusableSegments`. An annotation affects one record and nothing else.

## Dictionaries

[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) are provided by the Electronic Dictionary Research and Development Group, in the JSON conversion by [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified). The database records only the JMdict date; release notes name the jmdict-simplified release.

The [Unihan archive](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) is pinned separately from weekly updates and supplies a few more listed Japanese readings. See [Unicode's field documentation](https://www.unicode.org/reports/tr38/).

## Wiktionary character readings

The Japanese file was selected from a pinned [Kaikki/wiktextract](https://kaikki.org/dictionary/rawdata.html) extraction of Japanese Wiktionary, and the English file from pinned revisions of English Wiktionary's character pages. Both keep only readings the source explicitly marks as on or kun readings, plus, in the English file, explicitly marked character prefixes. Historical, nanori, and unmarked forms are left out. Each file's `source` header records where and when it was extracted. Refreshing either is a separate review, not part of the weekly dictionary update.

## Lexical facts

Each fact in `lexical-evidence.json` looks like this:

```json
{
  "id": "clock-allocation",
  "written": "時計",
  "reading": "とけい",
  "segments": [["時", "と"], ["計", "けい"]],
  "reason": "The pinned word table explicitly assigns と to 時 and けい to 計.",
  "sources": [
    {"name": "English Wiktionary", "url": "https://en.wiktionary.org/w/index.php?oldid=92257101#Japanese"}
  ]
}
```

`id` names the fact; it is not a JMdict ID. `reason` and `sources` are required and explain the allocation. The generator places a fact wherever its spelling and reading occur, and contributes only the cuts inside it.

Optional `reusableSegments` lists the zero-based indices of segments whose single-character sound may also be used in other words; 76 facts have them. `jmdictEntries` then lists the JMdict entries that the fact's evidence came from, so its sounds never corroborate those same entries. Entries containing the fact's own spelling and reading are excluded automatically.

The facts were compiled during development from Wiktionary word tables, Kotobank and other dictionaries, and reviewed candidates from [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana). AI agents did the reviews, citing the sources listed with each fact; no lexicographer checked them.

## Annotations

An annotation in `annotations.json` has the same fields as a lexical fact, except that `id` is the JMdict ID and `sources` is a list of URLs. Its segments replace the generator's output for exactly that ID, spelling, and reading. An annotation whose pair no longer exists in JMdict fails the build.

## Licensing

Original software is MIT-licensed. The database, the reviewed evidence and annotations, and dictionary-derived test data use CC BY-SA 4.0, with EDRDG, Wiktionary, and JmdictFurigana attribution and Unihan's license in [NOTICE](../NOTICE).

Lorenzi's `furigana.txt` generator was used during development only to find cases worth investigating. It is not an input, and none of its data is distributed.
