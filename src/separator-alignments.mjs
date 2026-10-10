import { createHash } from "node:crypto";
import { createAligner } from "./align.mjs";
import { uniqueExactCharacterAlignment } from "./exact-character-allocation.mjs";
import { normalizeKana, splitGraphemes } from "./kana.mjs";
import { enumeratePairs, makeCharacterReadings, makeIrregularWordReadings, makeWordReadings } from "./sources.mjs";
import { boundaries, combineAlignments, pairKey, recordKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";

const rawOptionNames = new Set([
  "phonologicalAlternations", "terminalContraction", "compoundVoicing", "kanaRunCorrespondence", "internalKanaAnchors",
  "dictionaryUnvoicing", "dictionaryRenjo", "dictionaryNasalLoss", "dictionaryInitialVoicing"
]);
const isSeparator = unit => /^[・･·]$/u.test(unit);

function sourceIdentity(supplied, dictionary, name) {
  if (supplied === undefined) return {
    name: `Supplied ${name} input`,
    inputSHA256: createHash("sha256").update(JSON.stringify(dictionary)).digest("hex")
  };
  if (supplied === null || typeof supplied !== "object" || typeof supplied.version !== "string" || !supplied.version.trim() ||
    !/^[\da-f]{64}$/u.test(supplied.jsonSHA256 ?? "")) throw new TypeError(`${name} source identity requires a version and JSON SHA256`);
  return structuredClone(supplied);
}

function validateRawOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Raw aligner options must be an object");
  const result = {};
  for (const [name, value] of Object.entries(options)) {
    if (!rawOptionNames.has(name)) throw new TypeError(`Unsupported raw aligner option: ${name}`);
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new TypeError(`Raw aligner option ${name} must be a boolean`);
    result[name] = value;
  }
  return result;
}

function projectBoundaries(source, target, reading, segments) {
  const targetUnits = splitGraphemes(target), readingUnits = splitGraphemes(reading);
  const retained = targetUnits.flatMap((unit, index) => isSeparator(unit) ? [] : [index]);
  if (retained.map(index => targetUnits[index]).join("") !== source) return undefined;
  const points = [[0, 0]], withheld = [];
  let writtenOffset = 0, readingOffset = 0;
  for (const segment of segments.slice(0, -1)) {
    writtenOffset += splitGraphemes(segmentText(segment)).length;
    readingOffset += splitGraphemes(segmentReading(segment)).length;
    const left = retained[writtenOffset - 1] + 1, right = retained[writtenOffset];
    // The positive-reading schema cannot give a silent separator its own
    // segment. Withhold either adjacent cut instead of choosing its owner.
    if (left !== right) {
      withheld.push({ sourceWrittenOffset: writtenOffset, readingOffset });
      continue;
    }
    points.push([left, readingOffset]);
  }
  points.push([targetUnits.length, readingUnits.length]);
  const projected = [];
  for (let index = 1; index < points.length; ++index) {
    const [startX, startY] = points[index - 1], [endX, endY] = points[index];
    const text = targetUnits.slice(startX, endX).join(""), sound = readingUnits.slice(startY, endY).join("");
    projected.push(text === sound ? text : [text, sound]);
  }
  validateAlignment(target, reading, projected);
  return { segments: projected, withheld };
}

