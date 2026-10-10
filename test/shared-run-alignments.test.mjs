import assert from "node:assert/strict";
import test from "node:test";
import { deriveSharedRunAlignments } from "../src/shared-run-alignments.mjs";
import { compileLexicalEvidence } from "../src/lexical-evidence.mjs";
import { createAligner } from "../src/align.mjs";

function dictionary(values) {
  return { characters: Object.entries(values).map(([literal, forms]) => ({ literal,
    readingMeaning: { groups: [{ readings: forms.map(value => ({ type: "ja_on", value })) }] } })) };
}
function derive({ target = "甲乙丁", source = "甲乙丙", reading = "あいう", values = { 甲: ["ア"], 乙: ["イ"], 丙: ["ウ"], 丁: ["エ"] },
  sourceSegments = [["甲", "あ"], ["乙", "い"], ["丙", "う"]], targetSegments, sourceStatus = "aligned", targetStatus = "aligned", options = {} } = {}) {
  const jmdict = { words: [{ id: "1", kanji: [target, source].map(text => ({ text, tags: [] })),
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: [] }] };
  const align = (written, sound) => written === target ? { status: targetStatus, segments: targetSegments ?? [[written, sound]] } : { status: sourceStatus, segments: sourceSegments };
  return deriveSharedRunAlignments(jmdict, dictionary(values), align, { ...options,  });
}

test("transfers only the shared run's interior and preserves changed residue", () => {
  const result = derive();
  assert.deepEqual([...result.wordAlignments.values()][0].values().next().value, [["甲", "あ"], ["乙丁", "いう"]]);
  assert.equal(result.witnesses[0].units[0].fact.written, "甲乙");
  assert.equal(result.witnesses[0].units[0].sourcePair.written, "甲乙丙");
});

test("complete run endpoints must fit both target spelling and sound", () => {
  assert.equal(derive({ target: "甲乙" }).wordAlignments.size, 0);
});

test("every prior target cut constrains whole run placement", () => {
  assert.equal(derive({ targetSegments: [["甲乙", "あ"], ["丁", "いう"]] }).wordAlignments.size, 0);
  const accepted = derive({ targetSegments: [["甲乙", "あい"], ["丁", "う"]] });
  assert.deepEqual([...accepted.wordAlignments.values()][0].values().next().value, [["甲", "あ"], ["乙", "い"], ["丁", "う"]]);
});

test("requires a unique shared written occurrence", () => {
  assert.equal(derive({ target: "甲乙甲乙", reading: "あいあいう", values: { 甲: ["ア"], 乙: ["イ"], 丙: ["アイウ"] },
    sourceSegments: [["甲", "あ"], ["乙", "い"], ["丙", "あいう"]] }).wordAlignments.size, 0);
});

test("requires a unique shared reading occurrence", () => {
  assert.equal(derive({ reading: "あいあい", values: { 甲: ["ア"], 乙: ["イ"], 丙: ["アイ"] },
    sourceSegments: [["甲", "あ"], ["乙", "い"], ["丙", "あい"]] }).wordAlignments.size, 0);
});

test("withholds raw ambiguous source allocations", () => {
  assert.equal(derive({ reading: "あいうえ", values: { 甲: ["ア", "アイ"], 乙: ["イウ", "ウ"], 丙: ["エ"] },
    sourceSegments: [["甲", "あ"], ["乙", "いう"], ["丙", "え"]] }).wordAlignments.size, 0);
});

test("requires accepted source alignment to support every raw cut", () => {
  for (const sourceStatus of ["fallback", "ambiguous"]) assert.equal(derive({ sourceStatus }).wordAlignments.size, 0);
  assert.equal(derive({ sourceSegments: [["甲乙丙", "あいう"]] }).wordAlignments.size, 0);
});

test("withholds ambiguous and fallback targets", () => {
  for (const targetStatus of ["ambiguous", "fallback"]) assert.equal(derive({ targetStatus }).wordAlignments.size, 0);
});

test("a reviewed larger context vetoes a conflicting unit endpoint", () => {
  const reviewedFacts = compileLexicalEvidence([{ id: "reviewed", written: "甲乙丁", reading: "あいう", segments: [["甲乙", "あ"], ["丁", "いう"]],
    reason: "Synthetic context", sources: [{ url: "https://example.test/source" }] }]);
  assert.equal(derive({ options: { reviewedFacts } }).wordAlignments.size, 0);
});

test("mixed literal runs can retain independently supported character cuts", () => {
  const result = derive({ target: "甲あ丁", source: "甲あ乙", reading: "かあい", values: { 甲: ["カ"], 乙: ["イ"] },
    sourceSegments: [["甲", "か"], "あ", ["乙", "い"]] });
  assert.deepEqual([...result.wordAlignments.values()][0].values().next().value, [["甲", "か"], ["あ丁", "あい"]]);
});

