// Pure helpers for `scripts/update.ts`: what a dictionary update changed, whether it
// needs a person, and the pull request text that says so.
import type { SynthesizedPair } from "../../src/pairings.ts";
import type { Change, ChangedRecord, PairingChange, SegmentationChange } from "./compare.ts";
import { japanese, proseWithJapanese, ruby } from "./markup.ts";
import { kanjiSharingFurigana } from "./release-notes.ts";

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
  /**
   * Existing records whose `pairing` changed. A change between synthesized and unmarked is left
   * out, because the synthesized pairs' own section reports it.
   */
  pairingChanges: (SegmentationChange | PairingChange)[];
  /**
   * New records whose kanji share furigana. The generator found nothing that divides them, so
   * each is a word to look up: a split may be documented, and a reviewed fact can then record it.
   */
  grouped: ChangedRecord[];
}

export interface SynthesizedPairChanges {
  removed: SynthesizedPair[];
  added: SynthesizedPair[];
  unreviewed: SynthesizedPair[];
}

/** Whether a build or validation run passed, and the end of what it printed. */
export interface StepResult {
  passed: boolean;
  output: string;
}

/** The jmdict-simplified release a lock pins, and its dictionary date. */
export interface DictionaryPin {
  tag: string;
  url: string;
  date: string;
}

/** Everything a dictionary update's report says. */
export interface Update extends ChangeSummary {
  before: DictionaryPin;
  after: DictionaryPin;
  synthesized: SynthesizedPairChanges;
  /** The names of the data files, other than the lock and the synthesized pairs, that changed. */
  otherDataChanges: string[];
  /** Whether the build wrote a database to compare. */
  compared: boolean;
  build: StepResult;
  validate: StepResult;
  reviewNotes: string;
}

const listLimit = 30;
/** The most characters the folded lists may take together of the 65,536 a description can hold. */
const foldedLimit = 40_000;
const pairings = ["mispaired", "phonetic", "synthesized"] as const;
const entryLink = (id: string) =>
  `[${id}](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=${id})`;
