import { alignKanaPronunciations, getKanaVowels, isIdeograph, isKana, kanaPronunciation, normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";

const voicedInitials = new Map(Array.from("かきくけこさしすせそたちつてとはひふへほ").map((character, index) =>
  [character, Array.from("がぎぐげござじずぜぞだぢづでどばびぶべぼ")[index]]
));
const plosiveInitials = new Map(Array.from("はひふへほ").map((character, index) =>
  [character, Array.from("ぱぴぷぺぽ")[index]]
));
const unvoicedInitials = new Map([...voicedInitials].map(([unvoiced, voiced]) => [voiced, unvoiced]));
const nasalInitials = new Map(Array.from("あいうえお").map((character, index) =>
  [character, Array.from("なにぬねの")[index]]
));
const geminateInitials = /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u;
const removableFinals = /[ちつ]$/u;
const sokuonFinals = /[くきちつう]$/u;

function assertReadingMap(map, name) {
  if (!(map instanceof Map)) {
    throw new TypeError(`${name} must be a Map`);
  }
  for (const [written, readings] of map) {
    if (typeof written !== "string" || !Array.isArray(readings) || readings.some(reading => typeof reading !== "string")) {
      throw new TypeError(`${name} must map strings to arrays of strings`);
    }
  }
}

function compareScore(left, right) {
  return left.unknownCharacters - right.unknownCharacters || left.cost - right.cost;
}

function dictionaryEdgeCost(writtenLength) {
  return writtenLength === 1 ? 1 : 20 * (writtenLength - 1);
}

function compileWordAlignments(wordAlignments, wordAlignmentRules) {
  if (!(wordAlignments instanceof Map)) throw new TypeError("wordAlignments must be a Map");
  if (!(wordAlignmentRules instanceof Map)) throw new TypeError("wordAlignmentRules must be a Map");
  for (const [written, readings] of wordAlignmentRules) {
    if (typeof written !== "string") throw new TypeError("wordAlignmentRules keys must be strings");
    assertReadingMap(readings, "wordAlignmentRules reading rules");
  }
  const compiled = new Map();
  for (const [written, readings] of wordAlignments) {
    if (typeof written !== "string" || !(readings instanceof Map)) {
      throw new TypeError("wordAlignments must map strings to reading Maps");
    }
    const variants = [];
    for (const [reading, segments] of readings) {
      if (typeof reading !== "string" || !Array.isArray(segments)) {
        throw new TypeError("wordAlignments reading Maps must map strings to segment arrays");
      }
      const parts = segments.map(segment => {
        if (typeof segment === "string") return { written: segment, reading: segment };
        if (Array.isArray(segment) && segment.length === 2 && segment.every(value => typeof value === "string")) {
          return { written: segment[0], reading: segment[1] };
        }
        throw new TypeError("wordAlignments segments must be strings or [written, reading] pairs");
      });
      if (parts.map(part => part.written).join("") !== written || parts.map(part => part.reading).join("") !== reading) {
        throw new TypeError(`wordAlignments projections do not match ${JSON.stringify([written, reading])}`);
      }
      if (parts.some(part => !part.written || !part.reading)) {
        throw new TypeError("wordAlignments segments must have nonempty written and reading text");
      }
      variants.push({
        reading: normalizeKana(reading),
        rules: wordAlignmentRules.get(written)?.get(reading) === undefined ? ["alternate-spelling"] : [...wordAlignmentRules.get(written).get(reading)],
        parts: parts.map(part => ({
          writtenLength: splitGraphemes(part.written).length,
          reading: normalizeKana(part.reading),
          literal: normalizeKana(part.written) === normalizeKana(part.reading)
        }))
      });
    }
    if (written) compiled.set(written, variants);
  }
  return compiled;
}

function readingIndex(reading) {
  const units = splitGraphemes(reading);
  const offsets = [0];
  let normalized = "";
  for (const unit of units) {
    normalized += normalizeKana(unit);
    offsets.push(normalized.length);
  }
  const ends = new Map(offsets.map((offset, index) => [offset, index]));
  return {
    units,
    normalized,
    offsets,
    match(start, candidate) {
      const offset = offsets[start];
      if (!normalized.startsWith(candidate, offset)) return undefined;
      return ends.get(offset + candidate.length);
    },
    matchEnd(end, candidate) {
      const offset = offsets[end] - candidate.length;
      if (offset < 0 || !normalized.startsWith(candidate, offset)) return undefined;
      return ends.get(offset);
    }
  };
}

function stripVariationSelectors(text) {
  return text.replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "");
}

function mergeOutput(parts) {
  const segments = [];
  const evidence = [];
  for (const part of parts) {
    const plain = part.written === part.reading;
    const previous = evidence.at(-1);
    const merge = previous && (
      (plain && typeof segments.at(-1) === "string") ||
      (!plain && Array.isArray(segments.at(-1)) && part.type === "literal" && previous.type === "literal") ||
      (!plain && Array.isArray(segments.at(-1)) && part.type === "fallback" && previous.type === "fallback")
    );
    if (merge) {
      previous.written += part.written;
      previous.reading += part.reading;
      previous.rules = [...new Set([...previous.rules, ...part.rules])];
      if (plain) segments[segments.length - 1] += part.written;
      else segments[segments.length - 1] = [previous.written, previous.reading];
    } else {
      segments.push(plain ? part.written : [part.written, part.reading]);
      evidence.push({ ...part });
    }
  }
  return { segments, evidence };
}

