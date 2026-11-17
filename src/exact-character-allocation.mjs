import { isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.mjs";
import { validateAlignment } from "./segments.mjs";

export function uniqueExactCharacterAlignment(spelling, reading, primary) {
  const spellingUnits = splitGraphemes(spelling), readingUnits = splitGraphemes(reading);
  const offsets = [0];
  let normalized = "";
  for (const unit of readingUnits) { normalized += normalizeKana(unit); offsets.push(normalized.length); }
  const ends = new Map(offsets.map((offset, index) => [offset, index])), memo = new Map();
  function visit(index, offset) {
    if (index === spellingUnits.length) return offset === readingUnits.length ? [[]] : [];
    const key = `${index}:${offset}`;
    if (memo.has(key)) return memo.get(key);
    const character = spellingUnits[index], candidates = new Map();
    if (isKana(character)) candidates.set(normalizeKana(character), { literal: true, rawForms: [] });
    for (const value of primary.get(character) ?? []) {
      const sound = readingStem(value);
      if (!sound) continue;
      const claim = candidates.get(sound) ?? { literal: false, rawForms: [] };
      claim.rawForms.push(value);
      candidates.set(sound, claim);
    }
    const solutions = [];
    for (const [sound, claim] of candidates) {
      if (!normalized.startsWith(sound, offsets[offset])) continue;
      const end = ends.get(offsets[offset] + sound.length);
      if (end === undefined || end <= offset) continue;
      for (const suffix of visit(index + 1, end)) {
        solutions.push([{ spelling: character, reading: readingUnits.slice(offset, end).join(""), ...claim }, ...suffix]);
        if (solutions.length === 2) break;
      }
      if (solutions.length === 2) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const solutions = visit(0, 0);
  if (solutions.length !== 1) return undefined;
  const parts = [];
  for (const allocation of solutions[0]) {
    if (allocation.literal && parts.at(-1)?.literal) {
      parts.at(-1).spelling += allocation.spelling;
      parts.at(-1).reading += allocation.reading;
    } else parts.push({ ...allocation });
  }
  const segments = parts.map(part => part.spelling === part.reading ? part.spelling : [part.spelling, part.reading]);
  validateAlignment(spelling, reading, segments);
  return { segments, allocations: solutions[0] };
}
