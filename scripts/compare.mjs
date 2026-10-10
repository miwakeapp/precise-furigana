import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { boundaries, recordKey } from "../src/segments.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", default: "dist/changes.jsonl" } }
});
if (positionals.length !== 2) {
  throw new Error("Usage: npm run compare -- before.json after.json [--output changes.jsonl]");
}
function records(database) {
  return new Map(Object.entries(database.entries).flatMap(([id, pairs]) =>
    pairs.map(pair => [recordKey(id, pair.written, pair.reading), { id, ...pair }])));
}
const before = records(JSON.parse(await readFile(positionals[0], "utf8")));
const after = records(JSON.parse(await readFile(positionals[1], "utf8")));
await mkdir(dirname(values.output), { recursive: true });
const output = createWriteStream(values.output);
const counts = { unchanged: 0, added: 0, removed: 0, finer: 0, coarser: 0, incompatible: 0, statusOnly: 0 };
async function write(value) {
  if (!output.write(JSON.stringify(value) + "\n")) await once(output, "drain");
}
for (const [key, record] of after) {
  const previous = before.get(key);
  before.delete(key);
  if (!previous) {
    ++counts.added;
    await write({ change: "added", after: record });
  } else if (isDeepStrictEqual(previous.segments, record.segments)) {
    if (previous.status === record.status) ++counts.unchanged;
    else {
      ++counts.statusOnly;
      await write({ change: "statusOnly", before: previous, after: record });
    }
  } else {
    const oldBoundaries = new Set(boundaries(previous.segments));
    const newBoundaries = new Set(boundaries(record.segments));
    const change = [...oldBoundaries].every(boundary => newBoundaries.has(boundary)) ? "finer" :
      [...newBoundaries].every(boundary => oldBoundaries.has(boundary)) ? "coarser" : "incompatible";
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
