import { isIdeograph, isKana, normalizeKana, splitGraphemes } from "./kana.ts";
import { pairKey, segmentReading, segmentText, validateAlignment } from "./segments.ts";
import type { Alignment, Evidence, Segment } from "./types.ts";

/** Where a reviewed fact can be checked. */
export interface LexicalSource {
  url: string;
  name?: string;
}

/** A reviewed division of one named spelling and reading, as `data/lexical-evidence.json` lists them. */
export interface LexicalFact {
  id?: string;
  spelling: string;
  reading: string;
  segments: Segment[];
  reason: string;
  sources: LexicalSource[];
  jmdictEntries?: string[];
  /** The indexes of the segments whose character sound other words may reuse. */
  reusableSegments?: number[];
}

/** A boundary, as an offset into the spelling and an offset into the reading. */
export type Point = [x: number, y: number];

/** A fact prepared for matching against other words. */
export interface CompiledLexicalFact extends LexicalFact {
  spellingUnits: string[];
  normalizedReading: string;
  /** The fact's boundaries, counting graphemes of spelling and code units of normalized reading. */
  points: Point[];
}

/** The word whose proposed division a lexical context checker judges. */
export interface LexicalTarget {
  spelling: string;
  reading: string;
  segments: Segment[];
}

/** A reviewed fact placed at its one position in a target word. */
export interface LexicalContext {
  id: string | undefined;
  spelling: string;
  reading: string;
  points: Point[];
  sources: LexicalSource[];
}

export interface LexicalContextCheck {
  veto: boolean;
  contexts: LexicalContext[];
}

export type LexicalContextChecker = (
  target: LexicalTarget,
  proposed: Segment[],
) => LexicalContextCheck;

interface Placement {
  fact: CompiledLexicalFact;
  points: Point[];
}

export function compileLexicalEvidence(facts: LexicalFact[]): CompiledLexicalFact[] {
  if (!Array.isArray(facts)) throw new TypeError("Lexical evidence must be an array");
  const seen = new Set();
  return facts.map((fact) => {
    if (
      typeof fact.reason !== "string" ||
      !fact.reason.trim() ||
      !Array.isArray(fact.sources) ||
      fact.sources.length === 0 ||
      fact.sources.some(
        (source) => typeof source.url !== "string" || !/^https:\/\//u.test(source.url),
      )
    ) {
      throw new Error("Lexical evidence requires a rationale and source URLs");
    }
    validateAlignment(fact.spelling, fact.reading, fact.segments);
    if (
      fact.jmdictEntries !== undefined &&
      (!Array.isArray(fact.jmdictEntries) ||
        fact.jmdictEntries.some((id) => typeof id !== "string" || !/^\d+$/u.test(id)))
    ) {
      throw new TypeError("jmdictEntries must list JMdict entry IDs");
    }
    if (fact.reusableSegments !== undefined) {
      if (
        !Array.isArray(fact.reusableSegments) ||
        new Set(fact.reusableSegments).size !== fact.reusableSegments.length ||
        (fact.reusableSegments.length > 0 && (typeof fact.id !== "string" || !fact.id.trim())) ||
        fact.reusableSegments.some((index) => {
          if (!Number.isInteger(index) || index < 0 || index >= fact.segments.length) return true;
          const segment = fact.segments[index],
            spelling = segmentText(segment),
            reading = normalizeKana(segmentReading(segment));
          return (
            !Array.isArray(segment) ||
            splitGraphemes(spelling).length !== 1 ||
            !isIdeograph(spelling) ||
            spelling === "々" ||
            !isKana(reading) ||
            /^[ぁぃぅぇぉゃゅょゎっんー]/u.test(reading)
          );
        })
      )
        throw new TypeError(
          "reusableSegments requires unique single-ideograph kana allocations with safe onsets and a fact ID",
        );
    }
    const key = pairKey(fact.spelling, normalizeKana(fact.reading));
    if (seen.has(key)) throw new Error(`Duplicate lexical evidence: ${key}`);
    seen.add(key);
    let spellingOffset = 0,
      readingOffset = 0;
    const points: Point[] = [[0, 0]];
    for (const segment of fact.segments) {
      spellingOffset += splitGraphemes(segmentText(segment)).length;
      readingOffset += normalizeKana(segmentReading(segment)).length;
      points.push([spellingOffset, readingOffset]);
    }
    return {
      ...fact,
      spellingUnits: splitGraphemes(fact.spelling),
      normalizedReading: normalizeKana(fact.reading),
      points,
    };
  });
}

function occurrences(haystack: string[], needle: string[]): number[] {
  const result: number[] = [];
  for (let index = 0; index + needle.length <= haystack.length; ++index) {
    if (needle.every((unit, offset) => haystack[index + offset] === unit)) result.push(index);
  }
  return result;
}

function contradictsPoint([x, y]: Point, [otherX, otherY]: Point): boolean {
  if (x === otherX) return y !== otherY;
  return x < otherX ? y >= otherY : y <= otherY;
}

