import {
  alignKanaPronunciations,
  getKanaVowels,
  isIdeograph,
  isKana,
  kanaPronunciation,
  normalizeKana,
  readingStem,
  splitGraphemes,
} from "./kana.ts";
import type { Alignment, Evidence, ReadingMap, Segment, WordAlignments } from "./types.ts";

export interface AlignerOptions {
  /** Each character's readings in KANJIDIC notation. */
  characterReadings: ReadingMap;
  wordReadings?: ReadingMap;
  wordAlignments?: WordAlignments;
  /** Spelling, then reading, to the rules recorded for that word alignment. */
  wordAlignmentRules?: Map<string, Map<string, string[]>>;
  continuativeReadings?: ReadingMap;
  weakCharacterReadings?: ReadingMap;
  irregularWordReadings?: ReadingMap;
  phonologicalAlternations?: boolean;
  terminalContraction?: boolean;
  compoundVoicing?: boolean;
  kanaRunCorrespondence?: boolean;
  internalKanaAnchors?: boolean;
  dictionaryUnvoicing?: boolean;
  dictionaryRenjo?: boolean;
  dictionaryNasalLoss?: boolean;
  dictionaryInitialVoicing?: boolean;
}

/** What an aligner from `createAligner()` returns: an alignment with every detail present. */
export type DetailedAlignment = Required<Alignment>;

type Score = DetailedAlignment["score"];

/** One segment of a supplied word alignment, prepared for matching. */
interface CompiledPart {
  spellingLength: number;
  reading: string;
  literal: boolean;
}

/** One reading of a supplied word alignment, prepared for matching. */
interface CompiledVariant {
  reading: string;
  rules: string[];
  parts: CompiledPart[];
}

interface AlignmentCandidate extends CompiledVariant {
  cost: number;
  phonologicalRules: string[];
}

/** A span of the spelling, in graphemes, and the span of the reading it is matched with. */
interface MatchedRange {
  start: number;
  end: number;
  readStart: number;
  readEnd: number;
}

/** A group of characters that a word supports reading together, from a given starting point. */
interface DictionaryEdge {
  end: number;
  readEnd: number;
  rules: string[];
  cost: number;
  type: string | undefined;
}

/** A reading one character could take at one position. */
interface CharacterCandidate {
  text: string;
  cost: number;
  rules: string[];
  type?: string;
}

interface PathEdge {
  sourceId: number;
  destinationId: number;
  type: string;
  rules: string[];
}

/** The best score found for reaching one position, and every edge that achieves it. */
interface PathNode extends Score {
  incoming: PathEdge[];
}

const voicedInitials = new Map<string, string>(
  Array.from("かきくけこさしすせそたちつてとはひふへほ").map((character, index) => [
    character,
    Array.from("がぎぐげござじずぜぞだぢづでどばびぶべぼ")[index],
  ]),
);
const plosiveInitials = new Map<string, string>(
  Array.from("はひふへほ").map((character, index) => [character, Array.from("ぱぴぷぺぽ")[index]]),
);
const unvoicedInitials = new Map<string, string>(
  [...voicedInitials].map(([unvoiced, voiced]) => [voiced, unvoiced]),
);
const nasalInitials = new Map<string, string>(
  Array.from("あいうえお").map((character, index) => [character, Array.from("なにぬねの")[index]]),
);
const geminateInitials = /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u;
const removableFinals = /[ちつ]$/u;
const sokuonFinals = /[くきちつう]$/u;

function compareScore(left: Score, right: Score): number {
  return left.unknownCharacters - right.unknownCharacters || left.cost - right.cost;
}

function dictionaryEdgeCost(spellingLength: number): number {
  return spellingLength === 1 ? 1 : 20 * (spellingLength - 1);
}

function compileWordAlignments(
  wordAlignments: WordAlignments,
  wordAlignmentRules: Map<string, Map<string, string[]>>,
): Map<string, CompiledVariant[]> {
  const compiled = new Map<string, CompiledVariant[]>();
  for (const [spelling, readings] of wordAlignments) {
    const variants: CompiledVariant[] = [];
    for (const [reading, segments] of readings) {
      const parts = segments.map((segment) =>
        typeof segment === "string"
          ? { spelling: segment, reading: segment }
          : { spelling: segment[0], reading: segment[1] },
      );
      if (
        parts.map((part) => part.spelling).join("") !== spelling ||
        parts.map((part) => part.reading).join("") !== reading
      ) {
        throw new TypeError(
          `wordAlignments projections do not match ${JSON.stringify([spelling, reading])}`,
        );
      }
      if (parts.some((part) => !part.spelling || !part.reading)) {
        throw new TypeError("wordAlignments segments must have nonempty spelling and reading text");
      }
      variants.push({
        reading: normalizeKana(reading),
        rules:
          wordAlignmentRules.get(spelling)?.get(reading) === undefined
            ? ["alternate-spelling"]
            : [...wordAlignmentRules.get(spelling)!.get(reading)!],
        parts: parts.map((part) => ({
          spellingLength: splitGraphemes(part.spelling).length,
          reading: normalizeKana(part.reading),
          literal: normalizeKana(part.spelling) === normalizeKana(part.reading),
        })),
      });
    }
    if (spelling) compiled.set(spelling, variants);
  }
  return compiled;
}

function readingIndex(reading: string) {
  const units = splitGraphemes(reading);
  const offsets = [0];
  let normalized = "";
  for (const unit of units) {
    normalized += normalizeKana(unit);
    offsets.push(normalized.length);
  }
  const ends = new Map(offsets.map((offset, index) => [offset, index]));
  return {
    units,
    normalized,
    offsets,
    match(start: number, candidate: string): number | undefined {
      const offset = offsets[start];
      if (!normalized.startsWith(candidate, offset)) return undefined;
      return ends.get(offset + candidate.length);
    },
    matchEnd(end: number, candidate: string): number | undefined {
      const offset = offsets[end] - candidate.length;
      if (offset < 0 || !normalized.startsWith(candidate, offset)) return undefined;
      return ends.get(offset);
    },
  };
}

