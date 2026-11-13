import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAligner } from "./align.mjs";
import { loadSources, enumeratePairs, makeCharacterReadings, makeWordReadings, makeIrregularWordReadings } from "./sources.mjs";
import { boundaries, combineAlignments, pairKey, recordKey, segmentReading, segmentText, validateAlignment } from "./segments.mjs";
import { deriveCharacterReadings } from "./lexicon.mjs";
import { deriveVariantAlignments } from "./variants.mjs";
import { deriveContinuativeReadings } from "./morphology.mjs";
import { deriveWeakReadings, refineAlignment } from "./weak-readings.mjs";
import { deriveNumeralAlignments, deriveNumeralReadings } from "./numerals.mjs";
import { deriveReadingVariantAlignments } from "./reading-variants.mjs";
import { deriveAtejiAlignments } from "./ateji.mjs";
import { deriveLoanAlignments } from "./loan-readings.mjs";
import { deriveUnihanAlignments, parseUnihanReadings } from "./unihan.mjs";
import { deriveCharacterBundleAlignments } from "./character-readings.mjs";
import { compileLexicalEvidence, refineWithLexicalEvidence } from "./lexical-evidence.mjs";
import { deriveNativeCompoundAlignments } from "./native-compounds.mjs";
import { deriveListedPhonologyAlignments } from "./listed-phonology.mjs";
import { deriveKoreanAlignments } from "./korean-readings.mjs";
import { deriveOnReadingSpellingAlignments } from "./on-reading-spelling.mjs";
import { deriveSourceUnitAlignments } from "./source-units.mjs";
import { deriveSeparatorAlignments } from "./separator-alignments.mjs";
import { deriveSharedRunAlignments } from "./shared-run-alignments.mjs";

export const schemaVersion = 2;
export const algorithmVersion = "0.1.0";
export const defaultConfiguration = {
  terminalContraction: true, phonologicalAlternations: true, compoundVoicing: true,
  variantTransfers: true, learnReadings: false, continuativeStems: true,
  weakReadings: true, kanaSubstitutions: true, numeralTransfers: true, readingVariants: true,
  hanSubstitutions: true, kanaRunCorrespondence: true, internalKanaAnchors: true,
  dictionaryUnvoicing: true, phoneticAteji: true, dictionaryRenjo: true, counterSymbols: true,
  latinSubstitutions: true, loanReadings: true, untaggedKatakanaLoans: true,
  dictionaryNasalLoss: true, dictionaryInitialVoicing: true, unihanReadings: true,
  foreignNumerals: true, unihanVoicing: true, unihanYoon: true,
  listedCharacterReadings: true, reviewedLexicalEvidence: true,
  unihanOnLengthening: true, nativeCompounds: true, englishCharacterReadings: true,
  listedPhonology: true, koreanReadings: true, untaggedKatakanaKorean: true,
  onReadingSpelling: true, sourceUnitTransfers: true, separatorTransfers: true, virtualSeparatorSources: true, sharedRunTransfers: true
};

export function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function generatorDigest() {
  const names = (await readdir(new URL("./", import.meta.url))).filter(name => name.endsWith(".mjs")).sort();
  const inputs = [];
  for (const name of names) inputs.push(name, "\0", await readFile(new URL(name, import.meta.url)), "\0");
  for (const name of ["build.mjs", "lib/options.mjs", "lib/evaluation.mjs"]) {
    inputs.push(`scripts/${name}`, "\0", await readFile(new URL(`../scripts/${name}`, import.meta.url)));
  }
  inputs.push("data/lexical-evidence.json", "\0", await readFile(new URL("../data/lexical-evidence.json", import.meta.url)));
  const hash = createHash("sha256");
  for (const input of inputs) hash.update(input);
  return hash.digest("hex");
}

export function compileAnnotations(annotations) {
  const result = new Map();
  for (const annotation of annotations) {
    if (typeof annotation.id !== "string" || !/^\d+$/u.test(annotation.id) ||
      typeof annotation.reason !== "string" || !annotation.reason.trim() ||
      !Array.isArray(annotation.sources) || !annotation.sources.length ||
      annotation.sources.some(source => typeof source !== "string" || !source.trim())) {
      throw new Error("Annotations require a string JMdict ID, rationale, and evidence sources");
    }
    validateAlignment(annotation.written, annotation.reading, annotation.segments);
    const key = recordKey(annotation.id, annotation.written, annotation.reading);
    if (result.has(key)) throw new Error(`Duplicate annotation: ${key}`);
    result.set(key, annotation);
  }
  return result;
}

