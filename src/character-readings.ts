import { isIdeograph, isKana, normalizeKana } from "./kana.ts";
import { deriveUnihanAlignments } from "./unihan.ts";
import type { Aligner, JMdict, PassResult, ReadingMap } from "./types.ts";

/** Where a bundle of character readings came from. Its other fields are carried into witnesses. */
export interface CharacterReadingSource {
  name: string;
  version: string;
  sha256: string;
  publisher?: string;
  /** The field of the source's records that holds the readings. */
  field?: string;
  [detail: string]: unknown;
}

/** One reading that a source lists for a character. */
export interface CharacterReadingRecord {
  character: string;
  /** Katakana for an on reading, hiragana for a kun reading. */
  reading: string;
  kind: "on" | "kun";
  /** The reading in the script the source wrote it in. */
  originalForm: string;
  tags: string[];
  // Where in the source the reading appears, for the sources that record it.
  rawSourceForm?: string;
  sourceParameter?: string;
  sourcePageURL?: string;
  revisionURL?: string;
  revisionId?: number;
  revisionTimestamp?: string;
  boundaryStatus?: string;
  currentForm?: string;
  historicalForms?: string[];
  sourceSuffix?: string;
  sourceTemplate?: string;
  sourceTemplates?: string[];
  retrievedAt?: string;
  sourceLine?: number;
}

/** A file of character readings, such as `data/character-readings.json`. */
export interface CharacterReadingBundle {
  schemaVersion: number;
  source: CharacterReadingSource;
  readings: CharacterReadingRecord[];
}

export interface CharacterBundleOptions {
  weakCharacterReadings?: ReadingMap;
  unihanReadings?: ReadingMap;
}

/** A bundle record as a witness repeats it; the witness names the character itself. */
export type CharacterBundleForm = Omit<CharacterReadingRecord, "character">;

/** A character whose sound a bundle supplied, with the records that list it. */
export interface CharacterBundleCharacter {
  character: string;
  spelling: string;
  reading: string;
  codepoint: string;
  source: string;
  sourceName: string;
  sourceVersion: string;
  sourceSHA256: string;
  field: string;
  title: string;
  forms: CharacterBundleForm[];
}

export interface CharacterBundleWitness {
  id: string;
  spelling: string;
  reading: string;
  characters: CharacterBundleCharacter[];
}

const onTags = new Set(["on", "go-on", "kan-on", "to-on", "so-on", "kan-yo-on"]);
const excludedTags = new Set(["ko-kun", "nanori", "historical", "archaic", "obsolete"]);

export function validateCharacterReadingBundle(bundle: CharacterReadingBundle): void {
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.readings))
    throw new TypeError("Invalid character-reading bundle schema");
  if (
    typeof bundle.source?.name !== "string" ||
    !bundle.source.name.trim() ||
    typeof bundle.source.version !== "string" ||
    !bundle.source.version.trim() ||
    !/^[\da-f]{64}$/u.test(bundle.source.sha256 ?? "")
  )
    throw new TypeError("Character-reading bundles require source identity and SHA256");
  for (const field of ["publisher", "field"]) {
    if (
      bundle.source[field] !== undefined &&
      (typeof bundle.source[field] !== "string" || !bundle.source[field].trim())
    ) {
      throw new TypeError("Source publisher and field must be nonempty strings when provided");
    }
  }
  for (const record of bundle.readings) {
    if (
      typeof record.character !== "string" ||
      !/^\p{Unified_Ideograph}$/u.test(record.character) ||
      !["on", "kun"].includes(record.kind) ||
      typeof record.reading !== "string" ||
      !(record.kind === "on" ? /^[ァ-ヺー]+$/u : /^[ぁ-ゖー]+$/u).test(record.reading) ||
      typeof record.originalForm !== "string" ||
      !/^[ぁ-ゖァ-ヺー]+$/u.test(record.originalForm) ||
      normalizeKana(record.originalForm) !== normalizeKana(record.reading) ||
      !Array.isArray(record.tags) ||
      record.tags.some((tag) => typeof tag !== "string" || excludedTags.has(tag)) ||
      !record.tags.includes("transliteration")
    )
      throw new TypeError("Character readings require plain, exact on or kun source forms");
    const hasOn = record.tags.some((tag) => onTags.has(tag));
    const hasKun = record.tags.includes("kun");
    if (hasOn === hasKun || (record.kind === "on") !== hasOn)
      throw new TypeError("Character reading kind must agree with its source tags");
  }
}

