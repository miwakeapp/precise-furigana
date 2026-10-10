import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonicalizeSegments, classifyBoundaries, compareReferenceRecord, normalizeKana, parseReferenceLine, referenceKey } from "../src/reference.mjs";

test("reference parsing retains empty bases and rejects broken parallel segments", () => {
  assert.equal(parseReferenceLine("# Generated: irrelevant"), undefined);
  assert.equal(parseReferenceLine(""), undefined);
  assert.deepEqual(parseReferenceLine("1913350;ヤブ..蚊;ヤブ.っ.か"), {
    id: "1913350", written: "ヤブ蚊", reading: "ヤブっか", segments: [["ヤブ", "ヤブ"], ["", "っ"], ["蚊", "か"]]
  });
  assert.throws(() => parseReferenceLine("1;学.校;がっこう"), /segment counts/u);
  assert.throws(() => parseReferenceLine("not-an-ID;学;がく"), /ID/u);
});

test("pair matching normalizes kana script and documents destructive delimiter escaping", () => {
  assert.equal(normalizeKana("ガッコウヽヾヴ"), "がっこうゝゞゔ");
  assert.equal(referenceKey(1, "ヤブ蚊", "やぶっか"), referenceKey("1", "ヤブ蚊", "ヤブっか"));
  assert.equal(referenceKey(1, "A.B;", "エー.ビー;"), referenceKey("1", "A．B；", "えー．びー；"));
  assert.notEqual(referenceKey(1, "A", "えー"), referenceKey(2, "A", "えー"));
});

test("sokuon after literal kana belongs to following kanji", () => {
  const reference = parseReferenceLine("1913350;ヤブ..蚊;ヤブ.っ.か");
  const result = compareReferenceRecord({ segments: [["ヤブ", "やぶ"], ["蚊", "っか"]] }, [reference]);
  assert.equal(result.category, "exact");
  assert.ok(result.flags.includes("sokuon-to-following-kanji"));
});

test("sokuon between kanji belongs to preceding kanji", () => {
  const reference = parseReferenceLine("1913350;藪..蚊;やぶ.っ.か");
  const result = compareReferenceRecord({ segments: [["藪", "やぶっ"], ["蚊", "か"]] }, [reference]);
  assert.equal(result.category, "exact");
  assert.ok(result.flags.includes("sokuon-to-preceding-kanji"));
});

test("non-sokuon zero-base reading and conflicting normalized records are explicitly ambiguous", () => {
  const reference = parseReferenceLine("1;日..本;ひ.の.もと");
  assert.equal(compareReferenceRecord({ segments: [["日", "ひの"], ["本", "もと"]] }, [reference]).category, "uncomparable");
  const alternatives = [parseReferenceLine("1;日.本;に.ほん"), parseReferenceLine("1;日本;ニホン")];
  const result = compareReferenceRecord({ segments: [["日", "に"], ["本", "ほん"]] }, alternatives);
  assert.equal(result.reason, "multiple-reference-alignments");
});

test("literal subdivisions are ignored while real kana-reading mismatches remain", () => {
  const actual = canonicalizeSegments([["ヤ", "や"], ["ブ", "ぶ"], ["蚊", "か"]]);
  const reference = canonicalizeSegments([["ヤブ", "ヤブ"], ["蚊", "か"]]);
  assert.equal(classifyBoundaries(actual.segments, reference.segments), "exact");
  const mismatch = canonicalizeSegments([["メン", "めん"], ["ド", "どう"], ["臭", "くさ"], "い"]);
  assert.equal(mismatch.segments.length, 4);
});

test("classifications describe boundary relationships without assigning correctness", () => {
  const split = [["日", "に"], ["本", "ほん"]];
  const grouped = [["日本", "にほん"]];
  assert.equal(classifyBoundaries(split, split), "exact");
  assert.equal(classifyBoundaries(split, grouped), "finer");
  assert.equal(classifyBoundaries(grouped, split), "coarser");
  assert.equal(classifyBoundaries([["一", "ひと"], ["突", "つ"], "き"], [["一", "ひ"], ["突", "とつ"], "き"]), "incompatible");
  assert.equal(classifyBoundaries([["証し", "あかし"], "を"], [["証", "あか"], "しを"]), "coarser");
  assert.equal(classifyBoundaries([["証", "あか"], "しを"], [["証し", "あかし"], "を"]), "finer");
});

test("boundary comparisons count supplementary-plane characters as one code point", () => {
  assert.equal(classifyBoundaries([["𠮷", "よし"], ["田", "だ"]], [["𠮷田", "よしだ"]]), "finer");
});

test("CLI filters IDs, separates missing pairs, and writes reproducible diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "precise-furigana-reference-"));
  try {
    const datasetPath = join(directory, "dataset.json");
    const referencePath = join(directory, "reference.txt");
    const outputPath = join(directory, "differences.jsonl");
    await writeFile(datasetPath, JSON.stringify({ entries: {
      "1": [
        { written: "日本", reading: "にほん", segments: [["日", "に"], ["本", "ほん"]], status: "aligned" },
        { written: "日本", reading: "にっぽん", segments: [["日", "にっ"], ["本", "ぽん"]], status: "aligned" }
      ],
      "2": [{ written: "A.B", reading: "えーびー", segments: [["A.B", "えーびー"]], status: "fallback" }],
      "3": [{ written: "今日", reading: "きょう", segments: [["今日", "きょう"]], status: "fallback" }]
    } }));
    await writeFile(referencePath, "# Generated: fixed\n1;日.本;ニ.ホン\n2;A．B;エービー\n9999999;他;ほか\n");
    const script = new URL("../scripts/compare-reference.mjs", import.meta.url);
    const run = () => promisify(execFile)(process.execPath, [script.pathname, datasetPath, referencePath, outputPath]);
    await run();
    const summaryPath = join(directory, "differences.summary.json");
    const summaryText = await readFile(summaryPath, "utf8");
    const differencesText = await readFile(outputPath, "utf8");
    const summary = JSON.parse(summaryText);
    assert.equal(summary.referenceRows, 3);
    assert.equal(summary.ignoredReferenceRows, 1);
    assert.equal(summary.records, 4);
    assert.equal(summary.counts.exact, 2);
    assert.equal(summary.counts.absent, 2);
    assert.deepEqual(summary.absence, { missingID: 1, missingPair: 1 });
    assert.equal(summary.normalization["reference-punctuation-escape-uncertain"], 1);
    assert.equal(differencesText.trim().split("\n").length, 2);
    await run();
    assert.equal(await readFile(summaryPath, "utf8"), summaryText);
    assert.equal(await readFile(outputPath, "utf8"), differencesText);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
