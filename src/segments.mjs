export function segmentText(segment) {
  return typeof segment === "string" ? segment : segment[0];
}

export function segmentReading(segment) {
  return typeof segment === "string" ? segment : segment[1];
}

export function validateAlignment(written, reading, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(`Missing alignment: ${written}/${reading}`);
  }
  for (const segment of segments) {
    if (typeof segment === "string") {
      if (segment.length === 0) throw new Error("Empty literal segment");
    } else if (!Array.isArray(segment) || segment.length !== 2 ||
      segment.some(value => typeof value !== "string" || value.length === 0)) {
      throw new Error(`Invalid ruby segment: ${JSON.stringify(segment)}`);
    }
  }
  if (segments.map(segmentText).join("") !== written || segments.map(segmentReading).join("") !== reading) {
    throw new Error(`Alignment does not reconstruct ${written}/${reading}: ${JSON.stringify(segments)}`);
  }
}

// Boundaries use Unicode code points, so supplementary-plane kanji occupy one position.
export function boundaries(segments) {
  let writtenOffset = 0;
  let readingOffset = 0;
  return segments.slice(0, -1).map(segment => {
    writtenOffset += [...segmentText(segment)].length;
    readingOffset += [...segmentReading(segment)].length;
    return `${writtenOffset}:${readingOffset}`;
  });
}

// Independent evidence can refine different parts of the same word. Keep both
// sets of boundaries only when their union still forms a strictly ordered path.
export function combineAlignments(previous, candidate) {
  const written = previous.map(segmentText).join("");
  const reading = previous.map(segmentReading).join("");
  validateAlignment(written, reading, candidate);
  const priorPoints = new Set(boundaries(previous));
  const candidatePoints = new Set(boundaries(candidate));
  if ([...candidatePoints].every(point => priorPoints.has(point))) return previous;
  if ([...priorPoints].every(point => candidatePoints.has(point))) return candidate;
  const writtenUnits = [...written], readingUnits = [...reading];
  const points = [...new Set([...priorPoints, ...candidatePoints])].map(point => point.split(":").map(Number));
  points.push([0, 0], [writtenUnits.length, readingUnits.length]);
  points.sort(([leftX, leftY], [rightX, rightY]) => leftX - rightX || leftY - rightY);
  const segments = [];
  for (let index = 1; index < points.length; ++index) {
    const [startX, startY] = points[index - 1];
    const [endX, endY] = points[index];
    if (endX <= startX || endY <= startY) return previous;
    const text = writtenUnits.slice(startX, endX).join("");
    const sound = readingUnits.slice(startY, endY).join("");
    segments.push(text === sound ? text : [text, sound]);
  }
  return segments;
}

export function pairKey(written, reading) {
  return JSON.stringify([written, reading]);
}

export function recordKey(id, written, reading) {
  return JSON.stringify([String(id), written, reading]);
}
