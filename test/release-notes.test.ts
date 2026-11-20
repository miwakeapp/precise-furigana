import assert from "node:assert/strict";
import test from "node:test";
import { databaseStatistics, renderReleaseNotes } from "../scripts/lib/release-notes.ts";
import type { Database, DatabaseRecord } from "../src/types.ts";

const lock = { release: { tag: "source-tag", url: "https://example.com/source" } };
const database = (version: string, entries: Record<string, DatabaseRecord[]>): Database => ({
  version,
  schemaVersion: 1,
  jmdictDate: `${version.slice(2, 6)}-${version.slice(6, 8)}-${version.slice(8, 10)}`,
  entries,
});
const first = database("1.20261116.0", {
  "1": [{ spelling: "景色", reading: "けしき", segments: [["景色", "けしき"]] }],
  "2": [
    { spelling: "大人", reading: "おとな", segments: [["大人", "おとな"]] },
    {
      spelling: "ＳＦ",
      reading: "エス・エフ",
      segments: [
        ["Ｓ", "エス・"],
        ["Ｆ", "エフ"],
      ],
      pairing: "mispaired",
    },
  ],
  "3": [{ spelling: "古語", reading: "こご", segments: [["古語", "こご"]] }],
});
const second = database("1.20261123.0", {
  "1": [
    {
      spelling: "景色",
      reading: "けしき",
      segments: [
        ["景", "け"],
        ["色", "しき"],
      ],
    },
  ],
  "2": first.entries["2"],
  "4": [
    {
      spelling: "家捜し",
      reading: "やさがし",
      segments: [["家", "や"], ["捜", "さが"], "し"],
    },
    { spelling: "家さがし", reading: "やさがし", segments: [["家", "や"], "さがし"] },
  ],
  "5": [{ spelling: "ばか", reading: "ばか", segments: ["ばか"] }],
});

test("statistics count records, flags, and kanji that share furigana", () => {
  assert.deepEqual(databaseStatistics(first), {
    entries: 3,
    records: 4,
    synthesized: 0,
    mispaired: 1,
    phonetic: 0,
    kanji: 6,
    sharingKanji: 6,
    sharingRecords: 3,
  });
  const after = databaseStatistics(second);
  assert.equal(after.kanji, 7);
  assert.equal(after.sharingKanji, 2);
  assert.equal(after.sharingRecords, 1);
});

test("a first release's notes give statistics and no changes", () => {
  const notes = renderReleaseNotes(first, lock);
  assert.match(
    notes,
    /^Furigana for every spelling and reading in JMdict 2026-11-16 \(\[jmdict-simplified source-tag\]\(https:\/\/example\.com\/source\)\)\.\n/u,
  );
  assert.match(notes, /\| JMdict entries \| 3 \|\n/u);
  assert.match(notes, /\| Kanji sharing furigana with a neighbor \| 6 \(100\.0%\) \|\n/u);
  assert.doesNotMatch(notes, /Change/u);
});

test("later notes give each statistic's change and what changed", () => {
  const notes = renderReleaseNotes(second, lock, first, "https://example.com/previous");
  assert.match(notes, /\| JMdict entries \| 4 \| \+1 \|\n/u);
  assert.match(notes, /\| Records \| 6 \| \+2 \|\n/u);
  assert.match(notes, /\| Marked `"mispaired"` \| 1 \| \|\n/u);
  assert.match(notes, /\| Kanji sharing furigana with a neighbor \| 2 \(28\.6%\) \| −4 \|\n/u);
  assert.match(notes, /## Changes since \[1\.20261116\.0\]\(https:\/\/example\.com\/previous\)\n/u);
  // A removed entry, two added ones, and the records they bring; a kana-only entry is no example.
  assert.match(
    notes,
    /\*\*Dictionary\.\*\* 2 entries added and 1 removed; 3 records added and 1 removed\. New entries include <span lang="ja"><ruby>家<rt>や<\/ruby><ruby>捜<rt>さが<\/ruby>し<\/span> and 1 more\.\n/u,
  );
  assert.match(
    notes,
    /\*\*Segmentation\.\*\* 1 existing record is divided more finely and none more coarsely\.\n\n- <span lang="ja"><ruby>景色<rt>けしき<\/ruby><\/span> → <span lang="ja"><ruby>景<rt>け<\/ruby><ruby>色<rt>しき<\/ruby><\/span>\n/u,
  );
});

test("a coarser division is named, and each kind is listed under its own heading", () => {
  const notes = renderReleaseNotes(first, lock, second);
  assert.match(
    notes,
    /\*\*Segmentation\.\*\* 1 existing record is divided more coarsely\.\n\n- <span lang="ja"><ruby>景<rt>け<\/ruby><ruby>色<rt>しき<\/ruby><\/span> → <span lang="ja"><ruby>景色<rt>けしき<\/ruby><\/span>\n/u,
  );
  assert.doesNotMatch(notes, /none more coarsely/u);
});

test("a database with another schema is not compared", () => {
  const notes = renderReleaseNotes({ ...second, schemaVersion: 2 }, lock, first);
  assert.doesNotMatch(notes, /Change/u);
});
