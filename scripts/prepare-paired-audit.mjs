import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { buildPairedFrame, pairedAuditQuotas, pairedAuditSeed, selectPairedAudit } from "./lib/paired-audit.mjs";
import { normalizeKana, parseReferenceLine, referenceKey } from "../src/reference.mjs";
import { defaultCacheDirectory, defaultLockPath, enumeratePairs, loadSources } from "../src/sources.mjs";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, undefined, 2) + "\n";
const jsonLines = rows => rows.map(row => JSON.stringify(row) + "\n").join("");
const pairId = (id, written, reading) => JSON.stringify([String(id), written, normalizeKana(reading)]);
const fingerprint = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
const dependencyPaths = [
  "scripts/prepare-paired-audit.mjs", "scripts/lib/paired-audit.mjs", "scripts/lib/audit.mjs",
  "scripts/lib/paired-evaluation.mjs", "scripts/evaluate-paired-audit.mjs",
  "scripts/score-paired-audit.mjs", "scripts/lib/paired-scoring.mjs",
  "src/reference.mjs", "src/segments.mjs", "src/sources.mjs", "src/kana.mjs"
];

async function writeFrozen(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

export function makePairedAuditPacket(selected, { jmdict, kanjidic, unihanText, characterReadingBundle, englishCharacterReadingBundle }) {
  const words = new Map(jmdict.words.map(word => [word.id, word]));
  const characters = new Map(kanjidic.characters.map(character => [character.literal, character.readingMeaning]));
  const unihan = new Map();
  for (const line of (unihanText ?? "").split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const [codepoint, property, value] = line.split("\t");
    if (!/^U\+[\dA-F]{4,6}$/u.test(codepoint) || value === undefined) throw new Error("Malformed pinned Unihan evidence");
    const character = String.fromCodePoint(Number.parseInt(codepoint.slice(2), 16));
    const evidence = unihan.get(character) ?? [];
    evidence.push({ property, value });
    unihan.set(character, evidence);
  }
  const listed = new Map();
  for (const reading of characterReadingBundle?.readings ?? []) {
    const evidence = listed.get(reading.character) ?? [];
    evidence.push(reading);
    listed.set(reading.character, evidence);
  }
  const englishListed = new Map();
  for (const reading of englishCharacterReadingBundle?.readings ?? []) {
    const evidence = englishListed.get(reading.character) ?? [];
    evidence.push(reading);
    englishListed.set(reading.character, evidence);
  }
  return selected.map(({ auditId, id, written, reading }) => ({
    auditId, written, reading,
    jmdict: words.get(id),
    characters: [...new Set([...written])].filter(character =>
      characters.has(character) || unihan.has(character) || listed.has(character) || englishListed.has(character)
    ).map(character => ({
      character,
      ...(characters.has(character) ? { kanjidic: characters.get(character) } : {}),
      ...(unihan.has(character) ? { unihan: unihan.get(character) } : {}),
      ...(listed.has(character) ? { japaneseWiktionary: listed.get(character) } : {}),
      ...(englishListed.has(character) ? { englishWiktionary: englishListed.get(character) } : {})
    }))
  }));
}

/** Prepare a new local audit; the complete checkpoint is durable before sampling. */
export async function preparePairedAudit({
  datasetPath, referencePath = ".cache/reference/furigana.txt", outputDirectory,
  cacheDirectory = defaultCacheDirectory, lockPath = defaultLockPath
}) {
  if (typeof datasetPath !== "string" || !datasetPath || typeof outputDirectory !== "string" || !outputDirectory) {
    throw new TypeError("A candidate dataset and a new output directory are required");
  }
  await lstat(outputDirectory).then(() => { throw new Error("Refusing to overwrite an existing audit directory"); }, error => {
    if (error.code !== "ENOENT") throw error;
  });
  const [candidateBytes, referenceBytes, lockBytes, sources] = await Promise.all([
    readFile(datasetPath), readFile(referencePath), readFile(lockPath), loadSources({ cacheDirectory, lockPath })
  ]);
  const dataset = JSON.parse(candidateBytes);
  if (dataset.schemaVersion !== 1) throw new Error("Unsupported candidate schema");
  if (!isDeepStrictEqual(dataset.metadata?.sources, sources.lock) || !isDeepStrictEqual(JSON.parse(lockBytes), sources.lock)) {
    throw new Error("Candidate metadata sources must match the verified source lock");
  }
  const references = [];
  for (const [index, line] of referenceBytes.toString("utf8").split(/\r?\n/u).entries()) {
    try {
      const row = parseReferenceLine(line);
      if (row !== undefined) references.push(row);
    } catch (error) {
      throw new Error(`Invalid reference line ${index + 1}: ${error.message}`, { cause: error });
    }
  }
  const { frame, summary: frameSummary } = buildPairedFrame(dataset, references);
  const expectedPairs = new Set([...enumeratePairs(sources.jmdict)].map(pair => pairId(pair.id, pair.written, pair.reading)));
  const actualPairs = new Set(frame.map(row => row.pairId));
  if (actualPairs.size !== expectedPairs.size || [...actualPairs].some(key => !expectedPairs.has(key))) {
    throw new Error("The candidate must cover the complete distinct JMdict pair population without extra pairs");
  }
  const frameText = jsonLines(frame);
  const comparablePairs = Object.keys(pairedAuditQuotas).reduce((sum, category) => sum + (frameSummary.counts[category] ?? 0), 0);
  const referenceKeys = new Set(references.map(row => referenceKey(row.id, row.written, row.reading)));
  const frameReferenceKeys = new Set(frame.map(row => referenceKey(row.id, row.written, row.reading)));
  const population = {
    ...frameSummary, comparablePairs, outsideComparisonPairs: frame.length - comparablePairs,
    families: new Set(frame.map(row => row.familyId)).size,
    referenceRecords: references.length, distinctReferencePairs: referenceKeys.size,
    referencePairsOutsideFrame: [...referenceKeys].filter(key => !frameReferenceKeys.has(key)).length
  };
  const code = Object.fromEntries(await Promise.all(dependencyPaths.map(async path => {
    const bytes = await readFile(join(projectDirectory, path));
    return [path, fingerprint(path, bytes)];
  })));
  const protocolPath = "docs/paired-evaluation-protocol.md";
  const protocolBytes = await readFile(join(projectDirectory, protocolPath));
  const checkpoint = {
    schemaVersion: 1,
    notice: "Frozen before selection. Keep the complete frame and selected manifest sealed from annotators and implementation work.",
    inputs: {
      candidate: fingerprint(resolve(datasetPath), candidateBytes),
      reference: fingerprint(resolve(referencePath), referenceBytes),
      sourceLock: fingerprint(resolve(lockPath), lockBytes),
      verifiedSources: sources.lock
    },
    protocol: fingerprint(protocolPath, protocolBytes),
    dependencies: code,
    runtime: { node: process.version, versions: process.versions },
    frame: { file: "frame.sealed.jsonl", sha256: hash(frameText), bytes: Buffer.byteLength(frameText), ...population },
    familyRule: "JMdict entry ID only; orthographic relatives across entries are not grouped. Every distinct pair remains eligible, including relatives and previously discussed cases.",
    sampling: {
      seed: pairedAuditSeed, quotas: pairedAuditQuotas,
      method: "Lowest SHA256 ranks of JSON [seed, selection, category, pairId] within each complete stratum, without replacement",
      tieBreak: "Lexicographic pairId by JavaScript string code units",
      packetOrder: "SHA256 of JSON [seed, packet-order, pairId], with the same tie break",
      convenienceExclusions: false
    }
  };
  await mkdir(dirname(resolve(outputDirectory)), { recursive: true });
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFrozen(join(outputDirectory, "frame.sealed.jsonl"), frameText);
  const checkpointText = json(checkpoint);
  await writeFrozen(join(outputDirectory, "checkpoint.json"), checkpointText);

  // Do not move selection above the durable checkpoint write.
  const { selected, populations } = selectPairedAudit(frame);
  const manifestText = jsonLines(selected);
  const packetText = jsonLines(makePairedAuditPacket(selected, sources));
  await writeFrozen(join(outputDirectory, "manifest.sealed.jsonl"), manifestText);
  await writeFrozen(join(outputDirectory, "blind-packet.jsonl"), packetText);
  const summary = {
    schemaVersion: 1,
    notice: "Aggregate preparation report only. No labels have been collected or scored. Two independent blind full-pair judgments and reconciliation are required.",
    population, strata: populations,
    selectedPairs: selected.length,
    selectedFamilies: new Set(selected.map(row => row.familyId)).size,
    seed: pairedAuditSeed, quotas: pairedAuditQuotas,
    hashes: {
      checkpoint: hash(checkpointText), frame: hash(frameText), manifest: hash(manifestText), blindPacket: hash(packetText),
      candidate: hash(candidateBytes), reference: hash(referenceBytes), sourceLock: hash(lockBytes), protocol: hash(protocolBytes)
    }
  };
  await writeFrozen(join(outputDirectory, "summary.json"), json(summary));
  return summary;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    reference: { type: "string", default: ".cache/reference/furigana.txt" },
    output: { type: "string" },
    cache: { type: "string", default: defaultCacheDirectory },
    lock: { type: "string", default: defaultLockPath }
  } });
  if (positionals.length !== 1 || values.output === undefined) {
    throw new Error("Usage: node scripts/prepare-paired-audit.mjs DATASET.json --output NEW-DIRECTORY [--reference FILE] [--cache DIRECTORY] [--lock FILE]");
  }
  console.log(json(await preparePairedAudit({
    datasetPath: positionals[0], referencePath: values.reference, outputDirectory: values.output,
    cacheDirectory: values.cache, lockPath: values.lock
  })).trimEnd());
}
