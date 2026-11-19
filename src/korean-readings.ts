import { createHash } from "node:crypto";
import { enumeratePairs } from "./sources.ts";
import { normalizeKana } from "./kana.ts";
import { boundaries, pairKey, validateAlignment } from "./segments.ts";
import type {
  Aligner,
  JMdict,
  JMdictSense,
  Kanjidic2,
  Kanjidic2Reading,
  JMdictLanguageSource,
  PassResult,
  Segment,
  SourceIdentity,
  WordAlignments,
} from "./types.ts";

/** A precomposed Hangul syllable as the indexes of its three jamo. */
export interface HangulSyllable {
  value: string;
  onset: number;
  vowel: number;
  coda: number;
}

/** What transcribing a syllable needs to know of the syllable before it. */
export interface HangulContext {
  coda: number;
  value?: string;
}

/** A syllable with its kana approximation and how that was reached. */
export interface TranscribedHangul extends HangulSyllable {
  reading: string;
  rules: string[];
  transcription: {
    onset: string;
    vowel: string;
    coda: string;
    onsetRow: string;
    vowelClass: string;
    syllableKana: string;
    codaKana: string;
    previousSyllable: string | undefined;
  };
}

/** Where KANJIDIC lists a Korean reading of a character. */
interface KoreanClaim {
  groupIndex: number;
  readingIndex: number;
  form: Kanjidic2Reading;
}

/** Each character's listed Hangul readings, with every place that lists each one. */
type KoreanInventory = Map<string, Map<string, KoreanClaim[]>>;

interface KoreanAllocatedCharacter {
  character: string;
  reading: string;
  value: string;
  claims: KoreanClaim[];
  rules: string[];
  transcription: TranscribedHangul["transcription"];
}

interface KoreanAllocation {
  segments: Segment[];
  paths: KoreanAllocatedCharacter[][];
}

export interface KoreanEvidence extends KoreanClaim {
  source: "KANJIDIC2";
  field: "korean_h";
  sourceIdentity: SourceIdentity | { name: string; readingsSHA256: string };
  value: string;
  rules: string[];
  transcription: TranscribedHangul["transcription"];
}

export interface KoreanWitnessCharacter {
  character: string;
  spelling: string;
  reading: string;
  codepoint: string;
  evidence: KoreanEvidence[];
}

export interface KoreanWitness {
  id: string;
  spelling: string;
  reading: string;
  interpretation: string;
  eligibility: "source-language-kor" | "korean-only-katakana";
  languageSources: JMdictLanguageSource[];
  /** One item per way of reading the word from listed Hangul forms; each lists every character. */
  sourcePaths: KoreanWitnessCharacter[][];
}

export interface KoreanAlignmentOptions {
  untaggedKatakana?: boolean;
  kanjidicSource?: SourceIdentity;
}

// A deliberately incomplete kana approximation, following Cho Ui-sung's
// description at https://www.tufs.ac.jp/ts/personal/choes/Jnotice.html.
// Use ordinary-size coda kana for attested Japanese loan spellings. Omit
// tense onsets, compound glides/codas, length changes, and inferred gemination.
const vowels = new Map([
  [0, "a"],
  [1, "e"],
  [2, "ya"],
  [4, "o"],
  [5, "e"],
  [6, "yo"],
  [8, "o"],
  [12, "yo"],
  [13, "u"],
  [17, "yu"],
  [18, "u"],
  [20, "i"],
]);
const rows: Record<string, Record<string, string | undefined>> = Object.fromEntries(
  Object.entries({
    "": ["あ", "え", "や", "お", "よ", "う", "ゆ", "い"],
    k: ["か", "け", "きゃ", "こ", "きょ", "く", "きゅ", "き"],
    g: ["が", "げ", "ぎゃ", "ご", "ぎょ", "ぐ", "ぎゅ", "ぎ"],
    n: ["な", "ね", "にゃ", "の", "にょ", "ぬ", "にゅ", "に"],
    t: ["た", "て", undefined, "と", undefined, "とぅ", undefined, "てぃ"],
    d: ["だ", "で", undefined, "ど", undefined, "どぅ", undefined, "でぃ"],
    r: ["ら", "れ", "りゃ", "ろ", "りょ", "る", "りゅ", "り"],
    m: ["ま", "め", "みゃ", "も", "みょ", "む", "みゅ", "み"],
    p: ["ぱ", "ぺ", "ぴゃ", "ぽ", "ぴょ", "ぷ", "ぴゅ", "ぴ"],
    b: ["ば", "べ", "びゃ", "ぼ", "びょ", "ぶ", "びゅ", "び"],
    s: ["さ", "せ", "しゃ", "そ", "しょ", "す", "しゅ", "し"],
    ch: ["ちゃ", "ちぇ", "ちゃ", "ちょ", "ちょ", "ちゅ", "ちゅ", "ち"],
    j: ["じゃ", "じぇ", "じゃ", "じょ", "じょ", "じゅ", "じゅ", "じ"],
    h: ["は", "へ", "ひゃ", "ほ", "ひょ", "ふ", "ひゅ", "ひ"],
  }).map(([key, values]) => [
    key,
    Object.fromEntries(
      ["a", "e", "ya", "o", "yo", "u", "yu", "i"].map((vowel, index) => [vowel, values[index]]),
    ),
  ]),
);
const onsetRows = new Map([
  [0, ["k", "g"]],
  [2, ["n"]],
  [3, ["t", "d"]],
  [5, ["r"]],
  [6, ["m"]],
  [7, ["p", "b"]],
  [9, ["s"]],
  [11, [""]],
  [12, ["ch", "j"]],
  [14, ["ch"]],
  [15, ["k"]],
  [16, ["t"]],
  [17, ["p"]],
  [18, ["h"]],
]);
const codas = new Map([
  [0, ""],
  [1, "く"],
  [4, "ん"],
  [8, "る"],
  [16, "む"],
  [17, "ぷ"],
  [21, "ん"],
]);

