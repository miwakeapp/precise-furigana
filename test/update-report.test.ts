import assert from "node:assert/strict";
import test from "node:test";
import {
  diffSynthesizedPairs,
  renderCommitMessage,
  renderReport,
  reviewReasons,
} from "../scripts/lib/update-report.ts";
import { summarizeChanges } from "../scripts/lib/change-lists.ts";
import type { ChangedRecord, SegmentationChange } from "../scripts/lib/compare.ts";
import type { StepResult, Update } from "../scripts/lib/update-report.ts";
import type { SynthesizedPair } from "../src/pairings.ts";
import type { Segment } from "../src/types.ts";

const pair = (spelling: string, reading: string, unreviewed = false): SynthesizedPair => ({
  id: "1",
  spelling,
  reading,
  note: "",
  ...(unreviewed ? { unreviewed } : {}),
});
const record = (segments: Segment[]): ChangedRecord => ({
  id: "1",
  spelling: "山川",
  reading: "やまかわ",
  segments,
});
const passed: StepResult = { passed: true, output: "" };

function update(overrides: Partial<Update> = {}): Update {
  return {
    before: { tag: "3.6.2+20261005", url: "https://example.test/old", date: "2026-10-05" },
    after: { tag: "3.6.2+20261012", url: "https://example.test/new", date: "2026-10-12" },
    ...summarizeChanges([]),
    synthesized: diffSynthesizedPairs([], []),
    otherDataChanges: [],
    compared: true,
    build: passed,
    validate: passed,
    reviewNotes: "",
    ...overrides,
  };
}