/**
 * Construct an aligner from caller-supplied, licensed character and word readings.
 * Character readings retain KANJIDIC notation: katakana on readings, hiragana
 * kun readings, and dots marking okurigana. Only on readings may contract.
 * `aligned` describes support from this model, not a certification of correctness.
 * Equal-cost paths retain only boundaries shared by every best alignment.
 */
export function createAligner({
  characterReadings,
  wordReadings = new Map(),
  wordAlignments = new Map(),
  wordAlignmentRules = new Map(),
  continuativeReadings = new Map(),
  weakCharacterReadings = new Map(),
  irregularWordReadings = new Map(),
  phonologicalAlternations = true,
  terminalContraction = true,
  compoundVoicing = true,
  kanaRunCorrespondence = true,
  internalKanaAnchors = true,
  dictionaryUnvoicing = false,
  dictionaryRenjo = false,
  dictionaryNasalLoss = false,
  dictionaryInitialVoicing = false
} = {}) {
  assertReadingMap(characterReadings, "characterReadings");
  assertReadingMap(wordReadings, "wordReadings");
  assertReadingMap(continuativeReadings, "continuativeReadings");
  assertReadingMap(weakCharacterReadings, "weakCharacterReadings");
  assertReadingMap(irregularWordReadings, "irregularWordReadings");
  const alignedWords = compileWordAlignments(wordAlignments, wordAlignmentRules);
  const continuatives = new Map([...continuativeReadings].map(([written, readings]) =>
    [written, [...new Set(readings.map(normalizeKana).filter(Boolean))]]
  ));
  const weakCharacters = new Map([...weakCharacterReadings].map(([written, readings]) =>
    [written, [...new Set(readings.map(normalizeKana).filter(Boolean))]]
  ));
  const irregularWords = new Map([...irregularWordReadings].map(([written, readings]) =>
    [written, [...new Set(readings.map(normalizeKana).filter(Boolean))]]
  ));

  const characters = new Map();
  const onCharacters = new Map();
  const dottedReadings = new Map();
  for (const [written, readings] of characterReadings) {
    characters.set(written, [...new Set(readings.map(readingStem).filter(Boolean))]);
    onCharacters.set(written, [...new Set(readings.filter(reading =>
      /^[\p{Script=Katakana}ー]+$/u.test(reading.normalize("NFKC").replace(/^-|-$/gu, ""))
    ).map(readingStem).filter(Boolean))]);
    dottedReadings.set(written, readings.flatMap(reading => {
      const normalized = normalizeKana(reading.replace(/^-|-$/gu, ""));
      const dot = normalized.indexOf(".");
      if (dot <= 0) return [];
      const suffix = splitGraphemes(normalized.slice(dot + 1));
      return suffix.length > 1 ? [{ stem: normalized.slice(0, dot), suffix }] : [];
    }));
  }
  const words = new Map();
  let longestWord = 0;
  for (const [written, readings] of wordReadings) {
    if (!written) continue;
    words.set(written, [...new Set(readings.map(normalizeKana).filter(Boolean))]);
    longestWord = Math.max(longestWord, splitGraphemes(written).length);
  }
  for (const written of alignedWords.keys()) longestWord = Math.max(longestWord, splitGraphemes(written).length);
  for (const written of irregularWords.keys()) longestWord = Math.max(longestWord, splitGraphemes(written).length);
  const lexicalKanaVariants = new Map();
  if (kanaRunCorrespondence) {
    for (const readings of words.values()) {
      if (readings.length < 2) continue;
      const groups = new Map();
      for (const reading of readings) {
        const key = kanaPronunciation(reading).replaceAll("ー", "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(reading);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const reading of group) {
          if (!lexicalKanaVariants.has(reading)) lexicalKanaVariants.set(reading, new Set());
          for (const alternative of group) lexicalKanaVariants.get(reading).add(alternative);
        }
      }
    }
  }

  const hasLexicalKanaVariant = (written, reading) => {
    if (lexicalKanaVariants.get(written)?.has(reading)) return true;
    const units = splitGraphemes(written);
    for (let start = 0; start < units.length; ++start) {
      for (let end = start + 2; end <= units.length; ++end) {
        const prefix = units.slice(0, start).join("");
        const suffix = units.slice(end).join("");
        for (const alternative of lexicalKanaVariants.get(units.slice(start, end).join("")) ?? []) {
          if (prefix + alternative + suffix === reading) return true;
        }
      }
    }
    return false;
  };

  return function align(written, reading) {
    if (typeof written !== "string" || typeof reading !== "string") {
      throw new TypeError("written and reading must be strings");
    }
    if (written === reading) {
      return {
        segments: written ? [written] : [],
        status: "aligned",
        score: { unknownCharacters: 0, cost: 0 },
        optimalPathCount: "1",
        evidence: written ? [{ written, reading, type: "literal", rules: [] }] : []
      };
    }

    const writtenUnits = splitGraphemes(written);
    const readingData = readingIndex(reading);
    const readingUnits = readingData.units;
    const width = readingUnits.length + 1;
    const finalId = writtenUnits.length * width + readingUnits.length;
    const idFor = (writtenIndex, readIndex) => writtenIndex * width + readIndex;
    const dictionaryByStart = new Map();
    const attestedRanges = [];
    const irregularRanges = [];
    const ambiguousAnchorParticle = (start, end, wordReadStart, wordReading, innerStart, innerEnd, readStart, readEnd) => {
      if (innerEnd !== innerStart + 1 || !isIdeograph(writtenUnits[innerStart])) return undefined;
      const character = stripVariationSelectors(writtenUnits[innerStart]);
      const known = new Set([...(characters.get(character) ?? []), ...(words.get(character) ?? [])]);
      const residual = readingData.normalized.slice(readingData.offsets[readStart], readingData.offsets[readEnd]);
      if (known.has(residual)) return undefined;
      const particles = Array.from("のをがはにへとでも");
      const word = writtenUnits.slice(start, end).join("");
      const corroborated = (particle, writtenPosition, readPosition) => {
        const explicit = writtenUnits.slice(start, writtenPosition).join("") + particle + writtenUnits.slice(writtenPosition, end).join("");
        const offset = readingData.offsets[readPosition] - readingData.offsets[wordReadStart];
        const withoutParticle = wordReading.slice(0, offset) + wordReading.slice(offset + particle.length);
        return words.get(explicit)?.includes(wordReading) || words.get(word)?.includes(withoutParticle);
      };
      const leading = particles.some(particle => residual.startsWith(particle) && known.has(residual.slice(particle.length)) && corroborated(particle, innerStart, readStart));
      const trailing = particles.some(particle => residual.endsWith(particle) && known.has(residual.slice(0, -particle.length)) && corroborated(particle, innerEnd, readEnd - 1));
      return leading || trailing ? { leading, trailing } : undefined;
    };
    const hasAmbiguousAnchorVowel = (start, end, innerStart, innerEnd, readStart, readEnd, checkLeading = true, checkTrailing = true) => {
      if (innerEnd !== innerStart + 1 || !isIdeograph(writtenUnits[innerStart])) return false;
      const character = stripVariationSelectors(writtenUnits[innerStart]);
      const known = new Set([...(characters.get(character) ?? []), ...(words.get(character) ?? [])]);
      const residual = readingData.normalized.slice(readingData.offsets[readStart], readingData.offsets[readEnd]);
      if (known.has(residual)) return false;
      if (checkLeading && innerStart > start) {
        const previous = normalizeKana(writtenUnits[innerStart - 1]);
        const vowels = getKanaVowels(previous);
        if (vowels?.some(vowel => residual.startsWith(vowel) && known.has(residual.slice(vowel.length)))) return true;
      }
      if (checkTrailing && innerEnd < end) {
        const next = normalizeKana(writtenUnits[innerEnd]);
        if (/^[あいうえお]$/u.test(next) && residual.endsWith(next) && known.has(residual.slice(0, -next.length))) return true;
      }
      return false;
    };
    const internalAnchorBoundaries = (start, end, readStart, readEnd) => {
      const parts = [];
      for (let index = start; index < end; ++index) {
        const kana = isKana(writtenUnits[index]);
        if (!parts.length || parts.at(-1).kana !== kana) parts.push({ start: index, end: index + 1, kana });
        else parts.at(-1).end = index + 1;
      }
      if (!parts.some((part, index) => part.kana && index > 0 && index < parts.length - 1)) return undefined;
      const forward = [new Set([readStart])];
      for (const part of parts) {
        const next = new Set();
        if (part.kana) {
          const literal = normalizeKana(writtenUnits.slice(part.start, part.end).join(""));
          for (const position of forward.at(-1)) {
            const match = readingData.match(position, literal);
            if (match !== undefined && match <= readEnd) next.add(match);
          }
        } else if (forward.at(-1).size) {
          const first = Math.min(...forward.at(-1)) + 1;
          for (let position = first; position <= readEnd; ++position) next.add(position);
        }
        forward.push(next);
      }
      if (!forward.at(-1).has(readEnd)) return undefined;
      const backward = new Array(parts.length + 1);
      backward[parts.length] = new Set([readEnd]);
      for (let index = parts.length - 1; index >= 0; --index) {
        const part = parts[index];
        const previous = new Set();
        if (part.kana) {
          const literal = normalizeKana(writtenUnits.slice(part.start, part.end).join(""));
          for (let position = readStart; position < readEnd; ++position) {
            if (backward[index + 1].has(readingData.match(position, literal))) previous.add(position);
          }
        } else if (backward[index + 1].size) {
          const last = Math.max(...backward[index + 1]);
          for (let position = readStart; position < last; ++position) previous.add(position);
        }
        backward[index] = previous;
      }
      const boundaries = [];
      for (let index = 0; index <= parts.length; ++index) {
        const positions = [...forward[index]].filter(position => backward[index].has(position));
        if (positions.length === 1) boundaries.push({ writtenIndex: index === 0 ? start : parts[index - 1].end, readIndex: positions[0] });
      }
      return { parts, boundaries };
    };
    const addDictionaryEdge = (start, readStart, end, readEnd, rules = [], suppliedCost, type) => {
      const id = idFor(start, readStart);
      if (!dictionaryByStart.has(id)) dictionaryByStart.set(id, []);
      const edges = dictionaryByStart.get(id);
      const cost = suppliedCost === undefined ? dictionaryEdgeCost(end - start) : suppliedCost;
      const existing = edges.find(edge => edge.end === end && edge.readEnd === readEnd);
      if (!existing) edges.push({ end, readEnd, rules, cost, type });
      else if (cost < existing.cost) Object.assign(existing, { cost, rules, type });
    };

    // Only attested spelling/reading pairs create compound edges. A word with
    // several spellings must be supplied with the readings valid for each one.
    for (let start = 0; start < writtenUnits.length; ++start) {
      let text = "";
      for (let end = start + 1; end <= Math.min(writtenUnits.length, start + longestWord); ++end) {
        text += writtenUnits[end - 1];
        const candidates = words.get(text);
        const variants = alignedWords.get(text);
        const irregularReadings = irregularWords.get(text);
        if (!candidates && !variants && !irregularReadings) continue;
        let kanaRunEnd = start;
        while (kanaRunEnd < end && isKana(writtenUnits[kanaRunEnd])) ++kanaRunEnd;
        const leadingKana = normalizeKana(writtenUnits.slice(start, kanaRunEnd).join(""));
        const leadingPronunciation = kanaPronunciation(leadingKana);
        const leadingShortPronunciation = leadingPronunciation.replaceAll("ー", "");
        const readingCandidates = [];
        for (const candidate of candidates ?? []) {
          readingCandidates.push({ text: candidate, cost: 0, rules: [] });
          if (compoundVoicing && start > 0 && end - start > 1 && isIdeograph(writtenUnits[start])) {
            const first = Array.from(candidate)[0];
            if (voicedInitials.has(first)) {
              readingCandidates.push({ text: voicedInitials.get(first) + candidate.slice(first.length), cost: 2, rules: ["compound-voicing"] });
            }
          }
        }
        const alignmentCandidates = [];
        for (const variant of variants ?? []) {
          alignmentCandidates.push({ ...variant, cost: 0, phonologicalRules: [] });
          const first = Array.from(variant.reading)[0];
          if (compoundVoicing && start > 0 && end - start > 1 && isIdeograph(writtenUnits[start]) && voicedInitials.has(first) && !variant.parts[0].literal) {
            const voiced = voicedInitials.get(first);
            alignmentCandidates.push({
              reading: voiced + variant.reading.slice(first.length),
              parts: variant.parts.map((part, index) => index === 0 ? { ...part, reading: voiced + part.reading.slice(first.length) } : part),
              rules: variant.rules,
              cost: 2,
              phonologicalRules: ["compound-voicing"]
            });
          }
        }
        for (let readStart = 0; readStart < readingUnits.length; ++readStart) {
          for (const irregularReading of irregularReadings ?? []) {
            const readEnd = readingData.match(readStart, irregularReading);
            if (readEnd !== undefined) irregularRanges.push({ start, end, readStart, readEnd });
          }
          for (const candidate of readingCandidates) {
            const readEnd = readingData.match(readStart, candidate.text);
            if (readEnd === undefined) continue;
            if (candidate.cost === 0) attestedRanges.push({ start, end, readStart, readEnd });
            addDictionaryEdge(start, readStart, end, readEnd, candidate.rules, dictionaryEdgeCost(end - start) + candidate.cost);

            if (internalKanaAnchors && candidate.cost === 0) {
              const anchored = internalAnchorBoundaries(start, end, readStart, readEnd);
              for (let index = 1; anchored && index < anchored.boundaries.length; ++index) {
                const left = anchored.boundaries[index - 1];
                const right = anchored.boundaries[index];
                if (writtenUnits.slice(left.writtenIndex, right.writtenIndex).every(isKana)) continue;
                const leadingKana = anchored.parts.find(part => part.kana && part.end === left.writtenIndex && part.start === start);
                const trailingKana = anchored.parts.find(part => part.kana && part.start === right.writtenIndex && part.end === end);
                if (hasAmbiguousAnchorVowel(start, end, left.writtenIndex, right.writtenIndex, left.readIndex, right.readIndex, Boolean(leadingKana), Boolean(trailingKana))) continue;
                // An unprinted particle can occur between the literal anchor
                // and a known character reading. Its ownership is unresolved.
                const particle = ambiguousAnchorParticle(start, end, readStart, candidate.text, left.writtenIndex, right.writtenIndex, left.readIndex, right.readIndex);
                if (particle) {
                  const previous = anchored.boundaries[index - 2];
                  const next = anchored.boundaries[index + 1];
                  const rules = ["dictionary-internal-kana-anchors", "unwritten-particle-group"];
                  if (particle.leading && previous && writtenUnits.slice(previous.writtenIndex, left.writtenIndex).every(isKana)) {
                    addDictionaryEdge(previous.writtenIndex, previous.readIndex, right.writtenIndex, right.readIndex, rules, dictionaryEdgeCost(right.writtenIndex - previous.writtenIndex) + 5);
                  }
                  if (particle.trailing && next && writtenUnits.slice(right.writtenIndex, next.writtenIndex).every(isKana)) {
                    addDictionaryEdge(left.writtenIndex, left.readIndex, next.writtenIndex, next.readIndex, rules, dictionaryEdgeCost(next.writtenIndex - left.writtenIndex) + 5);
                  }
                  continue;
                }
                // Every complete literal placement shares these boundaries;
                // unresolved kanji inside each residual remain together.
                addDictionaryEdge(left.writtenIndex, left.readIndex, right.writtenIndex, right.readIndex, ["dictionary-internal-kana-anchors"], dictionaryEdgeCost(right.writtenIndex - left.writtenIndex) + 5);
              }
            }

            if (kanaRunCorrespondence && candidate.cost === 0 && kanaRunEnd > start && kanaRunEnd < end && isIdeograph(writtenUnits[kanaRunEnd])) {
              for (let kanaReadEnd = readStart + 1; kanaReadEnd < readEnd; ++kanaReadEnd) {
                const readPrefix = readingData.normalized.slice(readingData.offsets[readStart], readingData.offsets[kanaReadEnd]);
                const pronunciation = kanaPronunciation(readPrefix);
                const shortPronunciation = pronunciation.replaceAll("ー", "");
                if (shortPronunciation.length > leadingShortPronunciation.length) break;
                if (readPrefix === leadingKana || shortPronunciation !== leadingShortPronunciation) continue;
                const samePronunciation = pronunciation === leadingPronunciation;
                const alternativeWordReading = leadingKana + candidate.text.slice(readPrefix.length);
                const licensedDurationChange = kanaRunEnd - start >= 2 && (
                  candidates.includes(alternativeWordReading) || hasLexicalKanaVariant(leadingKana, readPrefix)
                );
                if (samePronunciation || licensedDurationChange) {
                  const rules = ["kana-run-correspondence", samePronunciation ? "long-vowel-notation" : "lexical-vowel-length"];
                  const kanaParts = alignKanaPronunciations(writtenUnits.slice(start, kanaRunEnd).join(""), readingUnits.slice(readStart, kanaReadEnd).join(""));
                  if (!kanaParts) {
                    addDictionaryEdge(start, readStart, kanaRunEnd, kanaReadEnd, rules, 6, "phonological");
                  } else {
                    let partStart = start;
                    let partReadStart = readStart;
                    for (const [base, ruby] of kanaParts) {
                      const partEnd = partStart + splitGraphemes(base).length;
                      const partReadEnd = readingData.match(partReadStart, normalizeKana(ruby));
                      if (normalizeKana(base) !== normalizeKana(ruby)) {
                        addDictionaryEdge(partStart, partReadStart, partEnd, partReadEnd, rules, 6, "phonological");
                      }
                      partStart = partEnd;
                      partReadStart = partReadEnd;
                    }
                  }
                }
              }
            }

            // Matching literal kana delimit the unresolved part of an attested
            // word. Keep that evidence local to this occurrence; it does not
            // establish a reusable reading for the remaining kanji.
            let innerStart = start;
            let innerReadStart = readStart;
            let innerEnd = end;
            let innerReadEnd = readEnd;
            while (innerStart < innerEnd && isKana(writtenUnits[innerStart])) {
              const next = readingData.match(innerReadStart, normalizeKana(writtenUnits[innerStart]));
              if (next === undefined || next > innerReadEnd) break;
              ++innerStart;
              innerReadStart = next;
            }
            while (innerStart < innerEnd && isKana(writtenUnits[innerEnd - 1])) {
              const previous = readingData.matchEnd(innerReadEnd, normalizeKana(writtenUnits[innerEnd - 1]));
              if (previous === undefined || previous < innerReadStart) break;
              --innerEnd;
              innerReadEnd = previous;
            }
            if (innerStart < innerEnd && innerReadStart < innerReadEnd && (innerStart > start || innerEnd < end)) {
              // Trimming is not proof that a neighboring kana's possible long
              // vowel belongs to the kanji. Retain the word group when that
              // allocation competes with an independently supported reading.
              if (!hasAmbiguousAnchorVowel(start, end, innerStart, innerEnd, innerReadStart, innerReadEnd)) {
                addDictionaryEdge(innerStart, innerReadStart, innerEnd, innerReadEnd, [...candidate.rules, "dictionary-kana-anchors"], dictionaryEdgeCost(innerEnd - innerStart) + candidate.cost + 4);
              }
            }
          }
          for (const variant of alignmentCandidates) {
            const readEnd = readingData.match(readStart, variant.reading);
            if (readEnd === undefined) continue;
            if (variant.cost === 0) attestedRanges.push({ start, end, readStart, readEnd });
            let partStart = start;
            let partReadStart = readStart;
            const edges = [];
            for (const part of variant.parts) {
              const partEnd = partStart + part.writtenLength;
              const partReadEnd = readingData.match(partReadStart, part.reading);
              if (partReadEnd === undefined || partEnd > end || partReadEnd > readEnd) break;
              const firstPart = partStart === start;
              const cost = part.literal ? 0 : 1 + 20 * (part.writtenLength - 1) + (firstPart ? variant.cost : 0);
              edges.push([partStart, partReadStart, partEnd, partReadEnd, [...variant.rules, ...(firstPart ? variant.phonologicalRules : [])], cost]);
              partStart = partEnd;
              partReadStart = partReadEnd;
            }
            // A normalization match may still split a combining sequence;
            // require every supplied boundary to be a boundary in this input.
            if (edges.length === variant.parts.length && partStart === end && partReadStart === readEnd) {
              for (const edge of edges) {
                // Literal transitions already exist one grapheme at a time;
                // adding grouped literal edges would create false ambiguity.
                if (edge[5] > 0) addDictionaryEdge(...edge);
              }
            }
          }
        }
      }
    }

    function candidatesFor(writtenIndex, readIndex) {
      const character = writtenUnits[writtenIndex];
      let lookup = stripVariationSelectors(character);
      if (lookup === "々") {
        let previous = writtenIndex - 1;
        while (previous >= 0 && stripVariationSelectors(writtenUnits[previous]) === "々") --previous;
        lookup = previous >= 0 ? stripVariationSelectors(writtenUnits[previous]) : lookup;
      }
      const stems = characters.get(lookup) ?? [];
      const iterationRules = stripVariationSelectors(character) === "々" ? ["iteration"] : [];
      const candidates = new Map();
      const add = (text, cost, rules, type) => {
        if (!text) return;
        const current = candidates.get(text);
        if (!current || cost < current.cost) candidates.set(text, { text, cost, rules, type });
      };
      for (const stem of stems) add(stem, 0, iterationRules);

      if (phonologicalAlternations) {
        for (const stem of stems) {
          const first = Array.from(stem)[0];
          const rest = stem.slice(first.length);
          const previousKana = normalizeKana(readingUnits[readIndex - 1] ?? "");
          if (writtenIndex > 0 && voicedInitials.has(first)) {
            add(voicedInitials.get(first) + rest, 2, [...iterationRules, "rendaku"]);
          }
          if ((previousKana === "っ" || previousKana === "ん") && plosiveInitials.has(first)) {
            add(plosiveInitials.get(first) + rest, 2, [...iterationRules, previousKana === "っ" ? "post-sokuon-plosive" : "post-nasal-plosive"]);
          }
          // Literal kana own their exact reading. An extra consonant in a
          // kana/kanji compound consequently belongs to the following kanji.
          if (writtenIndex > 0 && isKana(writtenUnits[writtenIndex - 1]) && geminateInitials.test(stem)) {
            add("っ" + stem, 5, [...iterationRules, "post-kana-gemination"]);
          }
        }
        for (const candidate of [...candidates.values()]) {
          if (writtenIndex + 1 >= writtenUnits.length || !isIdeograph(writtenUnits[writtenIndex + 1])) continue;
          const nextAfter = text => {
            const end = readingData.match(readIndex, text);
            return end === undefined ? "" : normalizeKana(readingUnits[end] ?? "");
          };
          if (sokuonFinals.test(candidate.text)) {
            const text = candidate.text.slice(0, -1) + "っ";
            if (geminateInitials.test(nextAfter(text))) add(text, candidate.cost + 3, [...candidate.rules, "sokuon"]);
          }
          const text = candidate.text + "っ";
          if (geminateInitials.test(nextAfter(text))) add(text, candidate.cost + 5, [...candidate.rules, "gemination"]);
        }
      }

      const supportedCompound = dictionaryByStart.get(idFor(writtenIndex, readIndex))?.some(edge =>
        !edge.rules.includes("compound-voicing") && edge.end > writtenIndex + 1 && writtenUnits.slice(writtenIndex, edge.end).every(isIdeograph)
      );
      if (terminalContraction && supportedCompound) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          if (removableFinals.test(stem)) add(stem.slice(0, -1), 8, ["dictionary-supported-terminal-contraction"]);
        }
      }
      if (writtenIndex + 1 < writtenUnits.length && isKana(writtenUnits[writtenIndex + 1])) {
        for (const { stem, suffix } of dottedReadings.get(lookup) ?? []) {
          for (let prefixLength = 1; prefixLength < suffix.length; ++prefixLength) {
            const remainder = suffix.slice(prefixLength).join("");
            const writtenEnd = writtenIndex + 1 + suffix.length - prefixLength;
            const writtenRemainder = writtenUnits.slice(writtenIndex + 1, writtenEnd);
            if (!writtenRemainder.every(isKana) || normalizeKana(writtenRemainder.join("")) !== remainder) continue;
            const candidate = stem + suffix.slice(0, prefixLength).join("");
            const readEnd = readingData.match(readIndex, candidate);
            const suffixEnd = readEnd === undefined ? undefined : readingData.match(readEnd, remainder);
            if (suffixEnd !== undefined && attestedRanges.some(range =>
              range.start <= writtenIndex && writtenEnd <= range.end &&
              range.readStart <= readIndex && suffixEnd <= range.readEnd
            )) {
              // A dotted reading can omit only part of its okurigana: `い.だす`
              // supports `出す` as `出[いだ] す` when the remaining `す` is literal.
              add(candidate, 4, ["partial-okurigana"]);
            }
          }
        }
      }
      if (writtenIndex + 1 < writtenUnits.length && isIdeograph(writtenUnits[writtenIndex + 1])) {
        for (const stem of continuatives.get(lookup) ?? []) {
          const readEnd = readingData.match(readIndex, stem);
          if (readEnd !== undefined && attestedRanges.some(range =>
            range.start <= writtenIndex && writtenIndex + 1 < range.end &&
            range.readStart <= readIndex && readEnd < range.readEnd
          )) {
            // The source verifies the verb stem; the exact compound context
            // licenses absorbing its omitted okurigana at this boundary.
            add(stem, 8, ["continuative-stem"]);
          }
        }
      }
      for (const candidate of weakCharacters.get(lookup) ?? []) {
        const variants = [{ text: candidate, cost: 12, rules: ["weak-character-reading"] }];
        if (phonologicalAlternations && writtenIndex > 0 && voicedInitials.has(candidate[0])) {
          variants.push({ text: voicedInitials.get(candidate[0]) + candidate.slice(1), cost: 14, rules: ["weak-character-reading", "rendaku"] });
        }
        for (const variant of variants) {
          const readEnd = readingData.match(readIndex, variant.text);
          const irregular = readEnd !== undefined && irregularRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end && range.readStart <= readIndex && readEnd <= range.readEnd
          );
          if (readEnd !== undefined && !irregular && attestedRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end &&
            range.readStart <= readIndex && readEnd <= range.readEnd &&
            writtenUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2
          )) {
            add(variant.text, variant.cost, variant.rules, "dictionary");
          }
        }
      }
      if (dictionaryUnvoicing && phonologicalAlternations) {
        for (const stem of stems) {
          const unvoiced = unvoicedInitials.get(stem[0]);
          if (unvoiced === undefined) continue;
          const candidate = unvoiced + stem.slice(1);
          const readEnd = readingData.match(readIndex, candidate);
          const irregular = readEnd !== undefined && irregularRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end && range.readStart <= readIndex && readEnd <= range.readEnd
          );
          if (readEnd !== undefined && !irregular && attestedRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end &&
            range.readStart <= readIndex && readEnd <= range.readEnd &&
            writtenUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2
          )) {
            add(candidate, 12, ["dictionary-supported-unvoicing"]);
          }
        }
      }
      if (dictionaryNasalLoss && phonologicalAlternations) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          if (!stem.endsWith("ん") || stem.length < 2) continue;
          const candidate = stem.slice(0, -1);
          const readEnd = readingData.match(readIndex, candidate);
          const irregular = readEnd !== undefined && irregularRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end && range.readStart <= readIndex && readEnd <= range.readEnd
          );
          if (readEnd !== undefined && !irregular && attestedRanges.some(range =>
            range.start <= writtenIndex && writtenIndex < range.end &&
            range.readStart <= readIndex && readEnd <= range.readEnd &&
            writtenUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2
          )) {
            // Historical on readings can lack a written final nasal in an
            // attested word; this is weak lexical evidence, not a free reading.
            add(candidate, 12, ["dictionary-supported-nasal-loss"]);
          }
        }
      }
      if (dictionaryInitialVoicing && phonologicalAlternations) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          const initials = [voicedInitials.get(stem[0]), plosiveInitials.get(unvoicedInitials.get(stem[0]) ?? stem[0])];
          for (const initial of initials) {
            if (initial === undefined || initial === stem[0]) continue;
            const candidate = initial + stem.slice(1);
            const readEnd = readingData.match(readIndex, candidate);
            const irregular = readEnd !== undefined && irregularRanges.some(range =>
              range.start <= writtenIndex && writtenIndex < range.end && range.readStart <= readIndex && readEnd <= range.readEnd
            );
            if (readEnd !== undefined && !irregular && attestedRanges.some(range =>
              range.start <= writtenIndex && writtenIndex < range.end &&
              range.readStart <= readIndex && readEnd <= range.readEnd &&
              writtenUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2
            )) {
              add(candidate, 12, ["dictionary-supported-initial-voicing"]);
            }
          }
        }
      }
      if (dictionaryRenjo && phonologicalAlternations && writtenIndex > 0 && isIdeograph(writtenUnits[writtenIndex - 1]) && normalizeKana(readingUnits[readIndex - 1] ?? "") === "ん") {
        for (const stem of onCharacters.get(lookup) ?? []) {
          const nasal = nasalInitials.get(stem[0]);
          if (nasal === undefined) continue;
          const candidate = nasal + stem.slice(1);
          const readEnd = readingData.match(readIndex, candidate);
          if (readEnd !== undefined && attestedRanges.some(range =>
            range.start < writtenIndex && writtenIndex < range.end &&
            range.readStart < readIndex && readEnd <= range.readEnd
          )) {
            add(candidate, 12, ["dictionary-supported-renjo"]);
          }
        }
      }
      return [...candidates.values()];
    }

    function solve(allowFallback) {
      const nodes = new Array((writtenUnits.length + 1) * width);
      nodes[0] = { unknownCharacters: 0, cost: 0, incoming: [] };
      const addEdge = (sourceId, writtenIndex, readIndex, type, cost = 0, rules = [], unknownCharacters = 0) => {
        const source = nodes[sourceId];
        const destinationId = idFor(writtenIndex, readIndex);
        const score = { unknownCharacters: source.unknownCharacters + unknownCharacters, cost: source.cost + cost };
        let destination = nodes[destinationId];
        const comparison = destination ? compareScore(score, destination) : -1;
        if (comparison > 0) return;
        const edge = { sourceId, destinationId, type, rules };
        if (comparison < 0) {
          destination = { ...score, incoming: [edge] };
          nodes[destinationId] = destination;
        } else if (!destination.incoming.some(previous => previous.sourceId === sourceId)) {
          destination.incoming.push(edge);
        }
      };

      for (let writtenIndex = 0; writtenIndex < writtenUnits.length; ++writtenIndex) {
        for (let readIndex = 0; readIndex < readingUnits.length; ++readIndex) {
          const sourceId = idFor(writtenIndex, readIndex);
          if (!nodes[sourceId]) continue;
          const character = writtenUnits[writtenIndex];
          const literalEnd = readingData.match(readIndex, normalizeKana(character));
          if (literalEnd !== undefined) addEdge(sourceId, writtenIndex + 1, literalEnd, "literal");

          if (isKana(character)) {
            const contexts = attestedRanges.filter(range => range.start <= writtenIndex && writtenIndex < range.end && range.readStart <= readIndex && readIndex < range.readEnd);
            if (phonologicalAlternations && literalEnd !== undefined && contexts.length) {
              const vowels = getKanaVowels(character);
              const katakana = /^[\p{Script=Katakana}\u3099\u309a]+$/u.test(character.normalize("NFKC"));
              // Hiragana often precedes a kanji whose reading starts with a
              // vowel. Only katakana permits an omitted written vowel; an
              // actual prolonged mark can extend a kana in either script.
              for (const vowel of vowels ? [...(katakana ? vowels : []), "ー"] : []) {
                const readEnd = readingData.match(readIndex, normalizeKana(character) + vowel);
                const next = writtenUnits[writtenIndex + 1];
                const nextKanaMatches = readEnd !== undefined && (next === undefined || !isKana(next) || readingData.match(readEnd, normalizeKana(next)) !== undefined);
                if (nextKanaMatches && contexts.some(range => readEnd <= range.readEnd)) {
                  addEdge(sourceId, writtenIndex + 1, readEnd, "phonological", 2, ["dictionary-supported-kana-vowel-extension"]);
                }
              }
            }
            if (literalEnd === undefined && contexts.length) {
              // Permit a single substituted kana only when the rest of its
              // kana run remains literal. Variable-length residuals would let
              // an incomplete kanji reading spill into the following kana.
              let runEnd = writtenIndex + 1;
              while (runEnd < writtenUnits.length && isKana(writtenUnits[runEnd])) ++runEnd;
              const unchangedTail = writtenUnits.slice(writtenIndex + 1, runEnd).join("");
              const tailEnd = unchangedTail ? readingData.match(readIndex + 1, normalizeKana(unchangedTail)) : undefined;
              if (tailEnd !== undefined && isKana(readingUnits[readIndex]) && normalizeKana(readingUnits[readIndex]) !== "ー" && contexts.some(range => runEnd <= range.end && tailEnd <= range.readEnd)) {
                addEdge(sourceId, writtenIndex + 1, readIndex + 1, "ambiguous", 14, ["dictionary-kana-mismatch"]);
              }
            }
          }

          if (isIdeograph(character)) {
            for (const candidate of candidatesFor(writtenIndex, readIndex)) {
              const readEnd = readingData.match(readIndex, candidate.text);
              if (readEnd !== undefined) {
                addEdge(sourceId, writtenIndex + 1, readEnd, candidate.type ?? (candidate.cost ? "phonological" : "character"), candidate.cost, candidate.rules);
              }
            }
          }
          for (const edge of dictionaryByStart.get(idFor(writtenIndex, readIndex)) ?? []) {
            // A dictionary group is sound evidence, but incurs a cost for each
            // boundary it leaves unresolved compared with character readings.
            addEdge(sourceId, edge.end, edge.readEnd, edge.type ?? "dictionary", edge.cost, edge.rules);
          }
          if (allowFallback && !isKana(character)) {
            for (let readEnd = readIndex + 1; readEnd <= readingUnits.length; ++readEnd) {
              addEdge(sourceId, writtenIndex + 1, readEnd, "fallback", 0, [], 1);
            }
          }
        }
      }
      return nodes[finalId] ? nodes : undefined;
    }

    function render(nodes) {
      if (!nodes) {
        return {
          segments: [[written, reading]],
          status: "fallback",
          score: { unknownCharacters: writtenUnits.length, cost: 0 },
          optimalPathCount: "1",
          evidence: [{ written, reading, type: "fallback", rules: [] }]
        };
      }

      const ancestors = new Set([finalId]);
      const pending = [finalId];
      while (pending.length) {
        const id = pending.pop();
        for (const edge of nodes[id].incoming) {
          if (!ancestors.has(edge.sourceId)) {
            ancestors.add(edge.sourceId);
            pending.push(edge.sourceId);
          }
        }
      }
      const ordered = [...ancestors].sort((left, right) => left - right);
      const forwardCounts = new Map([[0, 1n]]);
      for (const id of ordered) {
        if (id === 0) continue;
        forwardCounts.set(id, nodes[id].incoming.reduce((count, edge) => count + forwardCounts.get(edge.sourceId), 0n));
      }
      const backwardCounts = new Map([[finalId, 1n]]);
      for (const id of ordered.toReversed()) {
        for (const edge of nodes[id].incoming) {
          backwardCounts.set(edge.sourceId, (backwardCounts.get(edge.sourceId) ?? 0n) + backwardCounts.get(id));
        }
      }
      const pathCount = forwardCounts.get(finalId);
      const boundaries = ordered.filter(id => forwardCounts.get(id) * backwardCounts.get(id) === pathCount);
      const parts = [];
      for (let index = 1; index < boundaries.length; ++index) {
        const startId = boundaries[index - 1];
        const endId = boundaries[index];
        const localEdges = ordered.filter(id => id > startId && id <= endId).flatMap(id => nodes[id].incoming);
        const ambiguous = forwardCounts.get(endId) > forwardCounts.get(startId);
        const fallback = localEdges.some(edge => edge.type === "fallback");
        parts.push({
          written: writtenUnits.slice(Math.floor(startId / width), Math.floor(endId / width)).join(""),
          reading: readingUnits.slice(startId % width, endId % width).join(""),
          type: fallback ? "fallback" : ambiguous ? "ambiguous" : localEdges[0].type,
          rules: [...new Set(localEdges.flatMap(edge => edge.rules))]
        });
      }
      const result = mergeOutput(parts);
      const score = { unknownCharacters: nodes[finalId].unknownCharacters, cost: nodes[finalId].cost };
      return {
        ...result,
        status: score.unknownCharacters ? "fallback" : pathCount > 1n || result.evidence.some(part => part.type === "ambiguous") ? "ambiguous" : "aligned",
        score,
        optimalPathCount: pathCount.toString()
      };
    }

    return render(solve(false) ?? solve(true));
  };
}
