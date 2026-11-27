// Pure helpers for `scripts/update.ts`: what a dictionary update changed, whether it
// needs a person, and the pull request text that says so.
import type { SynthesizedPair } from "../../src/pairings.ts";
import {
  addedAndRemovedSection,
  changedRecordsSection,
  entryLink,
  section,
} from "./change-lists.ts";
import type { ChangeSummary } from "./change-lists.ts";
import type { ChangedRecord } from "./compare.ts";
import { japanese, proseWithJapanese, ruby } from "./markup.ts";

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
    grouped,
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
    // A change between synthesized and unmarked is the synthesized pairs' own section's to report.
    const listed = pairingChanges.filter(({ before: was, after: is }) =>
      [was.pairing, is.pairing].some(
        (pairing) => pairing !== undefined && pairing !== "synthesized",
      ),
    );
    lines.push(
      ...changedRecordsSection(update, listed, { limit: listLimit, open: true }),
      ...addedAndRemovedSection(update, groupedList(grouped), foldedLimit),
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