function stripVariationSelectors(text: string): string {
  return text.replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "");
}

function mergeOutput(parts: Evidence[]): { segments: Segment[]; evidence: Evidence[] } {
  const segments: Segment[] = [];
  const evidence: Evidence[] = [];
  for (const part of parts) {
    const plain = part.spelling === part.reading;
    const previous = evidence.at(-1);
    const merge =
      previous &&
      ((plain && typeof segments.at(-1) === "string") ||
        (!plain &&
          Array.isArray(segments.at(-1)) &&
          part.type === "literal" &&
          previous.type === "literal") ||
        (!plain &&
          Array.isArray(segments.at(-1)) &&
          part.type === "fallback" &&
          previous.type === "fallback"));
    if (merge) {
      previous.spelling += part.spelling;
      previous.reading += part.reading;
      previous.rules = [...new Set([...previous.rules, ...part.rules])];
      if (plain) segments[segments.length - 1] += part.spelling;
      else segments[segments.length - 1] = [previous.spelling, previous.reading];
    } else {
      segments.push(plain ? part.spelling : [part.spelling, part.reading]);
      evidence.push({ ...part });
    }
  }
  return { segments, evidence };
}

/**
 * Construct an aligner from caller-supplied, licensed character and word readings.
 * Character readings retain KANJIDIC notation: katakana on readings, hiragana
 * kun readings, and dots marking okurigana. Only on readings may contract.
 * `aligned` describes support from this model, not a certification of correctness.
 * Equal-cost paths retain only boundaries shared by every best alignment.
 */
