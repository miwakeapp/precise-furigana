import assert from "node:assert/strict";
import test from "node:test";
import { deriveKoreanAlignments } from "../src/korean-readings.ts";
import { compileAlignmentPipeline, defaultConfiguration } from "../src/dataset.ts";

function entry(
  id,
  spelling,
  reading,
  {
    tagged = true,
    wasei = false,
    language = "kor",
    appliesToKanji = ["*"],
    appliesToKana = ["*"],
    readingTags = [],
  } = {},
) {
  return {
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags: readingTags, appliesToKanji: ["*"] }],
    sense: tagged
      ? [
          {
            appliesToKanji,
            appliesToKana,
            languageSource: [{ lang: language, full: true, wasei, text: "source form" }],
          },
        ]
      : [],
  };
}

const source = (forms) => ({
  characters: forms.map(([literal, values]) => ({
    literal,
    readingMeaning: {
      groups: [{ readings: values.map((value) => ({ type: "korean_h", value })) }],
    },
  })),
});
const grouped = (spelling, reading) => ({ segments: [[spelling, reading]], status: "aligned" });
const juche = source([
  ["主", ["주"]],
  ["体", ["체"]],
]);
const run = (spelling, reading, forms, options = {}, entryOptions = {}) =>
  deriveKoreanAlignments(
    { words: [entry("1", spelling, reading, entryOptions)] },
    source(forms),
    grouped,
    options,
  );

test("Korean allocation preserves full raw records, target eligibility and transcription provenance", () => {
  const kanjidic = structuredClone(juche);
  kanjidic.characters[0].readingMeaning.groups[0].readings[0].sourceNote = "retain this raw field";
  const before = structuredClone(kanjidic);
  const identity = {
    version: "fixture",
    jsonSHA256: "a".repeat(64),
    url: "https://example.test/kanjidic.json",
  };
  const result = deriveKoreanAlignments(
    { words: [entry("1", "主体", "チュチェ")] },
    kanjidic,
    grouped,
    { kanjidicSource: identity },
  );
  assert.deepEqual(result.wordAlignments.get("主体").get("チュチェ"), [
    ["主", "チュ"],
    ["体", "チェ"],
  ]);
  assert.deepEqual(kanjidic, before);
  const witness = result.witnesses[0];
  assert.equal(witness.eligibility, "source-language-kor");
  assert.match(witness.interpretation, /not an etymological claim/u);
  assert.equal(witness.languageSources[0].text, "source form");
  const evidence = witness.sourcePaths[0][0].evidence[0];
  assert.deepEqual(evidence.form, before.characters[0].readingMeaning.groups[0].readings[0]);
  assert.deepEqual(evidence.sourceIdentity, identity);
  assert.equal(evidence.field, "korean_h");
  assert.equal(evidence.transcription.syllableKana, "ちゅ");
  assert.ok(evidence.rules.includes("korean-plain-devoicing"));
});

test("medial voicing and codas retain source-syllable ownership", () => {
  const result = run("温突", "オンドル", [
    ["温", ["온"]],
    ["突", ["돌"]],
  ]);
  assert.deepEqual(result.wordAlignments.get("温突").get("オンドル"), [
    ["温", "オン"],
    ["突", "ドル"],
  ]);
  const final = result.witnesses[0].sourcePaths[0][1].evidence[0];
  assert.equal(final.transcription.previousSyllable, "온");
  assert.equal(final.transcription.codaKana, "る");
  assert.ok(final.rules.includes("korean-medial-plain-voicing"));
  assert.ok(final.rules.includes("korean-coda-kana-approximation"));
});

test("different listed forms may support the same unique allocation without discarding source claims", () => {
  const result = run("大韓", "テハン", [
    ["大", ["대", "태"]],
    ["韓", ["한"]],
  ]);
  assert.deepEqual(result.wordAlignments.get("大韓").get("テハン"), [
    ["大", "テ"],
    ["韓", "ハン"],
  ]);
  assert.deepEqual(
    result.witnesses[0].sourcePaths.map((path) => path[0].evidence[0].value),
    ["대", "태"],
  );
  const duplicate = structuredClone(juche);
  duplicate.characters[0].readingMeaning.groups.push({
    readings: [{ type: "korean_h", value: "주", marker: "second claim" }],
  });
  const claims = deriveKoreanAlignments(
    { words: [entry("1", "主体", "チュチェ")] },
    duplicate,
    grouped,
  ).witnesses[0].sourcePaths[0][0].evidence;
  assert.equal(claims.length, 2);
  assert.equal(claims[1].groupIndex, 1);
  assert.equal(claims[1].form.marker, "second claim");
});