export function decodeHangul(value: string): HangulSyllable | undefined {
  if (typeof value !== "string" || !/^[가-힣]$/u.test(value)) return undefined;
  const code = value.codePointAt(0)! - 0xac00;
  return {
    value,
    onset: Math.floor(code / 588),
    vowel: Math.floor(code / 28) % 21,
    coda: code % 28,
  };
}

function compatibleContext(previous: HangulContext | undefined, current: HangulSyllable): boolean {
  if (previous === undefined || previous.coda === 0) return true;
  // These contexts can change consonant ownership through liaison, nasal or
  // liquid assimilation, or aspiration. No such transfer is inferred here.
  // https://www.korean.go.kr/front_eng/roman/roman_01.do
  if (current.onset === 11 && previous.coda !== 21) return false;
  if ([5, 18].includes(current.onset)) return false;
  if (previous.coda === 8 && current.onset === 2) return false;
  if ([1, 17].includes(previous.coda) && [2, 6].includes(current.onset)) return false;
  return true;
}

export function transcribeHangul(
  value: string,
  previous?: HangulContext,
): TranscribedHangul | undefined {
  const syllable = decodeHangul(value);
  if (syllable === undefined || !compatibleContext(previous, syllable)) return undefined;
  const onset = onsetRows.get(syllable.onset),
    vowel = vowels.get(syllable.vowel),
    coda = codas.get(syllable.coda);
  if (onset === undefined || vowel === undefined || coda === undefined) return undefined;
  const voiced = previous !== undefined && [0, 4, 8, 16, 21].includes(previous.coda);
  const row = voiced && onset.length === 2 ? onset[1] : onset[0];
  const head = rows[row][vowel];
  if (head === undefined) return undefined;
  const rules = ["listed-korean-syllable", "korean-vowel-kana-approximation"];
  if (onset.length === 2)
    rules.push(voiced ? "korean-medial-plain-voicing" : "korean-plain-devoicing");
  if (coda) rules.push("korean-coda-kana-approximation");
  return {
    ...syllable,
    reading: head + coda,
    rules,
    transcription: {
      onset: String.fromCodePoint(0x1100 + syllable.onset),
      vowel: String.fromCodePoint(0x1161 + syllable.vowel),
      coda: syllable.coda === 0 ? "" : String.fromCodePoint(0x11a7 + syllable.coda),
      onsetRow: row,
      vowelClass: vowel,
      syllableKana: head,
      codaKana: coda,
      previousSyllable: previous?.value,
    },
  };
}

function makeKoreanInventory(kanjidic: Kanjidic2): KoreanInventory {
  const inventory: KoreanInventory = new Map();
  for (const character of kanjidic.characters) {
    const forms = new Map<string, KoreanClaim[]>();
    for (const [groupIndex, group] of (character.readingMeaning?.groups ?? []).entries()) {
      for (const [readingIndex, form] of group.readings.entries()) {
        if (form.type !== "korean_h" || decodeHangul(form.value) === undefined) continue;
        const claims = forms.get(form.value) ?? [];
        claims.push({ groupIndex, readingIndex, form: structuredClone(form) });
        forms.set(form.value, claims);
      }
    }
    if (forms.size) inventory.set(character.literal, forms);
  }
  return inventory;
}

function allocateKorean(
  spelling: string,
  reading: string,
  inventory: KoreanInventory,
): KoreanAllocation | undefined {
  const characters = [...spelling],
    normalized = normalizeKana(reading),
    original = [...reading];
  // Matching must preserve the original reading's code-point positions.
  if ([...normalized].length !== original.length) return undefined;
  const solutions = new Map<string, KoreanAllocation>();
  function visit(
    index: number,
    offset: number,
    previous: TranscribedHangul | undefined,
    segments: Segment[],
    witnesses: KoreanAllocatedCharacter[],
  ): void {
    if (solutions.size > 1) return;
    if (index === characters.length) {
      if (offset === normalized.length) {
        const key = JSON.stringify(segments),
          existing = solutions.get(key);
        if (existing === undefined) solutions.set(key, { segments, paths: [witnesses] });
        else existing.paths.push(witnesses);
      }
      return;
    }
    for (const [value, claims] of inventory.get(characters[index]) ?? []) {
      const mapped = transcribeHangul(value, previous);
      if (mapped === undefined || !normalized.startsWith(mapped.reading, offset)) continue;
      const part = original.slice(offset, offset + mapped.reading.length).join("");
      visit(
        index + 1,
        offset + mapped.reading.length,
        mapped,
        [...segments, [characters[index], part]],
        [
          ...witnesses,
          {
            character: characters[index],
            reading: part,
            value,
            claims,
            rules: mapped.rules,
            transcription: mapped.transcription,
          },
        ],
      );
    }
  }
  visit(0, 0, undefined, [], []);
  return solutions.size === 1 ? [...solutions.values()][0] : undefined;
}