export function compileAlignmentPipeline(jmdict, kanjidic, options = {}, sources = {}) {
  return compilePipeline(jmdict, kanjidic, options, sources);
}

function cacheAligner(align) {
  const cache = new Map();
  return (written, reading) => {
    const key = pairKey(written, reading);
    if (!cache.has(key)) cache.set(key, align(written, reading));
    return cache.get(key);
  };
}

function mergeLateAlignments(independent, integrated) {
  if (independent === integrated) return integrated;
  const independentPoints = new Set(boundaries(independent.segments));
  const integratedPoints = new Set(boundaries(integrated.segments));
  const shared = new Set([...integratedPoints].filter(point => independentPoints.has(point)));
  function regions(parts) {
    const result = [];
    let writtenOffset = 0, readingOffset = 0, start = 0;
    for (const [index, segment] of parts.entries()) {
      writtenOffset += [...segmentText(segment)].length;
      readingOffset += [...segmentReading(segment)].length;
      if (shared.has(`${writtenOffset}:${readingOffset}`) || index === parts.length - 1) {
        result.push(parts.slice(start, index + 1));
        start = index + 1;
      }
    }
    return result;
  }
  const independentRegions = regions(independent.segments);
  // Keep the lexical-integrated result on conflict within each region. A
  // disagreement cannot discard evidence beyond an agreed boundary anchor.
  const regionContexts = [];
  const segments = regions(integrated.segments).flatMap((region, index) => {
    const candidate = independentRegions[index];
    const merged = combineAlignments(region, candidate);
    regionContexts.push(merged === region ? ["with-lexical-refinement"] :
      merged === candidate ? ["without-lexical-refinement"] : ["with-lexical-refinement", "without-lexical-refinement"]);
    return merged;
  });
  const points = boundaries(segments);
  if (points.length === integratedPoints.size && points.every(point => integratedPoints.has(point))) return integrated;
  if (points.length === independentPoints.size && points.every(point => independentPoints.has(point))) return independent;

  const supportingSpans = [];
  for (const [context, result] of [["without-lexical-refinement", independent], ["with-lexical-refinement", integrated]]) {
    let writtenOffset = 0, readingOffset = 0, regionIndex = 0;
    for (const [index, segment] of result.segments.entries()) {
      const written = segmentText(segment), reading = segmentReading(segment);
      const span = { writtenStart: writtenOffset, readingStart: readingOffset };
      writtenOffset += [...written].length;
      readingOffset += [...reading].length;
      if (regionContexts[regionIndex].includes(context)) supportingSpans.push({ ...span, writtenEnd: writtenOffset, readingEnd: readingOffset,
        evidence: { context, ...(result.evidence?.[index] ?? { written, reading, type: typeof segment === "string" ? "literal" : "dictionary", rules: [] }) } });
      if (shared.has(`${writtenOffset}:${readingOffset}`) || index === result.segments.length - 1) ++regionIndex;
    }
  }
  let writtenOffset = 0, readingOffset = 0;
  const evidence = segments.map(segment => {
    const written = segmentText(segment), reading = segmentReading(segment);
    const writtenEnd = writtenOffset + [...written].length, readingEnd = readingOffset + [...reading].length;
    const supporting = supportingSpans.filter(span => span.writtenStart <= writtenOffset && writtenEnd <= span.writtenEnd &&
      span.readingStart <= readingOffset && readingEnd <= span.readingEnd).map(span => span.evidence);
    writtenOffset = writtenEnd;
    readingOffset = readingEnd;
    return { written, reading, type: typeof segment === "string" ? "literal" : "dictionary",
      rules: [...new Set([...supporting.flatMap(span => span.rules ?? []), "independent-late-evidence-union"])],
      supportingSpans: supporting };
  });
  return { ...integrated, segments, evidence };
}

