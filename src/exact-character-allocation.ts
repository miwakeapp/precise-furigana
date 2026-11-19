import { isKana, normalizeKana, readingStem, splitGraphemes } from "./kana.ts";
import { validateAlignment } from "./segments.ts";
import type { ReadingMap, Segment } from "./types.ts";

/** One character of a spelling with the part of the reading it accounts for. */
export interface CharacterAllocation {
  spelling: string;
  reading: string;
  /** Whether the character is kana standing for itself. */
  literal: boolean;
  /** The listed readings, as written in the source, whose sound matched. */
  rawForms: string[];
}

export interface ExactCharacterAlignment {
  segments: Segment[];
  allocations: CharacterAllocation[];
}

export function uniqueExactCharacterAlignment(
  spelling: string,
  reading: string,
  primary: ReadingMap,
): ExactCharacterAlignment | undefined {
  const spellingUnits = splitGraphemes(spelling),
    readingUnits = splitGraphemes(reading);
  const offsets = [0];
  let normalized = "";
  for (const unit of readingUnits) {
    normalized += normalizeKana(unit);
    offsets.push(normalized.length);
  }
  const ends = new Map(offsets.map((offset, index): [number, number] => [offset, index])),
    memo = new Map<string, CharacterAllocation[][]>();
  function visit(index: number, offset: number): CharacterAllocation[][] {
    if (index === spellingUnits.length) return offset === readingUnits.length ? [[]] : [];
    const key = `${index}:${offset}`;
    if (memo.has(key)) return memo.get(key)!;
    const character = spellingUnits[index],
      candidates = new Map<string, Pick<CharacterAllocation, "literal" | "rawForms">>();
    if (isKana(character))
      candidates.set(normalizeKana(character), { literal: true, rawForms: [] });
    for (const value of primary.get(character) ?? []) {
      const sound = readingStem(value);
      if (!sound) continue;
      const claim = candidates.get(sound) ?? { literal: false, rawForms: [] };
      claim.rawForms.push(value);
      candidates.set(sound, claim);
    }
    const solutions: CharacterAllocation[][] = [];
    for (const [sound, claim] of candidates) {
      if (!normalized.startsWith(sound, offsets[offset])) continue;
      const end = ends.get(offsets[offset] + sound.length);
      if (end === undefined || end <= offset) continue;
      for (const suffix of visit(index + 1, end)) {
        solutions.push([
          { spelling: character, reading: readingUnits.slice(offset, end).join(""), ...claim },
          ...suffix,
        ]);
        if (solutions.length === 2) break;
      }
      if (solutions.length === 2) break;
    }
    memo.set(key, solutions);
    return solutions;
  }
  const solutions = visit(0, 0);
  if (solutions.length !== 1) return undefined;
  const parts: CharacterAllocation[] = [];
  for (const allocation of solutions[0]) {
    if (allocation.literal && parts.at(-1)?.literal) {
      parts.at(-1)!.spelling += allocation.spelling;
      parts.at(-1)!.reading += allocation.reading;
    } else parts.push({ ...allocation });
  }
  const segments = parts.map((part): Segment =>
    part.spelling === part.reading ? part.spelling : [part.spelling, part.reading],
  );
  validateAlignment(spelling, reading, segments);
  return { segments, allocations: solutions[0] };
}
