import type { Segment } from "./types.ts";

export function segmentText(segment: Segment): string {
  return typeof segment === "string" ? segment : segment[0];
}

export function segmentReading(segment: Segment): string {
  return typeof segment === "string" ? segment : segment[1];
}

export function validateAlignment(spelling: string, reading: string, segments: Segment[]): void {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(`Missing alignment: ${spelling}/${reading}`);
  }
  for (const segment of segments) {
    if (typeof segment === "string") {
      if (segment.length === 0) throw new Error("Empty literal segment");
    } else if (
      !Array.isArray(segment) ||
      segment.length !== 2 ||
      segment.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      throw new Error(`Invalid ruby segment: ${JSON.stringify(segment)}`);
    }
  }
  if (
    segments.map(segmentText).join("") !== spelling ||
    segments.map(segmentReading).join("") !== reading
  ) {
    throw new Error(
      `Alignment does not reconstruct ${spelling}/${reading}: ${JSON.stringify(segments)}`,
    );
  }
}

// Boundaries use Unicode code points, so supplementary-plane kanji occupy one position.
export function boundaries(segments: Segment[]): string[] {
  let spellingOffset = 0;
  let readingOffset = 0;
  return segments.slice(0, -1).map((segment) => {
    spellingOffset += [...segmentText(segment)].length;
    readingOffset += [...segmentReading(segment)].length;
    return `${spellingOffset}:${readingOffset}`;
  });
}

// Independent evidence can refine different parts of the same word. Keep both
// sets of boundaries only when their union still forms a strictly ordered path.
export function combineAlignments(previous: Segment[], candidate: Segment[]): Segment[] {
  const spelling = previous.map(segmentText).join("");
  const reading = previous.map(segmentReading).join("");
  validateAlignment(spelling, reading, candidate);
  const priorPoints = new Set(boundaries(previous));
  const candidatePoints = new Set(boundaries(candidate));
  if ([...candidatePoints].every((point) => priorPoints.has(point))) return previous;
  if ([...priorPoints].every((point) => candidatePoints.has(point))) return candidate;
  const spellingUnits = [...spelling],
    readingUnits = [...reading];
  const points = [...new Set([...priorPoints, ...candidatePoints])].map((point) =>
    point.split(":").map(Number),
  );
  points.push([0, 0], [spellingUnits.length, readingUnits.length]);
  points.sort(([leftX, leftY], [rightX, rightY]) => leftX - rightX || leftY - rightY);
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; ++index) {
    const [startX, startY] = points[index - 1];
    const [endX, endY] = points[index];
    if (endX <= startX || endY <= startY) return previous;
    const text = spellingUnits.slice(startX, endX).join("");
    const sound = readingUnits.slice(startY, endY).join("");
    segments.push(text === sound ? text : [text, sound]);
  }
  return segments;
}

export function pairKey(spelling: string, reading: string): string {
  return JSON.stringify([spelling, reading]);
}

export function recordKey(id: string, spelling: string, reading: string): string {
  return JSON.stringify([String(id), spelling, reading]);
}
