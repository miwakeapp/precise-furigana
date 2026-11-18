import assert from "node:assert/strict";
import test from "node:test";
import { deriveSeparatorAlignments } from "../src/separator-alignments.mjs";
import { uniqueExactCharacterAlignment } from "../src/exact-character-allocation.mjs";
import { makeCharacterReadings } from "../src/sources.mjs";

function word(id, spelling, reading) {
  return {
    id,
    kanji: [{ text: spelling, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }],
    sense: [],
  };
}
function dictionary(values = { 甲: ["ア"], 乙: ["イ"], 丙: ["ウ"] }) {
  return {
    characters: Object.entries(values).map(([literal, forms]) => ({
      literal,
      readingMeaning: { groups: [{ readings: forms.map((value) => ({ type: "ja_on", value })) }] },
    })),
  };
}
function derive({
  target = "甲乙・丙",
  reading = "あいう",
  kanjidic = dictionary(),
  extraWords = [],
  targetSegments,
  targetStatus = "aligned",
  options = {},
} = {}) {
  const jmdict = { words: [word("1", target, reading), ...extraWords] };
  const queried = [];
  const result = deriveSeparatorAlignments(
    jmdict,
    kanjidic,
    (spelling, sound) => {
      queried.push(spelling);
      assert.equal(
        spelling,
        target,
        "Generated spellings must never query earlier accepted output",
      );
      return { status: targetStatus, segments: targetSegments ?? [[spelling, sound]] };
    },
    options,
  );
  return { ...result, queried, target, reading };
}

test("virtual sources remain disabled by default and require a boolean option", () => {
  assert.equal(derive().wordAlignments.size, 0);
  assert.equal(derive({ options: { allowVirtualSources: undefined } }).wordAlignments.size, 0);
  assert.throws(() => derive({ options: { allowVirtualSources: null } }), TypeError);
});

test("unique exact generated allocation records no fabricated source attestation", () => {
  const result = derive({ options: { allowVirtualSources: true } });
  assert.deepEqual(result.wordAlignments.get(result.target)?.get(result.reading), [
    ["甲", "あ"],
    ["乙・", "い"],
    ["丙", "う"],
  ]);
  assert.deepEqual(result.queried, [result.target]);
  const witness = result.witnesses[0];
  assert.deepEqual(witness.virtualSource, {
    kind: "generated-plain-spelling",
    spelling: "甲乙丙",
    reading: "あいう",
    attestedInSameEntry: false,
    wholePairAttestationUsed: false,
  });
  assert.ok(!("id" in witness.virtualSource));
  assert.ok(!("sourcePair" in witness));
  assert.ok(!("sourceAttestation" in witness));
  assert.equal(witness.targetAttestation.id, "1");
  assert.equal(witness.rawBaselineAgreementIsAnAdditionalVeto, true);
  assert.deepEqual(
    witness.completeExactAllocation.map((part) => part.rawForms),
    [["ア"], ["イ"], ["ウ"]],
  );
  assert.match(witness.sourceIdentities.kanjidic.inputSHA256, /^[a-f0-9]{64}$/u);
});

test("an attestation elsewhere does not become a same-entry source claim", () => {
  const result = derive({
    extraWords: [word("2", "甲乙丙", "あいう")],
    options: { allowVirtualSources: true },
  });
  assert.equal(result.witnesses.length, 1);
  assert.equal(result.witnesses[0].virtualSource.wholePairAttestationUsed, false);
  assert.ok(!("sourcePair" in result.witnesses[0]));
});

test("rejects every competing complete exact allocation", () => {
  const result = derive({
    reading: "あいうえ",
    kanjidic: dictionary({ 甲: ["ア", "アイ"], 乙: ["イウ", "ウ"], 丙: ["エ"] }),
    options: { allowVirtualSources: true },
  });
  assert.equal(result.wordAlignments.size, 0);
});

test("raw character-only reconstruction cannot be replaced by a phonological path", () => {
  const result = derive({
    reading: "かがな",
    kanjidic: dictionary({ 甲: ["カ"], 乙: ["カ"], 丙: ["ナ"] }),
    options: { allowVirtualSources: true, rawAlignerOptions: { phonologicalAlternations: true } },
  });
  assert.equal(result.wordAlignments.size, 0);
});

