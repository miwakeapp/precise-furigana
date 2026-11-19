# Notices

The software in this repository is licensed under MIT; see [LICENSE.md](LICENSE.md). That license does not cover the data.

The generated database, its annotations, the reviewed evidence in `data/`, and the dictionary-derived test data are distributed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/), with the attributions below. Source URLs, versions, dates, sizes, and SHA-256 digests of every input are recorded in [data/sources.lock.json](data/sources.lock.json).

## JMdict and KANJIDIC2

The generated database uses [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/KANJIDIC_Project.html), which are copyright James William Breen and the Electronic Dictionary Research and Development Group (EDRDG), under the [EDRDG license statement](https://www.edrdg.org/edrdg/licence.html). The source JSON conversion is by [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified/releases).

A few lexical facts keep a place name or surname together on the evidence of [JMnedict](https://www.edrdg.org/enamdict/enamdict_doc.html), which is under the same EDRDG license; JMnedict is not an input to the build.

The generated database is an adaptation: this project selects permitted spelling/reading pairs and adds algorithmically inferred furigana boundaries and reviewed alignment annotations. No endorsement by EDRDG is implied.

## Wiktionary

The bundled character readings and selected lexical facts include adapted material from [Japanese Wiktionary](https://ja.wiktionary.org/) and [English Wiktionary](https://en.wiktionary.org/) contributors, licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/); see [Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights).

Japanese character readings were extracted by [Kaikki/wiktextract](https://kaikki.org/dictionary/rawdata.html). English character readings were extracted directly from pinned page revisions through the [MediaWiki API](https://en.wiktionary.org/w/api.php), following the [`ja-readings` template documentation](https://en.wiktionary.org/w/index.php?title=Template:ja-readings/documentation&oldid=89401685). This project filters, normalizes, and reviews their applicability: it retains literal on readings, explicitly complete kun readings, and documented character-reading prefixes; it withholds unmarked kun, nanori, and historical values and unsupported markup; and it infers no sound changes or inflections.

Source titles, original forms, tags, revision or archive provenance, and modification details are retained in [data/character-readings.json](data/character-readings.json) and [data/english-character-readings.json](data/english-character-readings.json), and each lexical fact in [data/lexical-evidence.json](data/lexical-evidence.json) lists its source URLs.

## JmdictFurigana

Reviewed alignment candidates also originated in [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) release 2.3.1+2026-09-25, whose generated data is distributed under the JMdict Creative Commons Attribution-ShareAlike license. Supported lexical units were selected and adapted after two AI reviews; no implementation code was imported. Each adopted unit's rationale and source URLs are retained in [data/lexical-evidence.json](data/lexical-evidence.json).

No endorsement by these contributors or projects is implied.

## Lorenzi's Jisho

Lorenzi's furigana data and implementation are not inputs to the generator and are not included in the distributed data.

## Unihan

Supplemental Japanese readings come from the [Unihan database](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) ([documentation](https://www.unicode.org/reports/tr38/)), under the following license.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
