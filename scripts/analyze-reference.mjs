import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { canonicalizeSegments, normalizeKana } from "../src/reference.mjs";
import { isIdeograph, isKana, readingStem } from "../src/kana.mjs";
import { loadSources, makeCharacterReadings, makeWordReadings } from "../src/sources.mjs";

const [inputPath = "dist/reference-differences.jsonl", outputDirectory = ".cache/reference-analysis"] = process.argv.slice(2);
const { jmdict, kanjidic, lock } = await loadSources();
const characterReadings = makeCharacterReadings(kanjidic);
const wordReadings = makeWordReadings(jmdict);
const families = new Map();
const units = new Map();
const categoryRows = new Map();
const pairRows = [];
let spanCount = 0;

function support(written, reading) {
  const normalized = normalizeKana(reading);
  if (normalizeKana(written) === normalized) return "literal";
  if ((wordReadings.get(written) ?? []).some(value => normalizeKana(value) === normalized)) return "word";
  if ((characterReadings.get(written) ?? []).some(value => readingStem(value) === normalized)) return "character";
  if ((characterReadings.get(written) ?? []).some(value => normalizeKana(value.replaceAll(".", "").replace(/^-|-$/gu, "")) === normalized)) return "whole-kun-reading";
  return isIdeograph(written) ? "missing-character-reading" : "missing-word-reading";
}

function positions(segments) {
  let writtenOffset = 0;
  let readingOffset = 0;
  return segments.map(([written, reading]) => {
    const result = { written, reading, writtenStart: writtenOffset, readingStart: readingOffset };
    writtenOffset += [...written].length;
    readingOffset += [...reading].length;
    return { ...result, writtenEnd: writtenOffset, readingEnd: readingOffset };
  });
}

for await (const line of createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity })) {
  const row = JSON.parse(line);
  if (row.category !== "coarser") continue;
  const actual = positions(canonicalizeSegments(row.actual).segments);
  const reference = positions(canonicalizeSegments(row.reference[0], { reference: true }).segments);
  const spans = [];
  for (const segment of actual) {
    if (normalizeKana(segment.written) === segment.reading) continue;
    const finer = reference.filter(part => part.writtenStart >= segment.writtenStart && part.writtenEnd <= segment.writtenEnd && part.readingStart >= segment.readingStart && part.readingEnd <= segment.readingEnd);
    if (finer.length < 2) continue;
    if (finer[0].writtenStart !== segment.writtenStart || finer[0].readingStart !== segment.readingStart || finer.at(-1).writtenEnd !== segment.writtenEnd || finer.at(-1).readingEnd !== segment.readingEnd) continue;
    const parts = finer.map(part => ({ written: part.written, reading: part.reading, support: support(part.written, part.reading) }));
    const missing = parts.filter(part => part.support.startsWith("missing-"));
    const hasKana = [...segment.written].some(isKana);
    const category = hasKana ? "mixed-kana-span" : missing.length === 0 ? "supported-units-grouped" : missing.length === 1 && missing[0].support === "missing-character-reading" ? "one-missing-character-reading" : missing.some(part => part.support === "missing-word-reading") ? "missing-word-unit" : "multiple-missing-character-readings";
    const key = JSON.stringify([segment.written, segment.reading, parts.map(part => [part.written, part.reading])]);
    const family = families.get(key) ?? { written: segment.written, reading: segment.reading, parts, category, occurrences: 0, ids: new Set(), examples: [] };
    family.occurrences++;
    family.ids.add(row.id);
    if (family.examples.length < 3) family.examples.push({ id: row.id, written: row.written, reading: row.reading });
    families.set(key, family);
    for (const part of missing) {
      const unitKey = JSON.stringify([part.written, part.reading]);
      const unit = units.get(unitKey) ?? { written: part.written, reading: part.reading, occurrences: 0, rows: new Set(), contexts: new Set(), licensedCharacterReadings: characterReadings.get(part.written) ?? [], examples: [] };
      unit.occurrences++;
      unit.rows.add(JSON.stringify([row.id, row.written, row.reading]));
      unit.contexts.add(JSON.stringify([segment.written, segment.reading]));
      if (unit.examples.length < 3) unit.examples.push({ id: row.id, written: row.written, reading: row.reading });
      units.set(unitKey, unit);
    }
    const categorySet = categoryRows.get(category) ?? new Set();
    categorySet.add(JSON.stringify([row.id, row.written, row.reading]));
    categoryRows.set(category, categorySet);
    spans.push({ written: segment.written, reading: segment.reading, category, parts });
    spanCount++;
  }
  pairRows.push({ id: row.id, written: row.written, reading: row.reading, spans });
}
const familyRows = [...families.values()].map(({ ids, ...row }) => ({ ...row, entries: ids.size })).sort((left, right) => right.occurrences - left.occurrences || JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
const unitRows = [...units.values()].map(({ rows, contexts, ...row }) => ({ ...row, pairs: rows.size, contexts: contexts.size })).sort((left, right) => right.pairs - left.pairs || JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
const summary = {
  notice: "Diagnostic reference discrepancies, not validated missing readings or generation inputs. Category membership can overlap across spans of one pair.",
  sourceRelease: lock.release.tag,
  inputPath,
  coarserPairs: pairRows.length,
  extractedSpans: spanCount,
  spanFamilies: familyRows.length,
  unexplainedPairs: pairRows.filter(row => row.spans.length === 0).length,
  categoryPairs: Object.fromEntries([...categoryRows].map(([key, rows]) => [key, rows.size]).sort((left, right) => right[1] - left[1])),
  topFamilies: familyRows.slice(0, 30),
  topMissingUnits: unitRows.slice(0, 40)
};
await mkdir(outputDirectory, { recursive: true });
for (const [name, rows] of [["pairs", pairRows], ["families", familyRows], ["missing-units", unitRows]]) await writeFile(join(outputDirectory, `${name}.jsonl`), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, undefined, 2) + "\n");
console.log(JSON.stringify({ coarserPairs: summary.coarserPairs, extractedSpans: summary.extractedSpans, spanFamilies: summary.spanFamilies, unexplainedPairs: summary.unexplainedPairs, categoryPairs: summary.categoryPairs, outputDirectory }, undefined, 2));
