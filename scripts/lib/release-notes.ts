// What a release's notes say: the database's statistics and, after the first release, what
// changed since the one before.
import type { SourceLock } from "../../src/sources.ts";
import type { Database, Segment } from "../../src/types.ts";
import { compareDatabases, type Change, type SegmentationChange } from "./compare.ts";

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
      let shares = false;
      for (const segment of record.segments) {
        if (typeof segment === "string") continue;
        const kanji = Array.from(segment[0]).filter(isKanji).length;
        statistics.kanji += kanji;
        if (kanji > 1) {
          statistics.sharingKanji += kanji;
          shares = true;
        }
      }
      if (shares) ++statistics.sharingRecords;
    }
  }
  return statistics;
}

/** How many of each kind of thing to show before summarizing the rest. */
const exampleLimit = 5;
/** Changes that could be regressions are listed in full, up to a size the page can hold. */
const regressionLimit = 100;

const count = (value: number) => value.toLocaleString("en-US");
const nouns = (value: number, noun: string, plural = `${noun}s`) =>
  `${count(value)} ${value === 1 ? noun : plural}`;
const signed = (value: number) =>
  value === 0 ? "" : `${value > 0 ? "+" : "−"}${count(Math.abs(value))}`;
const escapeHTML = (text: string) => text.replace(/[&<>]/gu, (unit) => `&#${unit.codePointAt(0)};`);
const ruby = (segments: Segment[]) =>
  segments
    .map((segment) =>
      typeof segment === "string"
        ? escapeHTML(segment)
        : `<ruby>${escapeHTML(segment[0])}<rt>${escapeHTML(segment[1])}</ruby>`,
    )
    .join("");
const more = (shown: number, total: number) =>
  total > shown ? [`${count(total - shown)} more`] : [];
const sentenceList = (items: string[]) =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

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

function dictionaryChanges(previous: Database, current: Database, changes: Change[]): string[] {
  const addedEntries = Object.keys(current.entries).filter((id) => !(id in previous.entries));
  const removedEntries = Object.keys(previous.entries).filter((id) => !(id in current.entries));
  const addedRecords = changes.filter(({ change }) => change === "added").length;
  const removedRecords = changes.filter(({ change }) => change === "removed").length;
  const tally = (added: number, removed: number, noun: string, plural: string) =>
    added > 0 && removed > 0
      ? `${nouns(added, noun, plural)} added and ${count(removed)} removed`
      : added > 0
        ? `${nouns(added, noun, plural)} added`
        : removed > 0
          ? `${nouns(removed, noun, plural)} removed`
          : undefined;
  const tallies = [
    tally(addedEntries.length, removedEntries.length, "entry", "entries"),
    tally(addedRecords, removedRecords, "record", "records"),
  ].filter((text) => text !== undefined);
  if (tallies.length === 0) return [];
  const sentences = [`${tallies.join("; ")}.`.replace(/^./u, (first) => first.toUpperCase())];
  // Show new words as the database renders them. Kana-only entries have nothing to show.
  const examples = addedEntries
    .map((id) => current.entries[id][0])
    .filter((record) => record.segments.some((segment) => typeof segment !== "string"));
  if (examples.length > 0) {
    const shown = examples.slice(0, exampleLimit).map((record) => ruby(record.segments));
    sentences.push(
      `New entries include ${sentenceList([...shown, ...more(shown.length, addedEntries.length)])}.`,
    );
  }
  return [`**Dictionary.** ${sentences.join(" ")}`, ""];
}

function segmentationChanges(all: Change[]): string[] {
  const changes: Record<SegmentationChange["change"], SegmentationChange[]> = {
    finer: [],
    coarser: [],
    incompatible: [],
    ruby: [],
  };
  for (const change of all) {
    if (change.change !== "added" && change.change !== "removed")
      changes[change.change].push(change);
  }
  const kinds: [kind: SegmentationChange["change"], phrase: string, limit: number][] = [
    ["finer", "divided more finely", exampleLimit],
    ["coarser", "divided more coarsely", regressionLimit],
    ["incompatible", "divided differently", regressionLimit],
    ["ruby", "given different furigana over the same parts", exampleLimit],
  ];
  const present = kinds.filter(([kind]) => changes[kind].length > 0);
  if (present.length === 0) return [];
  const summary = present.map(([kind, phrase], index) =>
    index === 0
      ? `${nouns(changes[kind].length, "existing record is", "existing records are")} ${phrase}`
      : `${count(changes[kind].length)} ${phrase}`,
  );
  // Say outright that nothing got coarser, since that is what a reader checks for.
  if (changes.coarser.length === 0 && changes.incompatible.length === 0)
    summary.push("none more coarsely");
  const lines = [`**Segmentation.** ${sentenceList(summary)}.`, ""];
  for (const [kind, phrase, limit] of present) {
    if (present.length > 1)
      lines.push(`${phrase.replace(/^./u, (first) => first.toUpperCase())}:`, "");
    const shown = changes[kind].slice(0, limit);
    lines.push(
      ...shown.map(({ before, after }) => `- ${ruby(before.segments)} → ${ruby(after.segments)}`),
      ...more(shown.length, changes[kind].length).map((text) => `- and ${text}`),
      "",
    );
  }
  return lines;
}

/**
 * Write a release's notes. `previous` is the database of the release before it; without one, or
 * when its schema differs, the notes give statistics only.
 */
export function renderReleaseNotes(
  current: Database,
  lock: Pick<SourceLock, "release">,
  previous?: Database,
  previousURL?: string,
): string {
  const comparable = previous?.schemaVersion === current.schemaVersion ? previous : undefined;
  const lines = [
    `Furigana for every spelling and reading in JMdict ${current.jmdictDate} ([jmdict-simplified ${lock.release.tag}](${lock.release.url})).`,
    "",
    ...statisticsTable(databaseStatistics(current), comparable && databaseStatistics(comparable)),
    "",
  ];
  if (comparable !== undefined) {
    const compared = [...compareDatabases(comparable, current)];
    const changes = [
      ...dictionaryChanges(comparable, current, compared),
      ...segmentationChanges(compared),
    ];
    if (changes.length > 0) {
      const name = previousURL ? `[${comparable.version}](${previousURL})` : comparable.version;
      lines.push(`## Changes since ${name}`, "", ...changes);
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
