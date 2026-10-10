import { parseArgs } from "node:util";
import { loadDataset } from "../src/dataset.mjs";

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 2) throw new Error("Usage: npm run inspect -- written reading");
const [written, reading] = positionals;
const dataset = await loadDataset();
const pairs = [...dataset.pairs()].filter(pair => pair.written === written && pair.reading === reading);
console.log(JSON.stringify({ written, reading, entries: pairs.map(pair => pair.id), ...dataset.align(written, reading) }, undefined, 2));
