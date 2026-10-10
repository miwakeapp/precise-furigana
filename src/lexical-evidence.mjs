import { isIdeograph, isKana, normalizeKana, splitGraphemes } from "./kana.mjs";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";

export function compileLexicalEvidence(facts) {
  if (!Array.isArray(facts)) throw new TypeError("Lexical evidence must be an array");
  const seen = new Set();
  return facts.map(fact => {
    if (typeof fact.reason !== "string" || !fact.reason.trim() || !Array.isArray(fact.sources) || fact.sources.length === 0 ||
      fact.sources.some(source => typeof source.url !== "string" || !/^https:\/\//u.test(source.url))) {
      throw new Error("Lexical evidence requires a rationale and source URLs");
    }
    validateAlignment(fact.written, fact.reading, fact.segments);
    if (fact.reusableSegments !== undefined) {
      if (!Array.isArray(fact.reusableSegments) || new Set(fact.reusableSegments).size !== fact.reusableSegments.length ||
        fact.reusableSegments.length > 0 && (typeof fact.id !== "string" || !fact.id.trim()) ||
        fact.reusableSegments.some(index => {
          if (!Number.isInteger(index) || index < 0 || index >= fact.segments.length) return true;
          const segment = fact.segments[index], written = segmentText(segment), reading = normalizeKana(segmentReading(segment));
          return !Array.isArray(segment) || splitGraphemes(written).length !== 1 || !isIdeograph(written) || written === "々" ||
            !isKana(reading) || /^[ぁぃぅぇぉゃゅょゎっんー]/u.test(reading);
        })) throw new TypeError("reusableSegments requires unique single-ideograph kana allocations with safe onsets and a fact ID");
    }
    const key = pairKey(fact.written, normalizeKana(fact.reading));
    if (seen.has(key)) throw new Error(`Duplicate lexical evidence: ${key}`);
    seen.add(key);
    let writtenOffset = 0, readingOffset = 0;
    const points = [[0, 0]];
    for (const segment of fact.segments) {
      writtenOffset += splitGraphemes(segmentText(segment)).length;
      readingOffset += normalizeKana(segmentReading(segment)).length;
      points.push([writtenOffset, readingOffset]);
    }
    return { ...fact, writtenUnits: splitGraphemes(fact.written), normalizedReading: normalizeKana(fact.reading), points };
  });
}

function occurrences(haystack, needle) {
  const result = [];
  for (let index = 0; index + needle.length <= haystack.length; ++index) {
    if (needle.every((unit, offset) => haystack[index + offset] === unit)) result.push(index);
  }
  return result;
}

function contradictsPoint([x, y], [otherX, otherY]) {
  if (x === otherX) return y !== otherY;
  return x < otherX ? y >= otherY : y <= otherY;
}

function hasContradictedEndpoint(proposal, context) {
  const start = proposal.points[0], end = proposal.points.at(-1);
  const contextStart = context.points[0], contextEnd = context.points.at(-1);
  // Only a strictly larger reviewed written context can disprove a shorter
  // occurrence. Its accepted internal cuts constrain where that unit ends;
  // a grouped portion does not itself prohibit finer supported cuts.
  if (contextStart[0] > start[0] || contextEnd[0] < end[0] ||
    contextStart[0] === start[0] && contextEnd[0] === end[0] ||
    contextStart[1] > start[1] || contextEnd[1] < end[1]) return false;
  return context.points.slice(1, -1).some(point => contradictsPoint(start, point) || contradictsPoint(end, point));
}

/** Named lexical facts refine opaque groups without creating character readings. */
export function refineWithLexicalEvidence(original, facts) {
  if (!original.segments.some(segment => Array.isArray(segment) && splitGraphemes(segment[0]).length > 1)) return original;
  const written = original.segments.map(segmentText).join(""), reading = original.segments.map(segmentReading).join("");
  const writtenUnits = splitGraphemes(written), readingUnits = splitGraphemes(reading);
  const originalPoints = [[0, 0]];
  for (const segment of original.segments) {
    const [x, y] = originalPoints.at(-1);
    originalPoints.push([x + splitGraphemes(segmentText(segment)).length, y + splitGraphemes(segmentReading(segment)).length]);
  }
  const readingOffsets = new Map([[0, 0]]);
  let normalizedReading = "";
  for (const [offset, unit] of readingUnits.entries()) {
    normalizedReading += normalizeKana(unit);
    readingOffsets.set(normalizedReading.length, offset + 1);
  }
  const placementsByFact = [];
  for (const fact of facts) {
    for (const writtenStart of occurrences(writtenUnits, fact.writtenUnits)) {
      const placements = [];
      const writtenEnd = writtenStart + fact.writtenUnits.length;
      for (const readingStart of readingOffsets.keys()) {
        if (!normalizedReading.startsWith(fact.normalizedReading, readingStart)) continue;
        const readingEnd = readingStart + fact.normalizedReading.length;
        if (!readingOffsets.has(readingEnd) || (writtenStart === 0) !== (readingStart === 0) ||
          (writtenEnd === writtenUnits.length) !== (readingEnd === normalizedReading.length)) continue;
        // A word occurrence cannot end inside the following kana mora or
        // claim the onset of an unrepresented nasal/long-vowel suffix.
        const anchoredEnd = originalPoints.some(([x, y]) => x === writtenEnd && y === readingOffsets.get(readingEnd));
        if (!anchoredEnd && writtenEnd < writtenUnits.length && /^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizedReading.slice(readingEnd))) continue;
        const points = fact.points.map(([x, y]) => [writtenStart + x, readingOffsets.get(readingStart + y)]);
        if (points.every(point => point[1] !== undefined && originalPoints.every(originalPoint => !contradictsPoint(point, originalPoint)))) placements.push(points);
      }
      if (placements.length === 1) placementsByFact.push({ fact, points: placements[0] });
    }
  }
  const proposals = [];
  // A rejected occurrence cannot disprove a smaller occurrence in turn.
  // Equal-size contexts cannot dominate one another; their conflicts remain
  // subject to the complete-placement consistency check below.
  for (const proposal of placementsByFact.sort((left, right) => right.fact.writtenUnits.length - left.fact.writtenUnits.length)) {
    if (!proposals.some(context => hasContradictedEndpoint(proposal, context))) proposals.push(proposal);
  }
  const allPoints = [...new Set([...originalPoints, ...proposals.flatMap(proposal => proposal.points)].map(point => point.join(":")))]
    .map(point => point.split(":").map(Number)).sort(([x, y], [otherX, otherY]) => x - otherX || y - otherY);
  const compatible = allPoints.every(([x, y], pointIndex) => pointIndex === 0 || x > allPoints[pointIndex - 1][0] && y > allPoints[pointIndex - 1][1]);
  // Check whole placements for consistency, but emit only internal cuts.
  // A unit's outer edge could assign an unwritten particle to its neighbor.
  const points = [...new Set([...originalPoints, ...proposals.flatMap(proposal => proposal.points.slice(1, -1))].map(point => point.join(":")))]
    .map(point => point.split(":").map(Number)).sort(([x, y], [otherX, otherY]) => x - otherX || y - otherY);
  if (!compatible || points.length <= originalPoints.length) return original;
  const segments = [], evidence = [];
  for (const [index, segment] of original.segments.entries()) {
    const [startX] = originalPoints[index], [endX] = originalPoints[index + 1];
    const localPoints = points.filter(([x]) => startX <= x && x <= endX);
    if (typeof segment === "string" || localPoints.length <= 2) {
      segments.push(segment);
      evidence.push(original.evidence?.[index] ?? { written: segmentText(segment), reading: segmentReading(segment), type: typeof segment === "string" ? "literal" : "dictionary", rules: [] });
      continue;
    }
    for (let pointIndex = 1; pointIndex < localPoints.length; ++pointIndex) {
      const [startX, startY] = localPoints[pointIndex - 1], [endX, endY] = localPoints[pointIndex];
      const text = writtenUnits.slice(startX, endX).join(""), sound = readingUnits.slice(startY, endY).join("");
      segments.push(text === sound ? text : [text, sound]);
      evidence.push({ written: text, reading: sound, type: "dictionary", rules: ["reviewed-lexical-unit"], facts: proposals.map(proposal => proposal.fact.id) });
    }
  }
  if (segments.length === original.segments.length) return original;
  validateAlignment(written, reading, segments);
  return { ...original, segments, evidence };
}