test("forwards the reviewed raw sound switches without accepting inferred dictionaries", () => {
  const inputs = { reading: "かがな", values: { 甲: ["カ"], 乙: ["カ"], 丙: ["ナ"] },
    sourceSegments: [["甲", "か"], ["乙", "が"], ["丙", "な"]] };
  assert.equal(derive({ ...inputs, options: { rawAlignerOptions: { phonologicalAlternations: true } } }).wordAlignments.size, 1);
  assert.equal(derive({ ...inputs, options: { rawAlignerOptions: { phonologicalAlternations: false } } }).wordAlignments.size, 0);
  for (const rawAlignerOptions of [{ dictionaryUnvoicing: true }, { dictionaryRenjo: true }, { wordAlignments: new Map() }, { internalKanaAnchors: null }]) {
    assert.throws(() => derive({ options: { rawAlignerOptions } }), TypeError);
  }
});

test("binds source identities and raw character forms in every selected witness", () => {
  const unit = derive().witnesses[0].units[0];
  assert.match(unit.sourceIdentities.jmdict.inputSHA256, /^[a-f0-9]{64}$/u);
  assert.match(unit.sourceIdentities.kanjidic.inputSHA256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(unit.rawCharacterReadings, { 甲: ["ア"], 乙: ["イ"], 丙: ["ウ"] });
  assert.throws(() => derive({ options: { jmdictSource: null } }), TypeError);
});

test("rejects incomparable proposals from entries sharing a target pair", () => {
  const reading = "あいう", target = "甲乙丁";
  const jmdict = { words: [[target, "甲乙丙"], [target, "戊乙丁"]].map((spellings, index) => ({ id: String(index + 1),
    kanji: spellings.map(text => ({ text, tags: [] })), kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: [] })) };
  const kanjidic = dictionary({ 甲: ["ア"], 乙: ["イ"], 丙: ["ウ"], 戊: ["ア"], 丁: ["ウ"] });
  const align = written => ({ status: "aligned", segments: written === target ? [[written, reading]] :
    [...written].map((character, index) => [character, [...reading][index]]) });
  const result = deriveSharedRunAlignments(jmdict, kanjidic, align);
  assert.equal(result.counts.changed, 2);
  assert.equal(result.wordAlignments.size, 0);
  assert.equal(result.witnesses.length, 0);
});

test("retains both attested target witnesses when repeated entries agree", () => {
  const target = "甲乙丁", source = "甲乙丙", reading = "あいう";
  const jmdict = { words: ["1", "2"].map(id => ({ id, kanji: [target, source].map(text => ({ text, tags: [] })),
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: [] })) };
  const align = written => ({ status: "aligned", segments: written === target ? [[written, reading]] : [["甲", "あ"], ["乙", "い"], ["丙", "う"]] });
  const result = deriveSharedRunAlignments(jmdict, dictionary({ 甲: ["ア"], 乙: ["イ"], 丙: ["ウ"] }), align);
  assert.deepEqual(result.wordAlignments.get(target)?.get(reading), [["甲", "あ"], ["乙丁", "いう"]]);
  assert.deepEqual(result.witnesses.map(witness => witness.targetAttestation.id), ["1", "2"]);
});

function corresponding({ source = "甲う乙", target = "甲ふ乙", reading = "あうい", values = { 甲: ["ア"], 乙: ["イ"] },
  sourceSegments = [["甲", "あ"], "う", ["乙", "い"]], targetSegments, options = {}, restricted = false, sourceStatus = "aligned" } = {}) {
  const jmdict = { words: [{ id: "1", kanji: [source, target].map(text => ({ text, tags: [] })),
    kana: [{ text: reading, tags: [], appliesToKanji: restricted ? [target] : ["*"] }], sense: [] }] };
  const align = written => ({ written, reading, status: written === source ? sourceStatus : "aligned",
    segments: written === source ? sourceSegments : targetSegments ?? [[target, reading]] });
  const result = deriveSharedRunAlignments(jmdict, dictionary(values), align, options);
  return { ...result, proposed: result.wordAlignments.get(target)?.get(reading) };
}

test("one-to-one historical kana keep independent character ownership", () => {
  for (const [sourceKana, targetKana] of [["う", "ふ"], ["い", "ひ"], ["え", "へ"]]) {
    const result = corresponding({ source: `甲${sourceKana}乙`, target: `甲${targetKana}乙`, reading: `あ${sourceKana}い`,
      sourceSegments: [["甲", "あ"], sourceKana, ["乙", "い"]] });
    assert.deepEqual(result.proposed, [["甲", "あ"], [targetKana, sourceKana], ["乙", "い"]]);
    assert.equal(result.witnesses[0].units[0].kanaCorrespondences[0].rule, "historical-kana");
  }
});

test("kana voicing and vowel marks require one-to-one contextual ownership", () => {
  const voiced = corresponding({ source: "カド甲乙", target: "カト甲乙", reading: "かどあい", sourceSegments: [["カド", "かど"], ["甲", "あ"], ["乙", "い"]] });
  assert.deepEqual(voiced.proposed, [["カ", "か"], ["ト", "ど"], ["甲", "あ"], ["乙", "い"]]);
  const prolonged = corresponding({ source: "甲乙プレイ", target: "甲乙プレー", reading: "あいプレイ", sourceSegments: [["甲", "あ"], ["乙", "い"], "プレイ"] });
  assert.deepEqual(prolonged.proposed, [["甲", "あ"], ["乙", "い"], "プレ", ["ー", "イ"]]);
  for (const [source, target, reading] of [["甲乙クイ", "甲乙クー", "あいクイ"], ["甲乙う", "甲乙ー", "あいう"], ["甲乙かあき", "甲乙かきい", "あいかあき"]]) {
    const result = corresponding({ source, target, reading, sourceSegments: [["甲", "あ"], ["乙", "い"], source.slice(2)] });
    assert(result.witnesses.every(witness => witness.units.every(unit => !unit.kanaCorrespondences)));
  }
});

test("former unequal okurigana-run failures cannot supply kana correspondence facts", () => {
  for (const values of [
    { source: "当りまえ", target: "当たりめー", reading: "あたりまえ", values: { 当: ["あ.たる"] }, sourceSegments: [["当", "あた"], "りまえ"] },
    { source: "当たりめー", target: "当りまえ", reading: "あたりめー", values: { 当: ["あ.たる"] }, sourceSegments: [["当", "あ"], "たりめー"] },
    { source: "変りもの", target: "変わりもん", reading: "かわりもの", values: { 変: ["か.わる"] }, sourceSegments: [["変", "かわ"], "りもの"] }
  ]) assert.equal(corresponding(values).proposed, undefined);
});

test("equal written length does not license a shifted or multi-grapheme kana allocation", () => {
  const shifted = corresponding({ source: "甲う乙", target: "甲ふ乙", reading: "あううい", values: { 甲: ["ア"], 乙: ["イ"] },
    sourceSegments: [["甲", "あ"], ["う", "うう"], ["乙", "い"]] });
  assert.equal(shifted.proposed, undefined);
  const unrelated = corresponding({ source: "甲ぐそ乙", target: "甲ふん乙", reading: "あぐそい", sourceSegments: [["甲", "あ"], "ぐそ", ["乙", "い"]] });
  assert.equal(unrelated.proposed, undefined);
});

test("aligned internal-anchor ownership and inferred donor outputs cannot justify correspondence", () => {
  assert.equal(corresponding({ values: {} }).proposed, undefined);
  for (const sourceStatus of ["fallback", "ambiguous"]) assert.equal(corresponding({ sourceStatus }).proposed, undefined);
  assert.equal(corresponding({ sourceSegments: [["甲う乙", "あうい"]] }).proposed, undefined);
});

test("kana projection respects exact reading restrictions, old cuts and lexical endpoints", () => {
  assert.equal(corresponding({ restricted: true }).proposed, undefined);
  assert.equal(corresponding({ targetSegments: [["甲ふ", "あ"], ["乙", "うい"]] }).proposed, undefined);
  const reviewedFacts = compileLexicalEvidence([{ id: "local", written: "甲ふ乙", reading: "あうい", segments: [["甲ふ", "あ"], ["乙", "うい"]],
    reason: "Synthetic independently reviewed ownership", sources: [{ url: "https://example.test/local" }] }]);
  assert.equal(corresponding({ options: { reviewedFacts } }).proposed, undefined);
  const prior = corresponding({ targetSegments: [["甲ふ", "あう"], ["乙", "い"]] });
  assert.deepEqual(prior.proposed, [["甲", "あ"], ["ふ", "う"], ["乙", "い"]]);
});

test("existing sound switches and original combining-mark coordinates remain effective", () => {
  for (const rawAlignerOptions of [{ kanaRunCorrespondence: false }, { phonologicalAlternations: false }]) {
    assert.equal(corresponding({ options: { rawAlignerOptions } }).proposed, undefined);
  }
  const decomposed = corresponding({ source: "か\u3099甲う乙", target: "が甲ふ乙", reading: "か\u3099あうい", sourceSegments: ["か\u3099", ["甲", "あ"], "う", ["乙", "い"]] });
  assert.deepEqual(decomposed.proposed, [["が", "か\u3099"], ["甲", "あ"], ["ふ", "う"], ["乙", "い"]]);
});

test("a shorter reviewed endpoint vetoes the whole-target projected fact", () => {
  const reviewedFacts = compileLexicalEvidence([{ id: "prefix", written: "甲ふ", reading: "あ", segments: [["甲ふ", "あ"]],
    reason: "Synthetic independently supported prefix endpoint", sources: [{ url: "https://example.test/source" }] }]);
  assert.equal(corresponding({ options: { reviewedFacts } }).proposed, undefined);
});

test("script-equivalent runs stay grouped while preserving old cuts and new character ownership", () => {
  const values = { source: "カナ甲乙", target: "かな甲乙", reading: "カナあい", sourceSegments: ["カナ", ["甲", "あ"], ["乙", "い"]] };
  assert.deepEqual(corresponding(values).proposed, [["かな", "カナ"], ["甲", "あ"], ["乙", "い"]]);
  assert.equal(corresponding({ ...values, targetSegments: [["かな", "カナ"], ["甲", "あ"], ["乙", "い"]] }).proposed, undefined);
  assert.deepEqual(corresponding({ ...values, targetSegments: [["か", "カ"], ["な甲乙", "ナあい"]] }).proposed,
    [["か", "カ"], ["な", "ナ"], ["甲", "あ"], ["乙", "い"]]);
});

test("kana projections preserve cuts supplied by another shared-run witness", () => {
  const word = (id, spellings, reading) => ({ id, kanji: spellings.map(text => ({ text, tags: [] })),
    kana: [{ text: reading, tags: [], appliesToKanji: ["*"] }], sense: [] });
  const jmdict = { words: [word("1", ["手提"], "てさげ"),
    word("2", ["手提げバッグ", "手提バッグ", "手提バック"], "てさげバッグ")] };
  const accepted = new Map([
    ["手提", [["手", "て"], ["提", "さげ"]]],
    ["手提げバッグ", [["手", "て"], ["提", "さ"], "げバッグ"]],
    ["手提バッグ", [["手", "て"], ["提", "さげ"], "バッグ"]]
  ]);
  const align = (written, reading) => ({ status: "aligned", segments: accepted.get(written) ?? [[written, reading]] });
  const result = deriveSharedRunAlignments(jmdict, dictionary({ 手: ["て"], 提: ["さ"] }), align);
  assert.deepEqual(result.wordAlignments.get("手提バック")?.get("てさげバッグ"),
    [["手", "て"], ["提", "さげ"], "バッ", ["ク", "グ"]]);
});

test("long-vowel spelling correspondence follows its notation switch independently of phonology", () => {
  for (const [sourceKana, targetKana] of [["プレイ", "プレー"], ["プレー", "プレイ"]]) {
    const inputs = { source: `甲${sourceKana}`, target: `甲${targetKana}`, reading: `あ${sourceKana}`,
      sourceSegments: [["甲", "あ"], sourceKana] };
    const normal = corresponding(inputs);
    const withoutPhonology = corresponding({ ...inputs, options: { rawAlignerOptions: { phonologicalAlternations: false } } });
    assert.deepEqual(withoutPhonology.proposed, [["甲", "あ"], "プレ", [targetKana.at(-1), sourceKana.at(-1)]]);
    assert.deepEqual(withoutPhonology.proposed, normal.proposed);
    assert.equal(withoutPhonology.witnesses[0].units[0].kanaCorrespondences[0].rule, "long-vowel-notation");
    for (const phonologicalAlternations of [true, false]) {
      const disabled = corresponding({ ...inputs, options: { rawAlignerOptions: { phonologicalAlternations, kanaRunCorrespondence: false } } });
      assert.equal(disabled.proposed, undefined);
    }
  }
});

test("the existing core also keeps exact long-vowel notation when phonology is disabled", () => {
  const options = { characterReadings: new Map([["甲", ["ア"]]]), wordReadings: new Map([["コー甲", ["コウあ"]]]), phonologicalAlternations: false };
  const enabled = createAligner(options)("コー甲", "コウあ");
  assert.deepEqual(enabled.segments, ["コ", ["ー", "ウ"], ["甲", "あ"]]);
  assert(enabled.evidence.some(edge => edge.rules.includes("long-vowel-notation")));
  const disabled = createAligner({ ...options, kanaRunCorrespondence: false })("コー甲", "コウあ");
  assert.deepEqual(disabled.segments, ["コ", ["ー甲", "ウあ"]]);
  assert(disabled.evidence.every(edge => !edge.rules.includes("long-vowel-notation")));
});
