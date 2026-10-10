import { parseArgs } from "node:util";
import { defaultCacheDirectory } from "../src/sources.mjs";
import { scorePairedAudit } from "./lib/paired-scoring.mjs";

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  "checkpoint-sha256": { type: "string" },
  adjudication: { type: "string" },
  "adjudication-sha256": { type: "string" },
  output: { type: "string" },
  cache: { type: "string", default: defaultCacheDirectory }
} });
if (positionals.length !== 1 || ["checkpoint-sha256", "adjudication", "adjudication-sha256", "output"].some(name => values[name] === undefined)) {
  throw new Error("Usage: node scripts/score-paired-audit.mjs AUDIT-DIRECTORY --checkpoint-sha256 HASH --adjudication FROZEN-ADJUDICATION.json --adjudication-sha256 HASH --output NEW-DIRECTORY [--cache DIRECTORY]");
}
const report = await scorePairedAudit({
  auditDirectory: positionals[0], checkpointSHA256: values["checkpoint-sha256"],
  adjudicationPath: values.adjudication, adjudicationSHA256: values["adjudication-sha256"],
  outputDirectory: values.output, cacheDirectory: values.cache
});
console.log(JSON.stringify(report, undefined, 2));
