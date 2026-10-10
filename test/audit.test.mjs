import test from "node:test";
import assert from "node:assert/strict";
import { alignmentPoints, compareScores, locateTarget, scoreTarget } from "../scripts/lib/audit.mjs";

test("audit expands literal kana and normalizes script", () => {
  assert.deepEqual(alignmentPoints(["カナ", ["字", "じ"]]), [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }
  ]);
});

test("audit separates missing supported boundaries from unsupported assertions", () => {
  const accepted = [[["甲", "こう"], ["乙", "おつ"]]];
  const origin = { x: 0, y: 0 };
  const exact = scoreTarget(accepted[0], origin, "甲乙", accepted);
  const grouped = scoreTarget([["甲乙", "こうおつ"]], origin, "甲乙", accepted);
  const wrong = scoreTarget([["甲", "こ"], ["乙", "うおつ"]], origin, "甲乙", accepted);
  assert.equal(exact.status, "exact");
  assert.equal(grouped.status, "coarser");
  assert.equal(grouped.missed.length, 1);
  assert.equal(wrong.status, "unsupported");
  assert.equal(wrong.unsupported.length, 1);
  assert.equal(wrong.missed.length, 1);
  assert.equal(compareScores(exact, grouped), "left-dominates");
  assert.equal(compareScores(grouped, wrong), "left-dominates");
});

test("audit accepts alternate numeral conventions without a typography win", () => {
  const accepted = [[["２４", "にじゅうよん"]], [["２", "にじゅう"], ["４", "よん"]]];
  for (const candidate of accepted) assert.equal(scoreTarget(candidate, { x: 0, y: 0 }, "２４", accepted).status, "exact");
});

test("audit locates paired spans and counts lost outside anchors", () => {
  const packet = { written: "甲乙", reading: "こうおつ", context: { written: "前甲乙後", reading: "まえこうおつあと" } };
  const baseline = [["前", "まえ"], ["甲乙", "こうおつ"], ["後", "あと"]];
  assert.deepEqual(locateTarget(packet, baseline), [{ x: 1, y: 2 }]);
  const score = scoreTarget([["前甲乙後", "まえこうおつあと"]], { x: 1, y: 2 }, "甲乙", [[["甲", "こう"], ["乙", "おつ"]]]);
  assert.equal(score.status, "coarser");
  assert.equal(score.missed.length, 3);
});

test("audit preserves uncertainty and metric tradeoffs", () => {
  assert.equal(scoreTarget([["甲", "こう"]], { x: 0, y: 0 }, "甲", null).status, "unresolved-label");
  assert.equal(compareScores({ status: "coarser", missed: [1, 2], unsupported: [] }, { status: "unsupported", missed: [], unsupported: [1] }), "tradeoff");
});