test("every character needs Korean evidence and Japanese companions cannot fill a missing syllable", () => {
  const missing = structuredClone(juche);
  missing.characters[1].readingMeaning.groups[0].readings = [{ type: "ja_on", value: "チェ" }];
  assert.equal(
    deriveKoreanAlignments({ words: [entry("1", "主体", "チュチェ")] }, missing, grouped)
      .wordAlignments.size,
    0,
  );
  for (const reading of ["チューチェ", "チュチエ", "チュチェア"]) {
    assert.equal(
      deriveKoreanAlignments({ words: [entry("1", "主体", reading)] }, juche, grouped)
        .wordAlignments.size,
      0,
    );
  }
});

test("competing complete allocations stay grouped even when one would preserve old boundaries", () => {
  const words = { words: [entry("1", "甲乙", "カクク")] };
  const inventory = source([
    ["甲", ["가", "각"]],
    ["乙", ["쿡", "쿠"]],
  ]);
  assert.equal(deriveKoreanAlignments(words, inventory, grouped).wordAlignments.size, 0);
  const prior = () => ({
    status: "aligned",
    segments: [
      ["甲", "カ"],
      ["乙", "クク"],
    ],
  });
  assert.equal(deriveKoreanAlignments(words, inventory, prior).wordAlignments.size, 0);
});

test("existing boundaries, nonaligned statuses and original Unicode remain intact", () => {
  const words = { words: [entry("1", "甲乙", "カクク")] },
    inventory = source([
      ["甲", ["가"]],
      ["乙", ["쿡"]],
    ]);
  const conflicting = () => ({
    status: "aligned",
    segments: [
      ["甲", "カク"],
      ["乙", "ク"],
    ],
  });
  assert.equal(deriveKoreanAlignments(words, inventory, conflicting).wordAlignments.size, 0);
  for (const status of ["ambiguous", "fallback", "reviewed"]) {
    assert.equal(
      deriveKoreanAlignments(words, inventory, (spelling, reading) => ({
        ...grouped(spelling, reading),
        status,
      })).wordAlignments.size,
      0,
    );
  }
  const supplementary = run("𠮷体", "ちゅちぇ", [
    ["𠮷", ["주"]],
    ["体", ["체"]],
  ]);
  assert.deepEqual(supplementary.wordAlignments.get("𠮷体").get("ちゅちぇ"), [
    ["𠮷", "ちゅ"],
    ["体", "ちぇ"],
  ]);
});

test("language-source gates obey sense restrictions, wasei and reading tags", () => {
  for (const options of [
    { tagged: false },
    { wasei: true },
    { language: "chi" },
    { appliesToKanji: ["別語"] },
    { appliesToKana: ["しゅたい"] },
    { readingTags: ["ik"] },
    { readingTags: ["sk"] },
  ]) {
    assert.equal(
      deriveKoreanAlignments({ words: [entry("1", "主体", "チュチェ", options)] }, juche, grouped, {
        untaggedKatakana: false,
      }).wordAlignments.size,
      0,
    );
  }
  assert.equal(
    deriveKoreanAlignments(
      { words: [entry("1", "主体", "チュチェ", { tagged: false })] },
      juche,
      grouped,
    ).witnesses[0].eligibility,
    "korean-only-katakana",
  );
  assert.equal(
    deriveKoreanAlignments(
      { words: [entry("1", "主体", "ちゅちぇ", { tagged: false })] },
      juche,
      grouped,
    ).wordAlignments.size,
    0,
  );
  assert.equal(run("主たい", "チュチェ", [["主", ["주"]]]).wordAlignments.size, 0);
});

test("liaison, assimilation, aspiration and omitted syllable classes fail closed", () => {
  const cases = [
    [
      "国亜",
      "ククア",
      [
        ["国", ["국"]],
        ["亜", ["아"]],
      ],
    ],
    [
      "白馬",
      "ペクマ",
      [
        ["白", ["백"]],
        ["馬", ["마"]],
      ],
    ],
    [
      "新羅",
      "シンラ",
      [
        ["新", ["신"]],
        ["羅", ["라"]],
      ],
    ],
    [
      "雪奈",
      "ソルナ",
      [
        ["雪", ["설"]],
        ["奈", ["나"]],
      ],
    ],
    [
      "入学",
      "イプハク",
      [
        ["入", ["입"]],
        ["学", ["학"]],
      ],
    ],
    [
      "黄主",
      "ファンジュ",
      [
        ["黄", ["황"]],
        ["主", ["주"]],
      ],
    ],
    [
      "氏主",
      "シジュ",
      [
        ["氏", ["씨"]],
        ["主", ["주"]],
      ],
    ],
    [
      "甲主",
      "カッジュ",
      [
        ["甲", ["갓"]],
        ["主", ["주"]],
      ],
    ],
  ];
  for (const [spelling, reading, forms] of cases)
    assert.equal(run(spelling, reading, forms).wordAlignments.size, 0, spelling);
});