/** Transfer independent raw-source boundaries into attested separator spellings. */
export function deriveSeparatorAlignments(jmdict, kanjidic, align, {
  jmdictSource, kanjidicSource, rawAlignerOptions = {}, allowVirtualSources = false
} = {}) {
  if (!Array.isArray(jmdict?.words) || !Array.isArray(kanjidic?.characters)) throw new TypeError("JMdict and KANJIDIC arrays are required");
  if (typeof align !== "function") throw new TypeError("An earlier alignment function is required");
  if (typeof allowVirtualSources !== "boolean") throw new TypeError("Virtual source eligibility must be a boolean");
  const soundOptions = validateRawOptions(rawAlignerOptions);
  const identities = {
    jmdict: sourceIdentity(jmdictSource, jmdict, "JMdict"),
    kanjidic: sourceIdentity(kanjidicSource, kanjidic, "KANJIDIC2")
  };
  const primary = makeCharacterReadings(kanjidic);
  // Keep source derivation independent of late facts, transferred alignments,
  // weak inferred readings, and results produced by this pass.
  const rawAlign = createAligner({ ...soundOptions, characterReadings: primary,
    wordReadings: makeWordReadings(jmdict), irregularWordReadings: makeIrregularWordReadings(jmdict) });
  const rawCache = new Map(), existingCache = new Map();
  function cached(cache, callback, written, reading) {
    const key = pairKey(written, reading);
    if (!cache.has(key)) cache.set(key, callback(written, reading));
    return cache.get(key);
  }
  const wordAlignments = new Map(), witnesses = [], seen = new Set();
  for (const word of jmdict.words) {
    if (!word.kanji.some(form => splitGraphemes(form.text).some(isSeparator))) continue;
    const pairs = [...enumeratePairs({ words: [word] })].filter(pair => pair.kind === "written");
    const byReading = new Map();
    for (const pair of pairs) {
      const key = normalizeKana(pair.reading), matches = byReading.get(key) ?? [];
      matches.push(pair);
      byReading.set(key, matches);
    }
    for (const target of pairs) {
      const targetKey = recordKey(target.id, target.written, target.reading);
      if (seen.has(targetKey)) continue;
      seen.add(targetKey);
      const targetUnits = splitGraphemes(target.written);
      if (!targetUnits.some(isSeparator)) continue;
      const plain = targetUnits.filter(unit => !isSeparator(unit)).join("");
      // `enumeratePairs` applies spelling/reading restrictions before this
      // normalized lookup. Keep raw readings equal so coordinates and script
      // are identical; a same-entry Cartesian product would not be evidence.
      const source = byReading.get(normalizeKana(target.reading))?.find(pair => pair.written === plain && pair.reading === target.reading);
      if (source === undefined && !allowVirtualSources) continue;
      const original = cached(existingCache, align, target.written, target.reading);
      if (original.status !== "aligned") continue;
      const independentlyAligned = cached(rawCache, rawAlign, plain, target.reading);
      if (independentlyAligned.status !== "aligned") continue;
      let sourceSegments = independentlyAligned.segments, sourceProvenance;
      if (source !== undefined) {
        const existingSource = cached(existingCache, align, source.written, source.reading);
        if (existingSource.status !== "aligned") continue;
        const acceptedSourcePoints = new Set(boundaries(existingSource.segments));
        if (boundaries(independentlyAligned.segments).some(point => !acceptedSourcePoints.has(point))) continue;
        sourceProvenance = { sourcePair: { id: source.id, written: source.written, reading: source.reading }, sourceAttestation: { ...source } };
      } else {
        // This spelling is generated by removing separators. Its boundaries
        // require one complete allocation from literal kana and exact listed
        // character stems; the raw aligner supplies only an additional veto.
        const exact = uniqueExactCharacterAlignment(plain, target.reading, primary);
        if (exact === undefined) continue;
        const exactPoints = boundaries(exact.segments), rawPoints = boundaries(independentlyAligned.segments);
        if (exactPoints.length !== rawPoints.length || exactPoints.some((point, index) => point !== rawPoints[index])) continue;
        sourceSegments = exact.segments;
        sourceProvenance = {
          virtualSource: { kind: "generated-plain-spelling", written: plain, reading: target.reading,
            attestedInSameEntry: false, wholePairAttestationUsed: false },
          completeExactAllocation: exact.allocations,
          rawBaselineAgreementIsAnAdditionalVeto: true
        };
      }
      const projection = projectBoundaries(plain, target.written, target.reading, sourceSegments);
      if (projection === undefined) continue;
      const combined = combineAlignments(original.segments, projection.segments);
      if (combined === original.segments) continue;
      const readings = wordAlignments.get(target.written) ?? new Map();
      readings.set(target.reading, combined);
      wordAlignments.set(target.written, readings);
      witnesses.push({ id: target.id, written: target.written, reading: target.reading,
        ...sourceProvenance, targetAttestation: { ...target },
        sourceIdentities: identities, rawAlignerOptions: { ...soundOptions },
        sourceSegments, sourceEvidence: independentlyAligned.evidence,
        rawCharacterReadings: Object.fromEntries([...new Set(splitGraphemes(plain))]
          .filter(character => primary.has(character)).map(character => [character, [...primary.get(character)]])),
        withheldSeparatorBoundaries: projection.withheld
      });
    }
  }
  return { wordAlignments, witnesses };
}
