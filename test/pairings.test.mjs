import assert from "node:assert/strict";
import test from "node:test";
import { contradictsSpelling, fitsSpelling, impliedReading, isMismatched, planSynthesizedPairs } from "../src/pairings.mjs";

test("a reading fits a spelling when the spelling's kana appear in it in order", () => {
  assert.ok(fitsSpelling("気持ちいい", "きもちいい"));
  assert.ok(!fitsSpelling("気持ちよい", "きもちいい"));
  assert.ok(!fitsSpelling("元どうり", "もとどおり"));
  assert.ok(fitsSpelling("親ネコ", "おやねこ"));
  assert.ok(fitsSpelling("何ヶ月", "なんかげつ"));
  assert.ok(fitsSpelling("士・農・工・商", "しのうこうしょう"));
  assert.ok(fitsSpelling("怪レい日本語", "あやしいにほんご"));
  // A kanji can absorb an omitted particle, which the omitted-particle sites catch instead.
  assert.ok(fitsSpelling("そっぽ向く", "そっぽをむく"));
  assert.ok(contradictsSpelling("そっぽ向く", "そっぽをむく", [{ offset: 3, particle: "を" }]));
});

test("only pairs with a search-only form are flagged as mismatched", () => {
  const pair = (written, reading, writtenTags = [], readingTags = []) => ({ written, reading, writtenTags, readingTags });
  assert.ok(isMismatched(pair("気持ちよい", "きもちいい", ["sK"])));
  assert.ok(isMismatched(pair("一日じゅう", "いちにちぢゅう", [], ["sk"])));
  assert.ok(!isMismatched(pair("宣ふ", "のたまう")));
  assert.ok(!isMismatched(pair("気持ちいい", "きもちいい", ["sK"])));
});

test("the implied reading keeps contradicted kana as written and removes an omitted particle", () => {
  assert.equal(impliedReading([["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"]), "きもちよい");
  assert.equal(impliedReading(["そっぽ", ["向", "をむ"], "く"], [{ offset: 3, particle: "を" }]), "そっぽむく");
  assert.equal(impliedReading([["水", "みずを"], ["差", "さ"], "す"], [{ offset: 1, particle: "を" }]), "みずさす");
  assert.equal(impliedReading([["外方向", "そっぽをむ"], "く"], [{ offset: 2, particle: "を" }]), undefined);
});

test("only spellings without a fitting pair need a synthesized one, and the reviewed list must match", () => {
  const records = [
    { id: "1", written: "気持ちよい", reading: "きもちいい", segments: [["気", "き"], ["持", "も"], "ち", ["よ", "い"], "い"] },
    { id: "2", written: "一日じゅう", reading: "いちにちじゅう", segments: [["一", "いち"], ["日", "にち"], "じゅう"] },
    { id: "2", written: "一日じゅう", reading: "いちにちぢゅう", segments: [["一", "いち"], ["日", "にち"], ["じ", "ぢ"], "ゅう"] }
  ];
  const jmdictPairs = new Set(records.map(record => `${record.id}\t${record.written}\t${record.reading}`));
  const missing = planSynthesizedPairs(records, new Map(), [], jmdictPairs);
  assert.deepEqual(missing.missing.map(item => [item.written, item.reading]), [["気持ちよい", "きもちよい"]]);
  assert.ok(missing.problems.length > 0);
  const item = { id: "1", written: "気持ちよい", reading: "きもちよい", upstream: "none", note: "" };
  const planned = planSynthesizedPairs(records, new Map(), [item], jmdictPairs);
  assert.deepEqual(planned.problems, []);
  assert.deepEqual(planned.pairs, [item]);
  // A listed pair that JMdict now has, or that no longer needs synthesizing, must be removed.
  assert.ok(planSynthesizedPairs(records, new Map(), [item, { ...item, id: "2", written: "一日じゅう", reading: "いちにちじゅう" }], jmdictPairs).problems.length > 0);
  assert.ok(planSynthesizedPairs(records, new Map(), [item], new Set([...jmdictPairs, "1\t気持ちよい\tきもちよい"])).problems.length > 0);
  assert.ok(planSynthesizedPairs(records, new Map(), [{ ...item, reading: "きもちええ" }], jmdictPairs).problems.length > 0);
  assert.ok(planSynthesizedPairs(records, new Map(), [{ ...item, upstream: "unreviewed" }], jmdictPairs).problems.length > 0);
});
