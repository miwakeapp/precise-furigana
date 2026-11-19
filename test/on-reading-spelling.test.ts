import assert from "node:assert/strict";
import test from "node:test";
import { deriveOnReadingSpellingAlignments } from "../src/on-reading-spelling.ts";
import * as fixture from "./support/dictionaries.ts";
import type { CharacterReadingBundle, CharacterReadingRecord } from "../src/character-readings.ts";
import type { OnReadingSpellingOptions } from "../src/on-reading-spelling.ts";
import type { Aligner, Alignment, Kanjidic2Reading } from "../src/types.ts";

/** A KANJIDIC reading, which may have a field KANJIDIC lacks that must still be carried through. */
type SourceReading = fixture.Loose<Kanjidic2Reading> & { note?: string };
/** A character and its readings; a bare string is typed by its script. */
type Forms = [literal: string, readings: (string | SourceReading)[]][];

const entry = (id: string, spelling: string, reading: string, tags: string[] = []) =>
  fixture.jmdictWord({
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags, appliesToKanji: ["*"] }],
    sense: [],
  });
const source = (forms: Forms) => ({
  characters: forms.map(([literal, readings]) => ({
    literal,
    readingMeaning: {
      groups: [
        {
          readings: readings.map((value): SourceReading =>
            typeof value === "string"
              ? {
                  type: /^[ァ-ヺ]/u.test(value) ? "ja_on" : "ja_kun",
                  value,
                }
              : value,
          ),
        },
      ],
    },
  })),
});
const grouped: Aligner = (spelling, reading) => ({
  status: "aligned",
  segments: [[spelling, reading]],
});
const bundle = (
  readings: [character: string, reading: string, kind?: "on" | "kun"][],
): CharacterReadingBundle => ({
  schemaVersion: 1,
  source: {
    name: "Typed fixture",
    version: "1",
    sha256: "b".repeat(64),
    publisher: "English Wiktionary",
  },
  readings: readings.map(([character, reading, kind = "on"]) => ({
    character,
    reading,
    kind,
    originalForm: reading,
    tags: [kind, "transliteration"],
    revisionId: 123,
  })),
});
function run(
  spelling: string,
  reading: string,
  forms: Forms,
  options?: OnReadingSpellingOptions,
  align = grouped,
) {
  return deriveOnReadingSpellingAlignments(
    fixture.jmdict({ words: [entry("1", spelling, reading)] }),
    fixture.kanjidic(source(forms)),
    align,
    options,
  );
}
const police: Forms = [
  ["警", ["ケイ"]],
  ["察", ["サツ"]],
];

test("on notation equivalence preserves raw source records, identity and original reading script", () => {
  const kanjidic = source(police);
  kanjidic.characters[0].readingMeaning.groups[0].readings[0].onType = "kan";
  const before = structuredClone(kanjidic);
  const identity = {
    version: "test",
    jsonSHA256: "a".repeat(64),
    url: "https://example.test/kanjidic.json",
  };
  const result = deriveOnReadingSpellingAlignments(
    fixture.jmdict({ words: [entry("1", "警察", "ケーサツ")] }),
    fixture.kanjidic(kanjidic),
    grouped,
    { kanjidicSource: identity },
  );
  assert.deepEqual(result.wordAlignments.get("警察")!.get("ケーサツ"), [
    ["警", "ケー"],
    ["察", "サツ"],
  ]);
  assert.deepEqual(kanjidic, before);
  const evidence = result.witnesses[0].spans[0].characters[0].evidence[0];
  assert.deepEqual(evidence.form, before.characters[0].readingMeaning.groups[0].readings[0]);
  assert.deepEqual(evidence.sourceIdentity, identity);
  assert.equal(evidence.field, "ja_on");
  assert.equal(evidence.groupIndex, 0);
  assert.equal(evidence.readingIndex, 0);
  assert.deepEqual(evidence.rules, ["on-long-vowel-notation-equivalence"]);
  assert.match(result.witnesses[0].interpretation, /not an etymological claim/u);
});

test("matching cannot remove length, delete final morae, voice, or replace vowels", () => {
  for (const reading of ["けさつ", "けいさ", "こーさつ", "げーさつ", "けーーさつ"]) {
    assert.equal(run("警察", reading, police).wordAlignments.size, 0, reading);
  }
});

