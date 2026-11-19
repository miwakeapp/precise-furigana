import { isKana, normalizeKana, splitGraphemes } from "./kana.ts";
import { enumeratePairs } from "./sources.ts";

const hanGraphemePattern = /^\p{Unified_Ideograph}[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]*$/u;
// Ordinary continuatives: https://a2.marugotoweb.jp/ja/grammar/reference/002.html
// Special JMdict conjugation classes intentionally have no rule here.
const regularEndings = new Map([
  ["v1", ["る", ""]],
  ["v5b", ["ぶ", "び"]],
  ["v5g", ["ぐ", "ぎ"]],
  ["v5k", ["く", "き"]],
  ["v5m", ["む", "み"]],
  ["v5n", ["ぬ", "に"]],
  ["v5r", ["る", "り"]],
  ["v5s", ["す", "し"]],
  ["v5t", ["つ", "ち"]],
  ["v5u", ["う", "い"]],
]);

function allows(restrictions, text) {
  return restrictions.includes("*") || restrictions.includes(text);
}

function isVerbClass(partOfSpeech) {
  return /^v(?:[1-5]|[knrsz])/u.test(partOfSpeech);
}

function countIdeographs(text) {
  return splitGraphemes(text).filter((grapheme) => hanGraphemePattern.test(grapheme)).length;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Produce weak, dictionary-gated continuative candidates; these are not unrestricted character readings. */
export function deriveContinuativeReadings(jmdict) {
  const candidates = [];
  const verbReadings = new Set();

  for (const word of jmdict.words) {
    const pairs = [...enumeratePairs({ words: [word] })];
    const compoundReadings = new Set(
      pairs
        .filter((pair) => pair.kind === "kanji" && countIdeographs(pair.spelling) > 1)
        .map((pair) => pair.reading),
    );
    for (const pair of pairs) {
      if (pair.readingTags.some((tag) => tag === "ik" || tag === "sk") || !isKana(pair.reading))
        continue;
      const senses = word.sense.filter(
        (sense) =>
          allows(sense.appliesToKanji, pair.spelling) && allows(sense.appliesToKana, pair.reading),
      );
      const partsOfSpeech = new Set(senses.flatMap((sense) => sense.partOfSpeech));
      const classes = [...partsOfSpeech].filter(isVerbClass);
      const normalizedReading = normalizeKana(pair.reading);
      if (classes.length > 0) verbReadings.add(normalizedReading);
      if (
        pair.kind !== "kanji" ||
        classes.length !== 1 ||
        !regularEndings.has(classes[0]) ||
        partsOfSpeech.has("exp")
      )
        continue;
      if (compoundReadings.has(pair.reading)) continue;

      const graphemes = splitGraphemes(pair.spelling);
      if (
        graphemes.length < 2 ||
        !hanGraphemePattern.test(graphemes[0]) ||
        !graphemes.slice(1).every(isKana)
      )
        continue;
      const okurigana = normalizeKana(graphemes.slice(1).join(""));
      if (!normalizedReading.endsWith(okurigana) || normalizedReading.length <= okurigana.length)
        continue;
      const [ending, replacement] = regularEndings.get(classes[0]);
      if (!okurigana.endsWith(ending) || !normalizedReading.endsWith(ending)) continue;
      const normalizedSpelling = graphemes[0] + okurigana;
      const stem = normalizedReading.slice(0, -ending.length) + replacement;
      const spellingStem = normalizedSpelling.slice(0, -ending.length) + replacement;
      if (!stem) continue;
      candidates.push({
        character: graphemes[0],
        normalizedSpelling,
        normalizedReading,
        spellingStem,
        id: pair.id,
        spelling: pair.spelling,
        reading: pair.reading,
        stem,
      });
    }
  }

  const byCharacter = new Map();
  for (const candidate of candidates) {
    const existing = byCharacter.get(candidate.character);
    if (existing === undefined) byCharacter.set(candidate.character, [candidate]);
    else existing.push(candidate);
  }
  const readings = new Map();
  const witnesses = [];
  const witnessed = new Set();
  candidates.sort(
    (left, right) =>
      compareText(left.character, right.character) ||
      compareText(left.stem, right.stem) ||
      compareText(left.id, right.id) ||
      compareText(left.spelling, right.spelling),
  );
  for (const candidate of candidates) {
    const compound = byCharacter.get(candidate.character).some((base) => {
      if (
        !candidate.normalizedSpelling.startsWith(base.spellingStem) ||
        !candidate.normalizedReading.startsWith(base.stem)
      )
        return false;
      const spellingSuffix = candidate.normalizedSpelling.slice(base.spellingStem.length);
      const readingSuffix = candidate.normalizedReading.slice(base.stem.length);
      return (
        spellingSuffix !== "" && spellingSuffix === readingSuffix && verbReadings.has(readingSuffix)
      );
    });
    if (compound) continue;
    const values = readings.get(candidate.character);
    if (values === undefined) readings.set(candidate.character, [candidate.stem]);
    else if (!values.includes(candidate.stem)) values.push(candidate.stem);
    const witness = {
      id: candidate.id,
      spelling: candidate.spelling,
      reading: candidate.reading,
      stem: candidate.stem,
    };
    const key = JSON.stringify(witness);
    if (!witnessed.has(key)) {
      witnessed.add(key);
      witnesses.push(witness);
    }
  }
  return { readings, witnesses };
}
