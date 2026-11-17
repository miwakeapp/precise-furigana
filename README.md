# Precise Furigana

A database that precisely places furigana over every kanji, for every permitted spelling/reading pair in [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), released as a JSON file, updated weekly.

## What is this?

By itself, JMdict just supplies a list of [kanji forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#kanji) and [readings/kana forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#readings), e.g. for [entry 2852392](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2852392):

- Kanji: お誕生日；御誕生日
- Readings: おたんじょうび

Below, we call the kanji forms **spellings**, since many of them aren't purely kanji (お誕生日, そっぽ向く, 無線ＬＡＮ). Words that JMdict writes only in kana, such as あおば, use the kana itself as the spelling.

So most software that just directly consumes JMdict (or otherwise has spelling/reading pairs it wants to display) renders these as お<ruby>誕生日<rt>たんじょうび</ruby> / <ruby>御誕生日<rt>おたんじょうび</ruby>. But this looks worse than the proper split of お<ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby> / <ruby>御<rt>お</ruby><ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby>. (And, I claim, the precisely-placed form is better for building a learner's kanji-reading mental muscles.)

With the Precise Furigana database, your software can display any word in JMdict—in fact, any allowed spelling/reading pair in JMdict—with this sort of nice-looking, good-for-learners, precisely-placed furigana!

## Use the data

The release artifacts are `precise-furigana.json` and its gzip-compressed equivalent, `precise-furigana.json.gz`. The corpus contains about 325,000 spelling/reading pairs; the compressed database is about 7 MB.

```js
const records = database.entries["1582710"];
const nihon = records.find(record => record.reading === "にほん");
// nihon.segments: [["日", "に"], ["本", "ほん"]]
```

Each record has:

- `spelling`: one of the JMdict [kanji forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#kanji), or for kana-only words, the kana form.
- `reading`: a string containing one of the JMdict ["reading"](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#readings) forms. (or, in [certain edge cases](#jmdict-limitations-mismatched-and-synthesized-pairs), a synthesized reading not present in JMdict)
- `segments`: the precisely-placed furigana, as an array of either strings (shown without ruby) or `[base, ruby]` pairs.
- `pairing`: an optional field, with a value of either `"synthesized"` or `"mismatched"`, for certain edge cases [explained below](#jmdict-limitations-mismatched-and-synthesized-pairs).

So for example, to turn the `segments` into HTML:

```js
const html = segments.map(
  (s) => typeof s === "string" ? s : `<ruby>${s[0]}<rt>${s[1]}</ruby>`,
)
  .join("");
```

See also the [data format](docs/data-format.md) and [JSON schema](schema.json) documentation.

TODO: more use-case focused? For people with (spelling, reading) pairs, vs. people wanting to look up the "most common" readings?

## Tricky cases

### Jukujikun

Sometimes Japanese words are written as kanji compounds based only on their meaning, with no correspondence to the kanji's readings: this is known as [jukujikun](https://en.wikipedia.org/wiki/Ateji#Related_concepts) (熟字訓). So for example, in our database:

- [<ruby>大人<rt>おとな</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1414170) is jukujikun, and thus has no split.
- In [<ruby>赤<rt>あか</ruby><ruby>啄木鳥<rt>げら</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1829200), 赤 gets the あか portion of the reading, but 啄木鳥 ("woodpecker") is jukujikun and gets げら.

### Unwritten particles

Sometimes Japanese words are written as kanji compounds, omitting particles, even though they would always be read with those particles. For example, in our database:

- [<ruby>身代<rt>みのしろ</ruby><ruby>金<rt>きん</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365610) has a natural split of <ruby>身<rt>み</ruby> plus <ruby>代<rt>しろ</ruby> plus <ruby>金<rt>きん</ruby>; the third of these can be placed precisely, but the former two must stay grouped in order to provide a place for the の.
- [<ruby>山手<rt>やまのて</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1755120) has a natural split of <ruby>山<rt>やま</ruby> plus <ruby>手<rt>て</ruby>, but nowhere to put the の, so it stays grouped.

Note that the latter example shows how furigana placement is a function of the (spelling, reading) pair: given the spelling 山の手, which is also present in the same JMdict entry, the same reading can be precisely placed as <ruby>山<rt>やま</ruby>の<ruby>手<rt>て</ruby>.

### JMdict limitations: mismatched and synthesized pairs

JMdict marks certain rarer spellings and readings as "search-only". Such spellings and readings are treated as second-class, in that editors are not allowed to add data about spelling/reading restrictions for them (as discussed [in the edit history for 息の長い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960)). So JMdict "allows" pairs whose reading contradicts the spelling.

For example:

- The [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230) entry has the きもちよい reading restricted to the 気持ち良い spelling, and thus "disallowed" for the 気持ちよい spelling, even though it's obviously the correct reading. This is because 気持ちよい is marked as search-only, and thus gets second-class treatment.

- The [そっぽを向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120) entry has a そっぽ向く spelling, but no そっぽむく reading, implying that そっぽ向く is read as そっぽ<ruby>向<rt>をむ</ruby>く, even though this is nonsense. Even if we added the そっぽむく reading (which is allowed per policy), the second-class treatment means that そっぽをむく would still be "allowed" for そっぽ向く, since as a search-only form そっぽ向く cannot have any restrictions recorded.

The Precise Furigana database still includes every pair JMdict allows, and its segments always spell out the record's reading exactly. Where that reading contradicts the spelling, the record is marked `"pairing": "mismatched"`:

| Spelling | Reading | Furigana | `pairing` |
| --- | --- | --- | --- |
| [息の長い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960) | いきがながい | <ruby>息<rt>いき</ruby><ruby>の<rt>が</ruby><ruby>長<rt>なが</ruby>い | `"mismatched"` |
| [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230) | きもちいい | <ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ち<ruby>よ<rt>い</ruby>い | `"mismatched"` |
| [そっぽ向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120) | そっぽをむく | そっぽ<ruby>向<rt>をむ</ruby>く | `"mismatched"` |
| [サイム油](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2867482) | タイムゆ | <ruby>サ<rt>タ</ruby>イム<ruby>油<rt>ゆ</ruby> | `"mismatched"` |

Every spelling also has at least one record that shows its kana as written. When JMdict has no such pair, we add one, marked `"pairing": "synthesized"`, with the spelling's own reading:

| Spelling | Reading | Furigana | `pairing` |
| --- | --- | --- | --- |
| [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230) | きもちよい | <ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ちよい | `"synthesized"` |
| [そっぽ向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120) | そっぽむく | そっぽ<ruby>向<rt>む</ruby>く | `"synthesized"` |
| [サイム油](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2867482) | サイムゆ | サイム<ruby>油<rt>ゆ</ruby> | `"synthesized"` |
| [宣ふ](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2055480) | のたまふ | <ruby>宣<rt>のたま</ruby>ふ | `"synthesized"` |

Some synthesized readings are real pronunciations JMdict is missing, like そっぽむく, and I'm submitting those upstream. Others just read the spelling as written, like the misspelling サイム油 or the historical spelling 宣ふ, where JMdict's own reading is the right pronunciation (but might not be what you want to print in a book or web page).

If you come with a (spelling, reading) pair, you get exactly that record, with the flag telling you how much to trust the pairing. For example, given 息の長い, いきのながい (avoiding the `"mismatched"` いきがながい) is the clean choice.

If you come with only a spelling and pick a reading yourself, prefer avoiding records with `"mismatched"` when possible. The choice between unmarked and `"synthesized"` is a matter of taste. For example, given 宣ふ, both <ruby>宣<rt>のたま</ruby><ruby>ふ<rt>う</ruby> (the modern pronunciation; no `"pairing"` value) and <ruby>宣<rt>のたま</ruby>ふ (as written; marked `"pairing": "synthesized"`) are reasonable.

## Comparison with other furigana databases

I am aware of two other projects in this space: [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) and [Lorenzi's Jisho](https://github.com/hlorenzi/jisho-open). JmdictFurigana is pretty hopeless: it can't segment basic words like 日本 correctly, [and even refused to fix this gap when asked](https://github.com/Doublevil/JmdictFurigana/issues/25). Lorenzi's Jisho is much better, but it [has no license](https://github.com/hlorenzi/jisho-open/issues/10), so it's probably not usable by most software.

Precise Furigana is fully open source, with MIT-licensed code and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) for the data. Additionally, it's updated weekly, following the active edits to JMdict. And, aided by the power of AI to crunch through tons of edge cases, we've managed to get more tricky cases right than the other projects.

| Word | Precise Furigana | Lorenzi | JmdictFurigana |
| --- | --- | --- | --- |
| 日本 | <ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby> | <ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby> | <ruby>日本<rt>にほん</ruby> |
| 無線ＬＡＮ | <ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby> | <ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby> | <ruby>無<rt>む</ruby><ruby>線<rt>せ</ruby><ruby>Ｌ<rt>ん</ruby><ruby>Ａ<rt>ラ</ruby><ruby>Ｎ<rt>ン</ruby> |
| 達磨 | <ruby>達<rt>だる</ruby><ruby>磨<rt>ま</ruby> | <ruby>達<rt>だ</ruby><ruby>磨<rt>るま</ruby> | <ruby>達磨<rt>だるま</ruby> |
| 御器噛り | <ruby>御<rt>ご</ruby><ruby>器<rt>っ</ruby><ruby>噛<rt>かぶ</ruby>り | <ruby>御器<rt>ごっ</ruby><ruby>噛<rt>かぶ</ruby>り | <ruby>御<rt>ごっ</ruby><ruby>器<rt>か</ruby><ruby>噛<rt>ぶ</ruby>り |
| メーカ希望価格 | メーカ<ruby>希<rt>き</ruby><ruby>望<rt>ぼう</ruby><ruby>価<rt>か</ruby><ruby>格<rt>かく</ruby> | メーカ<ruby>希望価格<rt>ーきぼうかかく</ruby> | <i>no entry</i> |
| 道程 | <ruby>道<rt>みち</ruby><ruby>程<rt>のり</ruby> | <ruby>道<rt>みち</ruby><ruby><rt>の</ruby><ruby>程<rt>り</ruby> | <i>no entry</i> |
| 前肢 | <ruby>前<rt>まえ</ruby><ruby>肢<rt>あし</ruby> | <ruby>前<rt>まえあ</ruby><ruby>肢<rt>し</ruby> | <i>no entry</i> |
