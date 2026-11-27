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

test("later notes give each statistic's change, the commits, and every change by entry", () => {
  const commits = [
    {
      sha: "0123456789abcdef",
      subject: "Update JMdict to 2026-11-23",
      url: "https://example.com/c1",
    },
    {
      sha: "fedcba9876543210",
      subject: "Divide 景色 by `kanji` & more",
      url: "https://example.com/c2",
    },
  ];
  const notes = renderReleaseNotes(second, lock, first, "https://example.com/previous", commits);
  assert.match(
    notes,
    /^Furigana for .*\)\)\. Changes are since \[1\.20261116\.0\]\(https:\/\/example\.com\/previous\)\.\n/u,
  );
  assert.match(notes, /\| JMdict entries \| 4 \| \+1 \|\n/u);
  assert.match(notes, /\| Records \| 6 \| \+2 \|\n/u);
  assert.match(notes, /\| Marked `"mispaired"` \| 1 \| \|\n/u);
  assert.match(notes, /\| Kanji sharing furigana with a neighbor \| 2 \(28\.6%\) \| −4 \|\n/u);
  // The commits say why; Japanese in a subject is marked, and markup characters are escaped.
  assert.ok(
    notes.includes(
      [
        "## Commits",
        "",
        "- [`0123456`](https://example.com/c1) Update JMdict to 2026-11-23",
        '- [`fedcba9`](https://example.com/c2) Divide <span lang="ja">景色</span> by `kanji` &#38; more',
        "",
        "## Changed records",
      ].join("\n"),
    ),
  );
  const outline = notes
    .split("\n")
    .filter((line) => /^#+ |^<summary><h3>/u.test(line))
    .map((line) => line.replace(/^<summary><h3>(.*)<\/h3><\/summary>$/u, "### $1"));
  assert.deepEqual(outline, [
    "## Commits",
    "## Changed records",
    "### Finer (1)",
    "## Added and removed records",
    "### New entries (2)",
    "### Removed entries (1)",
  ]);
  assert.match(notes, /\| Finer \| 1 \|\n\| Coarser \| 0 \|/u);
  assert.match(notes, /\| Added \| 2 \| 3 \|\n\| Removed \| 1 \| 1 \|/u);
  const link = (id: number) => `[${id}](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=${id})`;
  assert.ok(
    notes.includes(
      `- ${link(1)}: <span lang="ja"><ruby>景色<rt>けしき</ruby></span> → <span lang="ja"><ruby>景<rt>け</ruby><ruby>色<rt>しき</ruby></span>`,
    ),
  );
  // Every new entry is listed with all its records, kana-only ones included.
  assert.ok(
    notes.includes(
      [
        `- ${link(4)}: <span lang="ja"><ruby>家<rt>や</ruby><ruby>捜<rt>さが</ruby>し</span>, <span lang="ja"><ruby>家<rt>や</ruby>さがし</span>`,
        `- ${link(5)}: <span lang="ja">ばか</span>`,
      ].join("\n"),
    ),
  );
});

test("a change of pairing alone is listed, synthesized pairs included", () => {
  const marked = {
    ...first,
    version: "1.20261116.1",
    entries: {
      ...first.entries,
      "3": [{ ...first.entries["3"][0], pairing: "synthesized" as const }],
    },
  };
  const notes = renderReleaseNotes(marked, lock, first);
  assert.match(notes, /\| Pairing changed \| 1 \|/u);
  assert.match(
    notes,
    /<details>\n<summary><h3>Pairing changed \(1\)<\/h3><\/summary>\n\n- \[3\]\([^)]+\): <span lang="ja"><ruby>古語<rt>こご<\/ruby><\/span>: unmarked → synthesized\n/u,
  );
  // With no commits given and no address for the earlier release, the notes still stand.
  assert.match(notes, /Changes are since 1\.20261116\.0\.\n/u);
  assert.doesNotMatch(notes, /## Commits/u);
});

test("changes to several records of one entry share a line", () => {
  const record = (spelling: string, extra: Partial<DatabaseRecord> = {}): DatabaseRecord => ({
    spelling,
    reading: "みずさす",
    segments: [["水", "みず"], spelling.slice(1)],
    ...extra,
  });
  const before = database("1.20261116.0", {
    "7": [
      record("水さす", { pairing: "synthesized" }),
      record("水サス", { pairing: "synthesized" }),
      record("水をさす"),
      record("水差す", { segments: [["水差", "みずさ"], "す"] }),
      record("水注す", { segments: [["水注", "みずさ"], "す"] }),
    ],
  });
  const after = database("1.20261116.1", {
    "7": [
      record("水さす"),
      record("水サス"),
      record("水をさす", { pairing: "mispaired" }),
      record("水差す", { segments: [["水", "みず"], ["差", "さ"], "す"] }),
      record("水注す", { segments: [["水", "みず"], ["注", "さ"], "す"] }),
    ],
  });
  const notes = renderReleaseNotes(after, lock, before);
  const ja = (html: string) => `<span lang="ja">${html}</span>`;
  const mizu = "<ruby>水<rt>みず</ruby>";
  const link = "[7](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=7)";
  // Records that changed alike are named together, and each kind of change gets its own clause.
  assert.ok(
    notes.includes(
      `- ${link}: ${ja(`${mizu}さす`)}, ${ja(`${mizu}サス`)}: synthesized → unmarked; ${ja(`${mizu}をさす`)}: unmarked → mispaired\n`,
    ),
  );
  assert.ok(
    notes.includes(
      `- ${link}: ${ja("<ruby>水差<rt>みずさ</ruby>す")} → ${ja(`${mizu}<ruby>差<rt>さ</ruby>す`)}; ${ja("<ruby>水注<rt>みずさ</ruby>す")} → ${ja(`${mizu}<ruby>注<rt>さ</ruby>す`)}\n`,
    ),
  );
  // The headings still count records, and every list starts folded.
  assert.match(notes, /<h3>Finer \(2\)<\/h3>/u);
  assert.match(notes, /<h3>Pairing changed \(3\)<\/h3>/u);
  assert.doesNotMatch(notes, /<details open>/u);
});

test("a database with another schema is not compared", () => {
  const notes = renderReleaseNotes({ ...second, schemaVersion: 2 }, lock, first);
  assert.doesNotMatch(notes, /Change/u);
});
