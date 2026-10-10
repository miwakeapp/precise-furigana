const onTags = new Set(["on", "go-on", "kan-on", "to-on", "so-on", "kan-yo-on"]);
const excludedTags = new Set(["ko-kun", "nanori", "historical", "archaic", "obsolete"]);

export const japaneseWiktionarySource = {
  name: "Japanese Wiktionary character readings, extracted by Kaikki/Wiktextract",
  version: "jawiktionary-20261001",
  url: "https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz",
  sourcePageURL: "https://kaikki.org/dictionary/rawdata.html",
  sourceLogURL: "https://kaikki.org/dictionary/downloads/ja/ja-extract.log",
  dumpDate: "2026-10-01",
  extractionDate: "2026-10-01",
  retrievedDate: "2026-10-09",
  bytes: 64974760,
  sha256: "92b85a0c09e2013e9bad4258de9e0226d23e0a20011cb66c3ba7fed33d39ee90",
  characterPageURLTemplate: "https://ja.wiktionary.org/wiki/{character}#日本語",
  license: {
    id: "CC-BY-SA-4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    statementURL: "https://ja.wiktionary.org/wiki/Wiktionary:著作権",
    attribution: "Japanese Wiktionary contributors; structured extraction by Kaikki/Wiktextract; filtered and normalized by precise-furigana."
  },
  modifications: [
    "Select Japanese-language single-ideograph entries and explicit transliteration forms tagged on or kun.",
    "Exclude untyped, historical, nanori, and marked okurigana or affix forms.",
    "Preserve original forms and tags; normalize on readings to katakana and kun readings to hiragana.",
    "Deduplicate identical records and sort deterministically. Do not infer phonological changes or new readings."
  ]
};

export function extractCharacterReadings(entry) {
  if (entry.lang_code !== "ja" || typeof entry.word !== "string" || !/^\p{Unified_Ideograph}$/u.test(entry.word)) return [];
  const result = [];
  for (const form of entry.forms ?? []) {
    const tags = form.tags ?? [];
    if (!tags.includes("transliteration") || tags.some(tag => excludedTags.has(tag))) continue;
    if (typeof form.form !== "string" || !/^[ぁ-ゖァ-ヺー]+$/u.test(form.form)) continue;
    const isOn = tags.some(tag => onTags.has(tag));
    const isKun = tags.includes("kun");
    if (isOn === isKun) continue;
    const kind = isOn ? "on" : "kun";
    const reading = [...form.form].map(character => {
      const codepoint = character.codePointAt(0);
      if (kind === "on" && codepoint >= 0x3041 && codepoint <= 0x3096) return String.fromCodePoint(codepoint + 0x60);
      if (kind === "kun" && codepoint >= 0x30A1 && codepoint <= 0x30F6) return String.fromCodePoint(codepoint - 0x60);
      return character;
    }).join("");
    result.push({ character: entry.word, reading, kind, originalForm: form.form, tags: [...new Set(tags)].sort() });
  }
  return result;
}

export function makeCharacterReadingBundle(records) {
  const keys = [...new Set(records.map(record => JSON.stringify(record)))].sort();
  return { schemaVersion: 1, source: japaneseWiktionarySource, readings: keys.map(key => JSON.parse(key)) };
}

export function serializeCharacterReadingBundle(bundle) {
  const source = JSON.stringify(bundle.source, undefined, 2).split("\n").map((line, index) => index === 0 ? line : `  ${line}`).join("\n");
  return `{\n  "schemaVersion": 1,\n  "source": ${source},\n  "readings": [\n${bundle.readings.map(reading => `    ${JSON.stringify(reading)}`).join(",\n")}\n  ]\n}\n`;
}
