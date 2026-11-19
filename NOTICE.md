# Notices

The Precise Furigana database is distributed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/), with the attributions below. So are the reviewed readings and word divisions it is built from, which are kept in the project's repository. None of the projects named here endorses this one.

The project's software, including the database's JSON schema, is under the MIT license; see [LICENSE.md](LICENSE.md). That license does not cover the data.

## JMdict, KANJIDIC2, and JMnedict

The database is built from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC2](https://www.edrdg.org/wiki/KANJIDIC_Project.html), which are copyright James William Breen and the Electronic Dictionary Research and Development Group (EDRDG), under the [EDRDG license statement](https://www.edrdg.org/edrdg/licence.html). The JSON conversions used are by [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified/releases). A few word divisions also rely on name readings from [JMnedict](https://www.edrdg.org/enamdict/enamdict_doc.html), which is under the same license.

The database is an adaptation: it selects each entry's permitted spelling/reading pairs, adds a few readings that JMdict lacks, and divides every reading among the characters of its spelling.

## Wiktionary

Some character readings and word divisions are adapted from [Japanese Wiktionary](https://ja.wiktionary.org/) and [English Wiktionary](https://en.wiktionary.org/) contributors, under the same Creative Commons license; see [Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights). Japanese Wiktionary's readings were extracted by [Kaikki/wiktextract](https://kaikki.org/dictionary/rawdata.html). This project selected, normalized, and reviewed what it uses.

## JmdictFurigana

Some word divisions originated as candidates in [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) release 2.3.1+2026-09-25, whose data is distributed under JMdict's Creative Commons Attribution-ShareAlike license. They were reviewed and adapted before use; no code was imported.

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
