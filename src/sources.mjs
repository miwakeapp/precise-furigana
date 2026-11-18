import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
export const defaultCacheDirectory = join(projectDirectory, ".cache", "sources");
export const defaultLockPath = join(projectDirectory, "data", "sources.lock.json");

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadBundledSource(source, lockPath = defaultLockPath) {
  if (source.format !== "bundled-json" || !/^[\w.+-]+\.json$/u.test(source.file ?? ""))
    throw new Error("Invalid bundled source file name or format");
  const bytes = await readFile(join(dirname(lockPath), source.file));
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256)
    throw new Error(`Checksum or size mismatch for bundled ${source.file}`);
  return JSON.parse(bytes.toString("utf8"));
}

export async function loadSources({
  cacheDirectory = defaultCacheDirectory,
  lockPath = defaultLockPath,
} = {}) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.schemaVersion !== 1) {
    throw new Error(`Unsupported source lock schema: ${lock.schemaVersion}`);
  }

  async function loadSource(name) {
    const source = lock.sources[name];
    if (!source || typeof source.file !== "string" || !/^[\w.+-]+\.json$/u.test(source.file)) {
      throw new Error(`Invalid cached file name for ${name}`);
    }
    let bytes;
    try {
      bytes = await readFile(join(cacheDirectory, source.file));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Missing ${name} source. Run npm run fetch first.`, { cause: error });
      }
      throw error;
    }
    if (sha256(bytes) !== source.jsonSHA256) {
      throw new Error(`Checksum mismatch for cached ${name}; run npm run fetch to restore it.`);
    }
    return JSON.parse(bytes.toString("utf8"));
  }

  const jmdict = await loadSource("jmdict");
  const kanjidic = await loadSource("kanjidic");
  if (
    !Array.isArray(jmdict.words) ||
    jmdict.commonOnly !== false ||
    !Array.isArray(kanjidic.characters)
  ) {
    throw new Error("Expected complete jmdict-simplified JMdict and KANJIDIC2 dictionaries.");
  }
  let unihanText;
  const unihan = lock.lexicalSources?.unihan;
  if (unihan !== undefined) {
    if (!/^[\w.+-]+\.txt$/u.test(unihan.file ?? ""))
      throw new Error("Invalid cached Unihan file name");
    const bytes = await readFile(join(cacheDirectory, unihan.file));
    if (sha256(bytes) !== unihan.textSHA256)
      throw new Error(
        "Checksum mismatch for cached Unihan readings; run npm run fetch to restore them.",
      );
    unihanText = bytes.toString("utf8");
  }
  const japaneseWiktionary = lock.lexicalSources?.japaneseWiktionary;
  const characterReadingBundle =
    japaneseWiktionary === undefined
      ? undefined
      : await loadBundledSource(japaneseWiktionary, lockPath);
  const englishWiktionary = lock.lexicalSources?.englishWiktionary;
  const englishCharacterReadingBundle =
    englishWiktionary === undefined
      ? undefined
      : await loadBundledSource(englishWiktionary, lockPath);
  return {
    jmdict,
    kanjidic,
    unihanText,
    characterReadingBundle,
    englishCharacterReadingBundle,
    lock,
  };
}

// Reading restrictions apply to the spelling/reading pair, independently of sense restrictions.
export function* enumeratePairs(jmdict) {
  for (const word of jmdict.words) {
    if (typeof word.id !== "string" || !/^\d+$/u.test(word.id)) {
      throw new Error(`Invalid JMdict entry ID: ${word.id}`);
    }
    const spellings = new Set(word.kanji.map((kanji) => kanji.text));
    for (const [readingIndex, kana] of word.kana.entries()) {
      if (!Array.isArray(kana.appliesToKanji)) {
        throw new Error(`Missing reading restrictions in JMdict entry ${word.id}`);
      }
      for (const restriction of kana.appliesToKanji) {
        if (restriction !== "*" && !spellings.has(restriction)) {
          throw new Error(`Unknown restricted spelling ${restriction} in JMdict entry ${word.id}`);
        }
      }
      if (word.kanji.length === 0 || kana.appliesToKanji.length === 0) {
        yield {
          id: word.id,
          spelling: kana.text,
          reading: kana.text,
          kanjiIndex: null,
          readingIndex,
          kind: "kana",
          spellingTags: [],
          readingTags: kana.tags,
        };
        continue;
      }
      for (const [kanjiIndex, kanji] of word.kanji.entries()) {
        if (!kana.appliesToKanji.includes("*") && !kana.appliesToKanji.includes(kanji.text)) {
          continue;
        }
        yield {
          id: word.id,
          spelling: kanji.text,
          reading: kana.text,
          kanjiIndex,
          readingIndex,
          kind: "kanji",
          spellingTags: kanji.tags,
          readingTags: kana.tags,
        };
      }
    }
  }
}

function addReading(map, spelling, reading) {
  const readings = map.get(spelling);
  if (readings === undefined) {
    map.set(spelling, [reading]);
  } else if (!readings.includes(reading)) {
    readings.push(reading);
  }
}

// Keep the original `.` okurigana and `-` affix annotations for the aligner to interpret.
export function makeCharacterReadings(kanjidic) {
  const result = new Map();
  for (const character of kanjidic.characters) {
    for (const group of character.readingMeaning?.groups ?? []) {
      for (const reading of group.readings) {
        if (reading.type === "ja_on" || reading.type === "ja_kun") {
          addReading(result, character.literal, reading.value);
        }
      }
    }
  }
  return result;
}

// Name readings stay separate so callers can assign weaker, contextual evidence.
export function makeNanoriReadings(kanjidic) {
  const result = new Map();
  for (const character of kanjidic.characters) {
    for (const reading of character.readingMeaning?.nanori ?? []) {
      addReading(result, character.literal, reading);
    }
  }
  return result;
}

export function makeWordReadings(jmdict) {
  const result = new Map();
  for (const pair of enumeratePairs(jmdict)) {
    if (pair.kind === "kanji") {
      addReading(result, pair.spelling, pair.reading);
    }
  }
  return result;
}

// A whole-word irregular reading is contrary evidence for a weak character split.
// Explicit ateji spellings still permit phonetic character-by-character alignment.
export function makeIrregularWordReadings(jmdict) {
  const result = new Map();
  for (const pair of enumeratePairs(jmdict)) {
    if (
      pair.kind === "kanji" &&
      pair.readingTags.includes("gikun") &&
      !pair.spellingTags.includes("ateji")
    ) {
      addReading(result, pair.spelling, pair.reading);
    }
  }
  return result;
}
