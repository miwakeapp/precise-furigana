import assert from "node:assert/strict";
import test from "node:test";
import { deriveListedPhonologyAlignments } from "../src/listed-phonology.ts";
import { boundaries } from "../src/segments.ts";
import { compileLexicalEvidence } from "../src/lexical-evidence.ts";
import * as fixture from "./support/dictionaries.ts";
import type { CharacterReadingBundle, CharacterReadingRecord } from "../src/character-readings.ts";
import type { LexicalFact } from "../src/lexical-evidence.ts";
import type {
  KanjidicSoundClaim,
  ListedPhonologyOptions,
  ListedPhonologyWitness,
  ListedReadingWitness,
  PooledSoundWitness,
  ReusableSoundClaim,
  WeakSoundClaim,
} from "../src/listed-phonology.ts";
import type { WeakReadingWitness } from "../src/weak-readings.ts";
import type {
  Aligner,
  Alignment,
  JMdict,
  Kanjidic2Reading,
  PassResult,
  ReadingMap,
  Segment,
} from "../src/types.ts";

type SingleKanjiClaim = Extract<WeakSoundClaim, { category: "JMdict single-kanji spelling" }>;

const entry = (id: string, spelling: string, reading: string, tags: string[] = []) =>
  fixture.jmdictWord({
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags, appliesToKanji: ["*"] }],
  });
const grouped: Aligner = (spelling, reading) => ({
  status: "aligned",
  segments: [[spelling, reading]],
});
const form = (
  character: string,
  reading: string,
  kind: "on" | "kun" = "on",
  extra: Partial<CharacterReadingRecord> = {},
): CharacterReadingRecord => ({
  character,
  reading,
  kind,
  originalForm: reading,
  tags: [kind, "transliteration"],
  ...extra,
});
const bundle = (
  readings: CharacterReadingRecord[],
  publisher = "Japanese Wiktionary",
): CharacterReadingBundle => ({
  schemaVersion: 1,
  source: { name: `${publisher} fixture`, publisher, version: "fixture-1", sha256: "a".repeat(64) },
  readings,
});
const lookup = (result: PassResult, spelling: string, reading: string) =>
  result.wordAlignments.get(spelling)?.get(reading);

test("listed on phonology preserves raw source identity and actual publisher", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "愛惜", "アイジャク"), entry("2", "外戚", "げさく")],
  });
  const sourceForm = form("惜", "シャク", "on", {
    originalForm: "しゃく",
    rawSourceForm: "しゃく<しやく",
    sourceParameter: "goon",
    revisionId: 123,
    revisionURL: "https://en.wiktionary.org/w/index.php?oldid=123",
  });
  const english = bundle([sourceForm], "English Wiktionary");
  const japanese = bundle([form("戚", "シャク")]);
  const result = deriveListedPhonologyAlignments(
    jmdict,
    new Map([
      ["愛", ["アイ"]],
      ["外", ["ゲ"]],
    ]),
    grouped,
    {
      characterReadingBundle: japanese,
      englishCharacterReadingBundle: english,
    },
  );
  assert.deepEqual(lookup(result, "愛惜", "アイジャク"), [
    ["愛", "アイ"],
    ["惜", "ジャク"],
  ]);
  assert.deepEqual(lookup(result, "外戚", "げさく"), [
    ["外", "げ"],
    ["戚", "さく"],
  ]);
  const [voicing, yoon] = (result.witnesses as ListedReadingWitness[]).map(
    (witness) => witness.characters[0].evidence[0],
  );
  assert.equal(voicing.source, "English Wiktionary");
  assert.deepEqual(voicing.form, sourceForm);
  assert.deepEqual(voicing.sourceIdentity, english.source);
  assert.deepEqual(voicing.rules, ["initial-voicing"]);
  assert.equal(yoon.source, "Japanese Wiktionary");
  assert.deepEqual(yoon.rules, ["yoon-simplification"]);
  assert.equal(JSON.stringify(result.witnesses).includes("kJapanese"), false);
});

