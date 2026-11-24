import assert from "node:assert/strict";
import test from "node:test";
import { compareDatabases } from "../scripts/lib/compare.ts";
import type { DatabaseRecord } from "../src/types.ts";

const record = (spelling: string, reading: string, extra: Partial<DatabaseRecord> = {}) => ({
  spelling,
  reading,
  segments: [[spelling, reading]] as DatabaseRecord["segments"],
  ...extra,
});

test("added and removed records say whether their whole entry came or went", () => {
  const before = { entries: { 1: [record("山", "やま")], 2: [record("川", "かわ")] } };
  const after = {
    entries: { 1: [record("山", "やま"), record("山", "さん")], 3: [record("海", "うみ")] },
  };
  assert.deepEqual(
    Array.from(compareDatabases(before, after), (change) => [
      change.change,
      "after" in change ? change.after.reading : change.before.reading,
      change.change === "added" ? change.newEntry : undefined,
      change.change === "removed" ? change.removedEntry : undefined,
    ]),
    [
      ["added", "さん", false, undefined],
      ["added", "うみ", true, undefined],
      ["removed", "かわ", undefined, true],
    ],
  );
});

test("a record whose pairing alone changed is reported", () => {
  const before = { entries: { 1: [record("山", "やま"), record("川", "かわ")] } };
  const after = {
    entries: { 1: [record("山", "やま", { pairing: "mispaired" }), record("川", "かわ")] },
  };
  const changes = [...compareDatabases(before, after)];
  assert.equal(changes.length, 1);
  assert.equal(changes[0].change, "pairing");
});