test("an update that only drops synthesized pairs and adds or refines records is clean", () => {
  const clean = update({
    ...summarizeChanges([
      {
        change: "added",
        newEntry: false,
        after: record([
          ["山", "やま"],
          ["川", "かわ"],
        ]),
      },
      { change: "removed", removedEntry: false, before: record([["山川", "やまかわ"]]) },
      {
        change: "finer",
        before: record([["山川", "やまかわ"]]),
        after: record([
          ["山", "やま"],
          ["川", "かわ"],
        ]),
      },
    ]),
    synthesized: diffSynthesizedPairs([pair("そっぽ向く", "そっぽむく")], []),
  });
  assert.deepEqual(reviewReasons(clean), []);
  const report = renderReport(clean);
  assert.match(report, /\*\*Clean\.\*\*/u);
  assert.match(report, /\| Finer \| 1 \|/u);
  assert.match(
    report,
    /- \[1\]\(https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&g=1\): <span lang="ja"><ruby>山川<rt>やまかわ<\/ruby><\/span> → <span lang="ja"><ruby>山<rt>やま<\/ruby><ruby>川<rt>かわ<\/ruby><\/span>\n/u,
  );
  assert.match(
    report,
    /- \[1\]\(https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&g=1\): <span lang="ja">そっぽ向く<\/span> read <span lang="ja">そっぽむく<\/span>\n/u,
  );
  // The records an entry gained or lost are listed on its line, folded away.
  assert.match(
    report,
    /<details>\n<summary><h3>Entries with new records \(1\)<\/h3><\/summary>\n\n- \[1\]\(https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&g=1\): <span lang="ja"><ruby>山<rt>やま<\/ruby><ruby>川<rt>かわ<\/ruby><\/span>\n\n<\/details>\n/u,
  );
  assert.match(
    report,
    /<summary><h3>Entries with removed records \(1\)<\/h3><\/summary>\n\n- \[1\]\(https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&g=1\): <span lang="ja"><ruby>山川<rt>やまかわ<\/ruby><\/span>\n/u,
  );
  assert.doesNotMatch(report, /New entries|Removed entries|Pairing changed \(/u);
  assert.equal(
    renderCommitMessage(clean),
    "Update JMdict to 2026-10-12\n\nMoves the dictionary pin from jmdict-simplified 3.6.2+20261005 to 3.6.2+20261012. Removes 1 synthesized pair that JMdict now has or no longer needs.\n",
  );
});

test("anything a person should look at makes an update need review", () => {
  const coarser: SegmentationChange = {
    change: "coarser",
    before: record([
      ["山", "やま"],
      ["川", "かわ"],
    ]),
    after: record([["山川", "やまかわ"]]),
  };
  assert.equal(reviewReasons(update(summarizeChanges([coarser]))).length, 1);
  assert.equal(
    reviewReasons(update(summarizeChanges([{ ...coarser, change: "incompatible" }]))).length,
    1,
  );
  assert.deepEqual(reviewReasons(update({ otherDataChanges: ["annotations.json"] })), [
    "`annotations.json` changed.",
  ]);
  // A new pair needs a person whether it is still unreviewed or was reviewed automatically.
  for (const unreviewed of [true, false]) {
    const synthesized = diffSynthesizedPairs([], [pair("気持ちよい", "きもちよい", unreviewed)]);
    assert.equal(reviewReasons(update({ synthesized })).length, 1);
  }
});

test("a new record whose kanji share furigana is listed for review", () => {
  const grouped = record([["山川", "やまかわ"]]);
  const summary = summarizeChanges([
    { change: "added", newEntry: true, after: grouped },
    // A mispaired record's ruby is not a statement about its spelling.
    {
      change: "added",
      newEntry: true,
      after: { ...grouped, reading: "さんせん", pairing: "mispaired" },
    },
    // Only new records are candidates; an old one was looked at when it arrived.
    { change: "removed", removedEntry: true, before: grouped },
  ]);
  assert.deepEqual(summary.grouped, [grouped]);
  const needsReview = update(summary);
  assert.deepEqual(reviewReasons(needsReview), [
    "1 new record has kanji sharing furigana; check whether a split is documented.",
  ]);
  assert.match(
    renderReport(needsReview),
    /<details open>\n<summary><h3>New records with kanji sharing furigana \(1\)<\/h3><\/summary>\n\n- \[1\]\(https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&g=1\): <span lang="ja"><ruby>山川<rt>やまかわ<\/ruby><\/span>\n/u,
  );
});

test("an entry's records share one line, with the marked ones named", () => {
  const plain = record([
    ["山", "やま"],
    ["川", "かわ"],
  ]);
  const report = renderReport(
    update(
      summarizeChanges([
        { change: "added", newEntry: true, after: plain },
        {
          change: "added",
          newEntry: true,
          after: { ...plain, spelling: "やまかわ", segments: ["やまかわ"] },
        },
        {
          change: "added",
          newEntry: true,
          after: { ...plain, pairing: "mispaired", segments: [["山川", "さんせん"]] },
        },
        { change: "added", newEntry: true, after: { ...plain, pairing: "synthesized" } },
        { change: "added", newEntry: true, after: { ...plain, id: "2" } },
        { change: "removed", removedEntry: true, before: { ...plain, id: "3" } },
      ]),
    ),
  );
  const ruby = '<span lang="ja"><ruby>山<rt>やま</ruby><ruby>川<rt>かわ</ruby></span>';
  const link = (id: number) => `[${id}](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=${id})`;
  assert.ok(
    report.includes(
      [
        "<summary><h3>New entries (2)</h3></summary>",
        "",
        `- ${link(1)}: ${ruby}, <span lang="ja">やまかわ</span>; mispaired: <span lang="ja"><ruby>山川<rt>さんせん</ruby></span>; synthesized: ${ruby}`,
        `- ${link(2)}: ${ruby}`,
      ].join("\n"),
    ),
  );
  assert.ok(
    report.includes(`<summary><h3>Removed entries (1)</h3></summary>\n\n- ${link(3)}: ${ruby}\n`),
  );
});

test("a changed pairing is listed, except where the synthesized pairs already say so", () => {
  const plain = record([
    ["山", "やま"],
    ["川", "かわ"],
  ]);
  const summary = summarizeChanges([
    { change: "pairing", before: plain, after: { ...plain, pairing: "mispaired" } },
    // JMdict gained the pair, which the synthesized pairs' section reports as a removal.
    { change: "pairing", before: { ...plain, pairing: "synthesized" }, after: plain },
    // A record can change its division and its pairing at once.
    {
      change: "coarser",
      before: { ...plain, pairing: "phonetic" },
      after: { ...plain, id: "2", segments: [["山川", "やまかわ"]] },
    },
  ]);
  // The summary keeps all three; the description leaves out the one between synthesized and unmarked.
  assert.equal(summary.pairingChanges.length, 3);
  // Listing a change does not by itself make an update need review.
  assert.deepEqual(reviewReasons(update({ ...summary, counts: summarizeChanges([]).counts })), []);
  const report = renderReport(update(summary));
  assert.match(report, /\| Pairing changed \| 2 \|/u);
  assert.match(
    report,
    /<details open>\n<summary><h3>Pairing changed \(2\)<\/h3><\/summary>\n\n- \[1\]\([^)]+\): <span lang="ja"><ruby>山<rt>やま<\/ruby><ruby>川<rt>かわ<\/ruby><\/span>: unmarked → mispaired\n- \[2\]\([^)]+\): <span lang="ja"><ruby>山川<rt>やまかわ<\/ruby><\/span>: phonetic → unmarked\n/u,
  );
});