test("exact readings precede competing phonology and retain every source claim", () => {
  const jmdict = fixture.jmdict({ words: [entry("1", "甲乙", "そうき")] });
  const primary = new Map([["乙", ["ウキ", "キ"]]]);
  const options = {
    unihanReadings: new Map([["甲", ["ソ"]]]),
    characterReadingBundle: bundle([form("甲", "ソ"), form("甲", "ショウ")]),
    englishCharacterReadingBundle: bundle([form("甲", "ソ")], "English Wiktionary"),
    unihanSource: { version: "18.0.0", sha256: "b".repeat(64), textSHA256: "c".repeat(64) },
  } satisfies ListedPhonologyOptions;
  const result = deriveListedPhonologyAlignments(jmdict, primary, grouped, options);
  assert.deepEqual(lookup(result, "甲乙", "そうき"), [
    ["甲", "そ"],
    ["乙", "うき"],
  ]);
  const evidence = (result.witnesses[0] as ListedReadingWitness).characters[0].evidence;
  assert.deepEqual(
    evidence.map((value) => value.source),
    ["Unihan", "Japanese Wiktionary", "English Wiktionary"],
  );
  assert.ok(evidence.every((value) => value.rules.length === 0));
  assert.deepEqual(evidence[0].sourceIdentity, options.unihanSource);
  assert.equal(evidence[0].field, "kJapanese");
  assert.deepEqual(options.unihanReadings.get("甲"), ["ソ"]);
});

test("unknown Unihan upstream identity is represented only by a stable map fingerprint", () => {
  const jmdict = fixture.jmdict({ words: [entry("1", "甲乙", "そき")] });
  const primary = new Map([["乙", ["キ"]]]);
  const run = (unihanReadings: ReadingMap) =>
    (
      deriveListedPhonologyAlignments(jmdict, primary, grouped, { unihanReadings })
        .witnesses[0] as ListedReadingWitness
    ).characters[0].evidence[0].sourceIdentity;
  const left = run(
    new Map([
      ["甲", ["ソ", "ショ"]],
      ["丙", ["ヘイ"]],
    ]),
  );
  const right = run(
    new Map([
      ["丙", ["ヘイ"]],
      ["甲", ["ショ", "ソ"]],
    ]),
  );
  assert.deepEqual(left, right);
  assert.match(left.readingsSHA256 as string, /^[\da-f]{64}$/u);
  assert.equal(left.version, undefined);
  assert.equal(left.sha256, undefined);
});

test("old boundaries and nonaligned statuses remain protected", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "前愛惜", "ぜんあいじゃく"), entry("2", "愛惜", "あいじゃく")],
  });
  const prior: Alignment = {
    status: "aligned",
    segments: [
      ["前", "ぜん"],
      ["愛惜", "あいじゃく"],
    ],
  };
  const align: Aligner = (spelling, reading) =>
    spelling === "前愛惜" ? prior : { ...grouped(spelling, reading), status: "ambiguous" };
  const result = deriveListedPhonologyAlignments(
    jmdict,
    new Map([
      ["前", ["ゼン"]],
      ["愛", ["アイ"]],
    ]),
    align,
    {
      englishCharacterReadingBundle: bundle([form("惜", "シャク")], "English Wiktionary"),
    },
  );
  assert.ok(boundaries(lookup(result, "前愛惜", "ぜんあいじゃく")!).includes("1:2"));
  assert.equal(result.wordAlignments.has("愛惜"), false);
  assert.deepEqual(prior, {
    status: "aligned",
    segments: [
      ["前", "ぜん"],
      ["愛惜", "あいじゃく"],
    ],
  });
});

test("kun and marked prefix evidence remains exact and cannot acquire on phonology", () => {
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "甲乙", "がき"),
      entry("2", "甲乙", "かあき"),
      entry("3", "丙乙", "あつめき"),
      entry("4", "甲乙", "かき"),
    ],
  });
  const result = deriveListedPhonologyAlignments(jmdict, new Map([["乙", ["キ"]]]), grouped, {
    englishCharacterReadingBundle: bundle(
      [
        form("甲", "か", "kun", {
          rawSourceForm: "か-る",
          sourceSuffix: "る",
          boundaryStatus: "explicit-prefix",
        }),
        form("丙", "あつめる", "kun"),
      ],
      "English Wiktionary",
    ),
  });
  assert.deepEqual(lookup(result, "甲乙", "かき"), [
    ["甲", "か"],
    ["乙", "き"],
  ]);
  for (const reading of ["がき", "かあき"])
    assert.equal(lookup(result, "甲乙", reading), undefined);
  assert.equal(result.wordAlignments.has("丙乙"), false);
});