function applies(restrictions: string[] | undefined, value: string): boolean | undefined {
  return restrictions?.includes("*") || restrictions?.includes(value);
}

/** Whole-attested-word sound compatibility, with no reusable Japanese readings. */
export function deriveKoreanAlignments(
  jmdict: JMdict,
  kanjidic: Kanjidic2,
  align: Aligner,
  { untaggedKatakana = true, kanjidicSource }: KoreanAlignmentOptions = {},
): PassResult<KoreanWitness> {
  if (!Array.isArray(jmdict?.words) || !Array.isArray(kanjidic?.characters))
    throw new TypeError("JMdict and KANJIDIC arrays are required");
  if (typeof align !== "function" || typeof untaggedKatakana !== "boolean")
    throw new TypeError("An aligner and boolean Korean eligibility option are required");
  if (
    kanjidicSource !== undefined &&
    (kanjidicSource === null ||
      typeof kanjidicSource !== "object" ||
      typeof kanjidicSource.version !== "string" ||
      !kanjidicSource.version.trim() ||
      !/^[\da-f]{64}$/u.test(kanjidicSource.jsonSHA256 ?? ""))
  ) {
    throw new TypeError("KANJIDIC source identity requires a version and JSON SHA256");
  }
  const inventory = makeKoreanInventory(kanjidic);
  const sourceIdentity =
    kanjidicSource === undefined
      ? {
          name: "Supplied KANJIDIC Korean reading records",
          readingsSHA256: createHash("sha256")
            .update(
              JSON.stringify([...inventory].map(([character, forms]) => [character, [...forms]])),
            )
            .digest("hex"),
        }
      : structuredClone(kanjidicSource);
  const words = new Map(jmdict.words.map((word) => [word.id, word]));
  const wordAlignments: WordAlignments = new Map(),
    witnesses: KoreanWitness[] = [],
    seen = new Set<string>();
  for (const pair of enumeratePairs(jmdict)) {
    if (
      pair.kind !== "kanji" ||
      pair.readingTags.some((tag) => ["ik", "sk"].includes(tag)) ||
      !/^\p{Unified_Ideograph}{2,}$/u.test(pair.spelling)
    )
      continue;
    const languageSources = words
      .get(pair.id)!
      .sense.filter(
        (sense) =>
          applies(sense.appliesToKanji, pair.spelling) &&
          applies(sense.appliesToKana, pair.reading),
      )
      .flatMap((sense) =>
        sense.languageSource.filter((source) => source.lang === "kor" && !source.wasei),
      );
    const tagged = languageSources.length > 0;
    if (
      !tagged &&
      (!untaggedKatakana || !/^[\p{Script=Katakana}ー]+$/u.test(pair.reading.normalize("NFKC")))
    )
      continue;
    const key = pairKey(pair.spelling, pair.reading);
    if (seen.has(key)) continue;
    seen.add(key);
    const original = align(pair.spelling, pair.reading);
    if (original.status !== "aligned") continue;
    const split = allocateKorean(pair.spelling, pair.reading, inventory);
    if (split === undefined) continue;
    const oldPoints = new Set(boundaries(original.segments)),
      newPoints = new Set(boundaries(split.segments));
    if (newPoints.size <= oldPoints.size || [...oldPoints].some((point) => !newPoints.has(point)))
      continue;
    validateAlignment(pair.spelling, pair.reading, split.segments);
    const readings = wordAlignments.get(pair.spelling) ?? new Map();
    readings.set(pair.reading, split.segments);
    wordAlignments.set(pair.spelling, readings);
    witnesses.push({
      id: pair.id,
      spelling: pair.spelling,
      reading: pair.reading,
      interpretation: "Listed Korean sound compatibility; not an etymological claim",
      eligibility: tagged ? "source-language-kor" : "korean-only-katakana",
      languageSources: structuredClone(languageSources),
      sourcePaths: split.paths.map((path) =>
        path.map((character) => ({
          character: character.character,
          spelling: character.character,
          reading: character.reading,
          codepoint: `U+${character.character.codePointAt(0)!.toString(16).toUpperCase()}`,
          evidence: character.claims.map((claim) => ({
            source: "KANJIDIC2",
            field: "korean_h",
            sourceIdentity,
            value: character.value,
            ...claim,
            rules: [...character.rules],
            transcription: { ...character.transcription },
          })),
        })),
      ),
    });
  }
  return { wordAlignments, witnesses };
}
