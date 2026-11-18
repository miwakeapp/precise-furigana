import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deriveSeparatorAlignments } from "../src/separator-alignments.mjs";

const sourceSpelling = "甲乙丙",
  reading = "あいう";
const sourceSegments = [
  ["甲", "あ"],
  ["乙", "い"],
  ["丙", "う"],
];
function word(id, spellings, readings = [{ text: reading, appliesToKanji: ["*"] }]) {
  return {
    id,
    kanji: spellings.map((text) => ({ text, tags: [] })),
    kana: readings.map((form) => ({ tags: [], ...form })),
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
function inputs(target = "甲乙・丙", { source = sourceSpelling, readings } = {}) {
  return {
    jmdict: { words: [word("1", [source, target], readings)] },
    kanjidic: dictionary(),
    target,
  };
}
function earlier(
  target,
  {
    source = sourceSegments,
    sourceStatus = "aligned",
    targetSegments,
    targetStatus = "aligned",
  } = {},
) {
  return (spelling, sound) =>
    spelling === target
      ? { status: targetStatus, segments: targetSegments ?? [[spelling, sound]] }
      : { status: sourceStatus, segments: source };
}
function resultSegments(result, target, sound = reading) {
  return result.wordAlignments.get(target)?.get(sound);
}

test("transfers every cut and attaches silent separators to the preceding segment", () => {
  const { jmdict, kanjidic, target } = inputs();
  const result = deriveSeparatorAlignments(jmdict, kanjidic, earlier(target));
  assert.deepEqual(resultSegments(result, target), [
    ["甲", "あ"],
    ["乙・", "い"],
    ["丙", "う"],
  ]);
  assert.equal(result.witnesses.length, 1);
  assert.deepEqual(result.witnesses[0].sourceSegments, sourceSegments);
  assert.deepEqual(result.witnesses[0].rawCharacterReadings, {
    甲: ["ア"],
    乙: ["イ"],
    丙: ["ウ"],
  });
  assert.ok(result.witnesses[0].sourceEvidence.every((part) => part.type === "character"));
});

test("splits at every separator", () => {
  const { jmdict, kanjidic, target } = inputs("甲・乙・丙");
  assert.deepEqual(
    resultSegments(deriveSeparatorAlignments(jmdict, kanjidic, earlier(target)), target),
    [
      ["甲・", "あ"],
      ["乙・", "い"],
      ["丙", "う"],
    ],
  );
});

test("keeps separate alignments and witnesses for targets sharing one plain source", () => {
  const targets = ["甲乙・丙", "甲・乙丙"];
  const jmdict = { words: [word("1", [sourceSpelling, ...targets])] };
  const align = (spelling, sound) => ({
    status: "aligned",
    segments: spelling === sourceSpelling ? sourceSegments : [[spelling, sound]],
  });
  const result = deriveSeparatorAlignments(jmdict, dictionary(), align);
  assert.deepEqual(resultSegments(result, targets[0]), [
    ["甲", "あ"],
    ["乙・", "い"],
    ["丙", "う"],
  ]);
  assert.deepEqual(resultSegments(result, targets[1]), [
    ["甲・", "あ"],
    ["乙", "い"],
    ["丙", "う"],
  ]);
  assert.equal(result.witnesses.length, 2);
  for (const [index, target] of targets.entries()) {
    const witness = result.witnesses.find((value) => value.spelling === target);
    assert.equal(witness.targetAttestation.spelling, target);
    assert.equal(witness.targetAttestation.kanjiIndex, index + 1);
    assert.equal(witness.sourceAttestation.spelling, sourceSpelling);
    assert.equal(witness.sourceAttestation.kanjiIndex, 0);
  }
});

test("preserves earlier target cuts beside punctuation", () => {
  const { jmdict, kanjidic, target } = inputs();
  const align = earlier(target, {
    targetSegments: [
      ["甲乙", "あい"],
      ["・丙", "う"],
    ],
  });
  assert.deepEqual(resultSegments(deriveSeparatorAlignments(jmdict, kanjidic, align), target), [
    ["甲", "あ"],
    ["乙", "い"],
    ["・丙", "う"],
  ]);
});

test("rejects cuts that conflict with an earlier target boundary", () => {
  const { jmdict, kanjidic, target } = inputs();
  const align = earlier(target, {
    targetSegments: [
      ["甲", "あい"],
      ["乙・丙", "う"],
    ],
  });
  assert.equal(deriveSeparatorAlignments(jmdict, kanjidic, align).wordAlignments.size, 0);
});

test("requires an attested plain sibling in the same entry", () => {
  const target = "甲乙・丙",
    kanjidic = dictionary();
  for (const words of [[word("1", [target])], [word("1", [target]), word("2", [sourceSpelling])]]) {
    assert.equal(
      deriveSeparatorAlignments({ words }, kanjidic, earlier(target)).wordAlignments.size,
      0,
    );
  }
});

test("honors reading restrictions instead of pairing every spelling and reading", () => {
  const target = "甲乙・丙";
  const { jmdict, kanjidic } = inputs(target, {
    readings: [
      { text: reading, appliesToKanji: [target] },
      { text: "あいえ", appliesToKanji: [sourceSpelling] },
    ],
  });
  assert.equal(deriveSeparatorAlignments(jmdict, kanjidic, earlier(target)).wordAlignments.size, 0);
});

test("normalized lookup does not loosen exact original-reading eligibility", () => {
  const target = "甲乙・丙";
  const { jmdict, kanjidic } = inputs(target, {
    readings: [
      { text: reading, appliesToKanji: [target] },
      { text: "アイウ", appliesToKanji: [sourceSpelling] },
    ],
  });
  assert.equal(deriveSeparatorAlignments(jmdict, kanjidic, earlier(target)).wordAlignments.size, 0);
});

test("withholds ambiguous and fallback target or accepted source outputs", () => {
  const { jmdict, kanjidic, target } = inputs();
  for (const status of ["ambiguous", "fallback"]) {
    assert.equal(
      deriveSeparatorAlignments(jmdict, kanjidic, earlier(target, { targetStatus: status }))
        .wordAlignments.size,
      0,
    );
    assert.equal(
      deriveSeparatorAlignments(jmdict, kanjidic, earlier(target, { sourceStatus: status }))
        .wordAlignments.size,
      0,
    );
  }
});

test("independent source cuts must agree with accepted source boundaries", () => {
  const { jmdict, kanjidic, target } = inputs();
  assert.equal(
    deriveSeparatorAlignments(
      jmdict,
      kanjidic,
      earlier(target, { source: [[sourceSpelling, reading]] }),
    ).wordAlignments.size,
    0,
  );
});

test("does not use accepted source cuts when raw sources are ambiguous", () => {
  const target = "甲乙・丙",
    sound = "あいうえ";
  const jmdict = {
    words: [word("1", [sourceSpelling, target], [{ text: sound, appliesToKanji: ["*"] }])],
  };
  const kanjidic = dictionary({ 甲: ["ア", "アイ"], 乙: ["イウ", "ウ"], 丙: ["エ"] });
  const align = earlier(target, {
    source: [
      ["甲", "あ"],
      ["乙", "いう"],
      ["丙", "え"],
    ],
  });
  assert.equal(deriveSeparatorAlignments(jmdict, kanjidic, align).wordAlignments.size, 0);
});

test("forwards explicit sound switches into independent source derivation", () => {
  const target = "甲乙・丙",
    sound = "かがな";
  const jmdict = {
    words: [word("1", [sourceSpelling, target], [{ text: sound, appliesToKanji: ["*"] }])],
  };
  const kanjidic = dictionary({ 甲: ["カ"], 乙: ["カ"], 丙: ["ナ"] });
  const align = earlier(target, {
    source: [
      ["甲", "か"],
      ["乙", "が"],
      ["丙", "な"],
    ],
  });
  const enabled = deriveSeparatorAlignments(jmdict, kanjidic, align, {
    rawAlignerOptions: { phonologicalAlternations: true },
  });
  assert.ok(resultSegments(enabled, target, sound));
  const disabled = deriveSeparatorAlignments(jmdict, kanjidic, align, {
    rawAlignerOptions: { phonologicalAlternations: false },
  });
  assert.equal(disabled.wordAlignments.size, 0);
});

test("does not accept source reading maps or callbacks through raw options", () => {
  const { jmdict, kanjidic, target } = inputs();
  for (const rawAlignerOptions of [
    { wordAlignments: new Map() },
    { weakCharacterReadings: new Map() },
    { align: () => ({}) },
    { terminalContraction: null },
  ]) {
    assert.throws(
      () => deriveSeparatorAlignments(jmdict, kanjidic, earlier(target), { rawAlignerOptions }),
      TypeError,
    );
  }
  assert.ok(
    resultSegments(
      deriveSeparatorAlignments(jmdict, kanjidic, earlier(target), {
        rawAlignerOptions: { terminalContraction: undefined },
      }),
      target,
    ),
  );
});

test("binds omitted identities to supplied inputs and clones explicit identities", () => {
  const { jmdict, kanjidic, target } = inputs();
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const inferred = deriveSeparatorAlignments(jmdict, kanjidic, earlier(target)).witnesses[0]
    .sourceIdentities;
  assert.equal(inferred.jmdict.inputSHA256, hash(jmdict));
  assert.equal(inferred.kanjidic.inputSHA256, hash(kanjidic));
  const jmdictSource = { version: "test", jsonSHA256: "a".repeat(64) },
    kanjidicSource = { version: "test", jsonSHA256: "b".repeat(64) };
  const supplied = deriveSeparatorAlignments(jmdict, kanjidic, earlier(target), {
    jmdictSource,
    kanjidicSource,
  }).witnesses[0].sourceIdentities;
  assert.deepEqual(supplied, { jmdict: jmdictSource, kanjidic: kanjidicSource });
  assert.notEqual(supplied.jmdict, jmdictSource);
  assert.throws(
    () => deriveSeparatorAlignments(jmdict, kanjidic, earlier(target), { jmdictSource: null }),
    TypeError,
  );
});