test("typed final sokuon checks the following original word across old boundaries", () => {
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "乙甲子", "おつかっし"),
      entry("2", "乙甲名", "おつかっな"),
      entry("3", "乙甲", "おつかっ"),
    ],
  });
  const primary = new Map([
    ["乙", ["オツ"]],
    ["子", ["シ"]],
    ["名", ["ナ"]],
  ]);
  const align: Aligner = (spelling, reading) =>
    spelling.length === 3
      ? {
          status: "aligned",
          segments: [
            ["乙甲", "おつかっ"],
            [spelling[2], reading.at(-1)!],
          ],
        }
      : grouped(spelling, reading);
  const result = deriveListedPhonologyAlignments(jmdict, primary, align, {
    characterReadingBundle: bundle([form("甲", "カッ")]),
  });
  assert.deepEqual(lookup(result, "乙甲子", "おつかっし"), [
    ["乙", "おつ"],
    ["甲", "かっ"],
    ["子", "し"],
  ]);
  assert.equal(result.wordAlignments.has("乙甲名"), false);
  assert.equal(result.wordAlignments.has("乙甲"), false);
});

test("derived gemination requires its following obstruent and respects the switch", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "甲乙", "こっき"), entry("2", "甲丙", "こっあ")],
  });
  const primary = new Map([
    ["乙", ["キ"]],
    ["丙", ["ア"]],
  ]);
  const options = { characterReadingBundle: bundle([form("甲", "コク")]) };
  const result = deriveListedPhonologyAlignments(jmdict, primary, grouped, options);
  assert.deepEqual(lookup(result, "甲乙", "こっき"), [
    ["甲", "こっ"],
    ["乙", "き"],
  ]);
  assert.deepEqual((result.witnesses[0] as ListedReadingWitness).characters[0].evidence[0].rules, [
    "sokuon",
  ]);
  assert.equal(result.wordAlignments.has("甲丙"), false);
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, primary, grouped, {
      ...options,
      supplementalVoicing: false,
    }).wordAlignments.size,
    0,
  );
});

test("lengthening uses exact companions and preserves actual iteration sound", () => {
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "馬油", "マーユ"),
      entry("2", "戸々", "ここう"),
      entry("3", "甲乙", "くうじゃく"),
    ],
  });
  const options = {
    characterReadingBundle: bundle([
      form("馬", "マ"),
      form("戸", "コ"),
      form("甲", "ク"),
      form("乙", "シャク"),
    ]),
  };
  const primary = new Map([["油", ["ユ"]]]);
  const result = deriveListedPhonologyAlignments(jmdict, primary, grouped, options);
  assert.deepEqual(lookup(result, "馬油", "マーユ"), [
    ["馬", "マー"],
    ["油", "ユ"],
  ]);
  assert.deepEqual((result.witnesses[0] as ListedReadingWitness).characters[0].evidence[0].rules, [
    "single-mora-vowel-extension",
  ]);
  assert.equal(result.wordAlignments.has("戸々"), false);
  assert.equal(result.wordAlignments.has("甲乙"), false);
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, primary, grouped, { ...options, onLengthening: false })
      .wordAlignments.size,
    0,
  );
});

test("ambiguous paths and irregular ranges cannot be resolved by listed phonology", () => {
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "甲乙", "そうき"),
      entry("2", "愛惜", "あいじゃく", ["gikun"]),
      entry("3", "前愛惜", "ぜんあいじゃく"),
    ],
  });
  const result = deriveListedPhonologyAlignments(
    jmdict,
    new Map([
      ["乙", ["ウキ", "キ"]],
      ["前", ["ゼン"]],
      ["愛", ["アイ"]],
    ]),
    grouped,
    {
      characterReadingBundle: bundle([
        form("甲", "ショ"),
        form("甲", "ショウ"),
        form("惜", "シャク"),
      ]),
    },
  );
  assert.equal(result.wordAlignments.size, 0);
});

