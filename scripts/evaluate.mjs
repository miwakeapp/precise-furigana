import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadDataset } from "../src/dataset.mjs";
import { evaluateDataset } from "./lib/evaluation.mjs";
import { parseGeneratorOptions } from "./lib/options.mjs";

const { output, configuration } = parseGeneratorOptions("dist/evaluation.json");
const dataset = await loadDataset(configuration);
const goldText = await readFile(new URL("../test/fixtures/gold.json", import.meta.url), "utf8");
const evaluation = await evaluateDataset(dataset, goldText);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evaluation, undefined, 2) + "\n");
console.log(JSON.stringify(evaluation.summary, undefined, 2));
for (const failure of evaluation.results.filter(result => !result.pass)) {
  console.log(`${failure.spelling}/${failure.reading}: expected ${JSON.stringify(failure.segments)}, got ${JSON.stringify(failure.actual)} (${failure.status})`);
}
if (evaluation.summary.passed !== evaluation.summary.examples) process.exitCode = 1;
