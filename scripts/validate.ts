import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
  compileAnnotations,
  defaultConfiguration,
  digest,
  generatorDigest,
  schemaVersion,
} from "../src/dataset.ts";
import { pairKey, recordKey } from "../src/segments.ts";
import { deriveOmittedParticles } from "../src/variants.ts";
import { validateDisplayAlignment } from "../src/display.ts";
import { contradictionKind, contradictsSpelling } from "../src/pairings.ts";
import type { MispairedPair, SynthesizedPair } from "../src/pairings.ts";
import { enumeratePairs, loadSources, makeCharacterReadings } from "../src/sources.ts";
import { isSilentPunctuation, splitGraphemes } from "../src/kana.ts";
import {
  companionFiles,
  databaseFile,
  parseDatabaseVersion,
  releaseFiles,
} from "./lib/database-files.ts";
import type { Database } from "../src/types.ts";
import type { Manifest } from "./lib/database-files.ts";
import type { Evaluation } from "./lib/evaluation.ts";
import { extractZIPMember } from "./lib/zip.ts";

const { values } = parseArgs({ options: { directory: { type: "string", default: "dist" } } });
const bytes = await readFile(join(values.directory, databaseFile));
const output: Database = JSON.parse(bytes.toString("utf8"));
// Node gives a CommonJS module's `module.exports` as its default import. For these two packages
// that is the class and the function themselves, but their declarations only describe `default`.
const matchesSchema = (addFormats as unknown as typeof addFormats.default)(
  new (Ajv as unknown as typeof Ajv.default)(),
).compile(JSON.parse(await readFile(new URL("../schema.json", import.meta.url), "utf8")));
assert.ok(
  matchesSchema(output),
  `Output does not match schema.json: ${JSON.stringify(matchesSchema.errors?.slice(0, 3))}`,
);
assert.equal(output.schemaVersion, schemaVersion);
// Both published files hold exactly this database, and the archive holds its companions as they
// are in the repository.
const archive = await readFile(join(values.directory, releaseFiles[0]));
assert.deepEqual(extractZIPMember(archive, databaseFile), bytes);
for (const name of companionFiles) {
  assert.deepEqual(
    extractZIPMember(archive, name),
    await readFile(new URL(`../${name}`, import.meta.url)),
    `${name} in the archive`,
  );
}
assert.deepEqual(
  zstdDecompressSync(await readFile(join(values.directory, releaseFiles[1]))),
  bytes,
);
const manifest: Manifest = JSON.parse(
  await readFile(join(values.directory, "manifest.json"), "utf8"),
);
for (const [name, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(join(values.directory, name));
  assert.equal(contents.length, expected.bytes, `${name}: size`);
  assert.equal(digest(contents), expected.sha256, `${name}: SHA256`);
}
// Validation needs the input population and provenance, not a rebuilt aligner.
const { jmdict, kanjidic, lock } = await loadSources();
const { drops } = deriveOmittedParticles(jmdict, makeCharacterReadings(kanjidic));
const annotationsText = await readFile(
  new URL("../data/annotations.json", import.meta.url),
  "utf8",
);
const synthesized = new Map(
  (
    JSON.parse(
      await readFile(new URL("../data/synthesized-pairs.json", import.meta.url), "utf8"),
    ) as SynthesizedPair[]
  ).map((item): [string, SynthesizedPair] => [
    recordKey(item.id, item.spelling, item.reading),
    item,
  ]),
);
const mispaired = new Map(
  (
    JSON.parse(
      await readFile(new URL("../data/mispaired-pairs.json", import.meta.url), "utf8"),
    ) as MispairedPair[]
  ).map((item): [string, MispairedPair] => [recordKey(item.id, item.spelling, item.reading), item]),
);
const annotations = compileAnnotations(JSON.parse(annotationsText));
assert.deepEqual(Object.keys(output), ["version", "schemaVersion", "jmdictDate", "entries"]);
assert.equal(
  output.jmdictDate,
  lock.sources.jmdict.dictDate,
  "Output uses the locked input release",
);
// The version restates the schema version and dictionary date, and adds the release's revision.
assert.equal(manifest.version, output.version);
assert.deepEqual(
  { ...parseDatabaseVersion(output.version), revision: undefined },
  { schemaVersion, jmdictDate: output.jmdictDate, revision: undefined },
);
// The manifest binds the evaluation to this database; its provenance records the build inputs.
const { provenance } = JSON.parse(
  await readFile(join(values.directory, "evaluation.json"), "utf8"),
) as Evaluation;
assert.ok(manifest.files["evaluation.json"], "The manifest covers the evaluation");
assert.equal(
  provenance.generatorSHA256,
  await generatorDigest(),
  "Output uses the current generator code",
);
assert.deepEqual(provenance.configuration, {
  ...defaultConfiguration,
  ...provenance.configuration,
});
assert.equal(
  provenance.sourcesSHA256,
  digest(JSON.stringify(lock)),
  "Output uses the locked input release",
);
assert.equal(provenance.annotationsSHA256, digest(annotationsText));
const jmdictPairs = new Map(
  [...enumeratePairs(jmdict)].map((pair) => [
    recordKey(pair.id, pair.spelling, pair.reading),
    pair,
  ]),
);
const expected = new Set(jmdictPairs.keys());
const siblingReadings = Map.groupBy(
  [...jmdictPairs.values()].filter((pair) => !pair.readingTags.includes("sk")),
  (pair) => `${pair.id}\t${pair.spelling}`,
);
for (const key of annotations.keys())
  assert.ok(
    expected.has(key) || synthesized.has(key),
    `Stale annotation absent from source dictionary: ${key}`,
  );
let count = 0,
  synthesizedCount = 0;
const fitting = new Set<string>(),
  spellings = new Set<string>(),
  keys = new Set<string>();
// The position of each spelling's latest record: its JMdict reading index, or Infinity once synthesized.
const lastPosition = new Map<string, number | undefined>();
// A pair that several entries share has the same segments in each, so consumers can look one up without an ID.
const pairSegments = new Map<string, string>();
for (const [id, records] of Object.entries(output.entries)) {
  assert.ok(/^\d+$/u.test(id));
  assert.ok(records.length > 0);
  for (const record of records) {
    const key = recordKey(id, record.spelling, record.reading);
    assert.ok(!keys.has(key), `Two records share an ID, spelling, and reading: ${key}`);
    keys.add(key);
    const pair = pairKey(record.spelling, record.reading);
    const segments = JSON.stringify(record.segments);
    assert.equal(
      pairSegments.get(pair) ?? segments,
      segments,
      `Entries disagree on the segments of one spelling and reading: ${key}`,
    );
    pairSegments.set(pair, segments);
    validateDisplayAlignment(record.spelling, record.reading, record.segments);
    // Punctuation is never read, so outside a mispaired pair no ruby text holds any.
    if (record.pairing !== "mispaired") {
      for (const segment of record.segments) {
        assert.ok(
          typeof segment === "string" || !splitGraphemes(segment[1]).some(isSilentPunctuation),
          `Punctuation in ruby text: ${key}`,
        );
      }
    }
    spellings.add(`${id}\t${record.spelling}`);
    const position =
      record.pairing === "synthesized" ? Infinity : jmdictPairs.get(key)?.readingIndex;
    const previousPosition = lastPosition.get(`${id}\t${record.spelling}`);
    assert.ok(
      // A record that JMdict lacks has no position, and a spelling's first record has none before
      // it. Either way there is nothing to compare.
      position === undefined || previousPosition === undefined || position >= previousPosition,
      `Records for a spelling are out of JMdict reading order: ${key}`,
    );
    lastPosition.set(`${id}\t${record.spelling}`, position);
    if (record.pairing === "synthesized") {
      assert.deepEqual(Object.keys(record), ["spelling", "reading", "segments", "pairing"]);
      assert.ok(
        synthesized.delete(key) && !expected.has(key),
        `Synthesized pair is not a reviewed, non-JMdict pair: ${key}`,
      );
      assert.ok(
        !contradictsSpelling(record.spelling, record.reading, undefined, record.segments),
        `Synthesized pair does not fit its spelling: ${key}`,
      );
      fitting.add(`${id}\t${record.spelling}`);
      ++synthesizedCount;
      continue;
    }
    assert.ok(expected.delete(key), `Unexpected or duplicated pair: ${key}`);
    const recordDrops = drops.get(pairKey(record.spelling, record.reading));
    const kind = contradictionKind(
      record.spelling,
      record.reading,
      recordDrops,
      record.segments,
      (siblingReadings.get(`${id}\t${record.spelling}`) ?? []).map((sibling) => sibling.reading),
    );
    // A reviewed mispaired pair is one the rules cannot see; a pair they do see needs no listing.
    const listed = mispaired.delete(key);
    assert.ok(!listed || kind === undefined, `Mispaired pair is already marked by rule: ${key}`);
    const pairing = listed ? "mispaired" : kind;
    assert.deepEqual(
      Object.keys(record),
      pairing === undefined
        ? ["spelling", "reading", "segments"]
        : ["spelling", "reading", "segments", "pairing"],
    );
    assert.equal(record.pairing, pairing);
    if (pairing === undefined) fitting.add(`${id}\t${record.spelling}`);
    ++count;
  }
}
assert.equal(expected.size, 0, "Every permitted JMdict spelling/reading pair is present");
assert.equal(mispaired.size, 0, "Every reviewed mispaired pair marks a JMdict pair");
assert.equal(
  synthesized.size,
  0,
  `Every reviewed synthesized pair is present: ${[...synthesized.keys()].join(", ")}`,
);
for (const spelling of spellings)
  assert.ok(fitting.has(spelling), `No pair fits the spelling: ${spelling}`);
assert.equal(count, manifest.counts.pairs);
assert.equal(synthesizedCount, manifest.counts.synthesized);
assert.equal(Object.keys(output.entries).length, manifest.counts.entries);
console.log(
  `Validated ${count} pairs across ${Object.keys(output.entries).length} JMdict entries, spelling reconstruction, reading coverage, input provenance, both published files, and artifact checksums.`,
);