test("arguments reject malformed maps, bundles, identities and null defaults", () => {
  const jmdict = fixture.jmdict({ words: [] }),
    primary = new Map();
  for (const options of [
    { weakCharacterReadings: null },
    { unihanReadings: new Map([["甲乙", ["カ"]]]) },
    { unihanReadings: new Map([["甲", ["か.り"]]]) },
    { supplementalVoicing: null },
    { characterReadingBundle: null },
    { characterReadingBundle: bundle([form("甲", "カ", "kun")]) },
    { unihanSource: { version: "18.0.0", sha256: "unverified" } },
  ])
    assert.throws(
      // @ts-expect-error: every one of these options is malformed.
      () => deriveListedPhonologyAlignments(jmdict, primary, grouped, options),
      TypeError,
    );
  // @ts-expect-error: a missing dictionary must be rejected.
  assert.throws(() => deriveListedPhonologyAlignments(undefined, primary, grouped), TypeError);
  // @ts-expect-error: a missing aligner must be rejected.
  assert.throws(() => deriveListedPhonologyAlignments(jmdict, primary, undefined), TypeError);
  assert.throws(
    () => deriveListedPhonologyAlignments(jmdict, new Map([["甲", ["invalid"]]]), grouped),
    TypeError,
  );
  assert.deepEqual(
    deriveListedPhonologyAlignments(jmdict, primary, grouped, { supplementalVoicing: undefined }),
    { wordAlignments: new Map(), witnesses: [] },
  );
});

const kanjidicCharacter = (
  literal: string,
  readings: fixture.Loose<Kanjidic2Reading>[] = [],
  nanori: string[] = [],
) =>
  fixture.kanjidicCharacter({
    literal,
    readingMeaning: { groups: [{ readings }], nanori },
  });
const pooledWitness = (result: PassResult<ListedPhonologyWitness>, spelling: string) =>
  result.witnesses.find(
    (witness): witness is PooledSoundWitness =>
      witness.spelling === spelling && witness.interpretation.startsWith("Unique exact allocation"),
  );

test("complete explicit nanori allocations remain valid outside names and retain source identities", () => {
  const jmdict = fixture.jmdict({ words: [entry("1", "甲乙", "あい", ["gikun"])] });
  const kanjidic = fixture.kanjidic({
    characters: [kanjidicCharacter("甲", [], ["あ"]), kanjidicCharacter("乙", [], ["い"])],
  });
  const weakWitnesses: WeakReadingWitness[] = [
    { spelling: "甲", reading: "あ", source: "KANJIDIC2 nanori" },
    { spelling: "乙", reading: "い", source: "KANJIDIC2 nanori" },
  ];
  const options = {
    kanjidic,
    weakWitnesses,
    kanjidicSource: { version: "fixture", jsonSHA256: "d".repeat(64) },
  };
  const before = structuredClone(options);
  const result = deriveListedPhonologyAlignments(jmdict, new Map(), grouped, options);
  assert.deepEqual(lookup(result, "甲乙", "あい"), [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  const witness = pooledWitness(result, "甲乙")!;
  assert.equal(witness.characters.length, 2);
  for (const character of witness.characters) {
    assert.equal(character.newlyAllocated, true);
    assert.equal(character.evidence[0].category, "KANJIDIC2 nanori");
    assert.deepEqual(
      (character.evidence[0] as WeakSoundClaim).sourceIdentity,
      options.kanjidicSource,
    );
    assert.equal((character.evidence[0] as WeakSoundClaim).witness.spelling, character.spelling);
  }
  assert.deepEqual(options, before);
});

test("JMdict-derived weak sounds require an independent witness and a multi-Han target", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "甲い", "アイ"), entry("2", "甲乙", "あい")],
  });
  const kanjidic = fixture.kanjidic({
    characters: [kanjidicCharacter("乙", [{ type: "ja_on", value: "イ" }])],
  });
  const weakWitnesses: WeakReadingWitness[] = [
    {
      spelling: "甲",
      reading: "あ",
      source: "JMdict single-kanji spelling",
      witness: { id: "3", spelling: "甲い", reading: "あい" },
    },
    {
      spelling: "甲",
      reading: "あ",
      source: "JMdict single-kanji spelling",
      witness: { id: "4", spelling: "甲う", reading: "あう" },
    },
    {
      spelling: "甲",
      reading: "あ",
      source: "JMdict single-kanji spelling",
      witness: { id: "5", spelling: "甲乙", reading: "アイ" },
    },
  ];
  const result = deriveListedPhonologyAlignments(jmdict, new Map([["乙", ["イ"]]]), grouped, {
    kanjidic,
    weakWitnesses,
  });
  assert.equal(lookup(result, "甲い", "アイ"), undefined);
  assert.deepEqual(lookup(result, "甲乙", "あい"), [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  const claims = pooledWitness(result, "甲乙")!.characters[0].evidence as SingleKanjiClaim[];
  assert.deepEqual(
    claims.map((claim) => claim.witness.witness.id),
    ["3", "4"],
  );
  assert.ok(
    claims.every((claim) => /^[a-f0-9]{64}$/u.test(claim.sourceIdentity.readingsSHA256 as string)),
  );
});

