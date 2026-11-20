import { isDeepStrictEqual } from "node:util";
import { splitGraphemes } from "../../src/kana.ts";
import { recordKey, segmentText } from "../../src/segments.ts";
import type { Database, DatabaseRecord, Segment } from "../../src/types.ts";

/** A database record with the ID of its entry. */
export interface ChangedRecord extends DatabaseRecord {
  id: string;
}

/**
 * A record present in both databases whose segments differ. "finer" keeps every cut and adds
 * some, "coarser" only removes some, "incompatible" does both, and "ruby" has the same cuts with
 * furigana added to, removed from, or changed on a segment.
 */
export interface SegmentationChange {
  change: "finer" | "coarser" | "incompatible" | "ruby";
  before: ChangedRecord;
  after: ChangedRecord;
}

export type Change =
  | { change: "added"; after: ChangedRecord }
  | { change: "removed"; before: ChangedRecord }
  | SegmentationChange;

// Release segments partition the spelling; plain text can be silent, so only
// spelling positions identify a boundary.
function boundaries(segments: Segment[]): number[] {
  let offset = 0;
  return segments
    .slice(0, -1)
    .map((segment) => (offset += splitGraphemes(segmentText(segment)).length));
}

function records(database: Pick<Database, "entries">): Map<string, ChangedRecord> {
  return new Map(
    Object.entries(database.entries).flatMap(([id, entry]) =>
      entry.map((record): [string, ChangedRecord] => [
        recordKey(id, record.spelling, record.reading),
        { id, ...record },
      ]),
    ),
  );
}

/** List the records that one database has and the other lacks, or that they divide differently. */
export function* compareDatabases(
  before: Pick<Database, "entries">,
  after: Pick<Database, "entries">,
): Generator<Change, void, undefined> {
  const old = records(before);
  for (const [key, record] of records(after)) {
    const previous = old.get(key);
    old.delete(key);
    if (!previous) {
      yield { change: "added", after: record };
    } else if (!isDeepStrictEqual(previous.segments, record.segments)) {
      const oldBoundaries = new Set(boundaries(previous.segments));
      const newBoundaries = new Set(boundaries(record.segments));
      const kept = [...oldBoundaries].every((boundary) => newBoundaries.has(boundary));
      const change =
        kept && oldBoundaries.size === newBoundaries.size
          ? "ruby"
          : kept
            ? "finer"
            : [...newBoundaries].every((boundary) => oldBoundaries.has(boundary))
              ? "coarser"
              : "incompatible";
      yield { change, before: previous, after: record };
    }
  }
  for (const record of old.values()) yield { change: "removed", before: record };
}
