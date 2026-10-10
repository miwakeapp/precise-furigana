import { isIdeograph, isKana, normalizeKana } from "./kana.mjs";
import { deriveUnihanAlignments } from "./unihan.mjs";

const onTags = new Set(["on", "go-on", "kan-on", "to-on", "so-on", "kan-yo-on"]);
const excludedTags = new Set(["ko-kun", "nanori", "historical", "archaic", "obsolete"]);

export function validateCharacterReadingBundle(bundle) {
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.readings)) throw new TypeError("Invalid character-reading bundle schema");
  if (typeof bundle.source?.name !== "string" || !bundle.source.name.trim() ||
    typeof bundle.source.version !== "string" || !bundle.source.version.trim() ||
    !/^[\da-f]{64}$/u.test(bundle.source.sha256 ?? "")) throw new TypeError("Character-reading bundles require source identity and SHA256");
  for (const field of ["publisher", "field"]) {
    if (bundle.source[field] !== undefined && (typeof bundle.source[field] !== "string" || !bundle.source[field].trim())) {
      throw new TypeError("Source publisher and field must be nonempty strings when provided");
    }
  }
  for (const record of bundle.readings) {
    if (typeof record.character !== "string" || !/^\p{Unified_Ideograph}$/u.test(record.character) ||
      !["on", "kun"].includes(record.kind) || typeof record.reading !== "string" ||
      !(record.kind === "on" ? /^[ァ-ヺー]+$/u : /^[ぁ-ゖー]+$/u).test(record.reading) ||
      typeof record.originalForm !== "string" || !/^[ぁ-ゖァ-ヺー]+$/u.test(record.originalForm) ||
      normalizeKana(record.originalForm) !== normalizeKana(record.reading) ||
      !Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== "string" || excludedTags.has(tag)) ||
      !record.tags.includes("transliteration")) throw new TypeError("Character readings require plain, exact on or kun source forms");
    const hasOn = record.tags.some(tag => onTags.has(tag));
    const hasKun = record.tags.includes("kun");
    if (hasOn === hasKun || (record.kind === "on") !== hasOn) throw new TypeError("Character reading kind must agree with its source tags");
  }
}

function companionReadings(weakCharacterReadings, unihanReadings) {
  const combined = new Map();
  for (const [name, map] of [["weakCharacterReadings", weakCharacterReadings], ["unihanReadings", unihanReadings]]) {
    if (!(map instanceof Map)) throw new TypeError(`${name} must be a Map`);
    for (const [character, readings] of map) {
      if (typeof character !== "string" || !Array.isArray(readings) || readings.some(reading => typeof reading !== "string" || !isKana(reading))) {
        throw new TypeError(`${name} must contain exact kana readings`);
      }
      combined.set(character, [...new Set([...(combined.get(character) ?? []), ...readings])]);
    }
  }
  return combined;
}

/** Add exact Wiktionary sound evidence only inside the supplied alignment's opaque spans. */
export function deriveCharacterBundleAlignments(jmdict, characterReadings, bundle, align, {
  weakCharacterReadings = new Map(),
  unihanReadings = new Map()
} = {}) {
  validateCharacterReadingBundle(bundle);
  const readings = new Map();
  const recordsByReading = new Map();
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
    supplementalReadingFilter: ({ reading, followingWritten, followingReading }) => !normalizeKana(reading).endsWith("っ") || (
      followingWritten !== undefined && isIdeograph(followingWritten) && /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u.test(normalizeKana(followingReading))
    )
  });
  const witnesses = result.witnesses.map(witness => ({
    id: witness.id,
    written: witness.written,
    reading: witness.reading,
    characters: witness.characters.map(character => ({
      character: character.character,
      written: character.written,
      reading: character.reading,
      codepoint: character.codepoint,
      source: bundle.source.publisher ?? "Japanese Wiktionary",
      sourceName: bundle.source.name,
      sourceVersion: bundle.source.version,
      sourceSHA256: bundle.source.sha256,
      field: bundle.source.field ?? "forms",
      title: character.character,
      forms: recordsByReading.get(JSON.stringify([character.character, normalizeKana(character.reading)])).map(record => ({
        originalForm: record.originalForm,
        reading: record.reading,
        kind: record.kind,
        tags: [...record.tags],
        ...Object.fromEntries([
          "rawSourceForm", "sourceParameter", "sourcePageURL", "revisionURL", "revisionId", "revisionTimestamp",
          "boundaryStatus", "currentForm", "historicalForms", "sourceSuffix", "sourceTemplate", "sourceTemplates", "retrievedAt", "sourceLine"
        ].filter(field => record[field] !== undefined).map(field => [field, record[field]]))
      }))
    }))
  }));
  return { wordAlignments: result.wordAlignments, witnesses };
}
