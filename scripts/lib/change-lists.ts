// What changed between two databases, arranged for a reader: the lists that an update's pull
// request description and a release's notes share.
import type { Segment } from "../../src/types.ts";
import type { Change, ChangedRecord, PairingChange, SegmentationChange } from "./compare.ts";
import { ruby } from "./markup.ts";

export type ChangeCounts = Record<Change["change"], number>;
export type ListedChanges = Record<SegmentationChange["change"], SegmentationChange[]>;

/** One entry, with the records it gained or lost. */
export interface EntryRecords {
  id: string;
  records: ChangedRecord[];
}

export interface ChangeSummary {
  counts: ChangeCounts;
  listed: ListedChanges;
  /** Entries the new database adds, and existing entries that gained records. */
  newEntries: EntryRecords[];
  grownEntries: EntryRecords[];
  /** Entries the new database drops, and remaining entries that lost records. */
  removedEntries: EntryRecords[];
  shrunkEntries: EntryRecords[];
  /** Existing records whose `pairing` changed, whether or not their division did. */
  pairingChanges: (SegmentationChange | PairingChange)[];
  /**
   * New records whose kanji share furigana. The generator found nothing that divides them, so
   * each is a word to look up: a split may be documented, and a reviewed fact can then record it.
   */
  grouped: ChangedRecord[];
}

const pairings = ["mispaired", "phonetic", "synthesized"] as const;
export const entryLink = (id: string) =>
  `[${id}](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=${id})`;
const isKanji = (character: string) => /\p{Script=Han}/u.test(character);

/** How many of a record's kanji sit under furigana that also covers another kanji. */
export function kanjiSharingFurigana(record: { segments: Segment[] }): number {
  let sharing = 0;
  for (const segment of record.segments) {
    if (typeof segment === "string") continue;
    const kanji = Array.from(segment[0]).filter(isKanji).length;
    if (kanji > 1) sharing += kanji;
  }
  return sharing;
}

/** Count the changes `scripts/compare.ts` wrote, and arrange the ones to list. */
export function summarizeChanges(changes: Change[]): ChangeSummary {
  const counts: ChangeCounts = {
    added: 0,
    removed: 0,
    finer: 0,
    coarser: 0,
    incompatible: 0,
    ruby: 0,
    pairing: 0,
  };
  const listed: ListedChanges = { finer: [], coarser: [], incompatible: [], ruby: [] };
  const grouped: ChangedRecord[] = [];
  const pairingChanges: ChangeSummary["pairingChanges"] = [];
  const entries = {
    newEntries: new Map<string, ChangedRecord[]>(),
    grownEntries: new Map<string, ChangedRecord[]>(),
    removedEntries: new Map<string, ChangedRecord[]>(),
    shrunkEntries: new Map<string, ChangedRecord[]>(),
  };
  const collect = (group: keyof typeof entries, record: ChangedRecord) => {
    const records = entries[group].get(record.id);
    if (records) records.push(record);
    else entries[group].set(record.id, [record]);
  };
  for (const item of changes) {
    ++counts[item.change];
    if (item.change === "added") {
      collect(item.newEntry ? "newEntries" : "grownEntries", item.after);
      // A mispaired record's ruby says nothing about its spelling, so it is no candidate.
      if (item.after.pairing !== "mispaired" && kanjiSharingFurigana(item.after) > 0)
        grouped.push(item.after);
    } else if (item.change === "removed") {
      collect(item.removedEntry ? "removedEntries" : "shrunkEntries", item.before);
    } else {
      if (item.change !== "pairing") listed[item.change].push(item);
      if (item.before.pairing !== item.after.pairing) pairingChanges.push(item);
    }
  }
  const grouping = (group: keyof typeof entries): EntryRecords[] =>
    Array.from(entries[group], ([id, records]) => ({ id, records }));
  return {
    counts,
    listed,
    newEntries: grouping("newEntries"),
    grownEntries: grouping("grownEntries"),
    removedEntries: grouping("removedEntries"),
    shrunkEntries: grouping("shrunkEntries"),
    pairingChanges,
    grouped,
  };
}

/**
 * A list under a third-level heading, which the reader can fold away. The heading sits in the
 * fold's summary, so the section still counts in the page's outline. `open` shows it unfolded.
 */
export function section(title: string, rows: string[], open: boolean): string[] {
  return [
    open ? "<details open>" : "<details>",
    `<summary><h3>${title}</h3></summary>`,
    "",
    ...rows,
    "",
    "</details>",
    "",
  ];
}

/** Group changes by entry, keeping the order in which entries first appear. */
function byEntry<Item extends { after: ChangedRecord }>(items: Item[]): [string, Item[]][] {
  const entries = new Map<string, Item[]>();
  for (const item of items) {
    const group = entries.get(item.after.id);
    if (group) group.push(item);
    else entries.set(item.after.id, [item]);
  }
  return [...entries];
}

/** The rows for at most `limit` entries, and a count of the entries left out. */
function limited(rows: string[], limit: number): string[] {
  return rows.length > limit
    ? [...rows.slice(0, limit), `- …and ${rows.length - limit} more entries.`]
    : rows;
}

