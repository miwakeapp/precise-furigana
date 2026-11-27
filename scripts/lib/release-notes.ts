// What a release's notes say: the database's statistics and, after the first release, what
// changed since the one before.
import type { SourceLock } from "../../src/sources.ts";
import type { Database } from "../../src/types.ts";
import {
  addedAndRemovedSection,
  changedRecordsSection,
  kanjiSharingFurigana,
  summarizeChanges,
} from "./change-lists.ts";
import { compareDatabases } from "./compare.ts";
import { proseWithJapanese } from "./markup.ts";

export interface Statistics {
  entries: number;
  records: number;
  synthesized: number;
  mispaired: number;
  phonetic: number;
  /** Kanji in records that are not mispaired. */
  kanji: number;
  /** Those kanji whose ruby also covers another kanji. */
  sharingKanji: number;
  /** Records with at least one such kanji. */
  sharingRecords: number;
}

const isKanji = (character: string) => /\p{Script=Han}/u.test(character);

export function databaseStatistics(database: Pick<Database, "entries">): Statistics {
  const statistics: Statistics = {
    entries: 0,
    records: 0,
    synthesized: 0,
    mispaired: 0,
    phonetic: 0,
    kanji: 0,
    sharingKanji: 0,
    sharingRecords: 0,
  };
  for (const entry of Object.values(database.entries)) {
    ++statistics.entries;
    for (const record of entry) {
      ++statistics.records;
      if (record.pairing !== undefined) ++statistics[record.pairing];
      // A mispaired record's ruby is not a statement about its spelling.
      if (record.pairing === "mispaired") continue;
      for (const segment of record.segments) {
        if (typeof segment !== "string")
          statistics.kanji += Array.from(segment[0]).filter(isKanji).length;
      }
      const sharing = kanjiSharingFurigana(record);
      statistics.sharingKanji += sharing;
      if (sharing > 0) ++statistics.sharingRecords;
    }
  }
  return statistics;
}

/**
 * A release's notes can hold 125,000 characters, about twice a pull request description, so the
 * lists get more room here than in an update's description. They all start folded: the notes
 * are a record to consult, where an update's description is a list of things to look at.
 */
const listLimit = 200;
const foldedLimit = 80_000;
/** The most commits to name before giving a count of the rest. */
const commitLimit = 50;

const count = (value: number) => value.toLocaleString("en-US");
const signed = (value: number) =>
  value === 0 ? "" : `${value > 0 ? "+" : "−"}${count(Math.abs(value))}`;

/** A commit made since the previous release, as GitHub's compare API describes it. */
export interface ReleaseCommit {
  sha: string;
  /** The first line of its message. */
  subject: string;
  url: string;
}

function statisticsTable(current: Statistics, previous: Statistics | undefined): string[] {
  const share = ((100 * current.sharingKanji) / current.kanji).toFixed(1);
  const rows: [label: string, value: string, change: number][] = [
    ["JMdict entries", count(current.entries), current.entries - (previous?.entries ?? 0)],
    ["Records", count(current.records), current.records - (previous?.records ?? 0)],
    [
      "&emsp;from JMdict",
      count(current.records - current.synthesized),
      current.records -
        current.synthesized -
        ((previous?.records ?? 0) - (previous?.synthesized ?? 0)),
    ],
    [
      "&emsp;synthesized",
      count(current.synthesized),
      current.synthesized - (previous?.synthesized ?? 0),
    ],
    [
      'Marked `"mispaired"`',
      count(current.mispaired),
      current.mispaired - (previous?.mispaired ?? 0),
    ],
    ['Marked `"phonetic"`', count(current.phonetic), current.phonetic - (previous?.phonetic ?? 0)],
    [
      "Kanji sharing furigana with a neighbor",
      `${count(current.sharingKanji)} (${share}%)`,
      current.sharingKanji - (previous?.sharingKanji ?? 0),
    ],
    [
      "Records where kanji share furigana",
      count(current.sharingRecords),
      current.sharingRecords - (previous?.sharingRecords ?? 0),
    ],
  ];
  return previous === undefined
    ? ["| | |", "| --- | ---: |", ...rows.map(([label, value]) => `| ${label} | ${value} |`)]
    : [
        "| | | Change |",
        "| --- | ---: | ---: |",
        ...rows.map(
          ([label, value, change]) =>
            `| ${label} | ${value} |${change === 0 ? "" : ` ${signed(change)}`} |`,
        ),
      ];
}

/** The commits between the two releases, oldest first: the reasons for what the lists show. */
function commitList(commits: ReleaseCommit[]): string[] {
  if (commits.length === 0) return [];
  const shown = commits
    .slice(0, commitLimit)
    .map(
      ({ sha, subject, url }) => `- [\`${sha.slice(0, 7)}\`](${url}) ${proseWithJapanese(subject)}`,
    );
  if (commits.length > commitLimit) shown.push(`- …and ${commits.length - commitLimit} more.`);
  return ["## Commits", "", ...shown, ""];
}

/**
 * Write a release's notes: the database's statistics and, after the first release, everything
 * that changed since the release before, in the sections an update's description uses.
 * `previous` is that release's database; without one, or when its schema differs, the notes give
 * statistics only. `commits` are the commits made since it.
 */
export function renderReleaseNotes(
  current: Database,
  lock: Pick<SourceLock, "release">,
  previous?: Database,
  previousURL?: string,
  commits: ReleaseCommit[] = [],
): string {
  const comparable = previous?.schemaVersion === current.schemaVersion ? previous : undefined;
  const since =
    comparable === undefined
      ? ""
      : ` Changes are since ${previousURL ? `[${comparable.version}](${previousURL})` : comparable.version}.`;
  const lines = [
    `Furigana for every spelling and reading in JMdict ${current.jmdictDate} ([jmdict-simplified ${lock.release.tag}](${lock.release.url})).${since}`,
    "",
    ...statisticsTable(databaseStatistics(current), comparable && databaseStatistics(comparable)),
    "",
  ];
  if (comparable !== undefined) {
    const summary = summarizeChanges([...compareDatabases(comparable, current)]);
    lines.push(
      ...commitList(commits),
      // A release has no section of its own for synthesized pairs, so every pairing change is listed.
      ...changedRecordsSection(summary, summary.pairingChanges, { limit: listLimit, open: false }),
      ...addedAndRemovedSection(summary, [], foldedLimit),
    );
  }
  return lines.join("\n").trimEnd() + "\n";
}
