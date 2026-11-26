# Precise Furigana

A database that precisely places furigana over every kanji, for every permitted spelling/reading pair in [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), released as a JSON file, updated weekly.

## What is this?

By itself, JMdict just supplies a list of [kanji forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#kanji) and [readings/kana forms](https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict#readings), e.g. for [entry 2852392](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2852392):

- Kanji: <span lang="ja">お誕生日；御誕生日</span>
- Readings: <span lang="ja">おたんじょうび</span>

(We call the kanji forms **spellings**, since many of them aren't purely kanji, e.g., <span lang="ja">お誕生日</span>, <span lang="ja">そっぽ向く</span>, <span lang="ja">無線ＬＡＮ</span>. Words that JMdict writes only in kana, such as <span lang="ja">あおば</span>, use the kana itself as the spelling.)

Most software that just directly consumes JMdict, or otherwise has spelling/reading pairs it wants to display, renders these as <span lang="ja">お<ruby>誕生日<rt>たんじょうび</ruby></span> / <span lang="ja"><ruby>御誕生日<rt>おたんじょうび</ruby></span>. But this looks worse than the proper split of <span lang="ja">お<ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby></span> / <span lang="ja"><ruby>御<rt>お</ruby><ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby></span>. And, I claim, the precisely-placed form is better for building a learner's kanji-reading mental muscles.

With the Precise Furigana database, your software can display any word in JMdict—in fact, any allowed spelling/reading pair in JMdict—with this sort of nice-looking, good-for-learners, precisely-placed furigana!

## Use the data

Each [release](https://github.com/miwakeapp/precise-furigana/releases) has two files. `precise-furigana.zip` (about 7 MB) contains `precise-furigana.json` along with its schema and license notices. `precise-furigana.json.zst` (about 4.5 MB) is the same JSON file alone, compressed with [Zstandard](https://facebook.github.io/zstd/). The corpus contains about 325,000 spelling/reading pairs.

The top-level JSON object's `entries` property contains an object mapping JMdict IDs to lists of spelling/reading/segmentation records. For example, `database.entries["2852392"]` is the following:

<div lang="ja">

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

</div>

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

(Note that `findSegmentation()` picks the first encountered entry with the given spelling and reading, even though multiple might exist: e.g., both [entry 1198910](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1198910) and [entry 1546070](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1546070) contain the spelling <span lang="ja">解ける</span> and the reading <span lang="ja">とける</span>. This is not a problem in practice, as the segmentation is always the same across the entries.)

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

First, you need to determine which JMdict entry is being indicated: is <span lang="ja">辛い</span> meant to be [entry 1365850](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365850) ("spicy") or [entry 1365860](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365860) ("painful")? This is out of scope of this project. You could use traditional morphological tools like [MeCab](https://taku910.github.io/mecab/) + [UniDic](https://clrd.ninjal.ac.jp/unidic/en/), but even with the old Opus 4.6 / ChatGPT 5.2 generation, [LLMs were better](https://arxiv.org/abs/2606.22009), albeit slower and not free.

Even once you have the JMdict ID in hand, you can still get several possibilities: should you transform <span lang="ja">明日</span> into <span lang="ja"><ruby>明日<rt>あした</ruby></span> or <span lang="ja"><ruby>明<rt>あ</ruby><ruby>日<rt>す</ruby></span> or <span lang="ja"><ruby>明<rt>みょう</ruby><ruby>日<rt>にち</ruby></span>?

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

Sometimes Japanese words are written as kanji compounds based only on their meaning, with no correspondence to the kanji's readings: this is known as [jukujikun](https://en.wikipedia.org/wiki/Ateji#Related_concepts) (<span lang="ja">熟字訓</span>). So for example, in our database:

- [<span lang="ja"><ruby>大人<rt>おとな</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1414170) is jukujikun, and thus has no split.
- In [<span lang="ja"><ruby>赤<rt>あか</ruby><ruby>啄木鳥<rt>げら</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1829200), <span lang="ja">赤</span> gets the <span lang="ja">あか</span> portion of the reading, but <span lang="ja">啄木鳥</span> ("woodpecker") is jukujikun and gets <span lang="ja">げら</span>.

However, a word being noted as jukujikun does not always force grouping. If something documents how the characters divide the reading, our database splits, even where that's debatable:

- [<span lang="ja"><ruby>博<rt>はか</ruby><ruby>士<rt>せ</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1474620): JMdict tags this reading as jukujikun. But <span lang="ja">はかせ</span> is an old borrowing of the Chinese word <span lang="ja">博士</span> itself, and [Wiktionary's reading table](https://en.wiktionary.org/w/index.php?title=%E5%8D%9A%E5%A3%AB&oldid=92160459#Japanese) derives <span lang="ja">はか</span> from <span lang="ja">博</span>'s <span lang="ja">はく</span> and <span lang="ja">せ</span> from <span lang="ja">士</span>'s <span lang="ja">し</span>.
- [<span lang="ja">明日</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1584660) goes both ways in one entry. Read <span lang="ja">あした</span>, it stays grouped as <span lang="ja"><ruby>明日<rt>あした</ruby></span>, since nothing documents a <span lang="ja">した</span> for <span lang="ja">日</span>. Read <span lang="ja">あす</span>, it splits as <span lang="ja"><ruby>明<rt>あ</ruby><ruby>日<rt>す</ruby></span>: <span lang="ja">あ</span> is <span lang="ja">明</span>'s stem, as in <span lang="ja">明ける</span>, and <span lang="ja">す</span> is [listed as a name reading of <span lang="ja">日</span>](https://jisho.org/search/%E6%97%A5%20%23kanji).

Name readings are the weakest evidence we accept. The obvious objection is that <span lang="ja">す</span> is only listed for <span lang="ja">日</span> because of <span lang="ja">明日</span> itself, and that may well be its origin. But once such a reading exists, it gets used independently: <span lang="ja">日</span> is <span lang="ja">す</span> in names like <span lang="ja"><ruby>愛<rt>あ</ruby><ruby>日<rt>す</ruby><ruby>香<rt>か</ruby></span>. Similarly, <span lang="ja">海</span> is <span lang="ja">え</span> in <span lang="ja"><ruby>国<rt>くに</ruby><ruby>海<rt>え</ruby></span>, which is why we segment <span lang="ja">海老</span> as <code lang="ja">[["海", "え"], ["老", "び"]]</code>.

### Unwritten particles

Sometimes Japanese words are written as kanji compounds, omitting particles, even though they would always be read with those particles. For example, in our database:

- [<span lang="ja"><ruby>身代<rt>みのしろ</ruby><ruby>金<rt>きん</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1365610) has a natural split of <span lang="ja"><ruby>身<rt>み</ruby></span> plus <span lang="ja"><ruby>代<rt>しろ</ruby></span> plus <span lang="ja"><ruby>金<rt>きん</ruby></span>; the third of these can be placed precisely, but the former two must stay grouped in order to provide a place for the <span lang="ja">の</span>.
- [<span lang="ja"><ruby>山手<rt>やまのて</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1755120) has a natural split of <span lang="ja"><ruby>山<rt>やま</ruby></span> plus <span lang="ja"><ruby>手<rt>て</ruby></span>, but nowhere to put the <span lang="ja">の</span>, so it stays grouped.

Note that the latter example shows how furigana placement is a function of the (spelling, reading) pair: given the spelling <span lang="ja">山の手</span>, which is also present in the same JMdict entry, the same reading can be precisely placed as <span lang="ja"><ruby>山<rt>やま</ruby>の<ruby>手<rt>て</ruby></span>.

### Contracted readings

When a word's pronunciation contracts, we keep each piece of the reading with the character it came from, even if that leaves an odd-looking ruby:

- [<span lang="ja"><ruby>端<rt>はし</ruby><ruby>折<rt>ょ</ruby>る</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1581620) is a contraction of <span lang="ja"><ruby>端<rt>はし</ruby><ruby>折<rt>お</ruby>る</span>.
- [<span lang="ja"><ruby>仕<rt>し</ruby><ruby>様<rt>ょう</ruby>がない</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1305510) is a contraction of <span lang="ja"><ruby>仕<rt>し</ruby><ruby>様<rt>よう</ruby>がない</span>.
- [<span lang="ja"><ruby>胡<rt>きゅ</ruby><ruby>瓜<rt>うり</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1591500) is a contraction of <span lang="ja"><ruby>胡<rt>き</ruby><ruby>瓜<rt>うり</ruby></span>.

### Numerals

There's no clearly-established rule for how to place furigana over digits, especially when zeros are involved. We choose to place furigana over all nonzero digits, keeping the zeros grouped with the digit before them:

- [<span lang="ja"><ruby>１<rt>せん</ruby><ruby>９<rt>きゅうひゃく</ruby><ruby>８<rt>はちじゅう</ruby><ruby>２<rt>に</ruby><ruby>年<rt>ねん</ruby><ruby>憲<rt>けん</ruby><ruby>法<rt>ぽう</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2521950)
- [<span lang="ja"><ruby>１<rt>ひゃく</ruby><ruby>８０<rt>はちじゅう</ruby><ruby>度<rt>ど</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1711040)
- [<span lang="ja"><ruby>１００<rt>ひゃく</ruby><ruby>円<rt>えん</ruby>ショップ</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2100330)

Numbers read digit by digit get one ruby per digit: [<span lang="ja"><ruby>７<rt>しち</ruby><ruby>５<rt>ご</ruby><ruby>３<rt>さん</ruby></span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1319310).

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

JMdict marks certain rarer spellings and readings as "search-only". Such spellings and readings are treated as second-class, in that editors are not allowed to add data about spelling/reading restrictions for them (as discussed [in the edit history for <span lang="ja">息の長い</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960)). So JMdict "allows" pairs whose reading contradicts the spelling. Similarly, [JMdict does not intend to supply readings](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2079440.1~2383149) for all its search-only spellings.

For example:

- The [<span lang="ja">気持ちよい</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230) entry has the <span lang="ja">きもちよい</span> reading restricted to the <span lang="ja">気持ち良い</span> spelling, and thus "disallowed" for the <span lang="ja">気持ちよい</span> spelling, even though it's obviously the correct reading. This is because <span lang="ja">気持ちよい</span> is marked as search-only, and thus gets second-class treatment.

- The [<span lang="ja">そっぽを向く</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120) entry has a <span lang="ja">そっぽ向く</span> spelling, but no <span lang="ja">そっぽむく</span> reading, implying that <span lang="ja">そっぽ向く</span> is read as <span lang="ja">そっぽ<ruby>向<rt>をむ</ruby>く</span>, even though this is nonsense. Even if JMdict added the <span lang="ja">そっぽむく</span> reading (which is permitted, but discouraged), the second-class treatment means that <span lang="ja">そっぽをむく</span> would still be "allowed" for <span lang="ja">そっぽ向く</span>, since as a search-only form <span lang="ja">そっぽ向く</span> cannot have any restrictions recorded.

The Precise Furigana database still includes every pair JMdict allows, and its segments always spell out the record's reading exactly. But where the reading contradicts the spelling in a way that helps no reader, the record is marked `"pairing": "mispaired"`:

| Spelling                                                                                           | Reading                                   | Furigana                                                                                           | Why it's mispaired                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [<span lang="ja">息の長い</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2405960)       | <span lang="ja">いきがながい</span>       | <span lang="ja"><ruby>息<rt>いき</ruby><ruby>の<rt>が</ruby><ruby>長<rt>なが</ruby>い</span>       | The reading belongs to another spelling        |
| [<span lang="ja">気持ちよい</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230)     | <span lang="ja">きもちいい</span>         | <span lang="ja"><ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ち<ruby>よ<rt>い</ruby>い</span>         | The reading belongs to another spelling        |
| [<span lang="ja">そっぽ向く</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120)     | <span lang="ja">そっぽをむく</span>       | <span lang="ja">そっぽ<ruby>向<rt>をむ</ruby>く</span>                                             | The reading has a particle the spelling omits  |
| [<span lang="ja">来た見た勝った</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2834251) | <span lang="ja">きた、みた、かった</span> | <span lang="ja"><ruby>来<rt>き</ruby>た<ruby>見<rt>、み</ruby>た<ruby>勝<rt>、か</ruby>った</span> | The reading has punctuation the spelling lacks |
| [<span lang="ja">税金ドロボー</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2047920)   | <span lang="ja">ぜいきんどろぼう</span>   | <span lang="ja"><ruby>税<rt>ぜい</ruby><ruby>金<rt>きん</ruby>ドロボ<ruby>ー<rt>う</ruby></span>   | The reading spells the same sound another way  |

As the last two rows show, not every mispaired record comes from a search-only form.

#### `"synthesized"`

In the Precise Furigana database, every spelling has at least one record whose reading fits it. When JMdict has no such pair, we add a reading, marking the resulting record with `"pairing": "synthesized"`:

| Spelling                                                                                           | Reading                                 | Furigana                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [<span lang="ja">気持ちよい</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1222230)     | <span lang="ja">きもちよい</span>       | <span lang="ja"><ruby>気<rt>き</ruby><ruby>持<rt>も</ruby>ちよい</span>                        |
| [<span lang="ja">そっぽ向く</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2207120)     | <span lang="ja">そっぽむく</span>       | <span lang="ja">そっぽ<ruby>向<rt>む</ruby>く</span>                                           |
| [<span lang="ja">来た見た勝った</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2834251) | <span lang="ja">きたみたかった</span>   | <span lang="ja"><ruby>来<rt>き</ruby>た<ruby>見<rt>み</ruby>た<ruby>勝<rt>か</ruby>った</span> |
| [<span lang="ja">税金ドロボー</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2047920)   | <span lang="ja">ぜいきんドロボー</span> | <span lang="ja"><ruby>税<rt>ぜい</ruby><ruby>金<rt>きん</ruby>ドロボー</span>                  |
| [<span lang="ja">宣ふ</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2055480)           | <span lang="ja">のたまふ</span>         | <span lang="ja"><ruby>宣<rt>のたま</ruby>ふ</span>                                             |

Some synthesized readings, like <span lang="ja">そっぽむく</span>, are real pronunciations JMdict is missing due to its second-class treatment of search-only spellings. Others are existing JMdict readings that its restrictions keep from the spelling, like <span lang="ja">きもちよい</span>. The rest just read the spelling as written, like <span lang="ja">ぜいきんドロボー</span> and <span lang="ja">のたまふ</span>.

#### `"phonetic"`

Some spellings contain kana that are pronounced differently from how they're written: historical kana, full-size kana written for small ones, and the particle <span lang="ja">は</span>. A reading that gives the real sound needs some care. If furigana are being used as a pronunciation aid, such readings can be useful. But most of the time, it looks strange to put furigana over kana. We mark these records `"pairing": "phonetic"`, and each sits beside a record that fits the spelling:

| Spelling                                                                                   | Reading                           | Furigana                                                                                   | `pairing`       |
| ------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| [<span lang="ja">宣ふ</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2055480)   | <span lang="ja">のたまう</span>   | <span lang="ja"><ruby>宣<rt>のたま</ruby><ruby>ふ<rt>う</ruby></span>                      | `"phonetic"`    |
|                                                                                            | <span lang="ja">のたまふ</span>   | <span lang="ja"><ruby>宣<rt>のたま</ruby>ふ</span>                                         | `"synthesized"` |
| [<span lang="ja">思ひ出</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1589340) | <span lang="ja">おもいで</span>   | <span lang="ja"><ruby>思<rt>おも</ruby><ruby>ひ<rt>い</ruby><ruby>出<rt>で</ruby></span>   | `"phonetic"`    |
|                                                                                            | <span lang="ja">おもひで</span>   | <span lang="ja"><ruby>思<rt>おも</ruby>ひ<ruby>出<rt>で</ruby></span>                      | (none)          |
| [<span lang="ja">今日は</span>](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1289400) | <span lang="ja">こんにちわ</span> | <span lang="ja"><ruby>今<rt>こん</ruby><ruby>日<rt>にち</ruby><ruby>は<rt>わ</ruby></span> | `"phonetic"`    |
|                                                                                            | <span lang="ja">こんにちは</span> | <span lang="ja"><ruby>今<rt>こん</ruby><ruby>日<rt>にち</ruby>は</span>                    | (none)          |

If you're annotating pronunciation, use the phonetic record. If you're annotating only kanji, use the other one.

We only do this where the furigana tells the reader something. <span lang="ja">税金ドロボー</span> read <span lang="ja">ぜいきんどろぼう</span> would put <span lang="ja">う</span> over the <span lang="ja">ー</span>, which is the same sound, so that record is `"mispaired"` instead.

## Comparison with other furigana databases

I am aware of two other projects in this space: [Doublevil/JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) and [Lorenzi's Jisho](https://github.com/hlorenzi/jisho-open). JmdictFurigana is pretty hopeless: it can't segment basic words like <span lang="ja">日本</span> correctly, [and even refused to fix this gap when asked](https://github.com/Doublevil/JmdictFurigana/issues/25). Lorenzi's Jisho is much better, but it [has no license](https://github.com/hlorenzi/jisho-open/issues/10), so it's probably not usable by most software.

Precise Furigana is fully open source, with MIT-licensed code and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) for the data. Additionally, it's updated weekly, following the active edits to JMdict. And, aided by the power of AI to crunch through tons of edge cases, we've managed to get more tricky cases right than the other projects.

| Word                                  | Precise Furigana                                                                                                      | Lorenzi                                                                                            | JmdictFurigana                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| <span lang="ja">日本</span>           | <span lang="ja"><ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby></span>                                                   | <span lang="ja"><ruby>日<rt>に</ruby><ruby>本<rt>ほん</ruby></span>                                | <span lang="ja"><ruby>日本<rt>にほん</ruby></span>                                                                               |
| <span lang="ja">無線ＬＡＮ</span>     | <span lang="ja"><ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby></span>                        | <span lang="ja"><ruby>無<rt>む</ruby><ruby>線<rt>せん</ruby><ruby>ＬＡＮ<rt>ラン</ruby></span>     | <span lang="ja"><ruby>無<rt>む</ruby><ruby>線<rt>せ</ruby><ruby>Ｌ<rt>ん</ruby><ruby>Ａ<rt>ラ</ruby><ruby>Ｎ<rt>ン</ruby></span> |
| <span lang="ja">達磨</span>           | <span lang="ja"><ruby>達<rt>だる</ruby><ruby>磨<rt>ま</ruby></span>                                                   | <span lang="ja"><ruby>達<rt>だ</ruby><ruby>磨<rt>るま</ruby></span>                                | <span lang="ja"><ruby>達磨<rt>だるま</ruby></span>                                                                               |
| <span lang="ja">御器噛り</span>       | <span lang="ja"><ruby>御<rt>ご</ruby><ruby>器<rt>っ</ruby><ruby>噛<rt>かぶ</ruby>り</span>                            | <span lang="ja"><ruby>御器<rt>ごっ</ruby><ruby>噛<rt>かぶ</ruby>り</span>                          | <span lang="ja"><ruby>御<rt>ごっ</ruby><ruby>器<rt>か</ruby><ruby>噛<rt>ぶ</ruby>り</span>                                       |
| <span lang="ja">端折る</span>         | <span lang="ja"><ruby>端<rt>はし</ruby><ruby>折<rt>ょ</ruby>る</span>                                                 | <span lang="ja"><ruby>端<rt>は</ruby><ruby>折<rt>しょ</ruby>る</span>                              | <span lang="ja"><ruby>端<rt>は</ruby><ruby>折<rt>しょ</ruby>る</span>                                                            |
| <span lang="ja">メーカ希望価格</span> | <span lang="ja">メーカ<ruby>希<rt>き</ruby><ruby>望<rt>ぼう</ruby><ruby>価<rt>か</ruby><ruby>格<rt>かく</ruby></span> | <span lang="ja">メーカ<ruby>希望価格<rt>ーきぼうかかく</ruby></span>                               | <i>no entry</i>                                                                                                                  |
| <span lang="ja">道程</span>           | <span lang="ja"><ruby>道<rt>みち</ruby><ruby>程<rt>のり</ruby></span>                                                 | <span lang="ja"><ruby>道<rt>みち</ruby><ruby><rt>の</ruby><ruby>程<rt>り</ruby></span>             | <i>no entry</i>                                                                                                                  |
| <span lang="ja">前肢</span>           | <span lang="ja"><ruby>前<rt>まえ</ruby><ruby>肢<rt>あし</ruby></span>                                                 | <span lang="ja"><ruby>前<rt>まえあ</ruby><ruby>肢<rt>し</ruby></span>                              | <i>no entry</i>                                                                                                                  |
| <span lang="ja">２４時間</span>       | <span lang="ja"><ruby>２<rt>にじゅう</ruby><ruby>４<rt>よ</ruby><ruby>時<rt>じ</ruby><ruby>間<rt>かん</ruby></span>   | <span lang="ja"><ruby>２４<rt>にじゅうよ</ruby><ruby>時<rt>じ</ruby><ruby>間<rt>かん</ruby></span> | <i>no entry</i>                                                                                                                  |
