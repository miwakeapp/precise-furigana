import assert from "node:assert/strict";
import test from "node:test";
import { boundaries, combineAlignments, validateAlignment } from "../src/segments.ts";

test("segments preserve the exact spelling and reading, including script", () => {
  validateAlignment("ヤブ蚊", "やぶっか", [
    ["ヤブ", "やぶ"],
    ["蚊", "っか"],
  ]);
  assert.throws(() => validateAlignment("ヤブ蚊", "やぶっか", ["ヤブ", ["蚊", "っか"]]));
  assert.throws(() =>
    validateAlignment("蚊", "っか", [
      ["", "っ"],
      ["蚊", "か"],
    ]),
  );
  assert.throws(() => validateAlignment("蚊", "か", [["蚊", ""]]));
});

test("boundary coordinates count supplementary-plane characters once", () => {
  assert.deepEqual(
    boundaries([
      ["𠮷", "よし"],
      ["野", "の"],
    ]),
    ["1:2"],
  );
});

test("independent word evidence retains compatible refinements of both halves", () => {
  const first = [
    ["甲", "こう"],
    ["乙", "おつ"],
    ["丙丁", "へいてい"],
  ];
  const second = [
    ["甲乙", "こうおつ"],
    ["丙", "へい"],
    ["丁", "てい"],
  ];
  assert.deepEqual(combineAlignments(first, second), [
    ["甲", "こう"],
    ["乙", "おつ"],
    ["丙", "へい"],
    ["丁", "てい"],
  ]);
  assert.deepEqual(combineAlignments(second, first), combineAlignments(first, second));
});

test("conflicting or crossing word evidence retains the earlier alignment", () => {
  const first = [
    ["甲", "こう"],
    ["乙丙", "おつへい"],
  ];
  assert.equal(
    combineAlignments(first, [
      ["甲", "こ"],
      ["乙", "うおつ"],
      ["丙", "へい"],
    ]),
    first,
  );
  assert.equal(
    combineAlignments(first, [
      ["甲乙", "こ"],
      ["丙", "うおつへい"],
    ]),
    first,
  );
  assert.throws(() => combineAlignments(first, [["甲乙丙", "べつのよみ"]]), /reconstruct/u);
});
