// Japanese text for GitHub to render, in release notes and pull request descriptions.
//
// Japanese and Chinese share code points for kanji whose shapes differ between them, and a
// browser decides which shape to draw from the text's declared language. GitHub's pages declare
// English, which leaves the choice to each reader's own settings, so everything Japanese is
// marked as such.
import type { Segment } from "../../src/types.ts";

export const escapeHTML = (text: string) =>
  text.replace(/[&<>]/gu, (unit) => `&#${unit.codePointAt(0)};`);

/** A Japanese word or phrase. */
export const japanese = (text: string) => `<span lang="ja">${escapeHTML(text)}</span>`;

/** A divided word, with its furigana as ruby. */
export const ruby = (segments: Segment[]) =>
  `<span lang="ja">${segments
    .map((segment) =>
      typeof segment === "string"
        ? escapeHTML(segment)
        : `<ruby>${escapeHTML(segment[0])}<rt>${escapeHTML(segment[1])}</ruby>`,
    )
    .join("")}</span>`;

const japaneseRun =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆・、。]*/gu;

/** English prose that quotes Japanese, with each quoted run marked. Code spans are left alone. */
export const proseWithJapanese = (text: string) =>
  text
    .split(/(`[^`]*`)/u)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : escapeHTML(part).replace(japaneseRun, (run) => `<span lang="ja">${run}</span>`),
    )
    .join("");
