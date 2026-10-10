import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeSegments, normalizeKana } from "../src/reference.mjs";
import { loadSources } from "../src/sources.mjs";

const outputDirectory = ".cache/holdout-v1";
const frozenManifest = join(outputDirectory, "manifest.sealed.json");
if (await access(frozenManifest).then(() => true, error => {
  if (error.code === "ENOENT") return false;
  throw error;
})) throw new Error(`Refusing to overwrite frozen audit manifest: ${frozenManifest}`);
const seed = "precise-furigana-independent-family-audit-2026-10-09-v1";
const rank = key => createHash("sha256").update(seed + "\0" + key).digest("hex");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const datasetBytes = await readFile("dist/precise-furigana.json");
const dataset = JSON.parse(datasetBytes);
const differences = (await readFile("dist/reference-differences.jsonl", "utf8")).trim().split("\n").map(JSON.parse);
const missingKeys = new Set(differences.map(row => JSON.stringify([row.id, row.written, row.reading])));
const { jmdict, kanjidic, lock } = await loadSources();
const words = new Map(jmdict.words.map(word => [word.id, word]));
const characters = new Map(kanjidic.characters.map(character => [character.literal, character.readingMeaning]));
let discussed = "文字 時計 心地 部屋 可愛 硝子 奈良 神戸 合気 合氣 細小小笹 薔薇";
for (const directory of ["docs", "test", "data"]) for (const name of await readdir(directory)) {
  if (!/\.(?:md|mjs|json)$/u.test(name) || name === "sources.lock.json") continue;
  discussed += "\n" + await readFile(join(directory, name), "utf8");
}
const allFamilies = (await readFile(".cache/reference-analysis/families.jsonl", "utf8")).trim().split("\n").map(JSON.parse);
for (const family of allFamilies.slice(0, 30)) discussed += " " + family.written;
const eligible = written => [...written].length >= 2 && !discussed.includes(written) && !written.includes("薔薇");
const strata = new Map();
function add(stratum, row) {
  if (!eligible(row.written)) return;
  const values = strata.get(stratum) ?? new Map();
  const key = JSON.stringify([row.written, row.reading]);
  if (!values.has(key)) values.set(key, { ...row, key, stratum, rank: rank(key) });
  strata.set(stratum, values);
}
for (const row of allFamilies) if (row.category !== "supported-units-grouped") add(row.category, { written: row.written, reading: row.reading, occurrences: row.occurrences, examples: row.examples });
function points(segments) {
  const result = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  for (const [written, reading] of segments) {
    const literal = normalizeKana(written) === reading;
    const pieces = literal ? [...written].map(character => [character, normalizeKana(character)]) : [[written, reading]];
    for (const [w, r] of pieces) { x += [...w].length; y += [...r].length; result.push({ x, y }); }
  }
  return result;
}
for (const row of differences) {
  if (!["finer", "incompatible"].includes(row.category)) continue;
  const actual = canonicalizeSegments(row.actual).segments;
  const reference = canonicalizeSegments(row.reference[0], { reference: true }).segments;
  const a = points(actual), r = points(reference), rKeys = new Set(r.map(point => `${point.x}:${point.y}`));
  const shared = a.filter(point => rKeys.has(`${point.x}:${point.y}`));
  const written = [...actual.map(part => part[0]).join("")], reading = [...actual.map(part => part[1]).join("")];
  for (let index = 1; index < shared.length; index++) {
    const start = shared[index - 1], end = shared[index];
    const inside = list => list.filter(point => point.x > start.x && point.x < end.x && point.y > start.y && point.y < end.y).map(point => `${point.x}:${point.y}`).join(",");
    if (inside(a) === inside(r)) continue;
    add(row.category, { written: written.slice(start.x, end.x).join(""), reading: reading.slice(start.y, end.y).join(""), occurrences: 1, examples: [{ id: row.id, written: row.written, reading: row.reading }] });
  }
}
for (const [id, rows] of Object.entries(dataset.entries)) for (const row of rows) {
  if (missingKeys.has(JSON.stringify([id, row.written, row.reading]))) continue;
  if (!/\p{Script=Han}/u.test(row.written)) continue;
  add("exact-control", { written: row.written, reading: normalizeKana(row.reading), occurrences: 1, examples: [{ id, written: row.written, reading: row.reading }] });
}
const quota = { "one-missing-character-reading": 150, "multiple-missing-character-readings": 75, "mixed-kana-span": 50, "missing-word-unit": 25, incompatible: 60, finer: 30, "exact-control": 60 };
const selected = [];
const selectedKeys = new Set();
for (const [stratum, count] of Object.entries(quota)) {
  const candidates = [...(strata.get(stratum)?.values() ?? [])].sort((left, right) => left.rank.localeCompare(right.rank, "en"));
  for (const row of candidates) {
    if (selected.filter(value => value.stratum === stratum).length >= count) break;
    if (selectedKeys.has(row.key) || selected.some(value => row.written.includes(value.written) && row.reading.includes(value.reading) || value.written.includes(row.written) && value.reading.includes(row.reading))) continue;
    selected.push(row); selectedKeys.add(row.key);
  }
}
let idCounter = 0;
const manifest = selected.map(row => ({ auditId: `H${String(++idCounter).padStart(4, "0")}`, ...row }));
const blind = manifest.map(({ auditId, written, reading, examples }) => {
  const example = examples[0], word = words.get(example.id);
  return {
    auditId, written, reading, context: example,
    dictionary: { spellings: word.kanji.map(value => value.text), readings: word.kana, senses: word.sense.filter(sense => sense.gloss.some(gloss => gloss.lang === "eng")).map(sense => ({ partOfSpeech: sense.partOfSpeech, misc: sense.misc, appliesToKanji: sense.appliesToKanji, appliesToKana: sense.appliesToKana, gloss: sense.gloss.filter(gloss => gloss.lang === "eng").slice(0, 3).map(gloss => gloss.text) })) },
    characters: Object.fromEntries([...new Set([...written])].filter(character => characters.has(character)).map(character => [character, { readings: characters.get(character).groups.flatMap(group => group.readings).filter(value => value.type.startsWith("ja_")).map(value => value.value), nanori: characters.get(character).nanori }]))
  };
});
const excludedIds = new Set();
for (const [id, rows] of Object.entries(dataset.entries)) for (const row of rows) {
  if (manifest.some(value => row.written.includes(value.written) && normalizeKana(row.reading).includes(value.reading))) { excludedIds.add(id); break; }
}
await mkdir(outputDirectory, { recursive: true });
const manifestText = JSON.stringify(manifest, undefined, 2) + "\n";
await writeFile(join(outputDirectory, "manifest.sealed.json"), manifestText);
await writeFile(join(outputDirectory, "blind-packet.jsonl"), blind.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeFile(join(outputDirectory, "development-excluded-ids.json"), JSON.stringify([...excludedIds].sort(), undefined, 2) + "\n");
const summary = { notice: "Frozen before adjudication; implementation agents must not access blind packet, sealed manifest, or labels. Source data remain available as normal. Development sample filtering excludes complete entry IDs containing selected families.", seed, sourceRelease: lock.release.tag, datasetSHA256: hash(datasetBytes), manifestSHA256: hash(manifestText), selectedFamilies: manifest.length, excludedEntryIds: excludedIds.size, strata: Object.fromEntries(Object.keys(quota).map(stratum => [stratum, { eligible: strata.get(stratum)?.size ?? 0, selected: manifest.filter(row => row.stratum === stratum).length }])) };
await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, undefined, 2) + "\n");
console.log(JSON.stringify(summary, undefined, 2));