test("source fingerprints distinguish standalone inventories and malformed options are rejected", () => {
  const words = { words: [entry("1", "主体", "チュチェ")] };
  const fingerprint = (inventory) =>
    deriveKoreanAlignments(words, inventory, grouped).witnesses[0].sourcePaths[0][0].evidence[0]
      .sourceIdentity.readingsSHA256;
  const changed = structuredClone(juche);
  changed.characters[0].readingMeaning.groups[0].readings[0].marker = "different raw record";
  assert.notEqual(fingerprint(juche), fingerprint(changed));
  for (const options of [
    { untaggedKatakana: null },
    { kanjidicSource: null },
    { kanjidicSource: { version: "1", jsonSHA256: "bad" } },
  ]) {
    assert.throws(() => deriveKoreanAlignments(words, juche, grouped, options), TypeError);
  }
  assert.throws(() => deriveKoreanAlignments(undefined, juche, grouped), TypeError);
  assert.throws(() => deriveKoreanAlignments(words, {}, grouped), TypeError);
  assert.throws(() => deriveKoreanAlignments(words, juche, undefined), TypeError);
  assert.equal(
    deriveKoreanAlignments(words, juche, grouped, { untaggedKatakana: undefined }).wordAlignments
      .size,
    1,
  );
});

test("the final pipeline honors Korean controls and omits the pass from protected construction", () => {
  const jmdict = { words: [entry("1", "主体", "チュチェ", { tagged: false })] };
  const options = {
    ...Object.fromEntries(Object.keys(defaultConfiguration).map((name) => [name, false])),
    dictionaryNasalLoss: true,
    koreanReadings: true,
    untaggedKatakanaKorean: true,
  };
  const pipeline = compileAlignmentPipeline(jmdict, juche, options);
  assert.equal(pipeline.koreanReadings.length, 1);
  assert.deepEqual(pipeline.align("主体", "チュチェ").segments, [
    ["主", "チュ"],
    ["体", "チェ"],
  ]);
  assert.deepEqual(pipeline.align("主体", "チュチェ").evidence[0].rules, [
    "listed-korean-sound-compatibility",
  ]);
  for (const disabled of [{ koreanReadings: false }, { untaggedKatakanaKorean: false }]) {
    const without = compileAlignmentPipeline(jmdict, juche, { ...options, ...disabled });
    assert.equal(without.koreanReadings.length, 0);
    assert.deepEqual(without.align("主体", "チュチェ").segments, [["主体", "チュチェ"]]);
  }
});

test("pooled Korean sounds refine attested mixtures without creating readings for unattested pairs", () => {
  const jmdict = { words: [entry("1", "主体", "チュチェ"), entry("2", "主体阿", "チュチェア")] };
  const kanjidic = structuredClone(juche);
  kanjidic.characters.push({
    literal: "阿",
    readingMeaning: { groups: [{ readings: [{ type: "ja_on", value: "ア" }] }] },
  });
  const baseline = compileAlignmentPipeline(jmdict, kanjidic, { koreanReadings: false });
  const korean = compileAlignmentPipeline(jmdict, kanjidic);
  assert.deepEqual(korean.align("主体", "チュチェ").segments, [
    ["主", "チュ"],
    ["体", "チェ"],
  ]);
  assert.deepEqual(korean.align("主体阿", "チュチェア").segments, [
    ["主", "チュ"],
    ["体", "チェ"],
    ["阿", "ア"],
  ]);
  assert.ok(
    korean.listedPhonology.some(
      (witness) =>
        witness.spelling === "主体阿" &&
        witness.characters.some((character) =>
          character.evidence.some((claim) => claim.category === "Korean transcription"),
        ),
    ),
  );
  assert.deepEqual(
    korean.align("主阿", "チュア").segments,
    baseline.align("主阿", "チュア").segments,
  );
  assert.deepEqual(
    korean.align("主体", "ちゅちぇ").segments,
    baseline.align("主体", "ちゅちぇ").segments,
  );
});
