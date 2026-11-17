import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileLexicalEvidence, refineWithLexicalEvidence } from "../src/lexical-evidence.mjs";

const fact = (spelling, reading, segments) => ({ id: spelling, spelling, reading, segments, reason: "Independently reviewed local sound correspondence", sources: [{ url: "https://example.com/dictionary" }] });
const original = segments => ({ status: "aligned", segments });

test("reusable sound opt-ins identify complete safe single-character allocations", () => {
  const source = fact("甲乙", "あい", [["甲", "あ"], ["乙", "い"]]);
  assert.deepEqual(compileLexicalEvidence([{ ...source, reusableSegments: [0] }])[0].reusableSegments, [0]);
  assert.deepEqual(compileLexicalEvidence([{ ...source, reusableSegments: [] }])[0].reusableSegments, []);
  for (const reusableSegments of [null, 0, ["0"], [0, 0], [-1], [2], [0.5]]) {
    assert.throws(() => compileLexicalEvidence([{ ...source, reusableSegments }]), /reusableSegments/u);
  }
  assert.throws(() => compileLexicalEvidence([{ ...source, id: undefined, reusableSegments: [0] }]), /fact ID/u);
  for (const [spelling, reading, segments] of [
    ["甲乙", "あい", [["甲乙", "あい"]]], ["あ", "あ", ["あ"]], ["々", "あ", [["々", "あ"]]],
    ...["ぁ", "っ", "ん", "ー"].map(reading => ["甲", reading, [["甲", reading]]])
  ]) assert.throws(() => compileLexicalEvidence([{ ...fact(spelling, reading, segments), reusableSegments: [0] }]), /reusableSegments/u);
});

test("source entries are JMdict IDs", () => {
  const source = fact("甲乙", "あい", [["甲", "あ"], ["乙", "い"]]);
  assert.deepEqual(compileLexicalEvidence([{ ...source, jmdictEntries: ["1000390"] }])[0].jmdictEntries, ["1000390"]);
  for (const jmdictEntries of ["1000390", [1000390], ["JMdict:1000390"]]) {
    assert.throws(() => compileLexicalEvidence([{ ...source, jmdictEntries }]), /jmdictEntries/u);
  }
});

test("reviewed contractions remain local while exact-script projections are retained", () => {
  const facts = compileLexicalEvidence([
    fact("商人", "あきんど", [["商", "あき"], ["人", "んど"]]),
    fact("薩婆訶", "そわか", [["薩", "そ"], ["婆", "わ"], ["訶", "か"]])
  ]);
  assert.deepEqual(refineWithLexicalEvidence(original([["旅商人", "たびあきんど"]]), facts).segments, [["旅商", "たびあき"], ["人", "んど"]]);
  assert.deepEqual(refineWithLexicalEvidence(original([["薩婆訶", "ソワカ"]]), facts).segments, [["薩", "ソ"], ["婆", "ワ"], ["訶", "カ"]]);
  assert.deepEqual(refineWithLexicalEvidence(original([["旅人", "たびんど"]]), facts).segments, [["旅人", "たびんど"]]);
});

test("reviewed units cannot move existing boundaries or choose ambiguous placements", () => {
  const facts = compileLexicalEvidence([fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]])]);
  const prior = original([["丙甲", "くか"], ["乙", "き"]]);
  assert.equal(refineWithLexicalEvidence(prior, facts), prior);
  const repeated = original([["丙甲乙丁", "くかきかきけ"]]);
  assert.equal(refineWithLexicalEvidence(repeated, facts), repeated);
});

test("conflicting reviewed placements remain grouped independent of fact order", () => {
  const facts = compileLexicalEvidence([
    fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]]),
    fact("乙丙", "きくけ", [["乙", "きく"], ["丙", "け"]])
  ]);
  const prior = original([["甲乙丙", "かきくけ"]]);
  assert.equal(refineWithLexicalEvidence(prior, facts), prior);
  assert.equal(refineWithLexicalEvidence(prior, facts.toReversed()), prior);
});

test("a larger reviewed context rejects a shorter unit's contradicted endpoint", () => {
  const facts = compileLexicalEvidence([
    fact("真似", "まね", [["真", "ま"], ["似", "ね"]]),
    fact("真似鶫", "まねしつぐみ", [["真似", "まねし"], ["鶫", "つぐみ"]])
  ]);
  for (const ordered of [facts, facts.toReversed()]) {
    const result = refineWithLexicalEvidence(original([["真似鶫", "まねしつぐみ"]]), ordered);
    assert.deepEqual(result.segments, [["真似", "まねし"], ["鶫", "つぐみ"]]);
    assert.deepEqual(result.evidence.map(item => item.facts), [["真似鶫"], ["真似鶫"]]);
    assert.deepEqual(refineWithLexicalEvidence(original([["真似鶫科", "マネシツグミカ"]]), ordered).segments,
      [["真似", "マネシ"], ["鶫科", "ツグミカ"]]);
  }
  // The longer context does not change the separately attested short word.
  assert.deepEqual(refineWithLexicalEvidence(original([["真似", "まね"]]), facts).segments, [["真", "ま"], ["似", "ね"]]);
});