test("pooled Korean sounds retain contextual voicing across old cuts and reset after non-Korean units", () => {
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "甲乙", "なが"),
      entry("2", "甲乙", "なか"),
      entry("3", "甲丙乙", "ないか"),
      entry("4", "甲丙乙", "ないが"),
    ],
  });
  const kanjidic = fixture.kanjidic({
    characters: [
      kanjidicCharacter("甲", [{ type: "korean_h", value: "나" }]),
      kanjidicCharacter("乙", [{ type: "korean_h", value: "가" }]),
      kanjidicCharacter("丙", [{ type: "ja_on", value: "イ" }]),
    ],
  });
  const align: Aligner = (spelling, reading) =>
    spelling === "甲丙乙"
      ? {
          status: "aligned",
          segments: [
            ["甲", "な"],
            ["丙乙", reading.slice(1)],
          ],
        }
      : grouped(spelling, reading);
  const result = deriveListedPhonologyAlignments(jmdict, new Map([["丙", ["イ"]]]), align, {
    kanjidic,
  });
  assert.deepEqual(lookup(result, "甲乙", "なが"), [
    ["甲", "な"],
    ["乙", "が"],
  ]);
  assert.equal(lookup(result, "甲乙", "なか"), undefined);
  assert.deepEqual(lookup(result, "甲丙乙", "ないか"), [
    ["甲", "な"],
    ["丙", "い"],
    ["乙", "か"],
  ]);
  assert.equal(lookup(result, "甲丙乙", "ないが"), undefined);
  assert.ok(boundaries(lookup(result, "甲丙乙", "ないか")!).includes("1:1"));
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, new Map(), grouped, { kanjidic, koreanReadings: false })
      .wordAlignments.size,
    0,
  );
});

test("equal Korean kana do not merge raw states with different following-syllable compatibility", () => {
  const jmdict = fixture.jmdict({ words: [entry("1", "甲乙", "けんあ")] });
  const kanjidic = fixture.kanjidic({
    characters: [
      kanjidicCharacter("甲", [
        { type: "korean_h", value: "갠" },
        { type: "korean_h", value: "갱" },
      ]),
      kanjidicCharacter("乙", [{ type: "korean_h", value: "아" }]),
    ],
  });
  const result = deriveListedPhonologyAlignments(jmdict, new Map(), grouped, { kanjidic });
  assert.deepEqual(lookup(result, "甲乙", "けんあ"), [
    ["甲", "けん"],
    ["乙", "あ"],
  ]);
  assert.deepEqual(
    pooledWitness(result, "甲乙")!.characters[0].evidence.map(
      (claim) => (claim as KanjidicSoundClaim).form.value,
    ),
    ["갱"],
  );
  const onlyIncompatible = structuredClone(kanjidic);
  onlyIncompatible.characters[0].readingMeaning!.groups[0].readings.pop();
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, new Map(), grouped, { kanjidic: onlyIncompatible })
      .wordAlignments.size,
    0,
  );
});