/** Records whose division changed, one line per entry. */
function changeList(
  title: string,
  items: SegmentationChange[],
  limit: number,
  open: boolean,
): string[] {
  if (items.length === 0) return [];
  const rows = byEntry(items).map(
    ([id, changes]) =>
      `- ${entryLink(id)}: ${changes.map(({ before, after }) => `${ruby(before.segments)} → ${ruby(after.segments)}`).join("; ")}`,
  );
  return section(`${title} (${items.length})`, limited(rows, limit), open);
}

/** Records whose pairing changed, one line per entry, with those that changed alike together. */
function pairingList(
  items: ChangeSummary["pairingChanges"],
  limit: number,
  open: boolean,
): string[] {
  if (items.length === 0) return [];
  const rows = byEntry(items).map(([id, changes]) => {
    const alike = Map.groupBy(
      changes,
      ({ before, after }) => `${before.pairing ?? "unmarked"} → ${after.pairing ?? "unmarked"}`,
    );
    const clauses = Array.from(
      alike,
      ([change, group]) =>
        `${group.map(({ after }) => ruby(after.segments)).join(", ")}: ${change}`,
    );
    return `- ${entryLink(id)}: ${clauses.join("; ")}`;
  });
  return section(`Pairing changed (${items.length})`, limited(rows, limit), open);
}

/** One entry's records on one line: the unmarked ones first, then each marked kind by name. */
export function entryLine({ id, records }: EntryRecords): string {
  const list = (items: ChangedRecord[]) => items.map((item) => ruby(item.segments)).join(", ");
  const parts = [list(records.filter((record) => record.pairing === undefined))];
  for (const pairing of pairings) {
    const marked = records.filter((record) => record.pairing === pairing);
    if (marked.length > 0) parts.push(`${pairing}: ${list(marked)}`);
  }
  return `- ${entryLink(id)}: ${parts.filter((part) => part !== "").join("; ")}`;
}

/**
 * Entries of one kind, one line each, folded away so that the description stays readable.
 * GitHub limits a description's length, so the folded lists share a budget, and a list that
 * would overrun it is cut off with a count of the rest.
 */
function foldedEntries(title: string, entries: EntryRecords[], budget: { left: number }): string[] {
  if (entries.length === 0) return [];
  const rows: string[] = [];
  for (const entry of entries) {
    const row = entryLine(entry);
    if (row.length > budget.left) break;
    rows.push(row);
    budget.left -= row.length + 1;
  }
  if (rows.length < entries.length) {
    rows.push(`- …and ${entries.length - rows.length} more.`);
    // A later list must not use what an earlier one could not.
    budget.left = 0;
  }
  // These lists are long and rarely need reading, so they start folded.
  return section(`${title} (${entries.length})`, rows, false);
}

/**
 * The section on records that both databases have and that differ: its counts, and a list for
 * each kind of change, one line per entry. `pairingChanges` are the ones to list, which a caller
 * may have narrowed. `limit` is the most entries any one list shows, and `open` whether the
 * lists start unfolded.
 */
export function changedRecordsSection(
  { counts, listed }: ChangeSummary,
  pairingChanges: ChangeSummary["pairingChanges"],
  { limit, open }: { limit: number; open: boolean },
): string[] {
  return [
    "## Changed records",
    "",
    "| Change | Records |",
    "| --- | ---: |",
    `| Finer | ${counts.finer} |`,
    `| Coarser | ${counts.coarser} |`,
    `| Incompatible | ${counts.incompatible} |`,
    `| Ruby only | ${counts.ruby} |`,
    `| Pairing changed | ${pairingChanges.length} |`,
    "",
    ...changeList("Incompatible", listed.incompatible, limit, open),
    ...changeList("Coarser", listed.coarser, limit, open),
    ...changeList("Finer", listed.finer, limit, open),
    ...changeList("Ruby only", listed.ruby, limit, open),
    ...pairingList(pairingChanges, limit, open),
  ];
}

/**
 * The section on records that only one database has: its counts, then `extra` lists of the
 * caller's own, then the four folded lists of entries, which together take at most `budget`
 * characters.
 */
export function addedAndRemovedSection(
  { newEntries, grownEntries, removedEntries, shrunkEntries }: ChangeSummary,
  extra: string[],
  budget: number,
): string[] {
  const records = (entries: EntryRecords[]) =>
    entries.reduce((sum, entry) => sum + entry.records.length, 0);
  const left = { left: budget };
  return [
    "## Added and removed records",
    "",
    "| | Entries | Records |",
    "| --- | ---: | ---: |",
    `| Added | ${newEntries.length} | ${records(newEntries) + records(grownEntries)} |`,
    `| Removed | ${removedEntries.length} | ${records(removedEntries) + records(shrunkEntries)} |`,
    "",
    ...extra,
    ...foldedEntries("New entries", newEntries, left),
    ...foldedEntries("Entries with new records", grownEntries, left),
    ...foldedEntries("Removed entries", removedEntries, left),
    ...foldedEntries("Entries with removed records", shrunkEntries, left),
  ];
}
