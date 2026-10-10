import { createHash } from "node:crypto";

const onParameters = new Map([
  ["goon", "go-on"], ["kanon", "kan-on"], ["soon", "so-on"],
  ["toon", "to-on"], ["kanyoon", "kan-yo-on"], ["on", "on"]
]);
const plainKana = /^[ぁ-ゖァ-ヺー]+$/u;
const historicalKana = /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/u;

export const englishWiktionaryInputs = {
  rawPages: { file: "primary-pages-complete-frozen.jsonl", bytes: 27720517, sha256: "168070d2cfa2da11bed52773cef17bb6fcc71e2d713d845cdeb811b083dc0d1a" },
  characterFrame: { file: "jmdict-character-frame.json", bytes: 66485, sha256: "b1fa9eb57697c27d21c6da4601395bd7373c91c88911cd891457e3e5fb042e39" },
  kanjidic: { file: "kanjidic2-all-3.6.2+20261005200550.json", bytes: 17666723, sha256: "f6e2c30f8994e9d9df65f45f028a3020cd1844b65a02e31badd0270b90f8d0be" },
  unihan: { file: "Unihan-Readings-18.0.0.txt", bytes: 8844571, sha256: "9d39995b5de714e8ce93716ed5d15eaa0792d68e407cdf8a0add2893b8f4150b" },
  japaneseBundle: { file: "character-readings.json", bytes: 674862, sha256: "1433f551a99502fcfda5dce99d2240646c42e27c47a7caa4025fc79e4d8e68cd" }
};

export const englishWiktionarySource = {
  name: "English Wiktionary explicit character readings",
  publisher: "English Wiktionary",
  field: "ja-readings",
  version: "enwiktionary-api-20261009-6017-pages",
  url: "https://en.wiktionary.org/w/api.php",
  sourcePageURL: "https://en.wiktionary.org/wiki/Template:ja-readings/documentation",
  documentationRevisionURL: "https://en.wiktionary.org/w/index.php?title=Template:ja-readings/documentation&oldid=89401685",
  characterPageURLTemplate: "https://en.wiktionary.org/wiki/{character}#Japanese",
  retrievedDate: "2026-10-09",
  bytes: englishWiktionaryInputs.rawPages.bytes,
  sha256: englishWiktionaryInputs.rawPages.sha256,
  inputs: englishWiktionaryInputs,
  license: {
    id: "CC-BY-SA-4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    statementURL: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
    attribution: "English Wiktionary contributors; selected and normalized by precise-furigana from the public MediaWiki revision API."
  },
  modifications: [
    "Select Japanese ja-readings templates for the pinned JMdict character frame, ignoring comments and protected markup.",
    "Use literal current-orthography on readings, kun explicitly marked without a following suffix, and the exact character-reading prefix before one documented kun hyphen. Current orthography does not establish current lexical usage.",
    "Withhold unmarked kun, nanori, historical values, malformed historical chains, and unsupported markup. Do not infer phonological changes or inflections.",
    "Retain the original template item, current and historical forms, source parameter, marked suffix, template context, and page revision provenance. Normalize on readings to katakana and kun readings to hiragana.",
    "Keep only sound correspondences absent from the pinned KANJIDIC plain, stem, full, and nanori inventories, Unihan kJapanese, and Japanese Wiktionary bundle. This exclusion filter does not promote those inventories or alter the allocator's companion readings.",
    "Prefer complete-reading evidence when the same character and sound also has marked-prefix evidence. Deduplicate records and sort deterministically."
  ]
};

function normalizeReading(value, kind = "kun") {
  return [...value.normalize("NFC")].map(character => {
    const codepoint = character.codePointAt(0);
    if (kind === "on" && codepoint >= 0x3041 && codepoint <= 0x3096) return String.fromCodePoint(codepoint + 0x60);
    if (kind === "kun" && codepoint >= 0x30A1 && codepoint <= 0x30F6) return String.fromCodePoint(codepoint - 0x60);
    return character;
  }).join("");
}

export function characterReadingKey(character, reading) {
  return JSON.stringify([character, normalizeReading(reading)]);
}

