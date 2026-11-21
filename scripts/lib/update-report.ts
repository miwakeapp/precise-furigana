// Pure helpers for `scripts/update.ts`: what a dictionary update changed, whether it
// needs a person, and the pull request text that says so.
import type { SynthesizedPair } from "../../src/pairings.ts";
import type { Change, ChangedRecord, SegmentationChange } from "./compare.ts";
import { japanese, proseWithJapanese, ruby } from "./markup.ts";
import { kanjiSharingFurigana } from "./release-notes.ts";

export type ChangeCounts = Record<Change["change"], number>;
export type ListedChanges = Record<SegmentationChange["change"], SegmentationChange[]>;

export interface ChangeSummary {
  counts: ChangeCounts;
  listed: ListedChanges;
  /** The records only the new database has, and those only the old one had. */
  added: ChangedRecord[];
  removed: ChangedRecord[];
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
/** The most characters one folded list may take of the 65,536 a description can hold. */
const foldedLimit = 20_000;
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

/** Count the changes `scripts/compare.ts` wrote, and keep the ones to list. */
export function summarizeChanges(changes: Change[]): ChangeSummary {
  const counts: ChangeCounts = {
    added: 0,
    removed: 0,
    finer: 0,
    coarser: 0,
    incompatible: 0,
    ruby: 0,
  };
  const listed: ListedChanges = { finer: [], coarser: [], incompatible: [], ruby: [] };
  const grouped: ChangedRecord[] = [];
  const added: ChangedRecord[] = [],
    removed: ChangedRecord[] = [];
  for (const item of changes) {
    ++counts[item.change];
    if (item.change === "added") added.push(item.after);
    else if (item.change === "removed") removed.push(item.before);
    // Added and removed records are only counted; the segmentation changes are listed too.
    if (item.change !== "added" && item.change !== "removed") listed[item.change].push(item);
    // A mispaired record's ruby says nothing about its spelling, so it is no candidate.
    if (
      item.change === "added" &&
      item.after.pairing !== "mispaired" &&
      kanjiSharingFurigana(item.after) > 0
    )
      grouped.push(item.after);
  }
  return { counts, listed, grouped, added, removed };
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

function changeList(title: string, items: SegmentationChange[]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map(
      ({ before, after }) =>
        `- ${japanese(after.spelling)} (${japanese(after.reading)}, entry ${after.id}): ${ruby(before.segments)} → ${ruby(after.segments)}`,
    );
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return [`### ${title} (${items.length})`, "", ...rows, ""];
}

/**
 * Every record of one kind, folded away so that the description stays readable. GitHub limits a
 * description's length, so a very long list is cut off with a count of the rest.
 */
function foldedList(title: string, items: ChangedRecord[]): string[] {
  if (items.length === 0) return [];
  const rows: string[] = [];
  let length = 0;
  for (const item of items) {
    const row = `- ${ruby(item.segments)} (entry ${item.id})`;
    if (length + row.length > foldedLimit) break;
    rows.push(row);
    length += row.length + 1;
  }
  if (rows.length < items.length) rows.push(`- …and ${items.length - rows.length} more.`);
  return [
    "<details>",
    `<summary>${title} (${items.length})</summary>`,
    "",
    ...rows,
    "",
    "</details>",
    "",
  ];
}

function groupedList(items: ChangedRecord[]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map(
      (item) =>
        `- ${japanese(item.spelling)} (${japanese(item.reading)}, entry ${item.id}): ${ruby(item.segments)}`,
    );
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return [`### New records with kanji sharing furigana (${items.length})`, "", ...rows, ""];
}

function synthesizedList(title: string, items: SynthesizedPair[]): string[] {
  if (items.length === 0) return [];
  const rows = items
    .slice(0, listLimit)
    .map(
      (item) =>
        `- ${japanese(item.spelling)} read ${japanese(item.reading)} (entry ${item.id})${item.unreviewed ? ", unreviewed" : ""}${item.note ? `. ${proseWithJapanese(item.note)}` : ""}`,
    );
  if (items.length > listLimit) rows.push(`- …and ${items.length - listLimit} more.`);
  return [`### ${title} (${items.length})`, "", ...rows, ""];
}

/** The pull request description for an update. */
export function renderReport(update: Update): string {
  const {
    before,
    after,
    counts,
    listed,
    grouped,
    added: addedRecords,
    removed: removedRecords,
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
  if (reasons.length === 0) {
    lines.push("**Clean.** Nothing here needs review, so this merges once CI passes.", "");
  } else {
    lines.push("**Needs review:**", "", ...reasons.map((reason) => `- ${reason}`), "");
  }
  if (reviewNotes) lines.push("## Review notes", "", reviewNotes.trim(), "");
  if (compared) {
    lines.push(
      "## Segmentation changes",
      "",
      "| Change | Records |",
      "| --- | --- |",
      `| Added | ${counts.added} |`,
      `| Removed | ${counts.removed} |`,
      `| Finer | ${counts.finer} |`,
      `| Coarser | ${counts.coarser} |`,
      `| Incompatible | ${counts.incompatible} |`,
      `| Ruby only | ${counts.ruby} |`,
      "",
      ...changeList("Incompatible", listed.incompatible),
      ...changeList("Coarser", listed.coarser),
      ...changeList("Finer", listed.finer),
      ...changeList("Ruby only", listed.ruby),
      ...groupedList(grouped),
      ...foldedList("Added records", addedRecords),
      ...foldedList("Removed records", removedRecords),
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