test("kun companions match literal stems without native vowel normalization or inferred okurigana", () => {
  const forms: Forms = [
    ["労", ["ロウ"]],
    ["様", ["さま"]],
  ];
  assert.deepEqual(run("労様", "ろーさま", forms).wordAlignments.get("労様")!.get("ろーさま"), [
    ["労", "ろー"],
    ["様", "さま"],
  ]);
  assert.equal(
    run("甲乙", "こーおつ", [
      ["甲", ["こう"]],
      ["乙", ["オツ"]],
    ]).wordAlignments.size,
    0,
  );
  assert.equal(
    run("甲乙", "こうおー", [
      ["甲", ["コウ"]],
      ["乙", ["お.う"]],
    ]).wordAlignments.size,
    0,
  );
});

test("typed source fields determine on readings, not kana script", () => {
  assert.equal(
    run("警察", "けーさつ", [
      ["警", [{ type: "ja_kun", value: "ケイ" }]],
      ["察", ["サツ"]],
    ]).wordAlignments.size,
    0,
  );
  assert.equal(
    run("警察", "けーさつ", [
      ["警", [{ type: "ja_on", value: "けい" }]],
      ["察", ["サツ"]],
    ]).wordAlignments.size,
    1,
  );
  assert.equal(
    run("警察", "けーさつ", [
      ["警", [{ type: "korean_r", value: "kei" }]],
      ["察", ["サツ"]],
    ]).wordAlignments.size,
    0,
  );
});

test("each refined opaque span must actually need notation equivalence", () => {
  const exact = run("警察", "けいさつ", police);
  assert.equal(exact.wordAlignments.size, 0);
  const result = run(
    "警察と甲乙",
    "けーさつとこうおつ",
    [...police, ["甲", ["コウ"]], ["乙", ["オツ"]]],
    undefined,
    () => ({ status: "aligned", segments: [["警察", "けーさつ"], "と", ["甲乙", "こうおつ"]] }),
  );
  assert.deepEqual(result.wordAlignments.get("警察と甲乙")!.get("けーさつとこうおつ"), [
    ["警", "けー"],
    ["察", "さつ"],
    "と",
    ["甲乙", "こうおつ"],
  ]);
  // A literal listed alternative means notation is not necessary here.
  assert.equal(
    run("警察", "けーさつ", [
      ["警", ["ケイ", "ケー"]],
      ["察", ["サツ"]],
    ]).wordAlignments.size,
    0,
  );
});

test("complete competing allocations are withheld even if one uses more exact readings", () => {
  const forms: Forms = [
    ["甲", ["コ", "コウ"]],
    ["乙", ["ウエ", "エ"]],
    ["丙", ["ケイ"]],
  ];
  assert.equal(run("甲乙丙", "こうえけー", forms).wordAlignments.size, 0);
});

test("old boundaries and nonaligned statuses are preserved", () => {
  const forms: Forms = [
    ["甲", ["コ", "コウ"]],
    ["乙", ["ウエ", "エ"]],
    ["丙", ["ケイ"]],
  ];
  const original: Alignment = {
    status: "aligned",
    segments: [
      ["甲", "こ"],
      ["乙丙", "うえけー"],
    ],
  };
  const result = run("甲乙丙", "こうえけー", forms, undefined, () => original);
  assert.deepEqual(result.wordAlignments.get("甲乙丙")!.get("こうえけー"), [
    ["甲", "こ"],
    ["乙", "うえ"],
    ["丙", "けー"],
  ]);
  for (const status of ["ambiguous", "fallback", "reviewed"] as const) {
    assert.equal(
      run("警察", "ケーサツ", police, undefined, (spelling, reading) => ({
        ...grouped(spelling, reading),
        status,
      })).wordAlignments.size,
      0,
    );
  }
});

test("irregular subwords block changed or supplemental readings inside untagged compounds", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "甲乙", "こーおつ", ["gikun"]), entry("2", "丙甲乙", "へいこーおつ")],
  });
  const kanjidic = fixture.kanjidic(
    source([
      ["甲", ["コウ"]],
      ["乙", ["オツ"]],
      ["丙", ["ヘイ"]],
    ]),
  );
  assert.equal(deriveOnReadingSpellingAlignments(jmdict, kanjidic, grouped).wordAlignments.size, 0);
});

