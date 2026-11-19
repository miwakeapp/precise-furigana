import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { recordKey, segmentText } from "../src/segments.ts";
import type { Database, Segment } from "../src/types.ts";
import type { Change, ChangedRecord } from "./lib/update-report.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", default: "dist/changes.jsonl" } },
});
if (positionals.length !== 2) {
  throw new Error("Usage: npm run compare -- before.json after.json [--output changes.jsonl]");
}
// Release segments partition the spelling; plain text can be silent, so only
// spelling positions identify a boundary.
function boundaries(segments: Segment[]): number[] {
  let offset = 0;
  return segments.slice(0, -1).map((segment) => (offset += [...segmentText(segment)].length));
}
function records(database: Database): Map<string, ChangedRecord> {
  return new Map(
    Object.entries(database.entries).flatMap(([id, pairs]) =>
      pairs.map((pair): [string, ChangedRecord] => [
        recordKey(id, pair.spelling, pair.reading),
        { id, ...pair },
      ]),
    ),
  );
}
const before = records(JSON.parse(await readFile(positionals[0], "utf8")));
const after = records(JSON.parse(await readFile(positionals[1], "utf8")));
await mkdir(dirname(values.output), { recursive: true });
const output = createWriteStream(values.output);
const counts = {
  unchanged: 0,
  added: 0,
  removed: 0,
  finer: 0,
  coarser: 0,
  incompatible: 0,
  ruby: 0,
};
async function write(value: Change): Promise<void> {
  if (!output.write(JSON.stringify(value) + "\n")) await once(output, "drain");
}
for (const [key, record] of after) {
  const previous = before.get(key);
  before.delete(key);
  if (!previous) {
    ++counts.added;
    await write({ change: "added", after: record });
  } else if (isDeepStrictEqual(previous.segments, record.segments)) {
    ++counts.unchanged;
  } else {
    const oldBoundaries = new Set(boundaries(previous.segments));
    const newBoundaries = new Set(boundaries(record.segments));
    const kept = [...oldBoundaries].every((boundary) => newBoundaries.has(boundary));
    // Same cuts with different segments: ruby was added, removed or moved.
    const change =
      kept && oldBoundaries.size === newBoundaries.size
        ? "ruby"
        : kept
          ? "finer"
          : [...newBoundaries].every((boundary) => oldBoundaries.has(boundary))
            ? "coarser"
            : "incompatible";
    ++counts[change];
    await write({ change, before: previous, after: record });
  }
}
for (const record of before.values()) {
  ++counts.removed;
  await write({ change: "removed", before: record });
}
output.end();
await once(output, "finish");
console.log(JSON.stringify(counts, undefined, 2));
