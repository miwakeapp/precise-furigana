import { boundaries, segmentReading, segmentText } from "./segments.mjs";

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export function normalizeKana(text) {
  return text.normalize("NFD").replace(/[\u30a1-\u30f6\u30fd\u30fe]/gu,
    character => String.fromCodePoint(character.codePointAt(0) - 0x60)).normalize("NFC");
}

// The reference's delimiter escaping changes these characters irreversibly.
export function escapeReferenceText(text) {
  return text.replaceAll(".", "．").replaceAll(";", "；");
}

export function referenceKey(id, written, reading) {
  return JSON.stringify([String(id), escapeReferenceText(written), escapeReferenceText(normalizeKana(reading))]);
}

export function parseReferenceLine(line) {
  if (line.trim() === "" || line.startsWith("#")) return undefined;
  const fields = line.split(";");
  if (fields.length !== 3 || !/^\d+$/u.test(fields[0])) {
    throw new Error("Invalid reference ID or field count");
  }
  const writtenParts = fields[1].split(".");
  const readingParts = fields[2].split(".");
  if (writtenParts.length !== readingParts.length) {
    throw new Error("Reference segment counts differ");
  }
  if (writtenParts.join("") === "" || readingParts.join("") === "") {
    throw new Error("Empty reference spelling or reading");
  }
  return {
    id: fields[0],
    written: writtenParts.join(""),
    reading: readingParts.join(""),
    segments: writtenParts.map((written, index) => [written, readingParts[index]])
  };
}

export function canonicalizeSegments(segments, { reference = false } = {}) {
  const flags = new Set();
  let comparable = true;
  const pairs = segments.map(segment => {
    const written = segmentText(segment);
    const reading = segmentReading(segment);
    if (normalizeKana(reading) !== reading) flags.add("kana-script");
    if (escapeReferenceText(written) !== written || escapeReferenceText(reading) !== reading) {
      flags.add("escaped-punctuation");
    }
    return [escapeReferenceText(written), escapeReferenceText(normalizeKana(reading))];
  });
  if (reference) {
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index];
      if (pair[0] !== "") continue;
      const previous = pairs[index - 1];
      const next = pairs[index + 1];
      if (pair[1] === "っ" && previous?.[0] && next?.[0] && /[\p{Script=Han}々〆]/u.test(next[0])) {
        if (normalizeKana(previous[0]) === previous[1]) {
          next[1] = pair[1] + next[1];
          flags.add("sokuon-to-following-kanji");
        } else {
          previous[1] += pair[1];
          flags.add("sokuon-to-preceding-kanji");
        }
        pairs.splice(index, 1);
        index--;
      } else {
        // A reading attached to no written character has no unique ruby boundary.
        comparable = false;
        flags.add("ambiguous-empty-base");
      }
    }
  }
  const canonical = [];
  for (const [written, reading] of pairs) {
    const literal = normalizeKana(written) === reading;
    const previous = canonical.at(-1);
    if (literal && previous && normalizeKana(previous[0]) === previous[1]) {
      previous[0] += written;
      previous[1] += reading;
    } else {
      canonical.push([written, reading]);
    }
  }
  return { segments: canonical, comparable, flags: [...flags].sort() };
}

function comparisonBoundaries(segments) {
  // A literal run has an implicit boundary at every grapheme; absorbing part of
  // that run into ruby removes precision even when the remaining literal merges.
  const expanded = segments.flatMap(segment => {
    const written = segmentText(segment);
    const reading = segmentReading(segment);
    if (normalizeKana(written) !== normalizeKana(reading)) return [segment];
    return [...graphemeSegmenter.segment(written)].map(part => [part.segment, normalizeKana(part.segment)]);
  });
  return boundaries(expanded);
}

export function classifyBoundaries(actualSegments, referenceSegments) {
  const actual = new Set(comparisonBoundaries(actualSegments));
  const reference = new Set(comparisonBoundaries(referenceSegments));
  const actualContainsReference = [...reference].every(boundary => actual.has(boundary));
  const referenceContainsActual = [...actual].every(boundary => reference.has(boundary));
  if (actualContainsReference && referenceContainsActual) return "exact";
  if (actualContainsReference) return "finer";
  if (referenceContainsActual) return "coarser";
  return "incompatible";
}

export function compareReferenceRecord(record, references) {
  const actual = canonicalizeSegments(record.segments);
  const candidates = references.map(reference => canonicalizeSegments(reference.segments, { reference: true }));
  const flags = [...new Set([...actual.flags, ...candidates.flatMap(candidate => candidate.flags)])].sort();
  if (references.some(reference => /[．；]/u.test(reference.written + reference.reading))) {
    flags.push("reference-punctuation-escape-uncertain");
    flags.sort();
  }
  if (!candidates.every(candidate => candidate.comparable)) {
    return { category: "uncomparable", reason: "ambiguous-reference-segment", flags };
  }
  const signatures = new Set(candidates.map(candidate => JSON.stringify(comparisonBoundaries(candidate.segments))));
  if (signatures.size !== 1) {
    return { category: "uncomparable", reason: "multiple-reference-alignments", flags };
  }
  return {
    category: classifyBoundaries(actual.segments, candidates[0].segments),
    flags
  };
}