test("the folded lists share one budget and say how many entries they left out", () => {
  const long = record(["や".repeat(4000)]);
  const entries = Array.from({ length: 12 }, (_, index) => ({
    change: "added" as const,
    newEntry: index < 6,
    after: { ...long, id: String(index + 1) },
  }));
  const report = renderReport(update(summarizeChanges(entries)));
  assert.ok(report.length < 65_536);
  assert.match(report, /<summary><h3>New entries \(6\)<\/h3><\/summary>/u);
  assert.match(
    report,
    /<summary><h3>Entries with new records \(6\)<\/h3><\/summary>\n\n(- \[\d+\].*\n)*- …and \d more\.\n/u,
  );
});

test("synthesized pairs are listed by entry, with spellings that share a reading and note together", () => {
  const note = "Particle drop.";
  const synthesized = diffSynthesizedPairs(
    [],
    [
      { ...pair("水差す", "みずさす"), note },
      { ...pair("水さす", "みずさす"), note },
      // A different reading starts a new clause on the entry's line.
      pair("水差す", "みずをさす", true),
      { ...pair("縁切る", "えんきる"), id: "2", note },
    ],
  );
  const report = renderReport(update({ synthesized }));
  const link = (id: number) => `[${id}](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=${id})`;
  const ja = (text: string) => `<span lang="ja">${text}</span>`;
  assert.ok(
    report.includes(
      [
        "<details open>",
        "<summary><h3>New (4)</h3></summary>",
        "",
        `- ${link(1)}: ${ja("水差す")}, ${ja("水さす")} read ${ja("みずさす")}. Particle drop. ${ja("水差す")} read ${ja("みずをさす")}, unreviewed`,
        `- ${link(2)}: ${ja("縁切る")} read ${ja("えんきる")}. Particle drop.`,
        "",
      ].join("\n"),
    ),
  );
});

test("the report's headings nest by subject, with each list under the section it belongs to", () => {
  const grouped = record([["山川", "やまかわ"]]);
  const split = record([
    ["山", "やま"],
    ["川", "かわ"],
  ]);
  const full = update({
    ...summarizeChanges([
      { change: "added", newEntry: true, after: grouped },
      { change: "coarser", before: split, after: grouped },
      { change: "pairing", before: split, after: { ...split, pairing: "mispaired" } },
    ]),
    synthesized: diffSynthesizedPairs([pair("そっぽ向く", "そっぽむく")], []),
    reviewNotes: "Looked at it.",
  });
  // Headings written as Markdown, and the ones inside the folded lists' summaries.
  const outline = (report: string) =>
    report
      .split("\n")
      .filter((line) => /^#+ |^<summary><h3>/u.test(line))
      .map((line) => line.replace(/^<summary><h3>(.*)<\/h3><\/summary>$/u, "### $1"));
  assert.deepEqual(outline(renderReport(full)), [
    "## Needs review",
    "### Review notes",
    "## Changed records",
    "### Coarser (1)",
    "### Pairing changed (1)",
    "## Added and removed records",
    "### New records with kanji sharing furigana (1)",
    "### New entries (1)",
    "## Synthesized pairs",
    "### Removed because JMdict now has the pair or no longer needs it (1)",
  ]);
  // A clean update has nothing to review, so it has no such section.
  assert.deepEqual(outline(renderReport(update())), [
    "## Changed records",
    "## Added and removed records",
  ]);
});

test("a failed build is reported with its output and without a comparison", () => {
  const failed = update({
    compared: false,
    build: { passed: false, output: "Stale annotation absent from source dictionary" },
    validate: { passed: false, output: "" },
  });
  assert.deepEqual(reviewReasons(failed), ["The build fails."]);
  const report = renderReport(failed);
  assert.match(report, /## Build output\n\n```text\nStale annotation/u);
  assert.doesNotMatch(report, /Segmentation changes/u);
});

test("review notes appear in the report", () => {
  assert.match(
    renderReport(update({ reviewNotes: "Checked both readings.\n" })),
    /## Review notes\n\nChecked both readings\./u,
  );
});