test("a dictionary residual is insufficient without complete exact character support", () => {
  const result = derive({
    kanjidic: dictionary({ 丙: ["ウ"] }),
    extraWords: [word("2", "甲乙", "あい")],
    options: { allowVirtualSources: true },
  });
  assert.equal(result.wordAlignments.size, 0);
});

test("independent raw-source failure vetoes an otherwise exact allocation", () => {
  // The raw aligner strips variation selectors from character lookups; this
  // supplied inventory deliberately binds only the marked form.
  const marked = "甲\uFE00",
    kanjidic = dictionary({ [marked]: ["ア"], 乙: ["イ"], 丙: ["ウ"] });
  assert.ok(
    uniqueExactCharacterAlignment(`${marked}乙丙`, "あいう", makeCharacterReadings(kanjidic)),
  );
  assert.equal(
    derive({ target: `${marked}乙・丙`, kanjidic, options: { allowVirtualSources: true } })
      .wordAlignments.size,
    0,
  );
});

test("raw whole-word grouping vetoes different exact character boundaries", () => {
  const marked = "甲\uFE00",
    kanjidic = dictionary({ [marked]: ["ア"], 乙: ["イ"], 丙: ["ウ"] });
  assert.ok(
    uniqueExactCharacterAlignment(`${marked}乙丙`, "あいう", makeCharacterReadings(kanjidic)),
  );
  const result = derive({
    target: `${marked}乙・丙`,
    kanjidic,
    extraWords: [word("2", `${marked}乙丙`, "あいう")],
    options: { allowVirtualSources: true },
  });
  assert.equal(result.wordAlignments.size, 0);
});

test("virtual projection preserves earlier cuts and refuses conflicting cuts", () => {
  const supported = derive({
    targetSegments: [
      ["甲乙", "あい"],
      ["・丙", "う"],
    ],
    options: { allowVirtualSources: true },
  });
  assert.deepEqual(supported.wordAlignments.get(supported.target)?.get(supported.reading), [
    ["甲", "あ"],
    ["乙", "い"],
    ["・丙", "う"],
  ]);
  const conflict = derive({
    targetSegments: [
      ["甲", "あい"],
      ["乙・丙", "う"],
    ],
    options: { allowVirtualSources: true },
  });
  assert.equal(conflict.wordAlignments.size, 0);
  for (const targetStatus of ["ambiguous", "fallback"]) {
    assert.equal(
      derive({ targetStatus, options: { allowVirtualSources: true } }).wordAlignments.size,
      0,
    );
  }
});

test("virtual exact claims retain dotted forms without absorbing their suffixes", () => {
  const result = derive({
    target: "かな・甲乙れ",
    reading: "かなあいれ",
    kanjidic: dictionary({ 甲: ["ア"], 乙: ["い.る"] }),
    options: { allowVirtualSources: true },
  });
  assert.deepEqual(result.wordAlignments.get(result.target)?.get(result.reading), [
    ["かな・", "かな"],
    ["甲", "あ"],
    ["乙", "い"],
    "れ",
  ]);
  assert.deepEqual(
    result.witnesses[0].completeExactAllocation.find((part) => part.spelling === "乙").rawForms,
    ["い.る"],
  );
});

test("enabling virtual sources leaves existing sibling provenance and output unchanged", () => {
  const source = word("1", "甲乙丙", "あいう");
  source.kanji.push({ text: "甲乙・丙", tags: [] });
  const jmdict = { words: [source] },
    kanjidic = dictionary();
  const align = (spelling) => ({
    status: "aligned",
    segments:
      spelling === "甲乙丙"
        ? [
            ["甲", "あ"],
            ["乙", "い"],
            ["丙", "う"],
          ]
        : [[spelling, "あいう"]],
  });
  const original = deriveSeparatorAlignments(jmdict, kanjidic, align);
  const enabled = deriveSeparatorAlignments(jmdict, kanjidic, align, { allowVirtualSources: true });
  assert.deepEqual(enabled, original);
  assert.ok(!("virtualSource" in enabled.witnesses[0]));
});
