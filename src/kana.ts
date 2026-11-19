const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const kanaVowels = new Map(
  [
    ["あかがさざただなはばぱまゃやらゎわぁ", ["あ"]],
    ["いきぎしじちぢにひびぴみりゐぃ", ["い"]],
    ["うくぐすずつづぬふぶぷむゅゆるぅゔ", ["う"]],
    ["えけげせぜてでねへべぺめれゑぇ", ["え", "い"]],
    ["おこごそぞとどのほぼぽもょよろをぉ", ["お", "う"]],
  ].flatMap(([characters, vowels]) => Array.from(characters, (character) => [character, vowels])),
);

// Characters that can join a neighbor into one grapheme cluster: extending characters such as the
// half-width dakuten in ｶﾞ, other combining and spacing marks (including Thai and Lao SARA AM), format
// characters such as ZWJ, emoji modifiers, regional indicators, Hangul jamo, and CR. Text without them
// splits into graphemes exactly at code points.
const mayJoin =
  /[\p{Grapheme_Extend}\p{M}\p{Cf}\u0e33\u0eb3\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff\r\u{1f1e6}-\u{1f1ff}\u{1f3fb}-\u{1f3ff}]/u;

/**
 * Punctuation that separates words, and the double hyphen that joins names, is not read. A
 * symbol that is read aloud is never silent: ％ is パーセント, ＆ is アンド, and a wave dash can
 * be から.
 */
export function isSilentPunctuation(unit) {
  return /^(\p{P}|[＝=])$/u.test(unit) && !/^[〜～％%＆&＠@＃#＊*]$/u.test(unit);
}

/** Split text without separating a combining mark from its base character. */
export function splitGraphemes(text) {
  if (!mayJoin.test(text)) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

// Hiragana, the long-vowel mark, 々, and unified ideographs are unchanged by normalization.
const alreadyNormal = /^[\u3041-\u3096\u30fc\u3005\u3400-\u4dbf\u4e00-\u9fff]*$/u;

/** Normalize only for comparison; callers retain the original text for output. */
export function normalizeKana(text) {
  if (alreadyNormal.test(text)) return text;
  return text
    .normalize("NFKC")
    .replace(/[\u30a1-\u30f6]/gu, (character) =>
      String.fromCodePoint(character.codePointAt(0) - 0x60),
    )
    .normalize("NFC");
}

export function getKanaVowels(text) {
  return kanaVowels.get(normalizeKana(text));
}

/** Comparison key for standard long-vowel notation, not a phonetic transcription. */
export function kanaPronunciation(text) {
  let result = "";
  let precedingVowels;
  for (const character of Array.from(normalizeKana(text))) {
    if (character === "ー" || precedingVowels?.includes(character)) {
      result += "ー";
    } else {
      result += character;
      precedingVowels = kanaVowels.get(character);
    }
  }
  return result;
}

/**
 * Preserve kana boundaries inside a shared pronunciation skeleton.
 * A caller must separately establish that any vowel-length change is licensed.
 */
export function alignKanaPronunciations(spelling, reading) {
  const blocks = (text) => {
    const result = [];
    let precedingVowels;
    for (const unit of splitGraphemes(text)) {
      const character = normalizeKana(unit);
      if (Array.from(character).length !== 1) return undefined;
      if (character === "ー" || precedingVowels?.includes(character)) {
        if (!result.length) return undefined;
        result.at(-1).long.push(unit);
      } else {
        result.push({ character, unit, long: [] });
        precedingVowels = getKanaVowels(character);
      }
    }
    return result;
  };
  const left = blocks(spelling);
  const right = blocks(reading);
  if (
    !left ||
    !right ||
    left.length !== right.length ||
    left.some((block, index) => block.character !== right[index].character)
  )
    return undefined;
  const result = [];
  for (let index = 0; index < left.length; ++index) {
    const source = left[index];
    const target = right[index];
    if (source.long.length === target.long.length) {
      result.push([source.unit, target.unit]);
      for (let longIndex = 0; longIndex < source.long.length; ++longIndex)
        result.push([source.long[longIndex], target.long[longIndex]]);
    } else {
      const pair = [source.unit + source.long.join(""), target.unit + target.long.join("")];
      if (
        /^[ゃゅょぁぃぅぇぉゎ]$/u.test(source.character) &&
        index > 0 &&
        left[index - 1].long.length === 0 &&
        right[index - 1].long.length === 0
      ) {
        const previous = result.pop();
        pair[0] = previous[0] + pair[0];
        pair[1] = previous[1] + pair[1];
      }
      result.push(pair);
    }
  }
  return result;
}

export function isKana(text) {
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー\u3099\u309a]+$/u.test(text.normalize("NFKC"));
}

export function isIdeograph(text) {
  return /^(?:\p{Unified_Ideograph}|々|〆|〇)[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]*$/u.test(text);
}

/** KANJIDIC dots separate the written kanji's reading from its okurigana. */
export function readingStem(reading) {
  return normalizeKana(reading.replace(/^-|-$/gu, "").split(".")[0]);
}
