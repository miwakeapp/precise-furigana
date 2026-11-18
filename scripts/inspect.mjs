import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadDataset } from "../src/dataset.mjs";
import { recordKey } from "../src/segments.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: "string", default: "dist/precise-furigana.json" },
    explain: { type: "boolean", default: false },
  },
});
if (positionals.length !== 2)
  throw new Error("Usage: npm run inspect -- spelling reading [--explain] [--database file.json]");
const [spelling, reading] = positionals;
if (values.explain) {
  const dataset = await loadDataset();
  const pairs = [...dataset.pairs()].filter(
    (pair) => pair.spelling === spelling && pair.reading === reading,
  );
  console.log(
    JSON.stringify(
      {
        spelling,
        reading,
        algorithm: dataset.align(spelling, reading),
        records: pairs.map((pair) => ({
          id: pair.id,
          ...dataset.alignPair(pair),
          annotation: dataset.annotations.get(recordKey(pair.id, spelling, reading)),
        })),
      },
      undefined,
      2,
    ),
  );
} else {
  const database = JSON.parse(await readFile(values.database, "utf8"));
  const records = Object.entries(database.entries).flatMap(([id, rows]) =>
    rows
      .filter((row) => row.spelling === spelling && row.reading === reading)
      .map((row) => ({ id, ...row })),
  );
  console.log(JSON.stringify(records, undefined, 2));
  if (!records.length) process.exitCode = 1;
}