test("context dominance also checks a shorter unit's starting endpoint", () => {
  const facts = compileLexicalEvidence([
    fact("乙丙", "きくけ", [["乙", "きく"], ["丙", "け"]]),
    fact("甲乙丙", "あきくけ", [["甲", "あき"], ["乙丙", "くけ"]])
  ]);
  assert.deepEqual(refineWithLexicalEvidence(original([["甲乙丙", "あきくけ"]]), facts).segments,
    [["甲", "あき"], ["乙丙", "くけ"]]);
});

test("containing facts do not break ties between conflicting internal cuts", () => {
  const facts = compileLexicalEvidence([
    fact("甲乙", "あいう", [["甲", "あ"], ["乙", "いう"]]),
    fact("甲乙丙", "あいうえ", [["甲", "あい"], ["乙", "う"], ["丙", "え"]])
  ]);
  const prior = original([["甲乙丙", "あいうえ"]]);
  assert.equal(refineWithLexicalEvidence(prior, facts), prior);
  assert.equal(refineWithLexicalEvidence(prior, facts.toReversed()), prior);
});

test("equally specific facts cannot invalidate each other's endpoints", () => {
  const facts = compileLexicalEvidence([
    fact("甲乙", "あい", [["甲", "あ"], ["乙", "い"]]),
    fact("甲乙", "あいう", [["甲", "あい"], ["乙", "う"]])
  ]);
  const prior = original([["甲乙丙", "あいうえ"]]);
  assert.equal(refineWithLexicalEvidence(prior, facts), prior);
  assert.equal(refineWithLexicalEvidence(prior, facts.toReversed()), prior);
});

test("a grouped context preserves compatible independently supported internal cuts", () => {
  const facts = compileLexicalEvidence([
    fact("甲乙", "あいう", [["甲", "あ"], ["乙", "いう"]]),
    fact("甲乙丙", "あいうえ", [["甲乙", "あいう"], ["丙", "え"]])
  ]);
  assert.deepEqual(refineWithLexicalEvidence(original([["甲乙丙", "あいうえ"]]), facts).segments,
    [["甲", "あ"], ["乙", "いう"], ["丙", "え"]]);
});

test("a rejected context cannot invalidate a compatible shorter occurrence", () => {
  const facts = compileLexicalEvidence([
    fact("甲乙", "あい", [["甲", "あ"], ["乙", "い"]]),
    fact("甲乙丙", "あいう", [["甲乙", "あ"], ["丙", "いう"]]),
    fact("甲乙丙丁", "あいうえお", [["甲乙丙", "あいうえ"], ["丁", "お"]])
  ]);
  const permutations = [facts, [facts[0], facts[2], facts[1]], [facts[1], facts[0], facts[2]],
    [facts[1], facts[2], facts[0]], [facts[2], facts[0], facts[1]], facts.toReversed()];
  for (const ordered of permutations) {
    const result = refineWithLexicalEvidence(original([["甲乙丙丁", "あいうえお"]]), ordered);
    assert.deepEqual(result.segments, [["甲", "あ"], ["乙丙", "いうえ"], ["丁", "お"]]);
    assert.deepEqual(result.evidence.map(item => item.facts), Array(3).fill(["甲乙丙丁", "甲乙"]));
  }
});

test("a known word's internal cuts do not assign an unprinted particle to its neighbor", () => {
  const facts = compileLexicalEvidence([fact("博士", "はかせ", [["博", "はか"], ["士", "せ"]])]);
  assert.deepEqual(refineWithLexicalEvidence(original([["音博士", "こえのはかせ"]]), facts).segments, [["音博", "こえのはか"], ["士", "せ"]]);
});

test("a named unit cannot cut off an unknown long vowel or nasal continuation", () => {
  const facts = compileLexicalEvidence([fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]])]);
  for (const reading of ["かきゃ", "かきん", "かきー", "かきっ"]) {
    const prior = original([["甲乙丙", reading]]);
    assert.equal(refineWithLexicalEvidence(prior, facts), prior);
  }
});

