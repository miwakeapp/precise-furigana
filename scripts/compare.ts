import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { Database } from "../src/types.ts";
import { compareDatabases } from "./lib/compare.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", default: "dist/changes.jsonl" } },
});
if (positionals.length !== 2) {
  throw new Error("Usage: npm run compare -- before.json after.json [--output changes.jsonl]");
}
const before: Database = JSON.parse(await readFile(positionals[0], "utf8"));
const after: Database = JSON.parse(await readFile(positionals[1], "utf8"));
await mkdir(dirname(values.output), { recursive: true });
const output = createWriteStream(values.output);
const counts = { added: 0, removed: 0, finer: 0, coarser: 0, incompatible: 0, ruby: 0 };
for (const change of compareDatabases(before, after)) {
  ++counts[change.change];
  if (!output.write(JSON.stringify(change) + "\n")) await once(output, "drain");
}
output.end();
await once(output, "finish");
const total = Object.values(after.entries).reduce((sum, entry) => sum + entry.length, 0);
const unchanged =
  total - counts.added - counts.finer - counts.coarser - counts.incompatible - counts.ruby;
console.log(JSON.stringify({ unchanged, ...counts }, undefined, 2));
