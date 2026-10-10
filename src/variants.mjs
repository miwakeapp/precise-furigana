import { isIdeograph, isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { enumeratePairs } from "./sources.mjs";
import { boundaries, pairKey, validateAlignment } from "./segments.mjs";

const numeralPattern = /^[〇零一二三四五六七八九十百千万億兆京壱弐参拾廿卅卌壹貳參肆伍陸柒捌玖佰仟陌阡萬]/u;

function sameGrapheme(left, right) {
  return left === right || (isKana(left) && isKana(right) && normalizeKana(left) === normalizeKana(right));
}

function uniqueDeletionMapping(source, target) {
  if (source.length <= target.length) return undefined;
  const sourceIdeographs = source.filter(isIdeograph);
  const targetIdeographs = target.filter(isIdeograph);
  if (sourceIdeographs.length === 0 || sourceIdeographs.join("") !== targetIdeographs.join("")) return undefined;

  const width = target.length + 1;
  const paths = new Uint8Array((source.length + 1) * width);
  paths[source.length * width + target.length] = 1;
  for (let sourceIndex = source.length - 1; sourceIndex >= 0; --sourceIndex) {
    for (let targetIndex = target.length; targetIndex >= 0; --targetIndex) {
      let count = isKana(source[sourceIndex]) ? paths[(sourceIndex + 1) * width + targetIndex] : 0;
      if (targetIndex < target.length && sameGrapheme(source[sourceIndex], target[targetIndex])) {
        count += paths[(sourceIndex + 1) * width + targetIndex + 1];
      }
      paths[sourceIndex * width + targetIndex] = Math.min(2, count);
    }
  }
  if (paths[0] !== 1) return undefined;

  const mapping = [];
  let targetIndex = 0;
  for (let sourceIndex = 0; sourceIndex < source.length; ++sourceIndex) {
    if (targetIndex < target.length && sameGrapheme(source[sourceIndex], target[targetIndex]) && paths[(sourceIndex + 1) * width + targetIndex + 1] !== 0) {
      mapping.push(targetIndex++);
    } else {
      mapping.push(-1);
    }
  }
  return mapping;
}

function pushSegment(segments, written, reading) {
  if (written === reading) {
    if (typeof segments.at(-1) === "string") segments[segments.length - 1] += written;
    else segments.push(written);
  } else {
    segments.push([written, reading]);
  }
}

function attachDeletedReading(segments, reading) {
  const previous = segments.at(-1);
  if (!Array.isArray(previous) || !isIdeograph(splitGraphemes(previous[0]).at(-1))) return false;
  previous[1] += reading;
  return true;
}

function transferSegments(source, target, reading, mapping, segments) {
  const output = [];
  let offset = 0;
  for (const segment of segments) {
    const literal = typeof segment === "string";
    const written = literal ? segment : segment[0];
    const segmentReading = literal ? segment : segment[1];
    const graphemes = splitGraphemes(written);
    if (graphemes.some((grapheme, index) => grapheme !== source[offset + index])) return undefined;
    const localMapping = mapping.slice(offset, offset + graphemes.length);
    offset += graphemes.length;

    if (literal) {
      for (const [index, grapheme] of graphemes.entries()) {
        if (localMapping[index] === -1) {
          if (!attachDeletedReading(output, grapheme)) return undefined;
        } else {
          pushSegment(output, target[localMapping[index]], grapheme);
        }
      }
      continue;
    }

    const retained = localMapping.filter(index => index !== -1).map(index => target[index]).join("");
    if (retained.length === 0) {
      if (!attachDeletedReading(output, segmentReading)) return undefined;
      continue;
    }
    if (localMapping.includes(-1)) {
      const firstIdeograph = graphemes.findIndex(isIdeograph);
      // An existing grouped ruby span can shrink, but its reading cannot be split or moved to a neighbor.
      if (firstIdeograph === -1 || localMapping.slice(0, firstIdeograph).includes(-1)) return undefined;
    }
    pushSegment(output, retained, segmentReading);
  }
  if (offset !== source.length) return undefined;
  validateAlignment(target.join(""), reading, output);
  return output;
}

function uniqueSubstitutionMapping(source, target, kanaSubstitutions, latinSubstitutions) {
  const isLatin = value => /^[A-Za-zＡ-Ｚａ-ｚ]$/u.test(value);
  const hasKanjiReplacement = kanaSubstitutions && source.filter(isIdeograph).length < target.filter(isIdeograph).length;
  const hasLatinReplacement = latinSubstitutions && source.filter(isLatin).length < target.filter(isLatin).length;
  if (!hasKanjiReplacement && !hasLatinReplacement) return undefined;
  const memo = new Map();
  function visit(sourceIndex, targetIndex, replaced) {
    const key = `${sourceIndex}:${targetIndex}:${replaced}`;
    if (memo.has(key)) return memo.get(key);
    if (sourceIndex === source.length && targetIndex === target.length) return [[]];
    const paths = [];
    function add(sourceEnd, targetEnd, substitution) {
      for (const suffix of visit(sourceEnd, targetEnd, substitution)) {
        paths.push([{ sourceStart: sourceIndex, sourceEnd, targetStart: targetIndex, targetEnd, substitution }, ...suffix]);
        if (paths.length === 2) return;
      }
    }
    if (sourceIndex < source.length && targetIndex < target.length && sameGrapheme(source[sourceIndex], target[targetIndex])) {
      add(sourceIndex + 1, targetIndex + 1, false);
    }
    // Adjacent replacement operations would invent divisions inside an opaque kanji run.
    if (!replaced) {
      for (let sourceEnd = sourceIndex + 1; sourceEnd <= source.length && isKana(source[sourceEnd - 1]) && paths.length < 2; ++sourceEnd) {
        const replacementKind = hasKanjiReplacement && /^\p{Unified_Ideograph}/u.test(target[targetIndex] ?? "") ? "kanji" :
          hasLatinReplacement && isLatin(target[targetIndex] ?? "") ? "latin" : undefined;
        for (let targetEnd = targetIndex + 1; targetEnd <= target.length && paths.length < 2 &&
          (replacementKind === "kanji" ? /^\p{Unified_Ideograph}/u.test(target[targetEnd - 1]) : replacementKind === "latin" && isLatin(target[targetEnd - 1])); ++targetEnd) {
          add(sourceEnd, targetEnd, true);
        }
      }
    }
    memo.set(key, paths);
    return paths;
  }
  const paths = visit(0, 0, false);
  return paths.length === 1 ? paths[0] : undefined;
}

function transferSubstitutions(source, target, reading, mapping, segments, boundaryReadings) {
  const sourceBoundaries = new Map([[0, 0]]);
  let sourceOffset = 0;
  let readingOffset = 0;
  for (const segment of segments) {
    const literal = typeof segment === "string";
    const written = splitGraphemes(literal ? segment : segment[0]);
    const read = splitGraphemes(literal ? segment : segment[1]);
    if (written.length === read.length && written.every((grapheme, index) => isKana(grapheme) && sameGrapheme(grapheme, read[index]))) {
      for (let index = 1; index < written.length; ++index) {
        sourceBoundaries.set(sourceOffset + index, readingOffset + index);
      }
    }
    sourceOffset += written.length;
    readingOffset += read.length;
    sourceBoundaries.set(sourceOffset, readingOffset);
  }
  if (sourceOffset !== source.length) return undefined;

  const targetBoundaries = new Map([[0, 0]]);
  const readingGraphemes = splitGraphemes(reading);
  for (const operation of mapping) {
    if (operation.substitution && (!sourceBoundaries.has(operation.sourceStart) || !sourceBoundaries.has(operation.sourceEnd))) return undefined;
    if (operation.substitution && /^[っゃゅょぁぃぅぇぉゎー]/u.test(normalizeKana(source.slice(operation.sourceStart, operation.sourceEnd).join("")))) return undefined;
    if (operation.substitution && isIdeograph(source[operation.sourceStart - 1] ?? "")) {
      const precedingStart = sourceBoundaries.get(operation.sourceStart - 1);
      if (precedingStart === undefined) return undefined;
      const precedingEnd = sourceBoundaries.get(operation.sourceStart);
      const precedingReading = normalizeKana(readingGraphemes.slice(precedingStart, precedingEnd).join(""));
      const replacedReading = normalizeKana(readingGraphemes.slice(precedingEnd, sourceBoundaries.get(operation.sourceEnd)).join(""));
      // Written kana can be the preceding character's okurigana. Its disappearance
      // does not establish that all of its sound belongs to the replacement kanji.
      if ((boundaryReadings.get(source[operation.sourceStart - 1]) ?? []).some(value =>
        value.length > precedingReading.length && value.startsWith(precedingReading) && replacedReading.startsWith(value.slice(precedingReading.length)))) return undefined;
    }
    if (sourceBoundaries.has(operation.sourceStart)) targetBoundaries.set(operation.targetStart, sourceBoundaries.get(operation.sourceStart));
    if (sourceBoundaries.has(operation.sourceEnd)) targetBoundaries.set(operation.targetEnd, sourceBoundaries.get(operation.sourceEnd));
  }
  const output = [];
  let previousWritten = 0;
  let previousReading = 0;
  for (const [writtenEnd, readingEnd] of [...targetBoundaries].sort(([left], [right]) => left - right).slice(1)) {
    pushSegment(output, target.slice(previousWritten, writtenEnd).join(""), readingGraphemes.slice(previousReading, readingEnd).join(""));
    previousWritten = writtenEnd;
    previousReading = readingEnd;
  }
  validateAlignment(target.join(""), reading, output);
  return output;
}

function canSubstituteHan(source, target) {
  if (source.length !== target.length) return false;
  let substitutions = 0;
  let sharedIdeographs = 0;
  for (let index = 0; index < source.length; ++index) {
    if (sameGrapheme(source[index], target[index])) {
      if (/^\p{Unified_Ideograph}/u.test(source[index])) ++sharedIdeographs;
      continue;
    }
    if (!/^\p{Unified_Ideograph}/u.test(source[index]) || !/^\p{Unified_Ideograph}/u.test(target[index])) return false;
    // Positional numeral spellings such as `一三` and cardinal `十三` encode
    // the same number without preserving a reading for each written digit.
    if (numeralPattern.test(source[index]) || numeralPattern.test(target[index])) return false;
    ++substitutions;
  }
  return substitutions === 1 && sharedIdeographs > 0;
}

function canSubstituteCounterSymbol(source, target) {
  if (source.length !== target.length) return false;
  let substitutions = 0;
  for (let index = 0; index < source.length; ++index) {
    if (sameGrapheme(source[index], target[index])) continue;
    if (!/^[ヶヵケ]$/u.test(source[index]) && !/^[ヶヵケ]$/u.test(target[index])) return false;
    if (!/^[かがカガヶヵケ箇個]$/u.test(source[index]) || !/^[かがカガヶヵケ箇個]$/u.test(target[index])) return false;
    ++substitutions;
  }
  return substitutions === 1;
}

function transferHanSubstitution(target, reading, segments) {
  const output = [];
  let offset = 0;
  for (const segment of segments) {
    const literal = typeof segment === "string";
    const written = literal ? segment : segment[0];
    const length = splitGraphemes(written).length;
    pushSegment(output, target.slice(offset, offset + length).join(""), literal ? segment : segment[1]);
    offset += length;
  }
  validateAlignment(target.join(""), reading, output);
  return output;
}

/** Transfer boundaries between attested sibling spellings without learning reusable character readings. */
export function deriveVariantAlignments(jmdict, align, {
  kanaSubstitutions = false, hanSubstitutions = false, counterSymbols = false, latinSubstitutions = false, characterReadings, continuativeReadings
} = {}) {
  const sourceAlignments = new Map();
  const candidates = new Map();
  const boundaryReadings = new Map();
  if (kanaSubstitutions || latinSubstitutions) {
    if (!(characterReadings instanceof Map) || !(continuativeReadings instanceof Map)) {
      throw new TypeError("Kana substitution transfers require characterReadings and continuativeReadings Maps for boundary guards");
    }
    for (const source of [characterReadings, continuativeReadings]) {
      for (const [character, readings] of source) {
        const known = boundaryReadings.get(character) ?? [];
        known.push(...readings.map(reading => normalizeKana(reading.replaceAll(".", "").replace(/^-|-$/gu, ""))));
        boundaryReadings.set(character, known);
      }
    }
  }

  for (const word of jmdict.words) {
    const readingGroups = new Map();
    for (const pair of enumeratePairs({ words: [word] })) {
      if (pair.kind !== "written") continue;
      let group = readingGroups.get(pair.reading);
      if (group === undefined) {
        group = new Set();
        readingGroups.set(pair.reading, group);
      }
      group.add(pair.written);
    }
    for (const [reading, spellings] of readingGroups) {
      if (spellings.size < 2) continue;
      const forms = [...spellings].map(written => ({ written, graphemes: splitGraphemes(written) }));
      for (const from of forms) {
        for (const to of forms) {
          const deletionMapping = uniqueDeletionMapping(from.graphemes, to.graphemes);
          const substitutionMapping = deletionMapping === undefined && (kanaSubstitutions || latinSubstitutions) ? uniqueSubstitutionMapping(from.graphemes, to.graphemes, kanaSubstitutions, latinSubstitutions) : undefined;
          const hanSubstitution = deletionMapping === undefined && substitutionMapping === undefined && hanSubstitutions && canSubstituteHan(from.graphemes, to.graphemes);
          const counterSubstitution = deletionMapping === undefined && substitutionMapping === undefined && !hanSubstitution && counterSymbols && canSubstituteCounterSymbol(from.graphemes, to.graphemes);
          if (deletionMapping === undefined && substitutionMapping === undefined && !hanSubstitution && !counterSubstitution) continue;
          const sourceKey = pairKey(from.written, reading);
          let result = sourceAlignments.get(sourceKey);
          if (result === undefined) {
            result = align(from.written, reading);
            sourceAlignments.set(sourceKey, result);
          }
          if (result.status !== "aligned") continue;
          if ((substitutionMapping !== undefined || hanSubstitution || counterSubstitution) && result.evidence?.some(edge =>
            edge.rules?.some(rule => rule === "dictionary-kana-anchors" || rule === "post-kana-gemination"))) continue;
          validateAlignment(from.written, reading, result.segments);
          const segments = deletionMapping !== undefined ? transferSegments(from.graphemes, to.graphemes, reading, deletionMapping, result.segments) :
            hanSubstitution || counterSubstitution ? transferHanSubstitution(to.graphemes, reading, result.segments) :
              transferSubstitutions(from.graphemes, to.graphemes, reading, substitutionMapping, result.segments, boundaryReadings);
          if (segments === undefined) continue;

          const targetKey = pairKey(to.written, reading);
          const signature = JSON.stringify(segments);
          const witness = { id: word.id, from: from.written, to: to.written, reading };
          const candidate = candidates.get(targetKey);
          if (candidate === undefined) {
            candidates.set(targetKey, { written: to.written, reading, segments, signature, witnesses: [witness], conflict: false });
          } else if (candidate.signature !== signature) {
            if (!kanaSubstitutions && !hanSubstitutions && !counterSymbols && !latinSubstitutions) {
              candidate.conflict = true;
              continue;
            }
            const previousBoundaries = new Set(boundaries(candidate.segments));
            const newBoundaries = new Set(boundaries(segments));
            if ([...previousBoundaries].every(boundary => newBoundaries.has(boundary))) {
              candidate.segments = segments;
              candidate.signature = signature;
              candidate.witnesses = [witness];
            } else if (![...newBoundaries].every(boundary => previousBoundaries.has(boundary))) {
              candidate.conflict = true;
            }
          } else if (!candidate.witnesses.some(existing => existing.id === witness.id && existing.from === witness.from)) {
            candidate.witnesses.push(witness);
          }
        }
      }
    }
  }

  const wordAlignments = new Map();
  const transfers = [];
  for (const candidate of candidates.values()) {
    if (candidate.conflict) continue;
    let readings = wordAlignments.get(candidate.written);
    if (readings === undefined) {
      readings = new Map();
      wordAlignments.set(candidate.written, readings);
    }
    readings.set(candidate.reading, candidate.segments);
    transfers.push(...candidate.witnesses);
  }
  return { wordAlignments, transfers };
}
