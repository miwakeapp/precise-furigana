import { createHash } from "node:crypto";
import { validateCharacterReadingBundle } from "./character-readings.mjs";
import { isIdeograph, isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";
import { deriveUnihanAlignments } from "./unihan.mjs";
import { enumeratePairs } from "./sources.mjs";
import { uniqueExactCharacterAlignment } from "./exact-character-allocation.mjs";
import { transliteratePinyin } from "./loan-readings.mjs";
import { decodeHangul, transcribeHangul } from "./korean-readings.mjs";
import { makeLexicalContextChecker } from "./lexical-evidence.mjs";
import { boundaries, pairKey, segmentText, segmentReading, validateAlignment } from "./segments.mjs";

function validateReadingMap(map, name, annotated = false) {
  if (!(map instanceof Map)) throw new TypeError(`${name} must be a Map`);
  for (const [character, values] of map) {
    if (typeof character !== "string" || splitGraphemes(character).length !== 1 || !Array.isArray(values) ||
      values.some(value => typeof value !== "string" || !isKana(annotated ? readingStem(value) : value))) {
      throw new TypeError(`${name} must map single characters to kana readings`);
    }
  }
}

function mapFingerprint(readings) {
  const entries = [...readings].map(([character, values]) => [character, [...new Set(values)].sort()]);
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/**
 * Refine exact attested pairs using listed sounds and bounded correspondences.
 * These witnesses document phonetic allocations, not historical derivations.
 */
export function deriveListedPhonologyAlignments(jmdict, primary, align, {
  weakCharacterReadings = new Map(),
  unihanReadings = new Map(),
  characterReadingBundle,
  englishCharacterReadingBundle,
  unihanSource,
  kanjidic, kanjidicSource, jmdictSource, weakWitnesses = [], lexicalFacts = [],
  loanReadings = true, koreanReadings = true,
  supplementalVoicing = true,
  yoonSimplification = true,
  onLengthening = true
} = {}) {
  if (!Array.isArray(jmdict?.words)) throw new TypeError("JMdict must contain a words array");
  if (typeof align !== "function") throw new TypeError("align must be a function");
  validateReadingMap(primary, "primary", true);
  validateReadingMap(weakCharacterReadings, "weakCharacterReadings");
  validateReadingMap(unihanReadings, "unihanReadings");
  if ([supplementalVoicing, yoonSimplification, onLengthening, loanReadings, koreanReadings].some(value => typeof value !== "boolean")) {
    throw new TypeError("Listed phonology options must be booleans");
  }
  if (unihanSource !== undefined && (unihanSource === null || typeof unihanSource !== "object" ||
    typeof unihanSource.version !== "string" || !unihanSource.version.trim() ||
    !/^[\da-f]{64}$/u.test(unihanSource.sha256 ?? "") ||
    unihanSource.textSHA256 !== undefined && !/^[\da-f]{64}$/u.test(unihanSource.textSHA256))) {
    throw new TypeError("Unihan source identity requires a version and SHA256");
  }
  const readings = new Map(), sources = new Map();
  const add = (character, value, source) => {
    const values = readings.get(character) ?? [];
    if (!values.includes(value)) values.push(value);
    readings.set(character, values);
    const key = JSON.stringify([character, value]);
    const claims = sources.get(key) ?? [];
    claims.push(source);
    sources.set(key, claims);
  };
  const unihanIdentity = unihanSource ?? {
    name: "Supplied Unihan kJapanese reading map",
    readingsSHA256: mapFingerprint(unihanReadings)
  };
  for (const [character, values] of unihanReadings) {
    for (const value of values) add(character, value, {
      source: "Unihan", field: "kJapanese", sourceIdentity: { ...unihanIdentity }, value
    });
  }
  for (const [bundle, defaultPublisher] of [
    [characterReadingBundle, "Japanese Wiktionary"],
    [englishCharacterReadingBundle, "English Wiktionary"]
  ]) {
    if (bundle === undefined) continue;
    validateCharacterReadingBundle(bundle);
    for (const record of bundle.readings) add(record.character, record.reading, {
      source: bundle.source.publisher ?? defaultPublisher,
      field: bundle.source.field ?? "forms",
      sourceIdentity: { ...bundle.source },
      value: record.reading,
      form: { ...record, tags: [...record.tags] }
    });
  }
  const result = deriveUnihanAlignments(jmdict, primary, readings, align, {
    weakCharacterReadings, supplementalVoicing, yoonSimplification, onLengthening,
    // Check the actual complete word, including following old segment edges.
    // Applying this conservative check to every source avoids an unsafe typed
    // reading being admitted merely because another source duplicates it.
    supplementalReadingFilter: ({ reading, followingWritten, followingReading }) => !normalizeKana(reading).endsWith("っ") || (
      followingWritten !== undefined && isIdeograph(followingWritten) && /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u.test(normalizeKana(followingReading))
    )
  });
  const output = {
    wordAlignments: result.wordAlignments,
    witnesses: result.witnesses.map(witness => ({
      id: witness.id, written: witness.written, reading: witness.reading,
      interpretation: "Exact listed readings or finite contextual sound correspondences; not an etymological claim",
      characters: witness.characters.map(character => {
        const allocations = character.derivations ?? character.values.map(value => ({ value, rules: [] }));
        const evidence = allocations.flatMap(allocation => {
          const claims = sources.get(JSON.stringify([character.character, allocation.value]));
          if (claims === undefined) throw new Error("Missing listed-reading source provenance");
          return claims.map(claim => ({ ...claim, rules: [...allocation.rules] }));
        });
        return {
          character: character.character, written: character.written, reading: character.reading,
          codepoint: character.codepoint, evidence
        };
      })
    }))
  };
  if (kanjidic !== undefined) refineExactSounds(jmdict, kanjidic, align, output, sources, {
    kanjidicSource, jmdictSource, weakWitnesses, lexicalFacts, loanReadings, koreanReadings
  });
  return output;
}

// The static union is deliberately conservative: contextual Korean support is
// checked only after a complete allocation has unique character boundaries.
function refineExactSounds(jmdict, kanjidic, align, output, listedSources, {
  kanjidicSource, jmdictSource, weakWitnesses, lexicalFacts, loanReadings, koreanReadings
}) {
  if (!Array.isArray(kanjidic?.characters) || !Array.isArray(weakWitnesses)) throw new TypeError("KANJIDIC characters and weak witnesses must be arrays");
  for (const supplied of [kanjidicSource, jmdictSource]) {
    if (supplied !== undefined && (supplied === null || typeof supplied !== "object" ||
      typeof supplied.version !== "string" || !supplied.version.trim() || !/^[\da-f]{64}$/u.test(supplied.jsonSHA256 ?? ""))) {
      throw new TypeError("Dictionary source identities require a version and JSON SHA256");
    }
  }
  if (weakWitnesses.some(witness => !["KANJIDIC2 nanori", "KANJIDIC2 complete kun reading", "JMdict single-kanji spelling"].includes(witness.source) ||
    typeof witness.written !== "string" || splitGraphemes(witness.written).length !== 1 || typeof witness.reading !== "string" || !isKana(witness.reading) ||
    witness.source === "JMdict single-kanji spelling" && (typeof witness.witness?.written !== "string" || typeof witness.witness?.reading !== "string"))) {
    throw new TypeError("Weak sounds require an identifiable character-reading witness");
  }
  const identity = (supplied, name, records) => supplied ?? {
    name, readingsSHA256: createHash("sha256").update(JSON.stringify(records)).digest("hex")
  };
  const kanjidicIdentity = identity(kanjidicSource, "Supplied KANJIDIC records", kanjidic);
  const jmdictIdentity = identity(jmdictSource, "Supplied JMdict records", jmdict);
  const pool = new Map(), koreanForms = new Map();
  const foreign = claim => ["Mandarin transcription", "Korean transcription"].includes(claim.category);
  const badOnset = sound => /^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizeKana(sound));
  const add = (character, value, claim) => {
    const reading = normalizeKana(value);
    if (!reading || !isKana(reading) || foreign(claim) && badOnset(reading)) return;
    const sounds = pool.get(character) ?? new Map(), claims = sounds.get(reading) ?? [];
    claims.push(claim); sounds.set(reading, claims); pool.set(character, sounds);
  };
  for (const [key, claims] of listedSources) {
    const [character, value] = JSON.parse(key);
    for (const claim of claims) add(character, value, { category: `${claim.source} exact`, ...claim });
  }
  for (const character of kanjidic.characters) for (const [groupIndex, group] of (character.readingMeaning?.groups ?? []).entries()) {
    for (const [readingIndex, form] of group.readings.entries()) {
      const proof = { source: "KANJIDIC2", sourceIdentity: kanjidicIdentity, groupIndex, readingIndex, form: structuredClone(form) };
      if (["ja_on", "ja_kun"].includes(form.type)) add(character.literal, readingStem(form.value), { category: "KANJIDIC ordinary stem", ...proof });
      if (loanReadings && form.type === "pinyin") for (const reading of transliteratePinyin(form.value)) add(character.literal, reading, { category: "Mandarin transcription", ...proof });
      if (koreanReadings && form.type === "korean_h" && decodeHangul(form.value)) {
        koreanForms.set(form.value, decodeHangul(form.value));
        for (const mapped of [transcribeHangul(form.value), transcribeHangul(form.value, { coda: 0 })]) {
          if (mapped) add(character.literal, mapped.reading, { category: "Korean transcription", ...proof });
        }
      }
    }
  }
  for (const witness of weakWitnesses) add(witness.written, witness.reading, {
    category: witness.source, source: witness.source,
    sourceIdentity: witness.source.startsWith("JMdict") ? jmdictIdentity : kanjidicIdentity,
    witness: structuredClone(witness)
  });
  const reusable = lexicalFacts.filter(fact => fact.reusableSegments?.length), familyByPair = new Map();
  if (reusable.length) {
    const knownIds = new Set(jmdict.words.map(word => word.id));
    for (const pair of enumeratePairs(jmdict)) {
      const key = pairKey(pair.written, normalizeKana(pair.reading)), ids = familyByPair.get(key) ?? new Set();
      ids.add(pair.id); familyByPair.set(key, ids);
    }
    for (const fact of reusable) {
      // A sound cannot corroborate the entries it was derived from.
      const sourceFamilyIds = new Set(familyByPair.get(pairKey(fact.written, normalizeKana(fact.reading))) ?? []);
      for (const id of fact.jmdictEntries ?? []) if (knownIds.has(id)) sourceFamilyIds.add(id);
      // An opt-in asserts independently reusable exact Japanese sound evidence.
      // Context-bound or raw foreign-transcription-only claims remain local;
      // this category must not replace their existing transcription checks.
      for (const segmentIndex of fact.reusableSegments) {
        const segment = fact.segments[segmentIndex];
        add(segmentText(segment), segmentReading(segment), {
          category: "Reviewed reusable sound", source: "Reviewed lexical evidence", factId: fact.id, segmentIndex,
          sourceIdentity: { factSHA256: createHash("sha256").update(JSON.stringify(fact)).digest("hex") },
          witness: { written: fact.written, reading: fact.reading, segments: structuredClone(fact.segments) },
          sourceFamilyIds: [...sourceFamilyIds].sort(), sources: structuredClone(fact.sources), reason: fact.reason
        });
      }
    }
  }
  const eligible = (claim, target) => claim.category === "Reviewed reusable sound" ? (
    pairKey(claim.witness.written, normalizeKana(claim.witness.reading)) !== pairKey(target.written, normalizeKana(target.reading)) &&
    !claim.sourceFamilyIds.some(id => familyByPair.get(pairKey(target.written, normalizeKana(target.reading)))?.has(id))
  ) : claim.category !== "JMdict single-kanji spelling" || (
    splitGraphemes(target.written).filter(isIdeograph).length >= 2 &&
    pairKey(claim.witness.witness.written, normalizeKana(claim.witness.witness.reading)) !== pairKey(target.written, normalizeKana(target.reading))
  );
  // Keep source Hangul states, not just their equal kana strings: n/ng codas
  // can map to the same kana but license different following syllables.
  function supportPath(parts, target, foreignAllowed) {
    let previous = new Set([undefined]);
    const layers = [];
    for (const part of parts) {
      const next = new Set(), edges = [];
      if (part.literal || part.opaque) {
        for (const state of previous) {
          if (part.opaque && state !== undefined && state !== "opaque") continue;
          const end = part.opaque ? "opaque" : undefined;
          edges.push({ start: state, end, claim: { category: part.literal ? "literal" : "unchanged opaque span" } }); next.add(end);
        }
      } else {
        const claims = (pool.get(part.written)?.get(normalizeKana(part.reading)) ?? []).filter(claim => eligible(claim, target) && (foreignAllowed || !foreign(claim)));
        for (const state of previous) for (const claim of claims) {
          if (claim.category !== "Korean transcription") {
            edges.push({ start: state, end: undefined, claim }); next.add(undefined); continue;
          }
          if (state === "opaque") continue;
          const mapped = transcribeHangul(claim.form.value, state === undefined ? undefined : koreanForms.get(state));
          if (!mapped || normalizeKana(mapped.reading) !== normalizeKana(part.reading)) continue;
          edges.push({ start: state, end: claim.form.value, claim: { ...claim, rules: mapped.rules, transcription: mapped.transcription } }); next.add(claim.form.value);
        }
      }
      if (!next.size) return undefined;
      layers.push(edges); previous = next;
    }
    const result = [];
    for (let index = layers.length - 1; index >= 0; --index) {
      const edges = layers[index].filter(edge => previous.has(edge.end));
      result[index] = [...new Map(edges.map(edge => [JSON.stringify(edge.claim), edge.claim])).values()];
      previous = new Set(edges.map(edge => edge.start));
    }
    return result;
  }
  const checkLexical = makeLexicalContextChecker(lexicalFacts), seen = new Set();
  for (const pair of enumeratePairs(jmdict)) {
    const key = pairKey(pair.written, pair.reading);
    if (seen.has(key)) continue;
    seen.add(key);
    const earlier = align(pair.written, pair.reading);
    const original = { ...earlier, segments: output.wordAlignments.get(pair.written)?.get(pair.reading) ?? earlier.segments };
    if (original.status !== "aligned" || !original.segments.some(segment => Array.isArray(segment) && splitGraphemes(segment[0]).length > 1)) continue;
    const foreignAllowed = !pair.readingTags.some(tag => ["ik", "sk"].includes(tag)), readings = new Map();
    for (const character of new Set(splitGraphemes(pair.written))) {
      const values = [...(pool.get(character) ?? new Map())].filter(([, claims]) => claims.some(claim => eligible(claim, pair) && (foreignAllowed || !foreign(claim)))).map(([reading]) => reading);
      if (values.length) readings.set(character, values);
    }
    const parts = [], segments = [], changed = new Set();
    for (const segment of original.segments) {
      const written = segmentText(segment), reading = segmentReading(segment), units = splitGraphemes(written);
      let allocation = Array.isArray(segment) && units.length > 1 ? uniqueExactCharacterAlignment(written, reading, readings) : undefined;
      if (allocation?.allocations.some(part => !part.literal && badOnset(part.reading))) allocation = undefined;
      if (allocation && allocation.segments.length > 1) {
        for (const part of allocation.allocations) { changed.add(parts.length); parts.push(part); }
        segments.push(...allocation.segments);
      } else {
        segments.push(segment);
        if (units.every(isKana) && written === reading) parts.push({ written, reading, literal: true });
        else parts.push({ written, reading, opaque: units.length > 1 || !pool.get(written)?.has(normalizeKana(reading)) });
      }
    }
    if (!changed.size) continue;
    const support = supportPath(parts, pair, foreignAllowed);
    if (!support) continue;
    const lexical = checkLexical({ ...pair, segments: original.segments }, segments);
    if (lexical.veto) continue;
    const previous = new Set(boundaries(original.segments)), proposed = new Set(boundaries(segments));
    if (proposed.size <= previous.size || [...previous].some(point => !proposed.has(point))) continue;
    validateAlignment(pair.written, pair.reading, segments);
    const values = output.wordAlignments.get(pair.written) ?? new Map();
    values.set(pair.reading, segments); output.wordAlignments.set(pair.written, values);
    output.witnesses.push({ id: pair.id, written: pair.written, reading: pair.reading,
      interpretation: "Unique exact allocation from independently listed sounds; not an etymological claim",
      reviewedContexts: lexical.contexts,
      characters: parts.map((part, index) => ({ character: part.written, written: part.written, reading: part.reading,
        newlyAllocated: changed.has(index), evidence: support[index] })) });
  }
}
