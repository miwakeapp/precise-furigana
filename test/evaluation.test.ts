import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfiguration } from "../src/dataset.ts";
import { evaluateDataset } from "../scripts/lib/evaluation.ts";
import { parseGeneratorOptions } from "../scripts/lib/options.ts";

test("build and evaluation defaults match the release configuration", () => {
  assert.deepEqual(parseGeneratorOptions("dist", []).configuration, defaultConfiguration);
  const { output, configuration } = parseGeneratorOptions("dist", [
    "--output",
    "experiment",
    "--no-phonology",
    "--no-variants",
  ]);
  assert.equal(output, "experiment");
  assert.equal(configuration.phonologicalAlternations, false);
  assert.equal(configuration.compoundVoicing, false);
  assert.equal(configuration.variantTransfers, false);
  assert.throws(() => parseGeneratorOptions("dist", ["--unknown"]));
});

test("regressions exercise the generator without exact annotations masking errors", async () => {
  const segments = [
    ["日", "に"],
    ["本", "ほん"],
  ];
  const goldText = JSON.stringify([{ spelling: "日本", reading: "にほん", segments }]);
  const dataset = {
    lock: {},
    configuration: defaultConfiguration,
    annotationsSHA256: "annotations",
    align: () => ({ segments: [["日本", "にほん"]], status: "aligned" }),
    alignPair: () => {
      throw new Error("Annotations must not be applied");
    },
  };
  const failed = await evaluateDataset(dataset, goldText);
  assert.equal(failed.summary.passed, 0);
  assert.equal(failed.summary.falseNegative, 1);
  dataset.align = () => ({ segments, status: "aligned" });
  assert.equal((await evaluateDataset(dataset, goldText)).summary.passed, 1);
});