export function verifyEnglishWiktionaryInput(name, bytes) {
  const expected = englishWiktionaryInputs[name];
  if (expected === undefined) throw new Error(`Unknown English Wiktionary input ${name}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
    throw new Error(`${name} checksum mismatch; this importer requires the reviewed frozen inputs`);
  }
}

function japaneseSection(text) {
  const clean = text.replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .replace(/<(?:nowiki|pre|code|syntaxhighlight|source)\b[^>]*\/\s*>/giu, " ")
    .replace(/<(nowiki|pre|code|syntaxhighlight|source)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, " ");
  const headings = [...clean.matchAll(/^==[ \t]*([^=\r\n]+?)[ \t]*==[ \t]*$/gmu)];
  const index = headings.findIndex(match => match[1].trim() === "Japanese");
  if (index === -1) return "";
  const heading = headings[index];
  return clean.slice(heading.index + heading[0].length, headings[index + 1]?.index);
}

function* readingTemplates(text) {
  const stack = [];
  let start;
  for (let index = 0; index < text.length;) {
    if (text.startsWith("{{", index)) {
      const width = text.startsWith("{{{", index) && !text.startsWith("{{{{", index) ? 3 : 2;
      if (!stack.length) start = index;
      stack.push(width);
      index += width;
      continue;
    }
    if (!stack.length || !text.startsWith("}}", index)) {
      ++index;
      continue;
    }
    const width = stack.pop();
    if (!text.startsWith("}".repeat(width), index)) return;
    index += width;
    if (stack.length) continue;
    const template = text.slice(start, index);
    const parsed = /^\{\{ja-readings\s*\|([^{}]*)\}\}$/iu.exec(template);
    if (parsed) yield { template, body: parsed[1] };
  }
}

/** Extract only explicitly delimited character sounds, retaining revision evidence. */
export function extractEnglishCharacterReadings(page, { sourceLine } = {}) {
  if (typeof page?.title !== "string" || !/^\p{Unified_Ideograph}$/u.test(page.title)) return [];
  const revision = page.revisions?.[0];
  const text = revision?.slots?.main?.content;
  if (typeof text !== "string" || !Number.isSafeInteger(revision.revid) || typeof revision.timestamp !== "string") return [];
  const character = page.title;
  const records = [];
  for (const { template, body } of readingTemplates(japaneseSection(text))) {
    const parameters = new Map();
    let duplicate = false;
    for (const part of body.split("|")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      if (parameters.has(name)) duplicate = true;
      parameters.set(name, part.slice(separator + 1).trim());
    }
    if (duplicate || (parameters.has("pagename") && parameters.get("pagename") !== character)) continue;
    for (const [parameter, value] of parameters) {
      const kind = parameter === "kun" ? "kun" : onParameters.has(parameter) ? "on" : undefined;
      if (kind === undefined) continue;
      for (const item of value.split(",")) {
        const rawSourceForm = item.trim();
        if (!rawSourceForm) continue;
        const [currentForm, ...historicalForms] = rawSourceForm.split("<").map(form => form.trim());
        if (historicalForms.some(form => form.split("-").length > 2 || !historicalKana.test(form.replaceAll("-", "")))) continue;
        const parts = currentForm.split("-");
        if (parts.length > 2) continue;
        const originalForm = parts[0];
        let boundaryStatus;
        let sourceSuffix;
        if (parts.length === 1) {
          if (kind !== "on") continue;
          boundaryStatus = "literal-on";
        } else if (parts[1] === "") {
          boundaryStatus = "explicit-complete-reading";
        } else {
          if (kind !== "kun" || !plainKana.test(parts[1])) continue;
          boundaryStatus = "explicit-character-prefix";
          sourceSuffix = parts[1];
        }
        if (!plainKana.test(originalForm)) continue;
        records.push({
          character, reading: normalizeReading(originalForm, kind), kind, originalForm,
          tags: [kind === "kun" ? "kun" : onParameters.get(parameter), "transliteration"].sort(),
          rawSourceForm, currentForm, historicalForms, sourceParameter: parameter, boundaryStatus,
          ...(sourceSuffix === undefined ? {} : { sourceSuffix }),
          sourcePageURL: `https://en.wiktionary.org/wiki/${character}#Japanese`,
          revisionURL: `https://en.wiktionary.org/w/index.php?oldid=${revision.revid}`,
          revisionId: revision.revid, revisionTimestamp: revision.timestamp,
          retrievedAt: page.retrievedAt ?? page.retrievedDate,
          ...(sourceLine === undefined ? {} : { sourceLine }),
          sourceTemplate: template
        });
      }
    }
  }
  return records;
}

/** These keys only exclude existing facts; they are never added to an allocator. */
export function makeExistingCharacterReadingKeys({ kanjidic, unihanText, japaneseBundle }) {
  const result = new Set();
  const add = (character, reading) => result.add(characterReadingKey(character, reading));
  for (const entry of kanjidic.characters) {
    for (const group of entry.readingMeaning?.groups ?? []) for (const reading of group.readings ?? []) {
      if (!["ja_on", "ja_kun"].includes(reading.type)) continue;
      const value = reading.value.replace(/^-+|-+$/gu, "");
      add(entry.literal, value.split(".")[0]);
      add(entry.literal, value.replaceAll(".", ""));
    }
    for (const reading of entry.readingMeaning?.nanori ?? []) add(entry.literal, reading);
  }
  for (const line of unihanText.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [codepoint, field, value] = line.split("\t");
    if (field !== "kJapanese") continue;
    if (!/^U\+[\dA-F]+$/u.test(codepoint) || typeof value !== "string") throw new Error("Invalid Unihan kJapanese record");
    const character = String.fromCodePoint(Number.parseInt(codepoint.slice(2), 16));
    for (const reading of value.trim().split(/\s+/u)) add(character, reading);
  }
  for (const record of japaneseBundle.readings) add(record.character, record.reading);
  return result;
}

export function makeEnglishCharacterReadingBundle(records, existingReadings) {
  if (!(existingReadings instanceof Set)) throw new TypeError("Existing reading keys must be supplied explicitly");
  const novel = records.filter(record => !existingReadings.has(characterReadingKey(record.character, record.reading)));
  const complete = new Set(novel.filter(record => record.boundaryStatus !== "explicit-character-prefix")
    .map(record => characterReadingKey(record.character, record.reading)));
  const grouped = new Map();
  for (const { sourceTemplate, ...record } of novel) {
    if (record.boundaryStatus === "explicit-character-prefix" && complete.has(characterReadingKey(record.character, record.reading))) continue;
    const key = JSON.stringify(record);
    const templates = grouped.get(key) ?? new Set();
    templates.add(sourceTemplate);
    grouped.set(key, templates);
  }
  const readings = [...grouped.keys()].sort().map(key => ({ ...JSON.parse(key), sourceTemplates: [...grouped.get(key)].sort() }));
  return { schemaVersion: 1, source: structuredClone(englishWiktionarySource), readings };
}

export function serializeEnglishCharacterReadingBundle(bundle) {
  const source = JSON.stringify(bundle.source, undefined, 2).split("\n").map((line, index) => index === 0 ? line : `  ${line}`).join("\n");
  return `{\n  "schemaVersion": 1,\n  "source": ${source},\n  "readings": [\n${bundle.readings.map(reading => `    ${JSON.stringify(reading)}`).join(",\n")}\n  ]\n}\n`;
}
