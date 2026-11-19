// The shapes that pass between modules. Types used by one module only live in that module.

/** One piece of a divided word: text shown plain, or a base with the reading shown over it. */
export type Segment = string | [base: string, reading: string];

/** What supports one segment of an alignment. Passes add their own details beside these. */
export interface Evidence {
  spelling: string;
  reading: string;
  /** How the segment was matched, such as "literal", "dictionary", "ambiguous" or "fallback". */
  type: string;
  /** The sound changes and transfer rules that were applied. */
  rules: string[];
  [detail: string]: unknown;
}

/**
 * "aligned": one best division was found. "ambiguous": several tied. "fallback": some characters
 * have no supported reading, so they are grouped. "reviewed": an annotation supplied the result.
 */
export type AlignmentStatus = "aligned" | "ambiguous" | "fallback" | "reviewed";

/** A reading divided among the parts of a spelling. */
export interface Alignment {
  segments: Segment[];
  status: AlignmentStatus;
  /** One item per segment, in order. */
  evidence?: Evidence[];
  score?: { unknownCharacters: number; cost: number };
  optimalPathCount?: string;
}

export type Aligner = (spelling: string, reading: string) => Alignment;

/** Spelling, then reading, to the segments established for that pair. */
export type WordAlignments = Map<string, Map<string, Segment[]>>;

/** A character or word to its readings. */
export type ReadingMap = Map<string, string[]>;

/** What a pass returns: the alignments it established, and a record of where each came from. */
export interface PassResult<Witness = unknown> {
  wordAlignments: WordAlignments;
  witnesses: Witness[];
}

// JMdict and KANJIDIC2 in the JSON form that jmdict-simplified publishes, with its own types.
export type {
  JMdict,
  JMdictKana,
  JMdictKanji,
  JMdictLanguageSource,
  JMdictSense,
  JMdictWord,
  Kanjidic2,
  Kanjidic2Character,
  Kanjidic2Reading,
} from "@scriptin/jmdict-simplified-types";

/** A spelling and a reading that JMdict permits together in one entry. */
export interface Pair {
  id: string;
  spelling: string;
  reading: string;
  /** The spelling's position among the entry's kanji forms; null for a kana-only pair. */
  kanjiIndex: number | null;
  readingIndex: number;
  kind: "kana" | "kanji";
  spellingTags: string[];
  readingTags: string[];
}

/** One element of an entry in the released database. */
export interface DatabaseRecord {
  spelling: string;
  reading: string;
  segments: Segment[];
  pairing?: "mispaired" | "phonetic" | "synthesized";
}

export interface Database {
  version: string;
  schemaVersion: number;
  jmdictDate: string;
  entries: Record<string, DatabaseRecord[]>;
}

/** Where a pinned source file came from, as `data/sources.lock.json` records it. */
export interface SourceIdentity {
  version?: string;
  dictDate?: string;
  jsonSHA256?: string;
  [field: string]: unknown;
}
