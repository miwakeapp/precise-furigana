import { parseArgs } from "node:util";
import type { Configuration } from "../../src/dataset.ts";

// Keep build and standalone evaluation on the same configuration.
const switches = {
  "no-contraction": "terminalContraction",
  "no-phonology": "phonologicalAlternations",
  "no-variants": "variantTransfers",
  "no-compound-voicing": "compoundVoicing",
  "no-continuatives": "continuativeStems",
  "no-weak-readings": "weakReadings",
  "no-kana-substitutions": "kanaSubstitutions",
  "no-numerals": "numeralTransfers",
  "no-reading-variants": "readingVariants",
  "no-kana-correspondence": "kanaRunCorrespondence",
  "no-internal-anchors": "internalKanaAnchors",
  "no-han-substitutions": "hanSubstitutions",
  "no-unvoicing": "dictionaryUnvoicing",
  "no-renjo": "dictionaryRenjo",
  "no-phonetic-ateji": "phoneticAteji",
  "no-counter-symbols": "counterSymbols",
  "no-latin-substitutions": "latinSubstitutions",
  "no-loan-readings": "loanReadings",
  "no-untagged-katakana-loans": "untaggedKatakanaLoans",
  "no-nasal-loss": "dictionaryNasalLoss",
  "no-initial-voicing": "dictionaryInitialVoicing",
  "no-unihan-readings": "unihanReadings",
  "no-foreign-numerals": "foreignNumerals",
  "no-unihan-voicing": "unihanVoicing",
  "no-unihan-yoon": "unihanYoon",
  "no-listed-character-readings": "listedCharacterReadings",
  "no-reviewed-lexical-evidence": "reviewedLexicalEvidence",
  "no-unihan-on-lengthening": "unihanOnLengthening",
  "no-english-character-readings": "englishCharacterReadings",
  "no-listed-phonology": "listedPhonology",
  "no-korean-readings": "koreanReadings",
  "no-untagged-katakana-korean": "untaggedKatakanaKorean",
  "no-on-reading-spelling": "onReadingSpelling",
  "no-shared-run-transfers": "sharedRunTransfers",
  "no-late-sibling-transfers": "lateSiblingTransfers",
} as const;

type Switch = keyof typeof switches;

export interface GeneratorOptions {
  output: string;
  configuration: Configuration;
  updateSynthesizedPairs: boolean;
}

export function parseGeneratorOptions(
  defaultOutput: string,
  args: string[] = process.argv.slice(2),
): GeneratorOptions {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: "string", default: defaultOutput },
      "update-synthesized-pairs": { type: "boolean", default: false },
      ...(Object.fromEntries(
        Object.keys(switches).map((name) => [name, { type: "boolean", default: false }]),
      ) as Record<Switch, { type: "boolean"; default: false }>),
    },
  });
  const configuration = Object.fromEntries(
    Object.entries(switches).map(([flag, name]) => [name, !values[flag as Switch]]),
  ) as Configuration;
  configuration.compoundVoicing &&= configuration.phonologicalAlternations;
  return {
    output: values.output,
    configuration,
    updateSynthesizedPairs: values["update-synthesized-pairs"],
  };
}
