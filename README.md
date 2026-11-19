# Precise Furigana

A database that precisely places furigana over every kanji, for every permitted spelling/reading pair in [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), released as a JSON file, updated weekly.

## What is this?

By itself, JMdict just supplies a list of [kanji forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#kanji) and [readings/kana forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#readings), e.g. for [entry 2852392](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2852392):

- Kanji: お誕生日；御誕生日
- Readings: おたんじょうび

(We call the kanji forms **spellings**, since many of them aren't purely kanji, e.g., お誕生日, そっぽ向く, 無線ＬＡＮ. Words that JMdict writes only in kana, such as あおば, use the kana itself as the spelling.)

Most software that just directly consumes JMdict, or otherwise has spelling/reading pairs it wants to display, renders these as お<ruby>誕生日<rt>たんじょうび</ruby> / <ruby>御誕生日<rt>おたんじょうび</ruby>. But this looks worse than the proper split of お<ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby> / <ruby>御<rt>お</ruby><ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby>. And, I claim, the precisely-placed form is better for building a learner's kanji-reading mental muscles.

With the Precise Furigana database, your software can display any word in JMdict—in fact, any allowed spelling/reading pair in JMdict—with this sort of nice-looking, good-for-learners, precisely-placed furigana!

## Use the data

Each [release](https://github.com/miwakeapp/precise-furigana/releases) has two files. `precise-furigana.zip` (about 7 MB) contains `precise-furigana.json` along with its schema and license notices. `precise-furigana.json.zst` (about 4.5 MB) is the same JSON file alone, compressed with [Zstandard](https://facebook.github.io/zstd/). The corpus contains about 325,000 spelling/reading pairs.

The top-level JSON object's `entries` property contains an object mapping JMdict IDs to lists of spelling/reading/segmentation records. For example, `database.entries["2852392"]` is the following:

<!-- oxfmt-ignore -->
```json
[
  {
    "spelling": "お誕生日",
    "reading": "おたんじょうび",
    "segments": ["お", ["誕", "たん"], ["生", "じょう"], ["日", "び"]]
  },
  {
    "spelling": "御誕生日",
    "reading": "おたんじょうび",
    "segments": [["御", "お"], ["誕", "たん"], ["生", "じょう"], ["日", "び"]]
  }
]
```

Each record has:

- `spelling`: one of the JMdict [kanji forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#kanji), or for kana-only words, the kana form.
- `reading`: a string containing one of the JMdict ["reading"](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#readings) forms. (or, in [certain edge cases](#jmdict-limitations-mismatched-and-synthesized-pairs), a synthesized reading not present in JMdict)
- `segments`: the precisely-placed furigana, as an array of either strings (shown without ruby) or `[base, ruby]` pairs.
- `pairing`: an optional field, with a value of `"mispaired"`, `"synthesized"`, or `"phonetic"`, explained [below](#tricky-pairings).

There is [a JSON schema](./schema.json) available.

Below we give some examples of common tasks using this database, in JavaScript. Of course, you can use any language that can consume the JSON file.

### Finding segmentation given a spelling and reading

In some cases, your software might already have a specific reading in mind for a spelling. For example, if you are just trying to make existing furigana more precise, or if you are displaying all possible readings. An inefficient example of how to do this would be:

```js
function findSegmentation(spelling, reading) {
  for (const entry of Object.values(database.entries)) {
    for (const record of entry) {
      if (record.spelling === spelling && record.reading === reading) {
        return record.segments;
      }
    }
  }

  throw new Error(`The combination "${spelling}" + "${reading}" was not present in JMdict.`);
}
```

(Note that `findSegmentation()` picks the first encountered entry with the given spelling and reading, even though multiple might exist: e.g., both [entry 1198910](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1198910) and [entry 1546070](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1546070) contain the spelling 解ける and the reading とける. This is not a problem in practice, as the segmentation is always the same across the entries.)

If you already have the JMdict ID, for example because your software has already located it in order to give a definition to the user, then you can use it directly:

```js
function findSegmentationForKnownWord(jmdictId, spelling, reading) {
  for (const record of database.entries[jmdictId]) {
    if (record.spelling === spelling && record.reading === reading) {
      return record.segments;
    }
  }

  throw new Error(
    `The combination "${spelling}" + "${reading}" was not present in JMdict entry "${jmdictId}".`,
  );
}
```

### Finding the reading and segmentation given only the spelling

Trying to add precise furigana to a given spelling, without a reading supplied, is not trivial.

First, you need to determine which JMdict entry is being indicated: is 辛い meant to be [entry 1365850](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365850) ("spicy") or [entry 1365860](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365860) ("painful")? This is out of scope of this project; I suggest using an LLM.

Even once you have the JMdict ID in hand, you can still get several possibilities: should you transform 明日 into <ruby>明日<rt>あした</ruby> or <ruby>明<rt>あ</ruby><ruby>日<rt>す</ruby> or <ruby>明<rt>みょう</ruby><ruby>日<rt>にち</ruby>?

The following algorithm attempts to pick the best record given the data on hand. It has one configuration option, which is whether to annotate only kanji (the default), or to also annotate kana when they are pronounced differently than written ([see below](#phonetic)). Beyond that, "best" can be subjective, and again, an LLM might do better, given the context in which the word is being used.

```js
function bestRecord(jmdictId, spelling, { glossKana = false } = {}) {
  const records = (database.entries[jmdictId] ?? []).filter((r) => r.spelling === spelling);
  if (records.length === 0) {
    throw new Error(`The spelling "${spelling}" was not present in JMdict entry "${jmdictId}"`);
  }

  // A "phonetic" record puts the modern sound over kana that aren't read as
  // written, such as the ふ of 宣ふ.
  if (glossKana) {
    const phonetic = records.find((r) => r.pairing === "phonetic");
    if (phonetic) {
      return phonetic;
    }
  }

  // Otherwise, take the first record whose reading fits the spelling. There is
  // always one. Records are in JMdict order, which is most-common first.
  return records.find((r) => r.pairing !== "mispaired" && r.pairing !== "phonetic");
}
```

### Turning segments into HTML

Leave string segments alone, and turn `[base, ruby]` pairs into the appropriate HTML [ruby markup](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-ruby-element):

```js
function segmentsToRuby(segments) {
  return segments
    .map((s) => (typeof s === "string" ? s : `<ruby>${s[0]}<rt>${s[1]}</ruby>`))
    .join("");
}
```

## Tricky cases and how we handle them

### Jukujikun

Sometimes Japanese words are written as kanji compounds based only on their meaning, with no correspondence to the kanji's readings: this is known as [jukujikun](https://en.wikipedia.org/wiki/Ateji#Related_concepts) (熟字訓). So for example, in our database:

- [<ruby>大人<rt>おとな</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1414170) is jukujikun, and thus has no split.
- In [<ruby>赤<rt>あか</ruby><ruby>啄木鳥<rt>げら</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1829200), 赤 gets the あか portion of the reading, but 啄木鳥 ("woodpecker") is jukujikun and gets げら.

However, a word being noted as jukujikun does not always force grouping. If something documents how the characters divide the reading, our database splits, even where that's debatable:

- [<ruby>博<rt>はか</ruby><ruby>士<rt>せ</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1474620): JMdict tags this reading as jukujikun. But はかせ is an old borrowing of the Chinese word 博士 itself, and [Wiktionary's reading table](https://en.wiktionary.org/w/index.php?title=%E5%8D%9A%E5%A3%AB&oldid=92160459#Japanese) derives はか from 博's はく and せ from 士's し.
- [明日](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1584660) goes both ways in one entry. Read あした, it stays grouped as <ruby>明日<rt>あした</ruby>, since nothing documents a した for 日. Read あす, it splits as <ruby>明<rt>あ</ruby><ruby>日<rt>す</ruby>: あ is 明's stem, as in 明ける, and す is [listed as a name reading of 日](https://jisho.org/search/%E6%97%A5%20%23kanji).

Name readings are the weakest evidence we accept. The obvious objection is that す is only listed for 日 because of 明日 itself, and that may well be its origin. But once such a reading exists, it gets used independently: 日 is す in names like <ruby>愛<rt>あ</ruby><ruby>日<rt>す</ruby><ruby>香<rt>か</ruby>. Similarly, 海 is え in <ruby>国<rt>くに</ruby><ruby>海<rt>え</ruby>, which is why we segment 海老 as `[["海", "え"], ["老", "び"]]`.

### Unwritten particles

Sometimes Japanese words are written as kanji compounds, omitting particles, even though they would always be read with those particles. For example, in our database:

- [<ruby>身代<rt>みのしろ</ruby><ruby>金<rt>きん</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365610) has a natural split of <ruby>身<rt>み</ruby> plus <ruby>代<rt>しろ</ruby> plus <ruby>金<rt>きん</ruby>; the third of these can be placed precisely, but the former two must stay grouped in order to provide a place for the の.
- [<ruby>山手<rt>やまのて</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1755120) has a natural split of <ruby>山<rt>やま</ruby> plus <ruby>手<rt>て</ruby>, but nowhere to put the の, so it stays grouped.

Note that the latter example shows how furigana placement is a function of the (spelling, reading) pair: given the spelling 山の手, which is also present in the same JMdict entry, the same reading can be precisely placed as <ruby>山<rt>やま</ruby>の<ruby>手<rt>て</ruby>.

### Contracted readings

When a word's pronunciation contracts, we keep each piece of the reading with the character it came from, even if that leaves an odd-looking ruby:

- [<ruby>端<rt>はし</ruby><ruby>折<rt>ょ</ruby>る](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1581620) is a contraction of <ruby>端<rt>はし</ruby><ruby>折<rt>お</ruby>る.
- [<ruby>仕<rt>し</ruby><ruby>様<rt>ょう</ruby>がない](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1305510) is a contraction of <ruby>仕<rt>し</ruby><ruby>様<rt>よう</ruby>がない.
- [<ruby>胡<rt>きゅ</ruby><ruby>瓜<rt>うり</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1591500) is a contraction of <ruby>胡<rt>き</ruby><ruby>瓜<rt>うり</ruby>.

### Numerals

There's no clearly-established rule for how to place furigana over digits, especially when zeros are involved. We choose to place furigana over all nonzero digits, keeping the zeros grouped with the digit before them:

- [<ruby>１<rt>せん</ruby><ruby>９<rt>きゅうひゃく</ruby><ruby>８<rt>はちじゅう</ruby><ruby>２<rt>に</ruby><ruby>年<rt>ねん</ruby><ruby>憲<rt>けん</ruby><ruby>法<rt>ぽう</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2521950)
- [<ruby>１<rt>ひゃく</ruby><ruby>８０<rt>はちじゅう</ruby><ruby>度<rt>ど</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1711040)
- [<ruby>１００<rt>ひゃく</ruby><ruby>円<rt>えん</ruby>ショップ](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2100330)

Numbers read digit by digit get one ruby per digit: [<ruby>７<rt>しち</ruby><ruby>５<rt>ご</ruby><ruby>３<rt>さん</ruby>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1319310).

### Tricky pairings

Most records pair a spelling with a reading that simply fits it, and have no `pairing` field. The rest are marked:

| `pairing`       | What it is                                                                      | Should you use it?                 |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| (none)          | A JMdict pair whose reading fits the spelling                                   | Yes                                |
| `"synthesized"` | A fitting reading we added, because JMdict had none                             | Yes                                |
| `"phonetic"`    | A JMdict pair whose reading gives the sound of kana that aren't read as written | Only when annotating pronunciation |
| `"mispaired"`   | A JMdict pair whose reading doesn't belong with the spelling                    | No                                 |

Every spelling has a record of one of the first two kinds, and never both.

#### `"mispaired"`

JMdict marks certain rarer spellings and readings as "search-only". Such spellings and readings are treated as second-class, in that editors are not allowed to add data about spelling/reading restrictions for them (as discussed [in the edit history for 息の長い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960)). So JMdict "allows" pairs whose reading contradicts the spelling. Similarly, [JMdict does not intend to supply readings](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2079440.1~2383149) for all its search-only spellings.

For example:

- The [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230) entry has the きもちよい reading restricted to the 気持ち良い spelling, and thus "disallowed" for the 気持ちよい spelling, even though it's obviously the correct reading. This is because 気持ちよい is marked as search-only, and thus gets second-class treatment.

- The [そっぽを向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120) entry has a そっぽ向く spelling, but no そっぽむく reading, implying that そっぽ向く is read as そっぽ<ruby>向<rt>をむ</ruby>く, even though this is nonsense. Even if JMdict added the そっぽむく reading (which is permitted, but discouraged), the second-class treatment means that そっぽをむく would still be "allowed" for そっぽ向く, since as a search-only form そっぽ向く cannot have any restrictions recorded.

The Precise Furigana database still includes every pair JMdict allows, and its segments always spell out the record's reading exactly. But where the reading contradicts the spelling in a way that helps no reader, the record is marked `"pairing": "mispaired"`:

| Spelling                                                                    | Reading            | Furigana                                                                    | Why it's mispaired                             |
| --------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- | ---------------------------------------------- |
| [息の長い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960)       | いきがながい       | <ruby>息<rt>いき</ruby><ruby>の<rt>が</ruby><ruby>長<rt>なが</ruby>い       | The reading belongs to another spelling        |
| [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230)     | きもちいい         | <ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ち<ruby>よ<rt>い</ruby>い         | The reading belongs to another spelling        |
| [そっぽ向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120)     | そっぽをむく       | そっぽ<ruby>向<rt>をむ</ruby>く                                             | The reading has a particle the spelling omits  |
| [来た見た勝った](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2834251) | きた、みた、かった | <ruby>来<rt>き</ruby>た<ruby>見<rt>、み</ruby>た<ruby>勝<rt>、か</ruby>った | The reading has punctuation the spelling lacks |
| [税金ドロボー](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2047920)   | ぜいきんどろぼう   | <ruby>税<rt>ぜい</ruby><ruby>金<rt>きん</ruby>ドロボ<ruby>ー<rt>う</ruby>   | The reading spells the same sound another way  |

As the last two rows show, not every mispaired record comes from a search-only form.

#### `"synthesized"`

In the Precise Furigana database, every spelling has at least one record whose reading fits it. When JMdict has no such pair, we add a reading, marking the resulting record with `"pairing": "synthesized"`:

| Spelling                                                                    | Reading          | Furigana                                                                |
| --------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| [気持ちよい](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230)     | きもちよい       | <ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ちよい                        |
| [そっぽ向く](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120)     | そっぽむく       | そっぽ<ruby>向<rt>む</ruby>く                                           |
| [来た見た勝った](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2834251) | きたみたかった   | <ruby>来<rt>き</ruby>た<ruby>見<rt>み</ruby>た<ruby>勝<rt>か</ruby>った |
| [税金ドロボー](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2047920)   | ぜいきんドロボー | <ruby>税<rt>ぜい</ruby><ruby>金<rt>きん</ruby>ドロボー                  |
| [宣ふ](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2055480)           | のたまふ         | <ruby>宣<rt>のたま</ruby>ふ                                             |

Some synthesized readings, like そっぽむく, are real pronunciations JMdict is missing due to its second-class treatment of search-only spellings. Others are existing JMdict readings that its restrictions keep from the spelling, like きもちよい. The rest just read the spelling as written, like ぜいきんドロボー and のたまふ.

#### `"phonetic"`

Some spellings contain kana that are pronounced differently from how they're written: historical kana, full-size kana written for small ones, and the particle は. A reading that gives the real sound needs some care. If furigana are being used as a pronunciation aid, such readings can be useful. But most of the time, it looks strange to put furigana over kana. We mark these records `"pairing": "phonetic"`, and each sits beside a record that fits the spelling:

| Spelling                                                            | Reading    | Furigana                                                            | `pairing`       |
| ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- | --------------- |
| [宣ふ](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2055480)   | のたまう   | <ruby>宣<rt>のたま</ruby><ruby>ふ<rt>う</ruby>                      | `"phonetic"`    |
|                                                                     | のたまふ   | <ruby>宣<rt>のたま</ruby>ふ                                         | `"synthesized"` |
| [思ひ出](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1589340) | おもいで   | <ruby>思<rt>おも</ruby><ruby>ひ<rt>い</ruby><ruby>出<rt>で</ruby>   | `"phonetic"`    |
|                                                                     | おもひで   | <ruby>思<rt>おも</ruby>ひ<ruby>出<rt>で</ruby>                      | (none)          |
| [今日は](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1289400) | こんにちわ | <ruby>今<rt>こん</ruby><ruby>日<rt>にち</ruby><ruby>は<rt>わ</ruby> | `"phonetic"`    |
|                                                                     | こんにちは | <ruby>今<rt>こん</ruby><ruby>日<rt>にち</ruby>は                    | (none)          |

If you're annotating pronunciation, use the phonetic record. If you're annotating only kanji, use the other one.

We only do this where the furigana tells the reader something. 税金ドロボー read ぜいきんどろぼう would put う over the ー, which is the same sound, so that record is `"mispaired"` instead.

## Comparison with other furigana databases

I am aware of two other projects in this space: [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) and [Lorenzi's Jisho](https://github.com/hlorenzi/jisho-open). JmdictFurigana is pretty hopeless: it can't segment basic words like 日本 correctly, [and even refused to fix this gap when asked](https://github.com/Doublevil/JmdictFurigana/issues/25). Lorenzi's Jisho is much better, but it [has no license](https://github.com/hlorenzi/jisho-open/issues/10), so it's probably not usable by most software.

Precise Furigana is fully open source, with MIT-licensed code and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) for the data. Additionally, it's updated weekly, following the active edits to JMdict. And, aided by the power of AI to crunch through tons of edge cases, we've managed to get more tricky cases right than the other projects.

| Word           | Precise Furigana                                                                               | Lorenzi                                                                     | JmdictFurigana                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 日本           | <ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby>                                                   | <ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby>                                | <ruby>日本<rt>にほん</ruby>                                                                               |
| 無線ＬＡＮ     | <ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby>                        | <ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby>     | <ruby>無<rt>む</ruby><ruby>線<rt>せ</ruby><ruby>Ｌ<rt>ん</ruby><ruby>Ａ<rt>ラ</ruby><ruby>Ｎ<rt>ン</ruby> |
| 達磨           | <ruby>達<rt>だる</ruby><ruby>磨<rt>ま</ruby>                                                   | <ruby>達<rt>だ</ruby><ruby>磨<rt>るま</ruby>                                | <ruby>達磨<rt>だるま</ruby>                                                                               |
| 御器噛り       | <ruby>御<rt>ご</ruby><ruby>器<rt>っ</ruby><ruby>噛<rt>かぶ</ruby>り                            | <ruby>御器<rt>ごっ</ruby><ruby>噛<rt>かぶ</ruby>り                          | <ruby>御<rt>ごっ</ruby><ruby>器<rt>か</ruby><ruby>噛<rt>ぶ</ruby>り                                       |
| 端折る         | <ruby>端<rt>はし</ruby><ruby>折<rt>ょ</ruby>る                                                 | <ruby>端<rt>は</ruby><ruby>折<rt>しょ</ruby>る                              | <ruby>端<rt>は</ruby><ruby>折<rt>しょ</ruby>る                                                            |
| メーカ希望価格 | メーカ<ruby>希<rt>き</ruby><ruby>望<rt>ぼう</ruby><ruby>価<rt>か</ruby><ruby>格<rt>かく</ruby> | メーカ<ruby>希望価格<rt>ーきぼうかかく</ruby>                               | <i>no entry</i>                                                                                           |
| 道程           | <ruby>道<rt>みち</ruby><ruby>程<rt>のり</ruby>                                                 | <ruby>道<rt>みち</ruby><ruby><rt>の</ruby><ruby>程<rt>り</ruby>             | <i>no entry</i>                                                                                           |
| 前肢           | <ruby>前<rt>まえ</ruby><ruby>肢<rt>あし</ruby>                                                 | <ruby>前<rt>まえあ</ruby><ruby>肢<rt>し</ruby>                              | <i>no entry</i>                                                                                           |
| ２４時間       | <ruby>２<rt>にじゅう</ruby><ruby>４<rt>よ</ruby><ruby>時<rt>じ</ruby><ruby>間<rt>かん</ruby>   | <ruby>２４<rt>にじゅうよ</ruby><ruby>時<rt>じ</ruby><ruby>間<rt>かん</ruby> | <i>no entry</i>                                                                                           |
