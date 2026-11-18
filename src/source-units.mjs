import { createHash } from "node:crypto";
import { enumeratePairs, makeCharacterReadings } from "./sources.mjs";
import { normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";
import { boundaries, pairKey, segmentText, segmentReading } from "./segments.mjs";
import { deriveListedPhonologyAlignments } from "./listed-phonology.mjs";
import { deriveNativeCompoundAlignments } from "./native-compounds.mjs";
import { deriveKoreanAlignments } from "./korean-readings.mjs";
import { deriveOnReadingSpellingAlignments } from "./on-reading-spelling.mjs";
import { compileLexicalEvidence, refineWithLexicalEvidence } from "./lexical-evidence.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Source words are independently allocated before their internal boundaries
// can refine a longer opaque span. No derived sound becomes a character reading.
export function deriveSourceUnitAlignments(
  jmdict,
  kanjidic,
  align,
  {
    unihanReadings = new Map(),
    unihanSource,
    characterReadingBundle,
    englishCharacterReadingBundle,
    kanjidicSource,
    lexicalEvidence = [],
    listedPhonology = true,
    nativeCompounds = true,
    koreanReadings = true,
    untaggedKatakanaKorean = true,
    onReadingSpelling = true,
    supplementalVoicing = true,
    yoonSimplification = true,
    onLengthening = true,
    weakReadings = true,
  } = {},
) {
  if (typeof weakReadings !== "boolean") throw new TypeError("weakReadings must be a boolean");
  if (
    kanjidicSource !== undefined &&
    (kanjidicSource === null ||
      typeof kanjidicSource !== "object" ||
      typeof kanjidicSource.version !== "string" ||
      !kanjidicSource.version.trim() ||
      !/^[\da-f]{64}$/u.test(kanjidicSource.jsonSHA256 ?? ""))
  ) {
    throw new TypeError("KANJIDIC source identity requires a version and JSON SHA256");
  }
  const primary = makeCharacterReadings(kanjidic);
  const kanjidicIdentity =
    kanjidicSource === undefined
      ? {
          name: "Supplied KANJIDIC2 characters",
          charactersSHA256: digest(JSON.stringify(kanjidic.characters)),
        }
      : structuredClone(kanjidicSource);
  const unihanIdentity =
    unihanSource === undefined
      ? {
          name: "Supplied Unihan kJapanese reading map",
          readingsSHA256: digest(
            JSON.stringify(
              [...unihanReadings]
                .map(([character, values]) => [character, [...new Set(values)].sort()])
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
            ),
          ),
        }
      : structuredClone(unihanSource);
  const reviewed = compileLexicalEvidence(lexicalEvidence);
  const accepted = new Map();
  const opaqueSubstrings = new Set();
  const minUnitLength = 2,
    maxUnitLength = 8;
  for (const pair of enumeratePairs(jmdict)) {
    const result = align(pair.spelling, pair.reading);
    const record = { ...result, spelling: pair.spelling, reading: pair.reading };
    accepted.set(pairKey(record.spelling, record.reading), record);
    for (const segment of record.segments) {
      if (!Array.isArray(segment)) continue;
      const chars = splitGraphemes(segmentText(segment));
      for (let start = 0; start < chars.length; ++start)
        for (
          let end = start + minUnitLength;
          end <= Math.min(chars.length, start + maxUnitLength);
          ++end
        ) {
          if (end - start === chars.length) continue;
          const text = chars.slice(start, end).join("");
          if (/^\p{Unified_Ideograph}+$/u.test(text)) opaqueSubstrings.add(text);
        }
    }
  }
  const eligible = new Set();
  for (const [key, record] of accepted) {
    if (
      record.status === "aligned" &&
      opaqueSubstrings.has(record.spelling) &&
      record.segments.length === splitGraphemes(record.spelling).length &&
      record.segments.every(
        (segment) => Array.isArray(segment) && splitGraphemes(segmentText(segment)).length === 1,
      )
    )
      eligible.add(key);
  }
  // The independent source replay sees no accepted cut. Accepted source results
  // are compared afterward; unaligned or incomplete outputs cannot seed units.
  const grouped = (spelling, reading) => ({
    segments: [[spelling, reading]],
    status: eligible.has(pairKey(spelling, reading)) ? "aligned" : "withheld",
  });
  const rawClaims = new Map();
  const rawWeak = new Map();
  function claim(character, reading, evidence) {
    const key = pairKey(character, normalizeKana(reading));
    const claims = rawClaims.get(key) ?? [];
    claims.push(evidence);
    rawClaims.set(key, claims);
  }
  function weak(character, reading, evidence) {
    if (!weakReadings) return;
    claim(character, reading, evidence);
    const readings = rawWeak.get(character) ?? [];
    if (!readings.includes(reading)) readings.push(reading);
    rawWeak.set(character, readings);
  }
  for (const character of kanjidic.characters) {
    for (const [groupIndex, group] of (character.readingMeaning?.groups ?? []).entries()) {
      for (const [readingIndex, form] of group.readings.entries()) {
        if (!["ja_on", "ja_kun"].includes(form.type)) continue;
        const evidence = {
          source: "KANJIDIC2",
          field: form.type,
          sourceIdentity: kanjidicIdentity,
          groupIndex,
          readingIndex,
          form,
          value: form.value,
          rules: [],
        };
        claim(character.literal, readingStem(form.value), evidence);
        if (form.value.includes("."))
          weak(
            character.literal,
            normalizeKana(form.value.replaceAll(".", "").replace(/^-|-$/gu, "")),
            { ...evidence, rule: "explicit-complete-kun-form" },
          );
      }
    }
    for (const [nanoriIndex, value] of (character.readingMeaning?.nanori ?? []).entries())
      weak(character.literal, normalizeKana(value), {
        source: "KANJIDIC2",
        field: "nanori",
        sourceIdentity: kanjidicIdentity,
        nanoriIndex,
        value,
        rules: [],
      });
  }
  for (const [character, values] of unihanReadings)
    for (const value of values)
      claim(character, value, {
        source: "Unihan",
        field: "kJapanese",
        sourceIdentity: unihanIdentity,
        value,
        rules: [],
      });
  for (const bundle of [characterReadingBundle, englishCharacterReadingBundle].filter(
    (bundle) => bundle !== undefined,
  ))
    for (const form of bundle.readings)
      claim(form.character, form.reading, {
        source: bundle.source.publisher ?? bundle.source.name,
        field: bundle.source.field ?? "forms",
        sourceIdentity: bundle.source,
        value: form.reading,
        form,
        rules: [],
      });

  const facts = new Map(),
    rejected = {},
    passCounts = {};
  const increment = (name) => (rejected[name] = (rejected[name] ?? 0) + 1);
  function evidenceSources(character, evidence) {
    const identity = evidence.sourceIdentity;
    const metadata = { source: evidence.source, field: evidence.field, sourceIdentity: identity };
    if (evidence.form?.revisionURL !== undefined)
      return [{ ...metadata, url: evidence.form.revisionURL }];
    if (identity?.characterPageURLTemplate !== undefined)
      return [
        {
          ...metadata,
          url: identity.characterPageURLTemplate.replace(
            "{character}",
            encodeURIComponent(character.character),
          ),
          limitation:
            "The page URL is not a pinned revision; imported forms are bound to the source identity.",
        },
      ];
    if (evidence.source === "Unihan")
      return [{ ...metadata, url: identity?.url ?? "https://www.unicode.org/reports/tr38/" }];
    if (evidence.source === "KANJIDIC2")
      return [{ ...metadata, url: "https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" }];
    if (identity?.url !== undefined) return [{ ...metadata, url: identity.url }];
    return [];
  }
  function collect(name, result) {
    passCounts[name] = { independentlyAllocated: result.witnesses.length, retained: 0 };
    for (const witness of result.witnesses) {
      const key = pairKey(witness.spelling, witness.reading);
      const segments = result.wordAlignments.get(witness.spelling)?.get(witness.reading);
      const original = accepted.get(key);
      if (!eligible.has(key) || JSON.stringify(segments) !== JSON.stringify(original.segments)) {
        increment("acceptedSourceDisagrees");
        continue;
      }
      const points = boundaries(segments);
      const exactFact = reviewed.find(
        (fact) =>
          fact.spelling === witness.spelling &&
          fact.normalizedReading === normalizeKana(witness.reading),
      );
      if (
        exactFact !== undefined &&
        boundaries(exactFact.segments).some((point) => !points.includes(point))
      ) {
        increment("exactTargetVeto");
        continue;
      }
      const allocation = segments.map((segment) => {
        const character = segmentText(segment),
          reading = segmentReading(segment);
        const supplied = (
          witness.sourcePaths?.flat() ??
          witness.spans?.flatMap((span) => span.characters) ??
          witness.characters ??
          []
        ).filter(
          (item) =>
            item.spelling === character && normalizeKana(item.reading) === normalizeKana(reading),
        );
        const evidence = supplied.flatMap(
          (item) =>
            item.evidence ??
            item.derivations?.map((derivation) => ({
              ...derivation,
              sourceIdentity: kanjidicIdentity,
              rules: [item.rule],
            })) ??
            [],
        );
        const exact = rawClaims.get(pairKey(character, normalizeKana(reading))) ?? [];
        return { character, reading, evidence: evidence.length ? evidence : exact };
      });
      if (allocation.some((character) => character.evidence.length === 0)) {
        increment("incompleteProvenance");
        continue;
      }
      const transformed = allocation.some((character) =>
        character.evidence.every((evidence) => evidence.rules?.length > 0),
      );
      const normalizedKey = pairKey(witness.spelling, normalizeKana(witness.reading));
      const existing = facts.get(normalizedKey);
      if (existing !== undefined && (existing.strength === "exact" || transformed)) continue;
      const urls = allocation.flatMap((character) =>
        character.evidence.flatMap((evidence) => evidenceSources(character, evidence)),
      );
      if (urls.length === 0) {
        increment("missingSourceAttribution");
        continue;
      }
      facts.set(normalizedKey, {
        id: `raw-unit-${digest(normalizedKey).slice(0, 16)}`,
        spelling: witness.spelling,
        reading: witness.reading,
        segments,
        reason:
          "Complete allocation uniquely supported by the named source pass, independently replayed without source boundaries; retained only when identical to the accepted source word.",
        sources: urls,
        strength: transformed ? "transformed" : "exact",
        pass: name,
        sourcePair: { id: witness.id, spelling: witness.spelling, reading: witness.reading },
        allocation,
        rawWitness: witness,
      });
      ++passCounts[name].retained;
    }
  }
  const common = {
    weakCharacterReadings: rawWeak,
    unihanReadings,
    unihanSource,
    characterReadingBundle,
    englishCharacterReadingBundle,
  };
  collect(
    "listed-exact",
    deriveListedPhonologyAlignments(jmdict, primary, grouped, {
      ...common,
      supplementalVoicing: false,
      yoonSimplification: false,
      onLengthening: false,
    }),
  );
  if (listedPhonology)
    collect(
      "listed-finite",
      deriveListedPhonologyAlignments(jmdict, primary, grouped, {
        ...common,
        supplementalVoicing,
        yoonSimplification,
        onLengthening,
      }),
    );
  if (nativeCompounds)
    collect("native-contraction", deriveNativeCompoundAlignments(jmdict, primary, grouped, common));
  if (koreanReadings)
    collect(
      "korean-transcription",
      deriveKoreanAlignments(jmdict, kanjidic, grouped, {
        kanjidicSource,
        untaggedKatakana: untaggedKatakanaKorean,
      }),
    );
  if (onReadingSpelling)
    collect(
      "on-spelling",
      deriveOnReadingSpellingAlignments(jmdict, kanjidic, grouped, {
        characterReadingBundle,
        englishCharacterReadingBundle,
        kanjidicSource,
      }),
    );

  const compiled = compileLexicalEvidence([...facts.values()]);
  const wordAlignments = new Map();
  const witnesses = [];
  for (const pair of enumeratePairs(jmdict)) {
    const original = accepted.get(pairKey(pair.spelling, pair.reading));
    if (
      original.status !== "aligned" ||
      !original.segments.some(
        (segment) =>
          Array.isArray(segment) && splitGraphemes(segmentText(segment)).length > minUnitLength,
      )
    )
      continue;
    const targets = compiled.filter(
      (fact) =>
        pair.spelling.includes(fact.spelling) &&
        original.segments.some(
          (segment) =>
            Array.isArray(segment) &&
            splitGraphemes(segmentText(segment)).length > fact.spellingUnits.length &&
            segmentText(segment).includes(fact.spelling),
        ),
    );
    if (!targets.length) continue;
    const contexts = reviewed.filter((fact) => pair.spelling.includes(fact.spelling));
    const result = refineWithLexicalEvidence(original, [...contexts, ...targets]);
    if (result === original) continue;
    const usedIds = new Set(result.evidence?.flatMap((item) => item.facts ?? []) ?? []);
    const used = targets.filter((fact) => usedIds.has(fact.id));
    if (!used.length) continue;
    const readings = wordAlignments.get(pair.spelling) ?? new Map();
    readings.set(pair.reading, result.segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({ id: pair.id, spelling: pair.spelling, reading: pair.reading, units: used });
  }
  return { wordAlignments, witnesses, units: compiled, passCounts, rejected };
}
