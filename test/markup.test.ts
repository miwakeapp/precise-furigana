import assert from "node:assert/strict";
import test from "node:test";
import { japanese, proseWithJapanese, ruby } from "../scripts/lib/markup.ts";

test("Japanese text is marked as Japanese, with markup characters escaped", () => {
  assert.equal(japanese("直す"), '<span lang="ja">直す</span>');
  assert.equal(japanese("<b>&"), '<span lang="ja">&#60;b&#62;&#38;</span>');
});

test("a divided word is one Japanese span, including the kana between its ruby", () => {
  assert.equal(
    ruby(["お", ["誕", "たん"], ["生", "じょう"], ["日", "び"]]),
    '<span lang="ja">お<ruby>誕<rt>たん</ruby><ruby>生<rt>じょう</ruby><ruby>日<rt>び</ruby></span>',
  );
});

test("prose has each quoted Japanese run marked, outside code spans", () => {
  assert.equal(
    proseWithJapanese("Contraction: に関しちゃ is short for に関しては, a real form."),
    'Contraction: <span lang="ja">に関しちゃ</span> is short for <span lang="ja">に関しては</span>, a real form.',
  );
  assert.equal(
    proseWithJapanese("The ー of ドロボー, as `ドロボー` & <more>."),
    'The <span lang="ja">ー</span> of <span lang="ja">ドロボー</span>, as `ドロボー` &#38; &#60;more&#62;.',
  );
  assert.equal(proseWithJapanese("No Japanese here."), "No Japanese here.");
});