function hasContradictedEndpoint(proposal: Placement, context: Placement): boolean {
  const start = proposal.points[0],
    end = proposal.points.at(-1)!;
  const contextStart = context.points[0],
    contextEnd = context.points.at(-1)!;
  // Only a strictly larger reviewed written context can disprove a shorter
  // occurrence. Its accepted internal cuts constrain where that unit ends;
  // a grouped portion does not itself prohibit finer supported cuts.
  if (
    contextStart[0] > start[0] ||
    contextEnd[0] < end[0] ||
    (contextStart[0] === start[0] && contextEnd[0] === end[0]) ||
    contextStart[1] > start[1] ||
    contextEnd[1] < end[1]
  )
    return false;
  return context.points
    .slice(1, -1)
    .some((point) => contradictsPoint(start, point) || contradictsPoint(end, point));
}

/** Named lexical facts refine opaque groups without creating character readings. */
export function refineWithLexicalEvidence(
  original: Alignment,
  facts: CompiledLexicalFact[],
): Alignment {
  if (
    !original.segments.some(
      (segment) => Array.isArray(segment) && splitGraphemes(segment[0]).length > 1,
    )
  )
    return original;
  const spelling = original.segments.map(segmentText).join(""),
    reading = original.segments.map(segmentReading).join("");
  const spellingUnits = splitGraphemes(spelling),
    readingUnits = splitGraphemes(reading);
  const originalPoints: Point[] = [[0, 0]];
  for (const segment of original.segments) {
    const [x, y] = originalPoints.at(-1)!;
    originalPoints.push([
      x + splitGraphemes(segmentText(segment)).length,
      y + splitGraphemes(segmentReading(segment)).length,
    ]);
  }
  const readingOffsets = new Map([[0, 0]]);
  let normalizedReading = "";
  for (const [offset, unit] of readingUnits.entries()) {
    normalizedReading += normalizeKana(unit);
    readingOffsets.set(normalizedReading.length, offset + 1);
  }
  const placementsByFact: Placement[] = [];
  for (const fact of facts) {
    for (const spellingStart of occurrences(spellingUnits, fact.spellingUnits)) {
      const placements: Point[][] = [];
      const spellingEnd = spellingStart + fact.spellingUnits.length;
      for (const readingStart of readingOffsets.keys()) {
        if (!normalizedReading.startsWith(fact.normalizedReading, readingStart)) continue;
        const readingEnd = readingStart + fact.normalizedReading.length;
        if (
          !readingOffsets.has(readingEnd) ||
          (spellingStart === 0) !== (readingStart === 0) ||
          (spellingEnd === spellingUnits.length) !== (readingEnd === normalizedReading.length)
        )
          continue;
        // A word occurrence cannot end inside the following kana mora or
        // claim the onset of an unrepresented nasal/long-vowel suffix.
        const anchoredEnd = originalPoints.some(
          ([x, y]) => x === spellingEnd && y === readingOffsets.get(readingEnd),
        );
        if (
          !anchoredEnd &&
          spellingEnd < spellingUnits.length &&
          /^[ぁぃぅぇぉゃゅょゎっんー]/u.test(normalizedReading.slice(readingEnd))
        )
          continue;
        const points = fact.points.map(([x, y]): [number, number | undefined] => [
          spellingStart + x,
          readingOffsets.get(readingStart + y),
        ]);
        if (
          points.every(
            (point): point is Point =>
              point[1] !== undefined &&
              originalPoints.every(
                (originalPoint) => !contradictsPoint(point as Point, originalPoint),
              ),
          )
        )
          placements.push(points);
      }
      if (placements.length === 1) placementsByFact.push({ fact, points: placements[0] });
    }
  }
  const proposals: Placement[] = [];
  // A rejected occurrence cannot disprove a smaller occurrence in turn.
  // Equal-size contexts cannot dominate one another; their conflicts remain
  // subject to the complete-placement consistency check below.
  for (const proposal of placementsByFact.sort(
    (left, right) => right.fact.spellingUnits.length - left.fact.spellingUnits.length,
  )) {
    if (!proposals.some((context) => hasContradictedEndpoint(proposal, context)))
      proposals.push(proposal);
  }
  const allPoints = [
    ...new Set(
      [...originalPoints, ...proposals.flatMap((proposal) => proposal.points)].map((point) =>
        point.join(":"),
      ),
    ),
  ]
    .map((point) => point.split(":").map(Number))
    .sort(([x, y], [otherX, otherY]) => x - otherX || y - otherY);
  const compatible = allPoints.every(
    ([x, y], pointIndex) =>
      pointIndex === 0 || (x > allPoints[pointIndex - 1][0] && y > allPoints[pointIndex - 1][1]),
  );
  // Check whole placements for consistency, but emit only internal cuts.
  // A unit's outer edge could assign an unwritten particle to its neighbor.
  const points = [
    ...new Set(
      [...originalPoints, ...proposals.flatMap((proposal) => proposal.points.slice(1, -1))].map(
        (point) => point.join(":"),
      ),
    ),
  ]
    .map((point) => point.split(":").map(Number))
    .sort(([x, y], [otherX, otherY]) => x - otherX || y - otherY);
  if (!compatible || points.length <= originalPoints.length) return original;
  const segments: Segment[] = [],
    evidence: Evidence[] = [];
  for (const [index, segment] of original.segments.entries()) {
    const [startX] = originalPoints[index],
      [endX] = originalPoints[index + 1];
    const localPoints = points.filter(([x]) => startX <= x && x <= endX);
    if (typeof segment === "string" || localPoints.length <= 2) {
      segments.push(segment);
      evidence.push(
        original.evidence?.[index] ?? {
          spelling: segmentText(segment),
          reading: segmentReading(segment),
          type: typeof segment === "string" ? "literal" : "dictionary",
          rules: [],
        },
      );
      continue;
    }
    for (let pointIndex = 1; pointIndex < localPoints.length; ++pointIndex) {
      const [startX, startY] = localPoints[pointIndex - 1],
        [endX, endY] = localPoints[pointIndex];
      const text = spellingUnits.slice(startX, endX).join(""),
        sound = readingUnits.slice(startY, endY).join("");
      segments.push(text === sound ? text : [text, sound]);
      evidence.push({
        spelling: text,
        reading: sound,
        type: "dictionary",
        rules: ["reviewed-lexical-unit"],
        facts: proposals.map((proposal) => proposal.fact.id),
      });
    }
  }
  if (segments.length === original.segments.length) return original;
  validateAlignment(spelling, reading, segments);
  return { ...original, segments, evidence };
}