/** Reject cuts contradicted by a uniquely placed reviewed fact, including its outer edges. */
export function makeLexicalContextChecker(reviewedFacts) {
  if (!Array.isArray(reviewedFacts) || reviewedFacts.some(fact => !Array.isArray(fact.writtenUnits) || !Array.isArray(fact.points) || typeof fact.normalizedReading !== "string")) {
    throw new TypeError("reviewedFacts must contain compiled lexical evidence");
  }
  const byFirst = new Map();
  for (const fact of reviewedFacts) { const facts = byFirst.get(fact.writtenUnits[0]) ?? []; facts.push(fact); byFirst.set(fact.writtenUnits[0], facts); }
  return (target, proposed) => {
    const written = splitGraphemes(target.written), reading = splitGraphemes(target.reading), offsets = [0];
    let normalized = "";
    for (const unit of reading) { normalized += normalizeKana(unit); offsets.push(normalized.length); }
    const byOffset = new Map(offsets.map((offset, index) => [offset, index]));
    const points = segments => {
      const result = [[0, 0]];
      let x = 0, y = 0;
      for (const segment of segments) {
        x += splitGraphemes(segmentText(segment)).length;
        y += splitGraphemes(segmentReading(segment)).length;
        result.push([x, y]);
      }
      return result;
    };
    const originalPoints = points(target.segments), proposedPoints = points(proposed);
    const compatible = (left, right) => left.every(([x, y]) => right.every(([otherX, otherY]) => x === otherX ? y === otherY : x < otherX ? y < otherY : y > otherY));
    const contexts = [];
    for (const fact of new Set(written.flatMap(character => byFirst.get(character) ?? []))) {
      const placements = [];
      for (let startX = 0; startX + fact.writtenUnits.length <= written.length; ++startX) {
        if (!fact.writtenUnits.every((unit, index) => unit === written[startX + index])) continue;
        for (const startY of offsets) {
          if (!normalized.startsWith(fact.normalizedReading, startY)) continue;
          const endX = startX + fact.writtenUnits.length, endY = startY + fact.normalizedReading.length;
          if (!byOffset.has(endY) || (startX === 0) !== (startY === 0) || (endX === written.length) !== (endY === normalized.length)) continue;
          const placed = fact.points.map(([x, y]) => [startX + x, byOffset.get(startY + y)]);
          if (placed.every(([, y]) => y !== undefined) && compatible(placed, originalPoints)) placements.push(placed);
        }
      }
      if (placements.length !== 1) continue;
      contexts.push({ id: fact.id, written: fact.written, reading: fact.reading, points: placements[0], sources: fact.sources });
      if (!compatible(placements[0], proposedPoints)) return { veto: true, contexts };
    }
    return { veto: false, contexts };
  };
}

