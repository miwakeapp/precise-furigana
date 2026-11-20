import assert from "node:assert/strict";
import test from "node:test";
import {
  diffSynthesizedPairs,
  renderCommitMessage,
  renderReport,
  reviewReasons,
  summarizeChanges,
} from "../scripts/lib/update-report.ts";
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
        after: record([
          ["山", "やま"],
          ["川", "かわ"],
        ]),
      },
      { change: "removed", before: record([["山川", "やまかわ"]]) },
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
    /<ruby>山川<rt>やまかわ<\/rt><\/ruby> → <ruby>山<rt>やま<\/rt><\/ruby><ruby>川<rt>かわ<\/rt><\/ruby>/u,
  );
  assert.match(report, /そっぽ向く read そっぽむく/u);
  // Every added and removed record is listed, folded away.
  assert.match(
    report,
    /<details>\n<summary>Added records \(1\)<\/summary>\n\n- <ruby>山<rt>やま<\/rt><\/ruby><ruby>川<rt>かわ<\/rt><\/ruby> \(entry 1\)\n\n<\/details>\n/u,
  );
  assert.match(
    report,
    /<summary>Removed records \(1\)<\/summary>\n\n- <ruby>山川<rt>やまかわ<\/rt><\/ruby> \(entry 1\)\n/u,
  );
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
    { change: "added", after: grouped },
    // A mispaired record's ruby is not a statement about its spelling.
    { change: "added", after: { ...grouped, reading: "さんせん", pairing: "mispaired" } },
    // Only new records are candidates; an old one was looked at when it arrived.
    { change: "removed", before: grouped },
  ]);
  assert.deepEqual(summary.grouped, [grouped]);
  const needsReview = update(summary);
  assert.deepEqual(reviewReasons(needsReview), [
    "1 new record has kanji sharing furigana; check whether a split is documented.",
  ]);
  assert.match(
    renderReport(needsReview),
    /### New records with kanji sharing furigana \(1\)\n\n- 山川 \(やまかわ, entry 1\): <ruby>山川<rt>やまかわ<\/rt><\/ruby>\n/u,
  );
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