/** Reject cuts contradicted by a uniquely placed reviewed fact, including its outer edges. */
export function makeLexicalContextChecker(
  reviewedFacts: CompiledLexicalFact[],
): LexicalContextChecker {
  if (
    !Array.isArray(reviewedFacts) ||
    reviewedFacts.some(
      (fact) =>
        !Array.isArray(fact.spellingUnits) ||
        !Array.isArray(fact.points) ||
        typeof fact.normalizedReading !== "string",
    )
  ) {
    throw new TypeError("reviewedFacts must contain compiled lexical evidence");
  }
  const byFirst = new Map<string, CompiledLexicalFact[]>();
  for (const fact of reviewedFacts) {
    const facts = byFirst.get(fact.spellingUnits[0]) ?? [];
    facts.push(fact);
    byFirst.set(fact.spellingUnits[0], facts);
  }
  return (target, proposed) => {
    const spelling = splitGraphemes(target.spelling),
      reading = splitGraphemes(target.reading),
      offsets = [0];
    let normalized = "";
    for (const unit of reading) {
      normalized += normalizeKana(unit);
      offsets.push(normalized.length);
    }
    const byOffset = new Map(offsets.map((offset, index) => [offset, index]));
    const points = (segments: Segment[]) => {
      const result: Point[] = [[0, 0]];
      let x = 0,
        y = 0;
      for (const segment of segments) {
        x += splitGraphemes(segmentText(segment)).length;
        y += splitGraphemes(segmentReading(segment)).length;
        result.push([x, y]);
      }
      return result;
    };
    const originalPoints = points(target.segments),
      proposedPoints = points(proposed);
    const compatible = (left: Point[], right: Point[]) =>
      left.every(([x, y]) =>
        right.every(([otherX, otherY]) =>
          x === otherX ? y === otherY : x < otherX ? y < otherY : y > otherY,
        ),
      );
    const contexts: LexicalContext[] = [];
    for (const fact of new Set(spelling.flatMap((character) => byFirst.get(character) ?? []))) {
      const placements: Point[][] = [];
      for (let startX = 0; startX + fact.spellingUnits.length <= spelling.length; ++startX) {
        if (!fact.spellingUnits.every((unit, index) => unit === spelling[startX + index])) continue;
        for (const startY of offsets) {
          if (!normalized.startsWith(fact.normalizedReading, startY)) continue;
          const endX = startX + fact.spellingUnits.length,
            endY = startY + fact.normalizedReading.length;
          if (
            !byOffset.has(endY) ||
            (startX === 0) !== (startY === 0) ||
            (endX === spelling.length) !== (endY === normalized.length)
          )
            continue;
          const placed = fact.points.map(([x, y]): [number, number | undefined] => [
            startX + x,
            byOffset.get(startY + y),
          ]);
          if (
            placed.every(([, y]) => y !== undefined) &&
            compatible(placed as Point[], originalPoints)
          )
            placements.push(placed as Point[]);
        }
      }
      if (placements.length !== 1) continue;
      contexts.push({
        id: fact.id,
        spelling: fact.spelling,
        reading: fact.reading,
        points: placements[0],
        sources: fact.sources,
      });
      if (!compatible(placements[0], proposedPoints)) return { veto: true, contexts };
    }
    return { veto: false, contexts };
  };
}