test("an actual notation change outside an irregular range does not veto its direct primary readings", () => {
  const jmdict = fixture.jmdict({
    words: [entry("1", "甲乙", "こうおつ", ["gikun"]), entry("2", "甲乙丙", "こうおつへー")],
  });
  const kanjidic = fixture.kanjidic(
    source([
      ["甲", ["コウ"]],
      ["乙", ["オツ"]],
      ["丙", ["ヘイ"]],
    ]),
  );
  const result = deriveOnReadingSpellingAlignments(jmdict, kanjidic, grouped);
  assert.deepEqual(result.wordAlignments.get("甲乙丙")!.get("こうおつへー"), [
    ["甲", "こう"],
    ["乙", "おつ"],
    ["丙", "へー"],
  ]);
});

test("typed bundle claims retain their original source forms without pretending to be KANJIDIC", () => {
  const characterReadingBundle = bundle([["警", "ケイ"]]);
  const result = run("警察", "ケーサツ", [["察", ["サツ"]]], { characterReadingBundle });
  const evidence = result.witnesses[0].spans[0].characters[0].evidence[0];
  assert.equal(evidence.source, "English Wiktionary");
  assert.equal(evidence.field, "forms");
  assert.deepEqual(evidence.form, characterReadingBundle.readings[0]);
  assert.deepEqual(evidence.sourceIdentity, characterReadingBundle.source);
  assert.equal((evidence.form as CharacterReadingRecord).revisionId, 123);
});

test("all source claims for the same allocation are retained without creating false ambiguity", () => {
  const kanjidic = source(police);
  kanjidic.characters[0].readingMeaning.groups.push({
    readings: [{ type: "ja_on", value: "ケイ", note: "second claim" }],
  });
  const result = deriveOnReadingSpellingAlignments(
    fixture.jmdict({ words: [entry("1", "警察", "ケーサツ")] }),
    fixture.kanjidic(kanjidic),
    grouped,
    { englishCharacterReadingBundle: bundle([["警", "ケイ"]]) },
  );
  const claims = result.witnesses[0].spans[0].characters[0].evidence;
  assert.equal(claims.length, 3);
  assert.equal((claims[1].form as SourceReading).note, "second claim");
  assert.equal((claims[2].form as CharacterReadingRecord).revisionId, 123);
});

test("typed final sokuon checks actual following sounds across existing segment boundaries", () => {
  const characterReadingBundle = bundle([["乙", "カッ"]]);
  const forms: Forms = [
    ["甲", ["コウ"]],
    ["丙", ["カ", "ア"]],
  ];
  const align: Aligner = (spelling, reading) => ({
    status: "aligned",
    segments: [
      ["甲乙", "こーかっ"],
      ["丙", reading.at(-1)!],
    ],
  });
  assert.deepEqual(
    run("甲乙丙", "こーかっか", forms, { characterReadingBundle }, align)
      .wordAlignments.get("甲乙丙")!
      .get("こーかっか"),
    [
      ["甲", "こー"],
      ["乙", "かっ"],
      ["丙", "か"],
    ],
  );
  assert.equal(
    run("甲乙丙", "こーかっあ", forms, { characterReadingBundle }, align).wordAlignments.size,
    0,
  );
});

test("iteration, unlisted pairs and unsupported characters acquire no inferred readings", () => {
  assert.equal(run("警々", "けーけー", police).wordAlignments.size, 0);
  const result = run("警察", "ケーサツ", police);
  assert.equal(result.wordAlignments.has("警察警察"), false);
  assert.equal(run("警甲", "ケーサツ", police).wordAlignments.size, 0);
});

test("Unicode normalization is used only for matching", () => {
  const result = run("警察", "ｹｰｻﾂ", police);
  assert.deepEqual(result.wordAlignments.get("警察")!.get("ｹｰｻﾂ"), [
    ["警", "ｹｰ"],
    ["察", "ｻﾂ"],
  ]);
  const supplementary = run("𠮷察", "コーサツ", [
    ["𠮷", ["コウ"]],
    ["察", ["サツ"]],
  ]);
  assert.deepEqual(supplementary.wordAlignments.get("𠮷察")!.get("コーサツ"), [
    ["𠮷", "コー"],
    ["察", "サツ"],
  ]);
});

test("incomplete source identities are rejected", () => {
  const jmdict = fixture.jmdict({ words: [] }),
    kanjidic = fixture.kanjidic(source(police));
  for (const kanjidicSource of [{}, { version: "1", jsonSHA256: "bad" }]) {
    assert.throws(
      () => deriveOnReadingSpellingAlignments(jmdict, kanjidic, grouped, { kanjidicSource }),
      TypeError,
    );
  }
});