test("exact pooled allocation respects reviewed local endpoints without treating grouping as a veto", () => {
  const jmdict = fixture.jmdict({ words: [entry("1", "甲乙丙", "あいうえ")] });
  const kanjidic = fixture.kanjidic({
    characters: [
      kanjidicCharacter("甲", [{ type: "ja_on", value: "ア" }]),
      kanjidicCharacter("乙", [{ type: "ja_on", value: "イウ" }]),
      kanjidicCharacter("丙", [{ type: "ja_on", value: "エ" }]),
    ],
  });
  const fact = (segments: Segment[]) =>
    compileLexicalEvidence([
      {
        id: "fixture",
        spelling: "甲乙丙",
        reading: "あいうえ",
        segments,
        reason: "Synthetic word-local evidence",
        sources: [{ url: "https://example.com/dictionary" }],
      },
    ]);
  const compatible = deriveListedPhonologyAlignments(jmdict, new Map(), grouped, {
    kanjidic,
    lexicalFacts: fact([
      ["甲乙", "あいう"],
      ["丙", "え"],
    ]),
  });
  assert.deepEqual(lookup(compatible, "甲乙丙", "あいうえ"), [
    ["甲", "あ"],
    ["乙", "いう"],
    ["丙", "え"],
  ]);
  const contradictory = deriveListedPhonologyAlignments(jmdict, new Map(), grouped, {
    kanjidic,
    lexicalFacts: fact([
      ["甲乙", "あい"],
      ["丙", "うえ"],
    ]),
  });
  assert.equal(contradictory.wordAlignments.size, 0);
});

const reusableFact = (extra: Partial<LexicalFact> = {}): LexicalFact => ({
  id: "synthetic-source",
  spelling: "甲丙",
  reading: "あう",
  segments: [
    ["甲", "あ"],
    ["丙", "う"],
  ],
  reason: "Independent exact Japanese sound allocation; reuse separately reviewed.",
  sources: [{ url: "https://example.com/exact-sound" }],
  ...extra,
});
const exactReuse = (
  facts: LexicalFact[],
  {
    jmdict = { words: [entry("2", "甲乙", "あい")] },
    align = grouped,
    readings = [["乙", "イ"]],
    ...options
  }: ListedPhonologyOptions & {
    jmdict?: fixture.Loose<JMdict>;
    align?: Aligner;
    readings?: [spelling: string, reading: string][];
  } = {},
) =>
  deriveListedPhonologyAlignments(fixture.jmdict(jmdict), new Map(), align, {
    kanjidic: fixture.kanjidic({
      characters: readings.map(([spelling, reading]) =>
        kanjidicCharacter(spelling, [{ type: "ja_on", value: reading }]),
      ),
    }),
    lexicalFacts: compileLexicalEvidence(facts),
    ...options,
  });