export function createAligner({
  characterReadings,
  wordReadings = new Map(),
  wordAlignments = new Map(),
  wordAlignmentRules = new Map(),
  continuativeReadings = new Map(),
  weakCharacterReadings = new Map(),
  irregularWordReadings = new Map(),
  phonologicalAlternations = true,
  terminalContraction = true,
  compoundVoicing = true,
  kanaRunCorrespondence = true,
  internalKanaAnchors = true,
  dictionaryUnvoicing = false,
  dictionaryRenjo = false,
  dictionaryNasalLoss = false,
  dictionaryInitialVoicing = false,
}: AlignerOptions): (spelling: string, reading: string) => DetailedAlignment {
  const alignedWords = compileWordAlignments(wordAlignments, wordAlignmentRules);
  const continuatives = new Map<string, string[]>(
    [...continuativeReadings].map(([spelling, readings]) => [
      spelling,
      [...new Set(readings.map(normalizeKana).filter(Boolean))],
    ]),
  );
  const weakCharacters = new Map<string, string[]>(
    [...weakCharacterReadings].map(([spelling, readings]) => [
      spelling,
      [...new Set(readings.map(normalizeKana).filter(Boolean))],
    ]),
  );
  const irregularWords = new Map<string, string[]>(
    [...irregularWordReadings].map(([spelling, readings]) => [
      spelling,
      [...new Set(readings.map(normalizeKana).filter(Boolean))],
    ]),
  );

  const characters = new Map<string, string[]>();
  const onCharacters = new Map<string, string[]>();
  const dottedReadings = new Map<string, { stem: string; suffix: string[] }[]>();
  for (const [spelling, readings] of characterReadings) {
    characters.set(spelling, [...new Set(readings.map(readingStem).filter(Boolean))]);
    onCharacters.set(spelling, [
      ...new Set(
        readings
          .filter((reading) =>
            /^[\p{Script=Katakana}ー]+$/u.test(reading.normalize("NFKC").replace(/^-|-$/gu, "")),
          )
          .map(readingStem)
          .filter(Boolean),
      ),
    ]);
    dottedReadings.set(
      spelling,
      readings.flatMap((reading) => {
        const normalized = normalizeKana(reading.replace(/^-|-$/gu, ""));
        const dot = normalized.indexOf(".");
        if (dot <= 0) return [];
        const suffix = splitGraphemes(normalized.slice(dot + 1));
        return suffix.length > 1 ? [{ stem: normalized.slice(0, dot), suffix }] : [];
      }),
    );
  }
  const words = new Map<string, string[]>();
  let longestWord = 0;
  for (const [spelling, readings] of wordReadings) {
    if (!spelling) continue;
    words.set(spelling, [...new Set(readings.map(normalizeKana).filter(Boolean))]);
    longestWord = Math.max(longestWord, splitGraphemes(spelling).length);
  }
  for (const spelling of alignedWords.keys())
    longestWord = Math.max(longestWord, splitGraphemes(spelling).length);
  for (const spelling of irregularWords.keys())
    longestWord = Math.max(longestWord, splitGraphemes(spelling).length);
  const lexicalKanaVariants = new Map<string, Set<string>>();
  if (kanaRunCorrespondence) {
    for (const readings of words.values()) {
      if (readings.length < 2) continue;
      const groups = new Map<string, string[]>();
      for (const reading of readings) {
        const key = kanaPronunciation(reading).replaceAll("ー", "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(reading);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const reading of group) {
          if (!lexicalKanaVariants.has(reading)) lexicalKanaVariants.set(reading, new Set());
          for (const alternative of group) lexicalKanaVariants.get(reading)!.add(alternative);
        }
      }
    }
  }

  const hasLexicalKanaVariant = (spelling: string, reading: string): boolean => {
    if (lexicalKanaVariants.get(spelling)?.has(reading)) return true;
    const units = splitGraphemes(spelling);
    for (let start = 0; start < units.length; ++start) {
      for (let end = start + 2; end <= units.length; ++end) {
        const prefix = units.slice(0, start).join("");
        const suffix = units.slice(end).join("");
        for (const alternative of lexicalKanaVariants.get(units.slice(start, end).join("")) ?? []) {
          if (prefix + alternative + suffix === reading) return true;
        }
      }
    }
    return false;
  };

  return function align(spelling: string, reading: string): DetailedAlignment {
    if (spelling === reading) {
      return {
        segments: spelling ? [spelling] : [],
        status: "aligned",
        score: { unknownCharacters: 0, cost: 0 },
        optimalPathCount: "1",
        evidence: spelling ? [{ spelling, reading, type: "literal", rules: [] }] : [],
      };
    }

    const spellingUnits = splitGraphemes(spelling);
    const readingData = readingIndex(reading);
    const readingUnits = readingData.units;
    const width = readingUnits.length + 1;
    const finalId = spellingUnits.length * width + readingUnits.length;
    const idFor = (spellingIndex: number, readIndex: number): number =>
      spellingIndex * width + readIndex;
    const dictionaryByStart = new Map<number, DictionaryEdge[]>();
    const attestedRanges: MatchedRange[] = [];
    const irregularRanges: MatchedRange[] = [];
    const ambiguousAnchorParticle = (
      start: number,
      end: number,
      wordReadStart: number,
      wordReading: string,
      innerStart: number,
      innerEnd: number,
      readStart: number,
      readEnd: number,
    ) => {
      if (innerEnd !== innerStart + 1 || !isIdeograph(spellingUnits[innerStart])) return undefined;
      const character = stripVariationSelectors(spellingUnits[innerStart]);
      const known = new Set([
        ...(characters.get(character) ?? []),
        ...(words.get(character) ?? []),
      ]);
      const residual = readingData.normalized.slice(
        readingData.offsets[readStart],
        readingData.offsets[readEnd],
      );
      if (known.has(residual)) return undefined;
      const particles = Array.from("のをがはにへとでも");
      const word = spellingUnits.slice(start, end).join("");
      const corroborated = (particle: string, spellingPosition: number, readPosition: number) => {
        const explicit =
          spellingUnits.slice(start, spellingPosition).join("") +
          particle +
          spellingUnits.slice(spellingPosition, end).join("");
        const offset = readingData.offsets[readPosition] - readingData.offsets[wordReadStart];
        const withoutParticle =
          wordReading.slice(0, offset) + wordReading.slice(offset + particle.length);
        return (
          words.get(explicit)?.includes(wordReading) || words.get(word)?.includes(withoutParticle)
        );
      };
      const leading = particles.some(
        (particle) =>
          residual.startsWith(particle) &&
          known.has(residual.slice(particle.length)) &&
          corroborated(particle, innerStart, readStart),
      );
      const trailing = particles.some(
        (particle) =>
          residual.endsWith(particle) &&
          known.has(residual.slice(0, -particle.length)) &&
          corroborated(particle, innerEnd, readEnd - 1),
      );
      return leading || trailing ? { leading, trailing } : undefined;
    };
    const hasAmbiguousAnchorVowel = (
      start: number,
      end: number,
      innerStart: number,
      innerEnd: number,
      readStart: number,
      readEnd: number,
      checkLeading = true,
      checkTrailing = true,
    ): boolean => {
      if (innerEnd !== innerStart + 1 || !isIdeograph(spellingUnits[innerStart])) return false;
      const character = stripVariationSelectors(spellingUnits[innerStart]);
      const known = new Set([
        ...(characters.get(character) ?? []),
        ...(words.get(character) ?? []),
      ]);
      const residual = readingData.normalized.slice(
        readingData.offsets[readStart],
        readingData.offsets[readEnd],
      );
      if (known.has(residual)) return false;
      if (checkLeading && innerStart > start) {
        const previous = normalizeKana(spellingUnits[innerStart - 1]);
        const vowels = getKanaVowels(previous);
        if (
          vowels?.some(
            (vowel) => residual.startsWith(vowel) && known.has(residual.slice(vowel.length)),
          )
        )
          return true;
      }
      if (checkTrailing && innerEnd < end) {
        const next = normalizeKana(spellingUnits[innerEnd]);
        if (
          /^[あいうえお]$/u.test(next) &&
          residual.endsWith(next) &&
          known.has(residual.slice(0, -next.length))
        )
          return true;
      }
      return false;
    };
    const internalAnchorBoundaries = (
      start: number,
      end: number,
      readStart: number,
      readEnd: number,
    ) => {
      const parts: { start: number; end: number; kana: boolean }[] = [];
      for (let index = start; index < end; ++index) {
        const kana = isKana(spellingUnits[index]);
        if (!parts.length || parts.at(-1)!.kana !== kana)
          parts.push({ start: index, end: index + 1, kana });
        else parts.at(-1)!.end = index + 1;
      }
      if (!parts.some((part, index) => part.kana && index > 0 && index < parts.length - 1))
        return undefined;
      const forward = [new Set([readStart])];
      for (const part of parts) {
        const next = new Set<number>();
        if (part.kana) {
          const literal = normalizeKana(spellingUnits.slice(part.start, part.end).join(""));
          for (const position of forward.at(-1)!) {
            const match = readingData.match(position, literal);
            if (match !== undefined && match <= readEnd) next.add(match);
          }
        } else if (forward.at(-1)!.size) {
          const first = Math.min(...forward.at(-1)!) + 1;
          for (let position = first; position <= readEnd; ++position) next.add(position);
        }
        forward.push(next);
      }
      if (!forward.at(-1)!.has(readEnd)) return undefined;
      const backward = new Array<Set<number>>(parts.length + 1);
      backward[parts.length] = new Set([readEnd]);
      for (let index = parts.length - 1; index >= 0; --index) {
        const part = parts[index];
        const previous = new Set<number>();
        if (part.kana) {
          const literal = normalizeKana(spellingUnits.slice(part.start, part.end).join(""));
          for (let position = readStart; position < readEnd; ++position) {
            if (
              (backward[index + 1] as ReadonlySet<number | undefined>).has(
                readingData.match(position, literal),
              )
            )
              previous.add(position);
          }
        } else if (backward[index + 1].size) {
          const last = Math.max(...backward[index + 1]);
          for (let position = readStart; position < last; ++position) previous.add(position);
        }
        backward[index] = previous;
      }
      const boundaries: { spellingIndex: number; readIndex: number }[] = [];
      for (let index = 0; index <= parts.length; ++index) {
        const positions = [...forward[index]].filter((position) => backward[index].has(position));
        if (positions.length === 1)
          boundaries.push({
            spellingIndex: index === 0 ? start : parts[index - 1].end,
            readIndex: positions[0],
          });
      }
      return { parts, boundaries };
    };
    const addDictionaryEdge = (
      start: number,
      readStart: number,
      end: number,
      readEnd: number,
      rules: string[] = [],
      suppliedCost?: number,
      type?: string,
    ) => {
      const id = idFor(start, readStart);
      if (!dictionaryByStart.has(id)) dictionaryByStart.set(id, []);
      const edges = dictionaryByStart.get(id)!;
      const cost = suppliedCost === undefined ? dictionaryEdgeCost(end - start) : suppliedCost;
      const existing = edges.find((edge) => edge.end === end && edge.readEnd === readEnd);
      if (!existing) edges.push({ end, readEnd, rules, cost, type });
      else if (cost < existing.cost) Object.assign(existing, { cost, rules, type });
    };

    // Only attested spelling/reading pairs create compound edges. A word with
    // several spellings must be supplied with the readings valid for each one.
    for (let start = 0; start < spellingUnits.length; ++start) {
      let text = "";
      for (let end = start + 1; end <= Math.min(spellingUnits.length, start + longestWord); ++end) {
        text += spellingUnits[end - 1];
        const candidates = words.get(text);
        const variants = alignedWords.get(text);
        const irregularReadings = irregularWords.get(text);
        if (!candidates && !variants && !irregularReadings) continue;
        let kanaRunEnd = start;
        while (kanaRunEnd < end && isKana(spellingUnits[kanaRunEnd])) ++kanaRunEnd;
        const leadingKana = normalizeKana(spellingUnits.slice(start, kanaRunEnd).join(""));
        const leadingPronunciation = kanaPronunciation(leadingKana);
        const leadingShortPronunciation = leadingPronunciation.replaceAll("ー", "");
        const readingCandidates: { text: string; cost: number; rules: string[] }[] = [];
        for (const candidate of candidates ?? []) {
          readingCandidates.push({ text: candidate, cost: 0, rules: [] });
          if (
            compoundVoicing &&
            start > 0 &&
            end - start > 1 &&
            isIdeograph(spellingUnits[start])
          ) {
            const first = Array.from(candidate)[0];
            if (voicedInitials.has(first)) {
              readingCandidates.push({
                text: voicedInitials.get(first) + candidate.slice(first.length),
                cost: 2,
                rules: ["compound-voicing"],
              });
            }
          }
        }
        const alignmentCandidates: AlignmentCandidate[] = [];
        for (const variant of variants ?? []) {
          alignmentCandidates.push({ ...variant, cost: 0, phonologicalRules: [] });
          const first = Array.from(variant.reading)[0];
          if (
            compoundVoicing &&
            start > 0 &&
            end - start > 1 &&
            isIdeograph(spellingUnits[start]) &&
            voicedInitials.has(first) &&
            !variant.parts[0].literal
          ) {
            const voiced = voicedInitials.get(first);
            alignmentCandidates.push({
              reading: voiced + variant.reading.slice(first.length),
              parts: variant.parts.map((part, index) =>
                index === 0
                  ? { ...part, reading: voiced + part.reading.slice(first.length) }
                  : part,
              ),
              rules: variant.rules,
              cost: 2,
              phonologicalRules: ["compound-voicing"],
            });
          }
        }
        for (let readStart = 0; readStart < readingUnits.length; ++readStart) {
          for (const irregularReading of irregularReadings ?? []) {
            const readEnd = readingData.match(readStart, irregularReading);
            if (readEnd !== undefined) irregularRanges.push({ start, end, readStart, readEnd });
          }
          for (const candidate of readingCandidates) {
            const readEnd = readingData.match(readStart, candidate.text);
            if (readEnd === undefined) continue;
            if (candidate.cost === 0) attestedRanges.push({ start, end, readStart, readEnd });
            addDictionaryEdge(
              start,
              readStart,
              end,
              readEnd,
              candidate.rules,
              dictionaryEdgeCost(end - start) + candidate.cost,
            );

            if (internalKanaAnchors && candidate.cost === 0) {
              const anchored = internalAnchorBoundaries(start, end, readStart, readEnd);
              for (let index = 1; anchored && index < anchored.boundaries.length; ++index) {
                const left = anchored.boundaries[index - 1];
                const right = anchored.boundaries[index];
                if (spellingUnits.slice(left.spellingIndex, right.spellingIndex).every(isKana))
                  continue;
                const leadingKana = anchored.parts.find(
                  (part) => part.kana && part.end === left.spellingIndex && part.start === start,
                );
                const trailingKana = anchored.parts.find(
                  (part) => part.kana && part.start === right.spellingIndex && part.end === end,
                );
                if (
                  hasAmbiguousAnchorVowel(
                    start,
                    end,
                    left.spellingIndex,
                    right.spellingIndex,
                    left.readIndex,
                    right.readIndex,
                    Boolean(leadingKana),
                    Boolean(trailingKana),
                  )
                )
                  continue;
                // An unprinted particle can occur between the literal anchor
                // and a known character reading. Its ownership is unresolved.
                const particle = ambiguousAnchorParticle(
                  start,
                  end,
                  readStart,
                  candidate.text,
                  left.spellingIndex,
                  right.spellingIndex,
                  left.readIndex,
                  right.readIndex,
                );
                if (particle) {
                  const previous = anchored.boundaries[index - 2];
                  const next = anchored.boundaries[index + 1];
                  const rules = ["dictionary-internal-kana-anchors", "unwritten-particle-group"];
                  if (
                    particle.leading &&
                    previous &&
                    spellingUnits.slice(previous.spellingIndex, left.spellingIndex).every(isKana)
                  ) {
                    addDictionaryEdge(
                      previous.spellingIndex,
                      previous.readIndex,
                      right.spellingIndex,
                      right.readIndex,
                      rules,
                      dictionaryEdgeCost(right.spellingIndex - previous.spellingIndex) + 5,
                    );
                  }
                  if (
                    particle.trailing &&
                    next &&
                    spellingUnits.slice(right.spellingIndex, next.spellingIndex).every(isKana)
                  ) {
                    addDictionaryEdge(
                      left.spellingIndex,
                      left.readIndex,
                      next.spellingIndex,
                      next.readIndex,
                      rules,
                      dictionaryEdgeCost(next.spellingIndex - left.spellingIndex) + 5,
                    );
                  }
                  continue;
                }
                // Every complete literal placement shares these boundaries;
                // unresolved kanji inside each residual remain together.
                addDictionaryEdge(
                  left.spellingIndex,
                  left.readIndex,
                  right.spellingIndex,
                  right.readIndex,
                  ["dictionary-internal-kana-anchors"],
                  dictionaryEdgeCost(right.spellingIndex - left.spellingIndex) + 5,
                );
              }
            }

            if (
              kanaRunCorrespondence &&
              candidate.cost === 0 &&
              kanaRunEnd > start &&
              kanaRunEnd < end &&
              isIdeograph(spellingUnits[kanaRunEnd])
            ) {
              for (let kanaReadEnd = readStart + 1; kanaReadEnd < readEnd; ++kanaReadEnd) {
                const readPrefix = readingData.normalized.slice(
                  readingData.offsets[readStart],
                  readingData.offsets[kanaReadEnd],
                );
                const pronunciation = kanaPronunciation(readPrefix);
                const shortPronunciation = pronunciation.replaceAll("ー", "");
                if (shortPronunciation.length > leadingShortPronunciation.length) break;
                if (readPrefix === leadingKana || shortPronunciation !== leadingShortPronunciation)
                  continue;
                const samePronunciation = pronunciation === leadingPronunciation;
                const alternativeWordReading =
                  leadingKana + candidate.text.slice(readPrefix.length);
                const licensedDurationChange =
                  kanaRunEnd - start >= 2 &&
                  (candidates!.includes(alternativeWordReading) ||
                    hasLexicalKanaVariant(leadingKana, readPrefix));
                if (samePronunciation || licensedDurationChange) {
                  const rules = [
                    "kana-run-correspondence",
                    samePronunciation ? "long-vowel-notation" : "lexical-vowel-length",
                  ];
                  const kanaParts = alignKanaPronunciations(
                    spellingUnits.slice(start, kanaRunEnd).join(""),
                    readingUnits.slice(readStart, kanaReadEnd).join(""),
                  );
                  if (!kanaParts) {
                    addDictionaryEdge(
                      start,
                      readStart,
                      kanaRunEnd,
                      kanaReadEnd,
                      rules,
                      6,
                      "phonological",
                    );
                  } else {
                    let partStart = start;
                    let partReadStart = readStart;
                    for (const [base, ruby] of kanaParts) {
                      const partEnd = partStart + splitGraphemes(base).length;
                      const partReadEnd = readingData.match(partReadStart, normalizeKana(ruby))!;
                      if (normalizeKana(base) !== normalizeKana(ruby)) {
                        addDictionaryEdge(
                          partStart,
                          partReadStart,
                          partEnd,
                          partReadEnd,
                          rules,
                          6,
                          "phonological",
                        );
                      }
                      partStart = partEnd;
                      partReadStart = partReadEnd;
                    }
                  }
                }
              }
            }

            // Matching literal kana delimit the unresolved part of an attested
            // word. Keep that evidence local to this occurrence; it does not
            // establish a reusable reading for the remaining kanji.
            let innerStart = start;
            let innerReadStart = readStart;
            let innerEnd = end;
            let innerReadEnd = readEnd;
            while (innerStart < innerEnd && isKana(spellingUnits[innerStart])) {
              const next = readingData.match(
                innerReadStart,
                normalizeKana(spellingUnits[innerStart]),
              );
              if (next === undefined || next > innerReadEnd) break;
              ++innerStart;
              innerReadStart = next;
            }
            while (innerStart < innerEnd && isKana(spellingUnits[innerEnd - 1])) {
              const previous = readingData.matchEnd(
                innerReadEnd,
                normalizeKana(spellingUnits[innerEnd - 1]),
              );
              if (previous === undefined || previous < innerReadStart) break;
              --innerEnd;
              innerReadEnd = previous;
            }
            if (
              innerStart < innerEnd &&
              innerReadStart < innerReadEnd &&
              (innerStart > start || innerEnd < end)
            ) {
              // Trimming is not proof that a neighboring kana's possible long
              // vowel belongs to the kanji. Retain the word group when that
              // allocation competes with an independently supported reading.
              if (
                !hasAmbiguousAnchorVowel(
                  start,
                  end,
                  innerStart,
                  innerEnd,
                  innerReadStart,
                  innerReadEnd,
                )
              ) {
                addDictionaryEdge(
                  innerStart,
                  innerReadStart,
                  innerEnd,
                  innerReadEnd,
                  [...candidate.rules, "dictionary-kana-anchors"],
                  dictionaryEdgeCost(innerEnd - innerStart) + candidate.cost + 4,
                );
              }
            }
          }
          for (const variant of alignmentCandidates) {
            const readEnd = readingData.match(readStart, variant.reading);
            if (readEnd === undefined) continue;
            if (variant.cost === 0) attestedRanges.push({ start, end, readStart, readEnd });
            let partStart = start;
            let partReadStart = readStart;
            const edges: [number, number, number, number, string[], number][] = [];
            for (const part of variant.parts) {
              const partEnd = partStart + part.spellingLength;
              const partReadEnd = readingData.match(partReadStart, part.reading);
              if (partReadEnd === undefined || partEnd > end || partReadEnd > readEnd) break;
              const firstPart = partStart === start;
              const cost = part.literal
                ? 0
                : 1 + 20 * (part.spellingLength - 1) + (firstPart ? variant.cost : 0);
              edges.push([
                partStart,
                partReadStart,
                partEnd,
                partReadEnd,
                [...variant.rules, ...(firstPart ? variant.phonologicalRules : [])],
                cost,
              ]);
              partStart = partEnd;
              partReadStart = partReadEnd;
            }
            // A normalization match may still split a combining sequence;
            // require every supplied boundary to be a boundary in this input.
            if (
              edges.length === variant.parts.length &&
              partStart === end &&
              partReadStart === readEnd
            ) {
              for (const edge of edges) {
                // Literal transitions already exist one grapheme at a time;
                // adding grouped literal edges would create false ambiguity.
                if (edge[5] > 0) addDictionaryEdge(...edge);
              }
            }
          }
        }
      }
    }

    function candidatesFor(spellingIndex: number, readIndex: number): CharacterCandidate[] {
      const character = spellingUnits[spellingIndex];
      let lookup = stripVariationSelectors(character);
      if (lookup === "々") {
        let previous = spellingIndex - 1;
        while (previous >= 0 && stripVariationSelectors(spellingUnits[previous]) === "々")
          --previous;
        lookup = previous >= 0 ? stripVariationSelectors(spellingUnits[previous]) : lookup;
      }
      const stems = characters.get(lookup) ?? [];
      const iterationRules = stripVariationSelectors(character) === "々" ? ["iteration"] : [];
      const candidates = new Map<string, CharacterCandidate>();
      const add = (text: string, cost: number, rules: string[], type?: string) => {
        if (!text) return;
        const current = candidates.get(text);
        if (!current || cost < current.cost) candidates.set(text, { text, cost, rules, type });
      };
      for (const stem of stems) add(stem, 0, iterationRules);

      if (phonologicalAlternations) {
        for (const stem of stems) {
          const first = Array.from(stem)[0];
          const rest = stem.slice(first.length);
          const previousKana = normalizeKana(readingUnits[readIndex - 1] ?? "");
          if (spellingIndex > 0 && voicedInitials.has(first)) {
            add(voicedInitials.get(first) + rest, 2, [...iterationRules, "rendaku"]);
          }
          if ((previousKana === "っ" || previousKana === "ん") && plosiveInitials.has(first)) {
            add(plosiveInitials.get(first) + rest, 2, [
              ...iterationRules,
              previousKana === "っ" ? "post-sokuon-plosive" : "post-nasal-plosive",
            ]);
          }
          // Literal kana own their exact reading. An extra consonant in a
          // kana/kanji compound consequently belongs to the following kanji.
          if (
            spellingIndex > 0 &&
            isKana(spellingUnits[spellingIndex - 1]) &&
            geminateInitials.test(stem)
          ) {
            add("っ" + stem, 5, [...iterationRules, "post-kana-gemination"]);
          }
        }
        // A copy, because the loop adds candidates.
        // oxlint-disable-next-line unicorn/no-useless-spread
        for (const candidate of [...candidates.values()]) {
          if (
            spellingIndex + 1 >= spellingUnits.length ||
            !isIdeograph(spellingUnits[spellingIndex + 1])
          )
            continue;
          const nextAfter = (text: string) => {
            const end = readingData.match(readIndex, text);
            return end === undefined ? "" : normalizeKana(readingUnits[end] ?? "");
          };
          if (sokuonFinals.test(candidate.text)) {
            const text = candidate.text.slice(0, -1) + "っ";
            if (geminateInitials.test(nextAfter(text)))
              add(text, candidate.cost + 3, [...candidate.rules, "sokuon"]);
          }
          const text = candidate.text + "っ";
          if (geminateInitials.test(nextAfter(text)))
            add(text, candidate.cost + 5, [...candidate.rules, "gemination"]);
        }
      }

      const supportedCompound = dictionaryByStart
        .get(idFor(spellingIndex, readIndex))
        ?.some(
          (edge) =>
            !edge.rules.includes("compound-voicing") &&
            edge.end > spellingIndex + 1 &&
            spellingUnits.slice(spellingIndex, edge.end).every(isIdeograph),
        );
      if (terminalContraction && supportedCompound) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          if (removableFinals.test(stem))
            add(stem.slice(0, -1), 8, ["dictionary-supported-terminal-contraction"]);
        }
      }
      if (spellingIndex + 1 < spellingUnits.length && isKana(spellingUnits[spellingIndex + 1])) {
        for (const { stem, suffix } of dottedReadings.get(lookup) ?? []) {
          for (let prefixLength = 1; prefixLength < suffix.length; ++prefixLength) {
            const remainder = suffix.slice(prefixLength).join("");
            const spellingEnd = spellingIndex + 1 + suffix.length - prefixLength;
            const spellingRemainder = spellingUnits.slice(spellingIndex + 1, spellingEnd);
            if (
              !spellingRemainder.every(isKana) ||
              normalizeKana(spellingRemainder.join("")) !== remainder
            )
              continue;
            const candidate = stem + suffix.slice(0, prefixLength).join("");
            const readEnd = readingData.match(readIndex, candidate);
            const suffixEnd =
              readEnd === undefined ? undefined : readingData.match(readEnd, remainder);
            if (
              suffixEnd !== undefined &&
              attestedRanges.some(
                (range) =>
                  range.start <= spellingIndex &&
                  spellingEnd <= range.end &&
                  range.readStart <= readIndex &&
                  suffixEnd <= range.readEnd,
              )
            ) {
              // A dotted reading can omit only part of its okurigana: `い.だす`
              // supports `出す` as `出[いだ] す` when the remaining `す` is literal.
              add(candidate, 4, ["partial-okurigana"]);
            }
          }
        }
      }
      if (
        spellingIndex + 1 < spellingUnits.length &&
        isIdeograph(spellingUnits[spellingIndex + 1])
      ) {
        for (const stem of continuatives.get(lookup) ?? []) {
          const readEnd = readingData.match(readIndex, stem);
          if (
            readEnd !== undefined &&
            attestedRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex + 1 < range.end &&
                range.readStart <= readIndex &&
                readEnd < range.readEnd,
            )
          ) {
            // The source verifies the verb stem; the exact compound context
            // licenses absorbing its omitted okurigana at this boundary.
            add(stem, 8, ["continuative-stem"]);
          }
        }
      }
      for (const candidate of weakCharacters.get(lookup) ?? []) {
        const variants = [{ text: candidate, cost: 12, rules: ["weak-character-reading"] }];
        if (phonologicalAlternations && spellingIndex > 0 && voicedInitials.has(candidate[0])) {
          variants.push({
            text: voicedInitials.get(candidate[0]) + candidate.slice(1),
            cost: 14,
            rules: ["weak-character-reading", "rendaku"],
          });
        }
        for (const variant of variants) {
          const readEnd = readingData.match(readIndex, variant.text);
          const irregular =
            readEnd !== undefined &&
            irregularRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd,
            );
          if (
            readEnd !== undefined &&
            !irregular &&
            attestedRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd &&
                spellingUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2,
            )
          ) {
            add(variant.text, variant.cost, variant.rules, "dictionary");
          }
        }
      }
      if (dictionaryUnvoicing && phonologicalAlternations) {
        for (const stem of stems) {
          const unvoiced = unvoicedInitials.get(stem[0]);
          if (unvoiced === undefined) continue;
          const candidate = unvoiced + stem.slice(1);
          const readEnd = readingData.match(readIndex, candidate);
          const irregular =
            readEnd !== undefined &&
            irregularRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd,
            );
          if (
            readEnd !== undefined &&
            !irregular &&
            attestedRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd &&
                spellingUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2,
            )
          ) {
            add(candidate, 12, ["dictionary-supported-unvoicing"]);
          }
        }
      }
      if (dictionaryNasalLoss && phonologicalAlternations) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          if (!stem.endsWith("ん") || stem.length < 2) continue;
          const candidate = stem.slice(0, -1);
          const readEnd = readingData.match(readIndex, candidate);
          const irregular =
            readEnd !== undefined &&
            irregularRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd,
            );
          if (
            readEnd !== undefined &&
            !irregular &&
            attestedRanges.some(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readEnd <= range.readEnd &&
                spellingUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2,
            )
          ) {
            // Historical on readings can lack a written final nasal in an
            // attested word; this is weak lexical evidence, not a free reading.
            add(candidate, 12, ["dictionary-supported-nasal-loss"]);
          }
        }
      }
      if (dictionaryInitialVoicing && phonologicalAlternations) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          const initials = [
            voicedInitials.get(stem[0]),
            plosiveInitials.get(unvoicedInitials.get(stem[0]) ?? stem[0]),
          ];
          for (const initial of initials) {
            if (initial === undefined || initial === stem[0]) continue;
            const candidate = initial + stem.slice(1);
            const readEnd = readingData.match(readIndex, candidate);
            const irregular =
              readEnd !== undefined &&
              irregularRanges.some(
                (range) =>
                  range.start <= spellingIndex &&
                  spellingIndex < range.end &&
                  range.readStart <= readIndex &&
                  readEnd <= range.readEnd,
              );
            if (
              readEnd !== undefined &&
              !irregular &&
              attestedRanges.some(
                (range) =>
                  range.start <= spellingIndex &&
                  spellingIndex < range.end &&
                  range.readStart <= readIndex &&
                  readEnd <= range.readEnd &&
                  spellingUnits.slice(range.start, range.end).filter(isIdeograph).length >= 2,
              )
            ) {
              add(candidate, 12, ["dictionary-supported-initial-voicing"]);
            }
          }
        }
      }
      if (
        dictionaryRenjo &&
        phonologicalAlternations &&
        spellingIndex > 0 &&
        isIdeograph(spellingUnits[spellingIndex - 1]) &&
        normalizeKana(readingUnits[readIndex - 1] ?? "") === "ん"
      ) {
        for (const stem of onCharacters.get(lookup) ?? []) {
          const nasal = nasalInitials.get(stem[0]);
          if (nasal === undefined) continue;
          const candidate = nasal + stem.slice(1);
          const readEnd = readingData.match(readIndex, candidate);
          if (
            readEnd !== undefined &&
            attestedRanges.some(
              (range) =>
                range.start < spellingIndex &&
                spellingIndex < range.end &&
                range.readStart < readIndex &&
                readEnd <= range.readEnd,
            )
          ) {
            add(candidate, 12, ["dictionary-supported-renjo"]);
          }
        }
      }
      return [...candidates.values()];
    }

    function solve(allowFallback: boolean): (PathNode | undefined)[] | undefined {
      const nodes = new Array<PathNode | undefined>((spellingUnits.length + 1) * width);
      nodes[0] = { unknownCharacters: 0, cost: 0, incoming: [] };
      const addEdge = (
        sourceId: number,
        spellingIndex: number,
        readIndex: number,
        type: string,
        cost = 0,
        rules: string[] = [],
        unknownCharacters = 0,
      ) => {
        const source = nodes[sourceId]!;
        const destinationId = idFor(spellingIndex, readIndex);
        const score = {
          unknownCharacters: source.unknownCharacters + unknownCharacters,
          cost: source.cost + cost,
        };
        let destination = nodes[destinationId];
        const comparison = destination ? compareScore(score, destination) : -1;
        if (comparison > 0) return;
        const edge: PathEdge = { sourceId, destinationId, type, rules };
        if (comparison < 0) {
          destination = { ...score, incoming: [edge] };
          nodes[destinationId] = destination;
        } else if (!destination!.incoming.some((previous) => previous.sourceId === sourceId)) {
          destination!.incoming.push(edge);
        }
      };

      for (let spellingIndex = 0; spellingIndex < spellingUnits.length; ++spellingIndex) {
        for (let readIndex = 0; readIndex < readingUnits.length; ++readIndex) {
          const sourceId = idFor(spellingIndex, readIndex);
          if (!nodes[sourceId]) continue;
          const character = spellingUnits[spellingIndex];
          const literalEnd = readingData.match(readIndex, normalizeKana(character));
          if (literalEnd !== undefined) addEdge(sourceId, spellingIndex + 1, literalEnd, "literal");

          if (isKana(character)) {
            const contexts = attestedRanges.filter(
              (range) =>
                range.start <= spellingIndex &&
                spellingIndex < range.end &&
                range.readStart <= readIndex &&
                readIndex < range.readEnd,
            );
            if (phonologicalAlternations && literalEnd !== undefined && contexts.length) {
              const vowels = getKanaVowels(character);
              const katakana = /^[\p{Script=Katakana}\u3099\u309a]+$/u.test(
                character.normalize("NFKC"),
              );
              // Hiragana often precedes a kanji whose reading starts with a
              // vowel. Only katakana permits an omitted written vowel; an
              // actual prolonged mark can extend a kana in either script.
              for (const vowel of vowels ? [...(katakana ? vowels : []), "ー"] : []) {
                const readEnd = readingData.match(readIndex, normalizeKana(character) + vowel);
                const next = spellingUnits[spellingIndex + 1];
                const nextKanaMatches =
                  readEnd !== undefined &&
                  (next === undefined ||
                    !isKana(next) ||
                    readingData.match(readEnd, normalizeKana(next)) !== undefined);
                if (nextKanaMatches && contexts.some((range) => readEnd <= range.readEnd)) {
                  addEdge(sourceId, spellingIndex + 1, readEnd, "phonological", 2, [
                    "dictionary-supported-kana-vowel-extension",
                  ]);
                }
              }
            }
            if (literalEnd === undefined && contexts.length) {
              // Permit a single substituted kana only when the rest of its
              // kana run remains literal. Variable-length residuals would let
              // an incomplete kanji reading spill into the following kana.
              let runEnd = spellingIndex + 1;
              while (runEnd < spellingUnits.length && isKana(spellingUnits[runEnd])) ++runEnd;
              const unchangedTail = spellingUnits.slice(spellingIndex + 1, runEnd).join("");
              const tailEnd = unchangedTail
                ? readingData.match(readIndex + 1, normalizeKana(unchangedTail))
                : undefined;
              if (
                tailEnd !== undefined &&
                isKana(readingUnits[readIndex]) &&
                normalizeKana(readingUnits[readIndex]) !== "ー" &&
                contexts.some((range) => runEnd <= range.end && tailEnd <= range.readEnd)
              ) {
                addEdge(sourceId, spellingIndex + 1, readIndex + 1, "ambiguous", 14, [
                  "dictionary-kana-mismatch",
                ]);
              }
            }
          }

          if (isIdeograph(character)) {
            for (const candidate of candidatesFor(spellingIndex, readIndex)) {
              const readEnd = readingData.match(readIndex, candidate.text);
              if (readEnd !== undefined) {
                addEdge(
                  sourceId,
                  spellingIndex + 1,
                  readEnd,
                  candidate.type ?? (candidate.cost ? "phonological" : "character"),
                  candidate.cost,
                  candidate.rules,
                );
              }
            }
          }
          for (const edge of dictionaryByStart.get(idFor(spellingIndex, readIndex)) ?? []) {
            // A dictionary group is sound evidence, but incurs a cost for each
            // boundary it leaves unresolved compared with character readings.
            addEdge(
              sourceId,
              edge.end,
              edge.readEnd,
              edge.type ?? "dictionary",
              edge.cost,
              edge.rules,
            );
          }
          if (allowFallback && !isKana(character)) {
            for (let readEnd = readIndex + 1; readEnd <= readingUnits.length; ++readEnd) {
              addEdge(sourceId, spellingIndex + 1, readEnd, "fallback", 0, [], 1);
            }
          }
        }
      }
      return nodes[finalId] ? nodes : undefined;
    }

    function render(nodes: (PathNode | undefined)[] | undefined): DetailedAlignment {
      if (!nodes) {
        return {
          segments: [[spelling, reading]],
          status: "fallback",
          score: { unknownCharacters: spellingUnits.length, cost: 0 },
          optimalPathCount: "1",
          evidence: [{ spelling, reading, type: "fallback", rules: [] }],
        };
      }

      const ancestors = new Set([finalId]);
      const pending = [finalId];
      while (pending.length) {
        const id = pending.pop()!;
        for (const edge of nodes[id]!.incoming) {
          if (!ancestors.has(edge.sourceId)) {
            ancestors.add(edge.sourceId);
            pending.push(edge.sourceId);
          }
        }
      }
      const ordered = [...ancestors].sort((left, right) => left - right);
      const forwardCounts = new Map([[0, 1n]]);
      for (const id of ordered) {
        if (id === 0) continue;
        forwardCounts.set(
          id,
          nodes[id]!.incoming.reduce(
            (count, edge) => count + forwardCounts.get(edge.sourceId)!,
            0n,
          ),
        );
      }
      const backwardCounts = new Map([[finalId, 1n]]);
      for (const id of ordered.toReversed()) {
        for (const edge of nodes[id]!.incoming) {
          backwardCounts.set(
            edge.sourceId,
            (backwardCounts.get(edge.sourceId) ?? 0n) + backwardCounts.get(id)!,
          );
        }
      }
      const pathCount = forwardCounts.get(finalId)!;
      const boundaries = ordered.filter(
        (id) => forwardCounts.get(id)! * backwardCounts.get(id)! === pathCount,
      );
      const parts: Evidence[] = [];
      for (let index = 1; index < boundaries.length; ++index) {
        const startId = boundaries[index - 1];
        const endId = boundaries[index];
        const localEdges = ordered
          .filter((id) => id > startId && id <= endId)
          .flatMap((id) => nodes[id]!.incoming);
        const ambiguous = forwardCounts.get(endId)! > forwardCounts.get(startId)!;
        const fallback = localEdges.some((edge) => edge.type === "fallback");
        parts.push({
          spelling: spellingUnits
            .slice(Math.floor(startId / width), Math.floor(endId / width))
            .join(""),
          reading: readingUnits.slice(startId % width, endId % width).join(""),
          type: fallback ? "fallback" : ambiguous ? "ambiguous" : localEdges[0].type,
          rules: [...new Set(localEdges.flatMap((edge) => edge.rules))],
        });
      }
      const result = mergeOutput(parts);
      const score = {
        unknownCharacters: nodes[finalId]!.unknownCharacters,
        cost: nodes[finalId]!.cost,
      };
      return {
        ...result,
        status: score.unknownCharacters
          ? "fallback"
          : pathCount > 1n || result.evidence.some((part) => part.type === "ambiguous")
            ? "ambiguous"
            : "aligned",
        score,
        optimalPathCount: pathCount.toString(),
      };
    }

    return render(solve(false) ?? solve(true));
  };
}
