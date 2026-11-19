import assert from "node:assert/strict";
import test from "node:test";
import { chunkNumeral, chunkNumerals } from "../src/numeral-chunks.ts";
import type { Segment } from "../src/types.ts";

test("a numeral divides at each nonzero digit, which carries its place word", () => {
  assert.deepEqual(chunkNumeral("１１", "じゅういち"), [
    ["１", "じゅう"],
    ["１", "いち"],
  ]);
  assert.deepEqual(chunkNumeral("１９８２", "せんきゅうひゃくはちじゅうに"), [
    ["１", "せん"],
    ["９", "きゅうひゃく"],
    ["８", "はちじゅう"],
    ["２", "に"],
  ]);
  // Sound changes and counter forms are recognized.
  assert.deepEqual(chunkNumeral("１８６７", "せんはっぴゃくろくじゅうしち"), [
    ["１", "せん"],
    ["８", "はっぴゃく"],
    ["６", "ろくじゅう"],
    ["７", "しち"],
  ]);
  assert.deepEqual(chunkNumeral("２４", "にじゅうよっ"), [
    ["２", "にじゅう"],
    ["４", "よっ"],
  ]);
  // Kanji digits used positionally divide the same way.
  assert.deepEqual(chunkNumeral("一九八二", "せんきゅうひゃくはちじゅうに")?.length, 4);
});

test("zeros stay with the digit before them, and 万 follows the last digit of its group", () => {
  assert.deepEqual(chunkNumeral("１２０", "ひゃくにじゅっ"), [
    ["１", "ひゃく"],
    ["２０", "にじゅっ"],
  ]);
  assert.deepEqual(chunkNumeral("１０８", "ひゃくはち"), [
    ["１０", "ひゃく"],
    ["８", "はち"],
  ]);
  assert.deepEqual(chunkNumeral("８４０００", "はちまんよんせん"), [
    ["８", "はちまん"],
    ["４０００", "よんせん"],
  ]);
  assert.deepEqual(chunkNumeral("１２３４５６", "じゅうにまんさんぜんよんひゃくごじゅうろく"), [
    ["１", "じゅう"],
    ["２", "にまん"],
    ["３", "さんぜん"],
    ["４", "よんひゃく"],
    ["５", "ごじゅう"],
    ["６", "ろく"],
  ]);
  assert.deepEqual(chunkNumeral("２０５０００", "にじゅうまんごせん"), [
    ["２０", "にじゅうまん"],
    ["５０００", "ごせん"],
  ]);
});

test("a single chunk, a digit-by-digit reading, or an irregular reading is left alone", () => {
  for (const [digits, reading] of [
    ["１００", "ひゃく"],
    ["三〇", "さんじゅう"],
    ["二〇〇〇", "にせん"],
    ["７５３", "しちごさん"],
    ["二三", "にさん"],
    ["１１０", "ひゃくとお"],
    ["２０", "はつ"],
    ["山川", "やまかわ"],
  ]) {
    assert.equal(chunkNumeral(digits, reading), undefined, `${digits} ${reading}`);
  }
});

test("an alignment's digit segments are read as one numeral and divided again", () => {
  const known: Record<string, Segment[]> = {
    // A grouped numeral is divided, and its neighbors are kept.
    "２４日": [
      ["２４", "にじゅうよっ"],
      ["日", "か"],
    ],
    // A numeral that an earlier stage divided differently is put right.
    "２０１２年": [
      ["２０１", "にせんじゅう"],
      ["２", "に"],
      ["年", "ねん"],
    ],
    // Digits read one by one keep the division they have.
    "７５３": [
      ["７", "しち"],
      ["５", "ご"],
      ["３", "さん"],
    ],
    "１００倍": [
      ["１００", "ひゃく"],
      ["倍", "ばい"],
    ],
  };
  const align = chunkNumerals((spelling) => ({ status: "aligned", segments: known[spelling] }));
  assert.deepEqual(align("２４日", "にじゅうよっか").segments, [
    ["２", "にじゅう"],
    ["４", "よっ"],
    ["日", "か"],
  ]);
  assert.deepEqual(align("２０１２年", "にせんじゅうにねん").segments, [
    ["２０", "にせん"],
    ["１", "じゅう"],
    ["２", "に"],
    ["年", "ねん"],
  ]);
  assert.deepEqual(align("７５３", "しちごさん").segments, known["７５３"]);
  assert.deepEqual(align("１００倍", "ひゃくばい").segments, known["１００倍"]);
});
