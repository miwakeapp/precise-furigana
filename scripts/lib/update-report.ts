// Pure helpers for `scripts/update.ts`: what a dictionary update changed, whether it
// needs a person, and the pull request text that says so.
import type { MispairedPair, SynthesizedPair } from "../../src/pairings.ts";
import {
  addedAndRemovedSection,
  changedRecordsSection,
  entryLine,
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

/**
 * A pair that may be mispaired without any kana showing it. "search-only": a search-only form
 * paired with one of several partners, which JMdict cannot restrict. "sibling-reading": an
 * ordinary pair whose reading fits a sibling spelling's kanji and not its own, as a restriction
 * missing from JMdict would leave it.
 */
export interface ReviewCandidate extends ChangedRecord {
  kind: "search-only" | "sibling-reading";
}

export interface MispairedPairChanges {
  removed: MispairedPair[];
  added: MispairedPair[];
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
  mispaired: MispairedPairChanges;
  /**
   * Pairs worth a reviewer's look that are new with this update. They are listed to be looked
   * at, not as a reason to wait.
   */
  candidates: ReviewCandidate[];
  /** The names of the data files, other than the lock and the two lists of pairs, that changed. */
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
const pairKey = (item: Pick<SynthesizedPair, "id" | "spelling" | "reading">) =>
  `${item.id}\t${item.spelling}\t${item.reading}`;
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

/** Compare the reviewed mispaired pairs before and after an update. */
export function diffMispairedPairs(
  before: MispairedPair[],
  after: MispairedPair[],
): MispairedPairChanges {
  const old = new Set(before.map(pairKey));
  const current = new Set(after.map(pairKey));
  return {
    removed: before.filter((item) => !current.has(pairKey(item))),
    added: after.filter((item) => !old.has(pairKey(item))),
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
  mispaired,
  otherDataChanges,
  counts,
  grouped,
}: Pick<
  Update,
  "build" | "validate" | "synthesized" | "mispaired" | "otherDataChanges" | "counts" | "grouped"
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
  // The update itself only drops pairs from this list; an added one came from a review.
  if (mispaired.added.length > 0) {
    reasons.push(
      `${plural(mispaired.added.length, "pair")} ${mispaired.added.length === 1 ? "was" : "were"} newly listed as mispaired; check ${mispaired.added.length === 1 ? "it" : "them"}.`,
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
const candidateTitles: Record<ReviewCandidate["kind"], string> = {
  "search-only": "New pairs of a search-only form with one of several partners",
  "sibling-reading": "New pairs whose reading may belong to a sibling spelling",
};

/** The new candidates of one kind, by entry. */
function candidateList(kind: ReviewCandidate["kind"], candidates: ReviewCandidate[]): string[] {
  const items = candidates.filter((candidate) => candidate.kind === kind);
  if (items.length === 0) return [];
  const entries = new Map<string, ChangedRecord[]>();
  for (const item of items) {
    const records = entries.get(item.id);
    if (records) records.push(item);
    else entries.set(item.id, [item]);
  }
  const rows = Array.from(entries, ([id, records]) => entryLine({ id, records }));
  const shown = rows.slice(0, listLimit);
  if (rows.length > listLimit) shown.push(`- …and ${rows.length - listLimit} more entries.`);
  return section(`${candidateTitles[kind]} (${items.length})`, shown, true);
}

function synthesizedList(title: string, items: (SynthesizedPair | MispairedPair)[]): string[] {
  if (items.length === 0) return [];
  const entries = new Map<string, Map<string, (SynthesizedPair | MispairedPair)[]>>();
  for (const item of items) {
    const groups = entries.get(item.id) ?? new Map<string, (SynthesizedPair | MispairedPair)[]>();
    entries.set(item.id, groups);
    const key = JSON.stringify([
      item.reading,
      item.note,
      "unreviewed" in item && item.unreviewed === true,
    ]);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const rows = Array.from(entries, ([id, groups]) => {
    const clauses = Array.from(groups.values(), (pairs) => {
      const [{ reading, note }] = pairs;
      const unreviewed = "unreviewed" in pairs[0] && pairs[0].unreviewed;
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
    pairingChanges: allPairingChanges,
    synthesized,
    mispaired,
    candidates,
    compared,
    build,
    validate,
    reviewNotes,
  } = update;
  const reasons = reviewReasons(update);
  // A record that the mispaired pairs' own section reports is not listed a second time.
  const listedMispaired = new Set([...mispaired.added, ...mispaired.removed].map(pairKey));
  const pairingChanges = allPairingChanges.filter(
    ({ after }) => !listedMispaired.has(pairKey(after)),
  );
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
      ...addedAndRemovedSection(
        update,
        [
          ...groupedList(grouped),
          ...candidateList("search-only", candidates),
          ...candidateList("sibling-reading", candidates),
        ],
        foldedLimit,
      ),
    );
  }
  const removed = synthesizedList(
    "Removed because JMdict now has the pair or no longer needs it",
    synthesized.removed,
  );
  const added = synthesizedList("New", synthesized.added);
  if (removed.length + added.length > 0)
    lines.push("## Synthesized pairs", "", ...added, ...removed);
  const mispairedLists = [
    ...synthesizedList("New", mispaired.added),
    ...synthesizedList(
      "Removed because JMdict no longer has the pair or a rule now marks it",
      mispaired.removed,
    ),
  ];
  if (mispairedLists.length > 0) {
    lines.push("## Reviewed mispaired pairs", "");
    // A wrong pair between ordinary forms is JMdict's to fix, which fixes it for everyone.
    if (mispaired.added.length > 0) {
      lines.push(
        "Where neither form of a newly listed pair is search-only, JMdict lacks a restriction that it could have. Proposing one there removes the pair at its source, and its entry here then lapses.",
        "",
      );
    }
    lines.push(...mispairedLists);
  }
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
  mispaired,
}: Pick<Update, "before" | "after" | "synthesized" | "mispaired">): string {
  const body = [`Moves the dictionary pin from jmdict-simplified ${before.tag} to ${after.tag}.`];
  if (synthesized.removed.length > 0) {
    body.push(
      `Removes ${plural(synthesized.removed.length, "synthesized pair")} that JMdict now has or no longer needs.`,
    );
  }
  if (synthesized.added.length > 0)
    body.push(`Adds ${plural(synthesized.added.length, "synthesized pair")}.`);
  if (mispaired.removed.length > 0) {
    body.push(
      `Removes ${plural(mispaired.removed.length, "reviewed mispaired pair")} that no longer ${mispaired.removed.length === 1 ? "applies" : "apply"}.`,
    );
  }
  if (mispaired.added.length > 0)
    body.push(`Lists ${plural(mispaired.added.length, "more pair")} as mispaired.`);
  return `Update JMdict to ${after.date}\n\n${body.join(" ")}\n`;
}