test("reviewed source data has complete projections and no duplicate normalized pairs", async () => {
  const bundle = JSON.parse(await readFile(new URL("../data/lexical-evidence.json", import.meta.url), "utf8"));
  assert.equal(compileLexicalEvidence(bundle.facts).length, bundle.facts.length);
  const value = fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]]);
  assert.throws(() => compileLexicalEvidence([value, value]), /Duplicate/u);
});

const compile = (...facts) => compileLexicalEvidence(facts);

test("a complete fact crosses a literal boundary and preserves unchanged evidence", () => {
  const literal = { spelling: "う", reading: "う", type: "literal", rules: ["original-literal"] };
  const known = { spelling: "丙", reading: "く", type: "character", rules: ["original-proof"] };
  const original = { segments: [["甲乙", "かき"], "う", ["丙", "く"]], evidence: [{ type: "dictionary" }, literal, known], status: "ambiguous", score: { cost: 99 } };
  const result = refineWithLexicalEvidence(original, compile(fact("甲乙う丙", "かきうく", [["甲", "か"], ["乙", "き"], "う", ["丙", "く"]])));
  assert.deepEqual(result.segments, [["甲", "か"], ["乙", "き"], "う", ["丙", "く"]]);
  assert.equal(result.evidence[2], literal);
  assert.equal(result.evidence[3], known);
  assert.equal(result.segments[3], original.segments[2]);
  assert.equal(result.status, original.status);
  assert.equal(result.score, original.score);
});

test("a fact contradicting an existing coordinate cannot move that coordinate", () => {
  const original = { segments: [["甲", "あ"], ["乙丙", "いうえ"]], status: "aligned" };
  const conflict = fact("甲乙丙", "あいうえ", [["甲", "あい"], ["乙", "う"], ["丙", "え"]]);
  assert.equal(refineWithLexicalEvidence(original, compile(conflict)), original);
  const compatible = fact("乙丙", "いうえ", [["乙", "い"], ["丙", "うえ"]]);
  assert.deepEqual(refineWithLexicalEvidence(original, compile(conflict, compatible)).segments, [["甲", "あ"], ["乙", "い"], ["丙", "うえ"]]);
});

test("repeated written occurrences refine when each reading placement is anchored", () => {
  const original = { segments: [["甲乙", "かき"], "う", ["甲乙", "かき"]], status: "aligned" };
  assert.deepEqual(refineWithLexicalEvidence(original, compile(fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]]))).segments,
    [["甲", "か"], ["乙", "き"], "う", ["甲", "か"], ["乙", "き"]]);
});

test("an existing boundary owns a following literal small kana", () => {
  const original = { segments: [["甲乙", "かき"], "っぽい"], status: "aligned" };
  assert.deepEqual(refineWithLexicalEvidence(original, compile(fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]]))).segments,
    [["甲", "か"], ["乙", "き"], "っぽい"]);
});

test("a cross-boundary fact emits only internal points and preserves surrounding material", () => {
  const original = { segments: [["丁甲乙", "たかき"], "う", ["丙戊", "くつ"]], status: "aligned" };
  const result = refineWithLexicalEvidence(original, compile(fact("甲乙う丙", "かきうく", [["甲", "か"], ["乙", "き"], "う", ["丙", "く"]])));
  assert.deepEqual(result.segments, [["丁甲", "たか"], ["乙", "き"], "う", ["丙戊", "くつ"]]);
});

test("a full grouped context permits compatible finer cuts across an old boundary", () => {
  const original = { segments: [["甲乙", "かき"], "う", ["丙", "く"]], status: "aligned" };
  const finer = fact("甲乙", "かき", [["甲", "か"], ["乙", "き"]]);
  const grouped = fact("甲乙う丙", "かきうく", [["甲乙", "かき"], "う", ["丙", "く"]]);
  for (const facts of [compile(grouped, finer), compile(finer, grouped)]) assert.deepEqual(refineWithLexicalEvidence(original, facts).segments, [["甲", "か"], ["乙", "き"], "う", ["丙", "く"]]);
});

test("original grapheme coordinates survive a decomposed kana prefix", () => {
  const original = { segments: ["か\u3099", ["甲乙", "あい"], "う"], status: "aligned" };
  const result = refineWithLexicalEvidence(original, compile(fact("が甲乙う", "があいう", ["が", ["甲", "あ"], ["乙", "い"], "う"])));
  // Written matching remains exact; normalization does not invent a glyph match.
  assert.equal(result, original);
  const exact = fact("か\u3099甲乙う", "があいう", [["か\u3099", "が"], ["甲", "あ"], ["乙", "い"], "う"]);
  assert.deepEqual(refineWithLexicalEvidence(original, compile(exact)).segments, ["か\u3099", ["甲", "あ"], ["乙", "い"], "う"]);
});