function mergeLateWitnesses(independent, integrated) {
  if (independent === integrated) return independent;
  const witnesses = new Map();
  for (const [context, records] of [["without-lexical-refinement", independent], ["with-lexical-refinement", integrated]]) {
    for (const witness of records) {
      const key = JSON.stringify(witness);
      const record = witnesses.get(key) ?? { ...witness, lexicalContexts: [] };
      record.lexicalContexts.push(context);
      witnesses.set(key, record);
    }
  }
  return [...witnesses.values()];
}

function compilePipeline(jmdict, kanjidic, options, {
  unihanReadings = new Map(), unihanSource, characterReadingBundle, englishCharacterReadingBundle, lexicalEvidence = [], kanjidicSource, jmdictSource
}, inheritedVariantTargets) {
  const configuration = { ...defaultConfiguration };
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined) configuration[name] = value;
  }
  const facts = configuration.reviewedLexicalEvidence ? compileLexicalEvidence(lexicalEvidence) : [];
  const variantTargets = inheritedVariantTargets ?? new Map();
  if (inheritedVariantTargets === undefined) for (const fact of facts) {
    const readings = variantTargets.get(fact.written) ?? new Map();
    readings.set(fact.reading, fact.segments);
    variantTargets.set(fact.written, readings);
  }
  // The protected pipeline omits late lexical refinement, but must reject
  // the same contradicted transfers before its boundaries become protected.
  const protectedPipeline = configuration.dictionaryNasalLoss || configuration.dictionaryInitialVoicing ?
    compilePipeline(jmdict, kanjidic, {
      ...configuration, dictionaryNasalLoss: false, dictionaryInitialVoicing: false,
      listedCharacterReadings: false, reviewedLexicalEvidence: false,
      unihanOnLengthening: false, nativeCompounds: false, englishCharacterReadings: false,
      listedPhonology: false, koreanReadings: false, onReadingSpelling: false, sourceUnitTransfers: false, separatorTransfers: false, virtualSeparatorSources: false, sharedRunTransfers: false
    }, { unihanReadings }, variantTargets) : undefined;
  const baseReadings = makeCharacterReadings(kanjidic);
  const { characterReadings, additions } = configuration.learnReadings ? deriveCharacterReadings(jmdict, baseReadings) : { characterReadings: baseReadings, additions: [] };
  const alignerOptions = {
    characterReadings,
    wordReadings: makeWordReadings(jmdict),
    irregularWordReadings: makeIrregularWordReadings(jmdict),
    continuativeReadings: configuration.continuativeStems ? deriveContinuativeReadings(jmdict).readings : new Map(),
    ...configuration
  };
  const baseline = createAligner(alignerOptions);
  const { wordAlignments, transfers } = configuration.variantTransfers ? deriveVariantAlignments(jmdict, baseline) : { wordAlignments: new Map(), transfers: [] };
  const strong = createAligner({ ...alignerOptions, wordAlignments });
  const weak = configuration.weakReadings ? deriveWeakReadings(jmdict, kanjidic, characterReadings) : { readings: new Map(), witnesses: [] };
  const supplementaryOptions = { ...alignerOptions, weakCharacterReadings: weak.readings };
  const supplementaryBase = createAligner({ ...supplementaryOptions, wordAlignments });
  const supplementaryVariants = configuration.variantTransfers ? deriveVariantAlignments(jmdict, supplementaryBase, {
    kanaSubstitutions: configuration.kanaSubstitutions,
    hanSubstitutions: configuration.hanSubstitutions,
    counterSymbols: configuration.counterSymbols,
    latinSubstitutions: configuration.latinSubstitutions,
    characterReadings,
    continuativeReadings: alignerOptions.continuativeReadings
  }) : { wordAlignments: new Map(), transfers: [] };
  const supplementary = createAligner({ ...supplementaryOptions, wordAlignments: supplementaryVariants.wordAlignments });
  const refined = (written, reading) => refineAlignment(strong(written, reading), supplementary(written, reading));

  const numeralReadings = configuration.foreignNumerals ? deriveNumeralReadings(jmdict, alignerOptions.wordReadings) : undefined;
  const foreignAlign = numeralReadings === undefined ? undefined : createAligner({
    ...supplementaryOptions, wordReadings: numeralReadings.readings, wordAlignments: supplementaryVariants.wordAlignments
  });
  const numerals = configuration.numeralTransfers ? deriveNumeralAlignments(jmdict, refined, { foreignAlign }) : { wordAlignments: new Map(), witnesses: [] };
  const readingVariants = configuration.readingVariants ? deriveReadingVariantAlignments(jmdict, refined, { targetAlignments: variantTargets }) : { wordAlignments: new Map(), witnesses: [] };
  const ateji = configuration.phoneticAteji ? deriveAtejiAlignments(jmdict, characterReadings, refined) : { wordAlignments: new Map(), witnesses: [] };
  const loans = configuration.loanReadings ? deriveLoanAlignments(jmdict, kanjidic, refined, { untaggedKatakana: configuration.untaggedKatakanaLoans }) : { wordAlignments: new Map(), witnesses: [] };
  const unihan = configuration.unihanReadings ? deriveUnihanAlignments(jmdict, characterReadings, unihanReadings, refined, {
    weakCharacterReadings: weak.readings,
    supplementalVoicing: configuration.unihanVoicing,
    yoonSimplification: configuration.unihanYoon
  }) : { wordAlignments: new Map(), witnesses: [] };
  function withTransfers(initial) {
    const merged = new Map([...initial].map(([written, readings]) => [written, new Map(readings)]));
    const wordAlignmentRules = new Map();
    for (const [source, rule] of [[numerals.wordAlignments, "numeric-or-width-spelling"], [readingVariants.wordAlignments, "attested-reading-variant"], [ateji.wordAlignments, "phonetic-ateji"], [loans.wordAlignments, "attested-loan-sounds"], [unihan.wordAlignments, "unihan-character-evidence"]]) {
      for (const [written, readings] of source) {
        const existing = merged.get(written) ?? new Map();
        for (const [reading, segments] of readings) {
          const previous = existing.get(reading);
          const chosen = previous === undefined ? segments : combineAlignments(previous, segments);
          existing.set(reading, chosen);
          if (chosen !== previous) {
            const rules = wordAlignmentRules.get(written) ?? new Map();
            rules.set(reading, chosen === segments ? [rule] : [...new Set([...(rules.get(reading) ?? ["alternate-spelling"]), rule])]);
            wordAlignmentRules.set(written, rules);
          }
        }
        merged.set(written, existing);
      }
    }
    return { wordAlignments: merged, wordAlignmentRules };
  }
  const finalStrong = createAligner({ ...alignerOptions, ...withTransfers(wordAlignments) });
  const finalSupplementary = createAligner({ ...supplementaryOptions, ...withTransfers(supplementaryVariants.wordAlignments) });
  // Later evidence passes repeatedly query this fixed pipeline. Cache only
  // raw spelling/reading pairs so script-sensitive projections stay distinct.
  const baseCache = new Map();
  const alignBase = (written, reading) => {
    const key = pairKey(written, reading);
    if (baseCache.has(key)) return baseCache.get(key);
    const previous = refined(written, reading);
    const candidate = refineAlignment(finalStrong(written, reading), finalSupplementary(written, reading));
    // A transferred subword can compete with different character readings in
    // a longer input. Preserve the boundaries accepted before those transfers.
    const result = refineAlignment(previous, candidate);
    // Optional weak sound changes can alter the evidence used by spelling
    // transfers. Compare complete pipelines to preserve those earlier bounds.
    const protectedResult = protectedPipeline === undefined ? result : refineAlignment(protectedPipeline.align(written, reading), result);
    baseCache.set(key, protectedResult);
    return protectedResult;
  };
  const listed = configuration.listedCharacterReadings && characterReadingBundle !== undefined ?
    deriveCharacterBundleAlignments(jmdict, characterReadings, characterReadingBundle, alignBase, {
      weakCharacterReadings: weak.readings, unihanReadings: configuration.unihanReadings ? unihanReadings : new Map()
    }) :
    { wordAlignments: new Map(), witnesses: [] };
  function applyRefinement(result, segments, rule) {
    if (segments === undefined) return result;
    const previous = new Map();
    let writtenOffset = 0, readingOffset = 0;
    for (const [index, segment] of result.segments.entries()) {
      const written = segmentText(segment), reading = segmentReading(segment);
      const start = `${writtenOffset}:${readingOffset}`;
      writtenOffset += [...written].length;
      readingOffset += [...reading].length;
      previous.set(`${start}:${writtenOffset}:${readingOffset}`, result.evidence?.[index] ?? {
        written, reading, type: typeof segment === "string" ? "literal" : "dictionary", rules: []
      });
    }
    writtenOffset = 0;
    readingOffset = 0;
    return refineAlignment(result, {
      ...result, segments,
      evidence: segments.map(segment => {
        const written = segmentText(segment), reading = segmentReading(segment);
        const start = `${writtenOffset}:${readingOffset}`;
        writtenOffset += [...written].length;
        readingOffset += [...reading].length;
        return previous.get(`${start}:${writtenOffset}:${readingOffset}`) ?? {
          written, reading, type: typeof segment === "string" ? "literal" : "dictionary", rules: [rule]
        };
      })
    });
  }
  const alignListedCharacters = listed.wordAlignments.size === 0 ? alignBase : cacheAligner((written, reading) => applyRefinement(
    alignBase(written, reading), listed.wordAlignments.get(written)?.get(reading), "listed-character-evidence"
  ));
  const alignReviewed = facts.length === 0 ? alignListedCharacters : cacheAligner((written, reading) =>
    refineWithLexicalEvidence(alignListedCharacters(written, reading), facts)
  );
  const englishCompanions = new Map([...(configuration.unihanReadings ? unihanReadings : new Map())].map(([character, readings]) => [character, [...readings]]));
  for (const { character, reading } of configuration.listedCharacterReadings ? characterReadingBundle?.readings ?? [] : []) {
    const readings = englishCompanions.get(character) ?? [];
    if (!readings.includes(reading)) readings.push(reading);
    englishCompanions.set(character, readings);
  }
  function compileLateSequence(initialAlign) {
    // These refinements use the complete earlier pipeline and remain local to
    // exact dictionary pairs. Their inferred sounds cannot enter subword transfers.
    const lengthened = configuration.unihanReadings && configuration.unihanOnLengthening ?
      deriveUnihanAlignments(jmdict, characterReadings, unihanReadings, initialAlign, {
        weakCharacterReadings: weak.readings,
        supplementalVoicing: configuration.unihanVoicing,
        yoonSimplification: configuration.unihanYoon,
        onLengthening: true
      }) : { wordAlignments: new Map(), witnesses: [] };
    const alignLengthened = (written, reading) => applyRefinement(
      initialAlign(written, reading), lengthened.wordAlignments.get(written)?.get(reading), "unihan-final-character-evidence"
    );
    const native = configuration.nativeCompounds ? deriveNativeCompoundAlignments(jmdict, characterReadings, alignLengthened, {
      weakCharacterReadings: weak.readings,
      unihanReadings: configuration.unihanReadings ? unihanReadings : new Map(),
      characterReadingBundle: configuration.listedCharacterReadings ? characterReadingBundle : undefined
    }) : { wordAlignments: new Map(), witnesses: [] };
    const alignNative = (written, reading) => applyRefinement(
      alignLengthened(written, reading), native.wordAlignments.get(written)?.get(reading), "attested-native-final-mora-contraction"
    );
    const english = configuration.englishCharacterReadings && englishCharacterReadingBundle !== undefined ?
      deriveCharacterBundleAlignments(jmdict, characterReadings, englishCharacterReadingBundle, alignNative, {
        weakCharacterReadings: weak.readings, unihanReadings: englishCompanions
      }) : { wordAlignments: new Map(), witnesses: [] };
    const alignEnglish = (written, reading) => applyRefinement(
      alignNative(written, reading), english.wordAlignments.get(written)?.get(reading), "english-listed-character-evidence"
    );
    const listedPhonology = configuration.listedPhonology ? deriveListedPhonologyAlignments(jmdict, characterReadings, alignEnglish, {
      weakCharacterReadings: weak.readings,
      kanjidic, kanjidicSource, jmdictSource, weakWitnesses: weak.witnesses, lexicalFacts: facts,
      loanReadings: configuration.loanReadings, koreanReadings: configuration.koreanReadings,
      unihanReadings: configuration.unihanReadings ? unihanReadings : new Map(),
      unihanSource: configuration.unihanReadings ? unihanSource : undefined,
      characterReadingBundle: configuration.listedCharacterReadings ? characterReadingBundle : undefined,
      englishCharacterReadingBundle: configuration.englishCharacterReadings ? englishCharacterReadingBundle : undefined,
      supplementalVoicing: configuration.unihanVoicing,
      yoonSimplification: configuration.unihanYoon,
      onLengthening: configuration.unihanOnLengthening
    }) : { wordAlignments: new Map(), witnesses: [] };
    const alignListed = (written, reading) => applyRefinement(
      alignEnglish(written, reading), listedPhonology.wordAlignments.get(written)?.get(reading), "listed-reading-sound-correspondence"
    );
    const korean = configuration.koreanReadings ? deriveKoreanAlignments(jmdict, kanjidic, alignListed, {
      untaggedKatakana: configuration.untaggedKatakanaKorean, kanjidicSource
    }) : { wordAlignments: new Map(), witnesses: [] };
    const alignKorean = (written, reading) => applyRefinement(
      alignListed(written, reading), korean.wordAlignments.get(written)?.get(reading), "listed-korean-sound-compatibility"
    );
    const onSpelling = configuration.onReadingSpelling ? deriveOnReadingSpellingAlignments(jmdict, kanjidic, alignKorean, {
      characterReadingBundle: configuration.listedCharacterReadings ? characterReadingBundle : undefined,
      englishCharacterReadingBundle: configuration.englishCharacterReadings ? englishCharacterReadingBundle : undefined,
      kanjidicSource
    }) : { wordAlignments: new Map(), witnesses: [] };
    const align = (written, reading) => applyRefinement(
      alignKorean(written, reading), onSpelling.wordAlignments.get(written)?.get(reading), "on-long-vowel-notation-equivalence"
    );
    return { lengthened, native, english, listedPhonology, korean, onSpelling, align };
  }
  // Both paths share the expensive base, source inventories and the same
  // reviewed variant-transfer veto. A new coarse lexical cut must not remove
  // the witness that allowed another late pass to establish finer boundaries.
  const independentLate = compileLateSequence(alignListedCharacters);
  const integratedLate = facts.length === 0 ? independentLate : compileLateSequence(alignReviewed);
  const alignLate = facts.length === 0 ? independentLate.align : (written, reading) => mergeLateAlignments(
    independentLate.align(written, reading), integratedLate.align(written, reading)
  );
  const sourceUnits = configuration.sourceUnitTransfers ? deriveSourceUnitAlignments(jmdict, kanjidic, alignLate, {
    unihanReadings: configuration.unihanReadings ? unihanReadings : new Map(),
    unihanSource: configuration.unihanReadings ? unihanSource : undefined,
    characterReadingBundle: configuration.listedCharacterReadings ? characterReadingBundle : undefined,
    englishCharacterReadingBundle: configuration.englishCharacterReadings ? englishCharacterReadingBundle : undefined,
    kanjidicSource, lexicalEvidence: facts, weakReadings: configuration.weakReadings,
    listedPhonology: configuration.listedPhonology, nativeCompounds: configuration.nativeCompounds,
    koreanReadings: configuration.koreanReadings, untaggedKatakanaKorean: configuration.untaggedKatakanaKorean,
    onReadingSpelling: configuration.onReadingSpelling, supplementalVoicing: configuration.unihanVoicing,
    yoonSimplification: configuration.unihanYoon, onLengthening: configuration.unihanOnLengthening
  }) : { wordAlignments: new Map(), witnesses: [] };
  const alignUnits = sourceUnits.wordAlignments.size === 0 ? alignLate : (written, reading) => applyRefinement(
    alignLate(written, reading), sourceUnits.wordAlignments.get(written)?.get(reading), "independently-supported-word-unit"
  );
  const separators = configuration.separatorTransfers ? deriveSeparatorAlignments(jmdict, kanjidic, alignUnits, {
    jmdictSource, kanjidicSource, allowVirtualSources: configuration.virtualSeparatorSources,
    // Optional dictionary sound inferences stay disabled in this independent
    // raw source aligner, matching the reviewed separator-transfer experiment.
    rawAlignerOptions: {
      phonologicalAlternations: configuration.phonologicalAlternations,
      terminalContraction: configuration.terminalContraction,
      compoundVoicing: configuration.compoundVoicing,
      kanaRunCorrespondence: configuration.kanaRunCorrespondence,
      internalKanaAnchors: configuration.internalKanaAnchors
    }
  }) : { wordAlignments: new Map(), witnesses: [] };
  const alignSeparators = separators.wordAlignments.size === 0 ? alignUnits : (written, reading) => applyRefinement(
    alignUnits(written, reading), separators.wordAlignments.get(written)?.get(reading), "separator-spelling-evidence"
  );
  const sharedRuns = configuration.variantTransfers && configuration.sharedRunTransfers ? deriveSharedRunAlignments(jmdict, kanjidic, alignSeparators, {
    reviewedFacts: facts, jmdictSource, kanjidicSource,
    rawAlignerOptions: {
      phonologicalAlternations: configuration.phonologicalAlternations,
      terminalContraction: configuration.terminalContraction,
      compoundVoicing: configuration.compoundVoicing,
      kanaRunCorrespondence: configuration.kanaRunCorrespondence,
      internalKanaAnchors: configuration.internalKanaAnchors
    }
  }) : { wordAlignments: new Map(), witnesses: [] };
  const align = sharedRuns.wordAlignments.size === 0 ? alignSeparators : (written, reading) => applyRefinement(
    alignSeparators(written, reading), sharedRuns.wordAlignments.get(written)?.get(reading), "same-entry-shared-run"
  );
  const lateWitnesses = name => mergeLateWitnesses(independentLate[name].witnesses, integratedLate[name].witnesses);
  return {
    configuration,
    learnedReadings: additions,
    variantTransfers: transfers,
    supplementaryVariants: supplementaryVariants.transfers,
    weakReadings: weak.witnesses,
    numeralTransfers: numerals.witnesses,
    numeralReadings: numeralReadings?.witnesses ?? [],
    readingVariants: readingVariants.witnesses,
    phoneticAteji: ateji.witnesses,
    loanReadings: loans.witnesses,
    unihanReadings: unihan.witnesses,
    listedCharacterReadings: listed.witnesses,
    lexicalEvidence: facts,
    unihanOnLengthening: lateWitnesses("lengthened"),
    nativeCompounds: lateWitnesses("native"),
    englishCharacterReadings: lateWitnesses("english"),
    listedPhonology: lateWitnesses("listedPhonology"),
    koreanReadings: lateWitnesses("korean"),
    onReadingSpelling: lateWitnesses("onSpelling"),
    sourceUnitTransfers: sourceUnits.witnesses,
    separatorTransfers: separators.witnesses,
    sharedRunTransfers: sharedRuns.witnesses,
    align
  };
}