test("lexical sounds require a per-segment opt-in and keep immutable exact source provenance", () => {
  const source = reusableFact(),
    before = structuredClone(source);
  assert.equal(exactReuse([source]).wordAlignments.size, 0);
  assert.equal(exactReuse([{ ...source, reusableSegments: [1] }]).wordAlignments.size, 0);
  const result = exactReuse([{ ...source, reusableSegments: [0] }], {
    loanReadings: false,
    koreanReadings: false,
  });
  assert.deepEqual(lookup(result, "甲乙", "あい"), [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  const claim = pooledWitness(result, "甲乙")!.characters[0].evidence[0] as ReusableSoundClaim;
  assert.equal(claim.category, "Reviewed reusable sound");
  assert.equal(claim.factId, source.id);
  assert.equal(claim.segmentIndex, 0);
  assert.deepEqual(claim.sources, source.sources);
  assert.deepEqual(claim.witness.segments, source.segments);
  assert.match(claim.sourceIdentity.factSHA256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(source, before);
  const transformed = reusableFact({
    spelling: "甲丙",
    reading: "かくう",
    segments: [
      ["甲", "かく"],
      ["丙", "う"],
    ],
    reusableSegments: [0],
  });
  assert.equal(
    exactReuse([transformed], {
      jmdict: { words: [entry("2", "甲乙", "かっこう")] },
      readings: [["乙", "コウ"]],
    }).wordAlignments.size,
    0,
  );
});

test("normalized self witnesses and all restriction-valid source family identities are excluded", () => {
  const self = reusableFact({
    spelling: "甲乙",
    reading: "アイ",
    segments: [
      ["甲", "ア"],
      ["乙", "イ"],
    ],
    reusableSegments: [0],
  });
  assert.equal(exactReuse([self]).wordAlignments.size, 0);
  const source = reusableFact({ reusableSegments: [0] });
  const sameFamily = { words: [entry("2", "甲乙", "あい"), entry("2", "甲丙", "あう")] };
  assert.equal(lookup(exactReuse([source], { jmdict: sameFamily }), "甲乙", "あい"), undefined);
  const nested = reusableFact({ reusableSegments: [0], jmdictEntries: ["3"] });
  const duplicates = { words: [entry("2", "甲乙", "あい"), entry("3", "甲乙", "アイ")] };
  assert.equal(exactReuse([nested], { jmdict: duplicates }).wordAlignments.size, 0);
  const corroboration = reusableFact({
    id: "independent",
    spelling: "甲丁",
    reading: "あえ",
    segments: [
      ["甲", "あ"],
      ["丁", "え"],
    ],
    reusableSegments: [0],
  });
  const result = exactReuse([nested, corroboration], { jmdict: duplicates });
  assert.deepEqual(lookup(result, "甲乙", "あい"), [
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  assert.deepEqual(
    pooledWitness(result, "甲乙")!.characters[0].evidence.map(
      (claim) => (claim as ReusableSoundClaim).factId,
    ),
    ["independent"],
  );
});

test("family exclusion never invents forbidden spelling and reading combinations", () => {
  const source = reusableFact({ reusableSegments: [0] });
  const jmdict = {
    words: [
      {
        id: "2",
        kanji: [
          { text: "甲乙", tags: [] },
          { text: "甲丙", tags: [] },
        ],
        kana: [{ text: "あう", tags: [], appliesToKanji: ["甲乙"] }],
      },
    ],
  };
  const result = exactReuse([source], { jmdict, readings: [["乙", "ウ"]] });
  assert.deepEqual(lookup(result, "甲乙", "あう"), [
    ["甲", "あ"],
    ["乙", "う"],
  ]);
});

test("reusable sounds preserve old coordinates and ambiguity instead of selecting a convenient allocation", () => {
  const source = reusableFact({ reusableSegments: [0] });
  const jmdict = { words: [entry("2", "お丁甲乙", "おえあい")] };
  const prior: Alignment = { status: "aligned", segments: ["お", ["丁", "え"], ["甲乙", "あい"]] };
  const result = exactReuse([source], {
    jmdict,
    align: () => prior,
    readings: [
      ["丁", "エ"],
      ["乙", "イ"],
    ],
  });
  assert.deepEqual(lookup(result, "お丁甲乙", "おえあい"), [
    "お",
    ["丁", "え"],
    ["甲", "あ"],
    ["乙", "い"],
  ]);
  assert.ok(
    boundaries(prior.segments).every((point) =>
      boundaries(lookup(result, "お丁甲乙", "おえあい")!).includes(point),
    ),
  );
  assert.equal(
    exactReuse([source], {
      align: (spelling, reading) => ({ ...grouped(spelling, reading), status: "reviewed" }),
    }).wordAlignments.size,
    0,
  );
  const longer = reusableFact({
    id: "longer",
    spelling: "甲丁",
    reading: "あいう",
    segments: [
      ["甲", "あい"],
      ["丁", "う"],
    ],
    reusableSegments: [0],
  });
  assert.equal(
    exactReuse([source, longer], {
      jmdict: { words: [entry("2", "甲乙", "あいい")] },
      readings: [
        ["乙", "イ"],
        ["乙", "イイ"],
      ],
    }).wordAlignments.size,
    0,
  );
  const contrary = reusableFact({
    id: "local-context",
    spelling: "甲",
    reading: "あ",
    segments: [["甲", "あ"]],
  });
  assert.equal(
    exactReuse([longer, contrary], {
      jmdict: { words: [entry("2", "甲乙", "あいう")] },
      readings: [["乙", "ウ"]],
    }).wordAlignments.size,
    0,
  );
});

test("unopted Korean local facts cannot reset transcription context or bypass its source switch", () => {
  const jmdict = fixture.jmdict({
    words: [entry("2", "甲乙", "なむちょ"), entry("3", "甲乙", "なむじょ")],
  });
  const kanjidic = fixture.kanjidic({
    characters: [
      kanjidicCharacter("甲", [{ type: "korean_h", value: "남" }]),
      kanjidicCharacter("乙", [{ type: "korean_h", value: "조" }]),
    ],
  });
  const lexicalFacts = compileLexicalEvidence([
    reusableFact({
      spelling: "甲丙",
      reading: "なむど",
      segments: [
        ["甲", "なむ"],
        ["丙", "ど"],
      ],
      reason:
        "Synthetic raw Korean source 남도 establishes only the local transcription; no independent Japanese sound reuse is asserted.",
    }),
  ]);
  const result = deriveListedPhonologyAlignments(jmdict, new Map(), grouped, {
    kanjidic,
    lexicalFacts,
  });
  assert.equal(lookup(result, "甲乙", "なむちょ"), undefined);
  assert.deepEqual(lookup(result, "甲乙", "なむじょ"), [
    ["甲", "なむ"],
    ["乙", "じょ"],
  ]);
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, new Map(), grouped, {
      kanjidic,
      lexicalFacts,
      koreanReadings: false,
    }).wordAlignments.size,
    0,
  );
});

test("new Mandarin syllable alternatives retain raw proofs, eligibility and existing coordinates", () => {
  const kanjidic = fixture.kanjidic({
    characters: [
      kanjidicCharacter("甲", [{ type: "pinyin", value: "wei1" }]),
      kanjidicCharacter("乙", [{ type: "pinyin", value: "de5" }]),
      kanjidicCharacter("丙", [{ type: "ja_on", value: "カ" }]),
    ],
  });
  const jmdict = fixture.jmdict({
    words: [
      entry("1", "丙甲乙", "カウェイデー"),
      entry("2", "甲乙", "ウェイデ", ["ik"]),
      entry("3", "甲乙", "ウェイデー", ["sk"]),
    ],
  });
  const prior: Alignment = {
    status: "aligned",
    segments: [
      ["丙", "カ"],
      ["甲乙", "ウェイデー"],
    ],
  };
  const align: Aligner = (spelling, reading) =>
    spelling === "丙甲乙" ? prior : grouped(spelling, reading);
  const options = { kanjidic, kanjidicSource: { version: "fixture", jsonSHA256: "e".repeat(64) } };
  const result = deriveListedPhonologyAlignments(jmdict, new Map(), align, options);
  assert.deepEqual(lookup(result, "丙甲乙", "カウェイデー"), [
    ["丙", "カ"],
    ["甲", "ウェイ"],
    ["乙", "デー"],
  ]);
  assert.ok(
    boundaries(prior.segments).every((point) =>
      boundaries(lookup(result, "丙甲乙", "カウェイデー")!).includes(point),
    ),
  );
  const claims = pooledWitness(result, "丙甲乙")!
    .characters.slice(1)
    .map((character) => character.evidence[0] as KanjidicSoundClaim);
  assert.deepEqual(
    claims.map((claim) => claim.form.value),
    ["wei1", "de5"],
  );
  assert.ok(
    claims.every(
      (claim) =>
        claim.category === "Mandarin transcription" &&
        claim.sourceIdentity.jsonSHA256 === options.kanjidicSource.jsonSHA256,
    ),
  );
  assert.equal(result.wordAlignments.has("甲乙"), false);
  assert.equal(
    deriveListedPhonologyAlignments(jmdict, new Map(), align, { ...options, loanReadings: false })
      .wordAlignments.size,
    0,
  );
  const conflicting: Aligner = () => ({
    status: "aligned",
    segments: [
      ["丙甲", "カウェ"],
      ["乙", "イデー"],
    ],
  });
  assert.equal(
    deriveListedPhonologyAlignments(
      fixture.jmdict({ words: [jmdict.words[0]] }),
      new Map(),
      conflicting,
      options,
    ).wordAlignments.size,
    0,
  );
});
