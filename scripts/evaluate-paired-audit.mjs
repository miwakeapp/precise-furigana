import { readFile } from "node:fs/promises";
import { estimatePairedAccuracy } from "./lib/paired-evaluation.mjs";

if (process.argv.length !== 3) throw new Error("Usage: node scripts/evaluate-paired-audit.mjs FROZEN-AUDIT-SCORES.json");
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
console.log(JSON.stringify(estimatePairedAccuracy(input), undefined, 2));
