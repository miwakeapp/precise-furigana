// Usage: node scripts/update.ts <baseline|update|recheck> [--release <jmdict-simplified tag>]
//
// Moves the dictionary pin and reports what that changes, in three phases so a workflow can
// switch branches or fix data between them:
//
// - `baseline` builds the database from the tree as it stands and snapshots the data files.
// - `update` moves the pin, repairs the synthesized pairs, rebuilds, and writes the report.
// - `recheck` rebuilds and rewrites the report after someone has edited the data.
//
// Everything is written under `.cache/update/`: `report.md`, `commit-message.txt`, and
// `status.json`. In GitHub Actions the `changed` and `clean` outputs are set too.
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  diffSynthesizedPairs,
  renderCommitMessage,
  renderReport,
  reviewReasons,
  summarizeChanges,
} from "./lib/update-report.ts";
import type { SynthesizedPair } from "../src/pairings.ts";
import type { Change, DictionaryPin, StepResult, Update } from "./lib/update-report.ts";

/** The parts of `data/sources.lock.json` that say what it pins. */
interface PinnedLock {
  release: { tag: string; url: string };
  sources: { jmdict: { dictDate: string } };
}

/** A build's result, and whether it wrote the database. */
interface BuildResult extends StepResult {
  wrote: boolean;
}

/** What a phase reports to the workflow that ran it. */
interface Outputs {
  changed: boolean;
  clean: boolean;
  reasons: string[];
}

const directory = ".cache/update";
const baseDirectory = join(directory, "base");
const beforeDatabase = join(directory, "before", "precise-furigana.json");
const afterDatabase = "dist/precise-furigana.json";
const lockName = "sources.lock.json";
const synthesizedName = "synthesized-pairs.json";
const outputTailLines = 40;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { release: { type: "string" } },
});
const phase = positionals[0];

function run(script: string, args: string[] = []): StepResult {
  console.log(`\n> npm run ${script}${args.length ? ` -- ${args.join(" ")}` : ""}`);
  const result = spawnSync("npm", ["run", script, "--", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  return {
    passed: result.status === 0,
    output: output.trimEnd().split("\n").slice(-outputTailLines).join("\n"),
  };
}

/** Build the database. A build that only reports problems still writes it, so say whether it did. */
function build(args: string[] = []): BuildResult {
  const started = Date.now();
  const result = run("build", args);
  const wrote = existsSync(afterDatabase) && statSync(afterDatabase).mtimeMs >= started;
  return { ...result, wrote };
}

const readJSON = async <Value>(path: string): Promise<Value> =>
  JSON.parse(await readFile(path, "utf8")) as Value;
const pin = (lock: PinnedLock): DictionaryPin => ({
  tag: lock.release.tag,
  url: lock.release.url,
  date: lock.sources.jmdict.dictDate,
});

async function setOutputs(outputs: Outputs): Promise<void> {
  await writeFile(join(directory, "status.json"), JSON.stringify(outputs, undefined, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .filter(([, value]) => typeof value !== "object")
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
  }
}

/** The data files a dictionary update may need to touch, by name. */
async function dataFiles(): Promise<[name: string, path: string][]> {
  const names = (await readdir("data")).filter((name) => name.endsWith(".json"));
  return [
    ...names.map((name): [string, string] => [name, join("data", name)]),
    ["gold.json", "test/fixtures/gold.json"],
  ];
}

async function baseline(): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(baseDirectory, { recursive: true });
  if (!run("fetch").passed) throw new Error("Could not restore the locked inputs");
  if (!run("build", ["--output", join(directory, "before")]).passed) {
    throw new Error("The tree does not build before the update; fix that first");
  }
  for (const [name, path] of await dataFiles()) await cp(path, join(baseDirectory, name));
}

async function report(build: BuildResult): Promise<void> {
  const validate = build.passed ? run("validate") : { passed: false, output: "" };
  let changes: Change[] = [];
  if (build.wrote) {
    const changesPath = join(directory, "changes.jsonl");
    const compared = run("compare", [beforeDatabase, afterDatabase, "--output", changesPath]);
    if (!compared.passed) throw new Error("Could not compare the databases");
    changes = (await readFile(changesPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Change);
  }
  const otherDataChanges: string[] = [];
  for (const [name, path] of await dataFiles()) {
    if (name === lockName || name === synthesizedName) continue;
    if ((await readFile(path, "utf8")) !== (await readFile(join(baseDirectory, name), "utf8"))) {
      otherDataChanges.push(name);
    }
  }
  const reviewNotesPath = join(directory, "review.md");
  const update: Update = {
    before: pin(await readJSON<PinnedLock>(join(baseDirectory, lockName))),
    after: pin(await readJSON<PinnedLock>(join("data", lockName))),
    ...summarizeChanges(changes),
    synthesized: diffSynthesizedPairs(
      await readJSON<SynthesizedPair[]>(join(baseDirectory, synthesizedName)),
      await readJSON<SynthesizedPair[]>(join("data", synthesizedName)),
    ),
    otherDataChanges,
    compared: build.wrote,
    build,
    validate,
    reviewNotes: existsSync(reviewNotesPath) ? await readFile(reviewNotesPath, "utf8") : "",
  };
  const reasons = reviewReasons(update);
  await writeFile(join(directory, "report.md"), renderReport(update));
  await writeFile(join(directory, "commit-message.txt"), renderCommitMessage(update));
  await setOutputs({ changed: true, clean: reasons.length === 0, reasons });
  console.log(`\n${reasons.length === 0 ? "Clean." : `Needs review:\n- ${reasons.join("\n- ")}`}`);
}

async function update(): Promise<void> {
  const previous = (await readJSON<PinnedLock>(join("data", lockName))).release.tag;
  const fetched = run("fetch", [
    "--update",
    ...(values.release ? ["--release", values.release] : []),
  ]);
  if (!fetched.passed) throw new Error("Could not move the dictionary pin");
  if ((await readJSON<PinnedLock>(join("data", lockName))).release.tag === previous) {
    console.log(`\nAlready at ${previous}; nothing to update.`);
    await setOutputs({ changed: false, clean: true, reasons: [] });
    return;
  }
  let result = build();
  if (!result.passed) {
    // Drop synthesized pairs JMdict now has and add the ones new spellings need, then try again.
    build(["--update-synthesized-pairs"]);
    result = build();
  }
  await report(result);
}

if (phase === "baseline") await baseline();
else if (phase === "update") await update();
else if (phase === "recheck") await report(build());
else throw new Error("Usage: node scripts/update.ts <baseline|update|recheck> [--release <tag>]");