export async function loadDataset(options = {}) {
  const { jmdict, kanjidic, unihanText, characterReadingBundle, englishCharacterReadingBundle, lock } = await loadSources();
  const annotationsText = await readFile(new URL("../data/annotations.json", import.meta.url), "utf8");
  const annotations = compileAnnotations(JSON.parse(annotationsText));
  const lexicalBundle = JSON.parse(await readFile(new URL("../data/lexical-evidence.json", import.meta.url), "utf8"));
  if (lexicalBundle.schemaVersion !== 2) throw new Error("Unsupported lexical evidence schema");
  const pipeline = compileAlignmentPipeline(jmdict, kanjidic, options, {
    unihanReadings: unihanText === undefined ? new Map() : parseUnihanReadings(unihanText),
    unihanSource: lock.lexicalSources?.unihan,
    characterReadingBundle, englishCharacterReadingBundle, lexicalEvidence: lexicalBundle.facts,
    kanjidicSource: lock.sources.kanjidic, jmdictSource: lock.sources.jmdict
  });
  return {
    ...pipeline,
    jmdict,
    lock,
    annotations,
    annotationsSHA256: digest(annotationsText),
    pairs: () => enumeratePairs(jmdict),
    alignPair(pair) {
      const annotation = annotations.get(recordKey(pair.id, pair.written, pair.reading));
      const result = annotation ? { segments: annotation.segments, status: "reviewed" } : pipeline.align(pair.written, pair.reading);
      validateAlignment(pair.written, pair.reading, result.segments);
      return result;
    }
  };
}

export async function evaluationProvenance(dataset, goldText) {
  return {
    algorithmVersion,
    generatorSHA256: await generatorDigest(),
    sourcesSHA256: digest(JSON.stringify(dataset.lock)),
    annotationsSHA256: dataset.annotationsSHA256,
    configuration: dataset.configuration,
    goldSHA256: digest(goldText)
  };
}