function companionReadings(
  weakCharacterReadings: ReadingMap,
  unihanReadings: ReadingMap,
): ReadingMap {
  const combined: ReadingMap = new Map();
  for (const [name, map] of [
    ["weakCharacterReadings", weakCharacterReadings],
    ["unihanReadings", unihanReadings],
  ] as const) {
    for (const [character, readings] of map) {
      if (readings.some((reading) => !isKana(reading)))
        throw new TypeError(`${name} must contain exact kana readings`);
      combined.set(character, [...new Set([...(combined.get(character) ?? []), ...readings])]);
    }
  }
  return combined;
}

/** Add exact Wiktionary sound evidence only inside the supplied alignment's opaque spans. */
export function deriveCharacterBundleAlignments(
  jmdict: JMdict,
  characterReadings: ReadingMap,
  bundle: CharacterReadingBundle,
  align: Aligner,
  { weakCharacterReadings = new Map(), unihanReadings = new Map() }: CharacterBundleOptions = {},
): PassResult<CharacterBundleWitness> {
  validateCharacterReadingBundle(bundle);
  const readings: ReadingMap = new Map();
  const recordsByReading = new Map<string, CharacterReadingRecord[]>();
  for (const record of bundle.readings) {
    const values = readings.get(record.character) ?? [];
    if (!values.includes(record.reading)) values.push(record.reading);
    readings.set(record.character, values);
    const key = JSON.stringify([record.character, normalizeKana(record.reading)]);
    const records = recordsByReading.get(key) ?? [];
    records.push(record);
    recordsByReading.set(key, records);
  }
  const result = deriveUnihanAlignments(jmdict, characterReadings, readings, align, {
    weakCharacterReadings: companionReadings(weakCharacterReadings, unihanReadings),
    supplementalReadingFilter: ({ reading, followingSpelling, followingReading }) =>
      !normalizeKana(reading).endsWith("っ") ||
      (followingSpelling !== undefined &&
        isIdeograph(followingSpelling) &&
        /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u.test(normalizeKana(followingReading))),
  });
  const witnesses = result.witnesses.map((witness): CharacterBundleWitness => ({
    id: witness.id,
    spelling: witness.spelling,
    reading: witness.reading,
    characters: witness.characters.map((character) => ({
      character: character.character,
      spelling: character.spelling,
      reading: character.reading,
      codepoint: character.codepoint,
      source: bundle.source.publisher ?? "Japanese Wiktionary",
      sourceName: bundle.source.name,
      sourceVersion: bundle.source.version,
      sourceSHA256: bundle.source.sha256,
      field: bundle.source.field ?? "forms",
      title: character.character,
      forms: recordsByReading
        .get(JSON.stringify([character.character, normalizeKana(character.reading)]))!
        .map((record) => ({
          originalForm: record.originalForm,
          reading: record.reading,
          kind: record.kind,
          tags: [...record.tags],
          ...Object.fromEntries(
            (
              [
                "rawSourceForm",
                "sourceParameter",
                "sourcePageURL",
                "revisionURL",
                "revisionId",
                "revisionTimestamp",
                "boundaryStatus",
                "currentForm",
                "historicalForms",
                "sourceSuffix",
                "sourceTemplate",
                "sourceTemplates",
                "retrievedAt",
                "sourceLine",
              ] as const
            )
              .filter((field) => record[field] !== undefined)
              .map((field) => [field, record[field]] as const),
          ),
        })),
    })),
  }));
  return { wordAlignments: result.wordAlignments, witnesses };
}