const pairKey = (item: SynthesizedPair) => `${item.id}\t${item.spelling}\t${item.reading}`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Compare the synthesized pairs before and after an update. */
export function diffSynthesizedPairs(
  before: SynthesizedPair[],
  after: SynthesizedPair[],
): SynthesizedPairChanges {
  const old = new Set(before.map(pairKey));
  const current = new Set(after.map(pairKey));
  return {
    removed: before.filter((item) => !current.has(pairKey(item))),
    added: after.filter((item) => !old.has(pairKey(item))),
    unreviewed: after.filter((item) => item.unreviewed),
  };
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
      const was = item.before.pairing,
        is = item.after.pairing;
      const synthesizedOnly = [was, is].every(
        (pairing) => pairing === undefined || pairing === "synthesized",
      );
      if (was !== is && !synthesizedOnly) pairingChanges.push(item);
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
 * The reasons an update needs a person. An update with none is clean: it only moves the
 * dictionary pin and drops synthesized pairs that JMdict now has, it makes no existing
 * segmentation coarser or incompatible, and every new record's kanji have furigana of their own.
 */
export function reviewReasons({
  build,
  validate,
  synthesized,
  otherDataChanges,
  counts,
  grouped,
}: Pick<
  Update,
  "build" | "validate" | "synthesized" | "otherDataChanges" | "counts" | "grouped"
>): string[] {
  const reasons: string[] = [];
  if (!build.passed) reasons.push("The build fails.");
  else if (!validate.passed) reasons.push("Validation fails.");
  if (synthesized.unreviewed.length > 0) {
    reasons.push(
      `${plural(synthesized.unreviewed.length, "synthesized pair")} still ${synthesized.unreviewed.length === 1 ? "needs" : "need"} review.`,
    );
  }
  const reviewed = synthesized.added.filter((item) => !item.unreviewed);
  if (reviewed.length > 0) {
    reasons.push(
      `${plural(reviewed.length, "new synthesized pair")} ${reviewed.length === 1 ? "was" : "were"} reviewed automatically; check ${reviewed.length === 1 ? "it" : "them"}.`,
    );
  }
  if (grouped.length > 0) {
    reasons.push(
      `${plural(grouped.length, "new record")} ${grouped.length === 1 ? "has" : "have"} kanji sharing furigana; check whether a split is documented.`,
    );
  }
  for (const name of otherDataChanges) reasons.push(`\`${name}\` changed.`);
  if (counts.coarser > 0)
    reasons.push(`${plural(counts.coarser, "existing segmentation")} became coarser.`);
  if (counts.incompatible > 0) {
    reasons.push(`${plural(counts.incompatible, "existing segmentation")} changed incompatibly.`);
  }
  return reasons;
}

/**
 * A list under a third-level heading, which the reader can fold away. The heading sits in the
 * fold's summary, so the section still counts in the page's outline. `open` shows it unfolded.
 */
function section(title: string, rows: string[], open: boolean): string[] {
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

function changeList(title: string, items: SegmentationChange[]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map(
      ({ before, after }) =>
        `- ${entryLink(after.id)}: ${ruby(before.segments)} → ${ruby(after.segments)}`,
    );
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return section(`${title} (${items.length})`, rows, true);
}

function pairingList(items: ChangeSummary["pairingChanges"]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map(
      ({ before, after }) =>
        `- ${entryLink(after.id)}: ${ruby(after.segments)}, ${before.pairing ?? "unmarked"} → ${after.pairing ?? "unmarked"}`,
    );
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return section(`Pairing changed (${items.length})`, rows, true);
}

/** One entry's records on one line: the unmarked ones first, then each marked kind by name. */
function entryLine({ id, records }: EntryRecords): string {
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

function groupedList(items: ChangedRecord[]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map((item) => `- ${entryLink(item.id)}: ${ruby(item.segments)}`);
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return section(`New records with kanji sharing furigana (${items.length})`, rows, true);
}

/**
 * Synthesized pairs, one line per entry. Pairs of an entry that share a reading and a note are
 * named together, since a note usually explains every such spelling at once.
 */
function synthesizedList(title: string, items: SynthesizedPair[]): string[] {
  if (items.length === 0) return [];
  const entries = new Map<string, Map<string, SynthesizedPair[]>>();
  for (const item of items) {
    const groups = entries.get(item.id) ?? new Map<string, SynthesizedPair[]>();
    entries.set(item.id, groups);
    const key = JSON.stringify([item.reading, item.note, item.unreviewed === true]);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const rows = Array.from(entries, ([id, groups]) => {
    const clauses = Array.from(groups.values(), (pairs) => {
      const [{ reading, note, unreviewed }] = pairs;
      return `${pairs.map((pair) => japanese(pair.spelling)).join(", ")} read ${japanese(reading)}${unreviewed ? ", unreviewed" : ""}${note ? `. ${proseWithJapanese(note)}` : ""}`;
    });
    // Every clause but the last must end its sentence before the next one starts.
    const sentences = clauses.map((clause, index) =>
      index < clauses.length - 1 && !/[.!?]$/u.test(clause) ? `${clause}.` : clause,
    );
    return `- ${entryLink(id)}: ${sentences.join(" ")}`;
  });
  const shown = rows.slice(0, listLimit);
  if (rows.length > listLimit) shown.push(`- …and ${rows.length - listLimit} more entries.`);
  return section(`${title} (${items.length})`, shown, true);
}

/** The pull request description for an update. */
export function renderReport(update: Update): string {
  const {
    before,
    after,
    counts,
    listed,
    grouped,
    newEntries,
    grownEntries,
    removedEntries,
    shrunkEntries,
    pairingChanges,
    synthesized,
    compared,
    build,
    validate,
    reviewNotes,
  } = update;
  const reasons = reviewReasons(update);
  const lines = [
    `Moves the dictionary pin from JMdict ${before.date} to ${after.date} ([jmdict-simplified ${after.tag}](${after.url})).`,
    "",
  ];
  // The headings follow what a reader asks, in order: does anything need me, did any record I
  // already rely on change, and what came and went.
  if (reasons.length === 0) {
    lines.push("**Clean.** Nothing here needs review, so this merges once CI passes.", "");
    if (reviewNotes) lines.push("## Review notes", "", reviewNotes.trim(), "");
  } else {
    lines.push("## Needs review", "", ...reasons.map((reason) => `- ${reason}`), "");
    if (reviewNotes) lines.push("### Review notes", "", reviewNotes.trim(), "");
  }
  if (compared) {
    const budget = { left: foldedLimit };
    const records = (entries: EntryRecords[]) =>
      entries.reduce((sum, entry) => sum + entry.records.length, 0);
    lines.push(
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
      ...changeList("Incompatible", listed.incompatible),
      ...changeList("Coarser", listed.coarser),
      ...changeList("Finer", listed.finer),
      ...changeList("Ruby only", listed.ruby),
      ...pairingList(pairingChanges),
      "## Added and removed records",
      "",
      "| | Entries | Records |",
      "| --- | ---: | ---: |",
      `| Added | ${newEntries.length} | ${records(newEntries) + records(grownEntries)} |`,
      `| Removed | ${removedEntries.length} | ${records(removedEntries) + records(shrunkEntries)} |`,
      "",
      ...groupedList(grouped),
      ...foldedEntries("New entries", newEntries, budget),
      ...foldedEntries("Entries with new records", grownEntries, budget),
      ...foldedEntries("Removed entries", removedEntries, budget),
      ...foldedEntries("Entries with removed records", shrunkEntries, budget),
    );
  }
  const removed = synthesizedList(
    "Removed because JMdict now has the pair or no longer needs it",
    synthesized.removed,
  );
  const added = synthesizedList("New", synthesized.added);
  if (removed.length + added.length > 0)
    lines.push("## Synthesized pairs", "", ...added, ...removed);
  for (const [title, step] of [
    ["Build output", build],
    ["Validation output", validate],
  ] as const) {
    if (!step.passed && step.output)
      lines.push(`## ${title}`, "", "```text", step.output.trim(), "```", "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** The commit message for an update, which is also the pull request's title and merge message. */
export function renderCommitMessage({
  before,
  after,
  synthesized,
}: Pick<Update, "before" | "after" | "synthesized">): string {
  const body = [`Moves the dictionary pin from jmdict-simplified ${before.tag} to ${after.tag}.`];
  if (synthesized.removed.length > 0) {
    body.push(
      `Removes ${plural(synthesized.removed.length, "synthesized pair")} that JMdict now has or no longer needs.`,
    );
  }
  if (synthesized.added.length > 0)
    body.push(`Adds ${plural(synthesized.added.length, "synthesized pair")}.`);
  return `Update JMdict to ${after.date}\n\n${body.join(" ")}\n`;
}
