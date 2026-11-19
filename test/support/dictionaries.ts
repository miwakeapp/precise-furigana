// Tests build dictionaries from only the fields the code under test reads. These wrappers check
// the fields a fixture does give against jmdict-simplified's types, and let it omit the rest.
import type {
  JMdict,
  JMdictKana,
  JMdictKanji,
  JMdictSense,
  JMdictWord,
  Kanjidic2,
  Kanjidic2Character,
  Kanjidic2Reading,
} from "../../src/types.ts";

/** `T` with every field optional, at every depth. */
export type Loose<T> = T extends (infer Item)[]
  ? Loose<Item>[]
  : T extends object
    ? { [Key in keyof T]?: Loose<T[Key]> }
    : T;

export const jmdict = (fixture: Loose<JMdict>) => fixture as JMdict;
export const jmdictWord = (fixture: Loose<JMdictWord>) => fixture as JMdictWord;
export const jmdictKanji = (fixture: Loose<JMdictKanji>) => fixture as JMdictKanji;
export const jmdictKana = (fixture: Loose<JMdictKana>) => fixture as JMdictKana;
export const jmdictSense = (fixture: Loose<JMdictSense>) => fixture as JMdictSense;
export const kanjidic = (fixture: Loose<Kanjidic2>) => fixture as Kanjidic2;
export const kanjidicCharacter = (fixture: Loose<Kanjidic2Character>) =>
  fixture as Kanjidic2Character;
export const kanjidicReading = (fixture: Loose<Kanjidic2Reading>) => fixture as Kanjidic2Reading;
