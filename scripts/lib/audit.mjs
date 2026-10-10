import { normalizeKana } from "../../src/reference.mjs";
import { segmentReading, segmentText } from "../../src/segments.mjs";

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const length = text => [...text].length;
const key = point => `${point.x}:${point.y}`;

export function alignmentPoints(segments) {
  const result = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  for (const segment of segments) {
    const written = segmentText(segment);
    const reading = normalizeKana(segmentReading(segment));
    const parts = normalizeKana(written) === reading ?
      [...segmenter.segment(written)].map(part => [part.segment, normalizeKana(part.segment)]) :
      [[written, reading]];
    for (const [text, sound] of parts) {
      x += length(text);
      y += length(sound);
      result.push({ x, y });
    }
  }
  return result;
}

export function locateTarget(packet, baselineSegments) {
  const written = [...packet.context.written];
  const reading = [...normalizeKana(packet.context.reading)];
  const points = alignmentPoints(baselineSegments);
  const pointKeys = new Set(points.map(key));
  const width = length(packet.written), height = length(packet.reading);
  return points.filter(({ x, y }) =>
    written.slice(x, x + width).join("") === packet.written &&
    reading.slice(y, y + height).join("") === packet.reading &&
    pointKeys.has(`${x + width}:${y + height}`));
}

export function scoreTarget(segments, origin, written, accepted) {
  if (!accepted?.length) return { status: "unresolved-label" };
  const width = length(written);
  const actual = new Set(alignmentPoints(segments)
    .filter(point => point.x >= origin.x && point.x <= origin.x + width)
    .map(point => `${point.x - origin.x}:${point.y - origin.y}`));
  const alternatives = accepted.map((alternative, index) => {
    const expected = new Set(alignmentPoints(alternative).map(key));
    const unsupported = [...actual].filter(boundary => !expected.has(boundary));
    const missed = [...expected].filter(boundary => !actual.has(boundary));
    return { alternative: index, unsupported, missed, expected: expected.size, asserted: actual.size };
  });
  // An explicitly accepted alternative must not lose to a preferred typography.
  // Among nonexact alternatives, minimize unsupported assertions first.
  alternatives.sort((left, right) => left.unsupported.length - right.unsupported.length ||
    left.missed.length - right.missed.length || left.alternative - right.alternative);
  const best = alternatives[0];
  return {
    status: best.unsupported.length ? "unsupported" : best.missed.length ? "coarser" : "exact",
    ...best
  };
}

export function compareScores(left, right) {
  const scored = score => ["exact", "coarser", "unsupported"].includes(score?.status);
  if (!scored(left) || !scored(right)) return "unscored";
  const differences = [left.unsupported.length - right.unsupported.length, left.missed.length - right.missed.length];
  if (differences.every(value => value === 0)) return "tied";
  if (differences.every(value => value <= 0)) return "left-dominates";
  if (differences.every(value => value >= 0)) return "right-dominates";
  return "tradeoff";
}
