import assert from "node:assert/strict";
import test from "node:test";
import { createAligner } from "../src/align.mjs";
import { deriveReadingVariantAlignments } from "../src/reading-variants.mjs";

function dictionary(spelling, readings) {
  return {
    words: [
      {
        id: "1000000",
        kanji: [{ text: spelling, tags: [] }],
        kana: readings.map((text) => ({ text, tags: [], appliesToKanji: ["*"] })),
      },
    ],
  };
}

test("attested short and long readings can share independently supported character boundaries", () => {
  const align = createAligner({
    characterReadings: new Map([
      ["阿", ["ア"]],
      ["呆", ["ホウ"]],
    ]),
    wordReadings: new Map([["阿呆", ["あほう", "あほ"]]]),
  });
  const result = deriveReadingVariantAlignments(dictionary("阿呆", ["あほう", "あほ"]), align);
  assert.deepEqual(result.wordAlignments.get("阿呆").get("あほ"), [
    ["阿", "あ"],
    ["呆", "ほ"],
  ]);
});

test("unrelated readings and literal kana cannot borrow sound boundaries", () => {
  const align = createAligner({
    characterReadings: new Map([
      ["一", ["イチ"]],
      ["日", ["ニチ"]],
      ["遠", ["とお"]],
    ]),
    wordReadings: new Map([["一日", ["いちにち", "ついたち"]]]),
  });
  assert.equal(
    deriveReadingVariantAlignments(dictionary("一日", ["いちにち", "ついたち"]), align)
      .wordAlignments.size,
    0,
  );
  const changedLiteral = deriveReadingVariantAlignments(
    dictionary("遠い", ["とおい", "とい"]),
    align,
  );
  assert.deepEqual(changedLiteral.wordAlignments.get("遠い").get("とい"), [["遠", "と"], "い"]);
});

test("a lengthened reading cannot move an independently supported kanji boundary", () => {
  const jmdict = dictionary("見出す", ["みだす", "みいだす"]);
  const align = createAligner({
    characterReadings: new Map([
      ["見", ["み"]],
      ["出", ["だ.す", "い.だす"]],
    ]),
    wordReadings: new Map([["見出す", ["みだす", "みいだす"]]]),
  });
  const result = deriveReadingVariantAlignments(jmdict, align);
  assert.equal(result.wordAlignments.get("見出す")?.has("みいだす") ?? false, false);
});

test("reviewed exact target boundaries veto vowel ownership inferred from a shorter reading", () => {
  const jmdict = dictionary("玄人", ["くろと", "くろうと"]);
  const align = createAligner({
    characterReadings: new Map([
      ["玄", ["くろ"]],
      ["人", ["と"]],
    ]),
    wordReadings: new Map([["玄人", ["くろと", "くろうと"]]]),
  });
  const unguarded = deriveReadingVariantAlignments(jmdict, align);
  assert.deepEqual(unguarded.wordAlignments.get("玄人").get("くろうと"), [
    ["玄", "くろう"],
    ["人", "と"],
  ]);
  const targetAlignments = new Map([
    [
      "玄人",
      new Map([
        [
          "クロウト",
          [
            ["玄", "クロ"],
            ["人", "ウト"],
          ],
        ],
      ]),
    ],
  ]);
  const guarded = deriveReadingVariantAlignments(jmdict, align, { targetAlignments });
  assert.equal(guarded.wordAlignments.get("玄人")?.has("くろうと") ?? false, false);
  assert.deepEqual(align("玄人", "くろと").segments, [
    ["玄", "くろ"],
    ["人", "と"],
  ]);
  assert.deepEqual(align("玄人", "くろうと").segments, [["玄人", "くろうと"]]);
  assert.deepEqual(
    [...targetAlignments.get("玄人")],
    [
      [
        "クロウト",
        [
          ["玄", "クロ"],
          ["人", "ウト"],
        ],
      ],
    ],
  );
});

test("target constraints are scoped to the exact pair and cannot become transfer sources", () => {
  const primary = new Map([
    ["玄", ["くろ"]],
    ["人", ["と"]],
    ["阿", ["あ"]],
    ["呆", ["ホウ"]],
  ]);
  const align = createAligner({
    characterReadings: primary,
    wordReadings: new Map([
      ["玄人", ["くろと", "くろうと"]],
      ["阿呆", ["あほ", "あほう"]],
    ]),
  });
  const unrelated = new Map([
    [
      "玄人",
      new Map([
        [
          "くろーと",
          [
            ["玄", "くろ"],
            ["人", "ーと"],
          ],
        ],
      ]),
    ],
    [
      "黒人",
      new Map([
        [
          "くろうと",
          [
            ["黒", "くろ"],
            ["人", "うと"],
          ],
        ],
      ]),
    ],
  ]);
  assert.deepEqual(
    deriveReadingVariantAlignments(dictionary("玄人", ["くろと", "くろうと"]), align, {
      targetAlignments: unrelated,
    })
      .wordAlignments.get("玄人")
      .get("くろうと"),
    [
      ["玄", "くろう"],
      ["人", "と"],
    ],
  );
  const targetAlignments = new Map([
    [
      "阿呆",
      new Map([
        [
          "あほう",
          [
            ["阿", "あ"],
            ["呆", "ほう"],
          ],
        ],
      ]),
    ],
  ]);
  assert.deepEqual(
    deriveReadingVariantAlignments(dictionary("阿呆", ["あほう", "あほ"]), align, {
      targetAlignments,
    })
      .wordAlignments.get("阿呆")
      .get("あほ"),
    [
      ["阿", "あ"],
      ["呆", "ほ"],
    ],
  );
  const grouped = (spelling, reading) => ({ status: "aligned", segments: [[spelling, reading]] });
  assert.equal(
    deriveReadingVariantAlignments(dictionary("阿呆", ["あほう", "あほ"]), grouped, {
      targetAlignments,
    }).wordAlignments.size,
    0,
  );
});

test("target constraints reject invalid projections and malformed maps", () => {
  const jmdict = dictionary("甲乙", ["あい", "ああい"]),
    align = createAligner({ characterReadings: new Map() });
  assert.throws(
    () => deriveReadingVariantAlignments(jmdict, align, { targetAlignments: null }),
    TypeError,
  );
  assert.throws(
    () =>
      deriveReadingVariantAlignments(jmdict, align, { targetAlignments: new Map([["甲乙", []]]) }),
    TypeError,
  );
  assert.throws(
    () =>
      deriveReadingVariantAlignments(jmdict, align, {
        targetAlignments: new Map([["甲乙", new Map([["あい", [["甲", "あ"]]]])]]),
      }),
    /reconstruct/u,
  );
});

test("readings that differ by one kana share boundaries when the change cannot cross one", () => {
  const near = (spelling, readings, segments) => {
    const [from, to] = readings;
    const align = (_, reading) =>
      reading === from
        ? { status: "aligned", segments }
        : { status: "aligned", segments: [[spelling, reading]] };
    return deriveReadingVariantAlignments(dictionary(spelling, readings), align, {
      nearVariants: true,
    })
      .wordAlignments.get(spelling)
      ?.get(to);
  };
  // An added sokuon or long vowel extends the kana before it, wherever it falls.
  assert.deepEqual(
    near(
      "盤谷",
      ["バンコク", "バンコック"],
      [
        ["盤", "バン"],
        ["谷", "コク"],
      ],
    ),
    [
      ["盤", "バン"],
      ["谷", "コック"],
    ],
  );
  assert.deepEqual(
    near(
      "其方",
      ["そち", "そっち"],
      [
        ["其", "そ"],
        ["方", "ち"],
      ],
    ),
    [
      ["其", "そっ"],
      ["方", "ち"],
    ],
  );
  assert.deepEqual(
    near(
      "祖父",
      ["おじ", "おおじ"],
      [
        ["祖", "お"],
        ["父", "じ"],
      ],
    ),
    [
      ["祖", "おお"],
      ["父", "じ"],
    ],
  );
  // A dropped small kana leaves the rest of its segment.
  assert.deepEqual(
    near(
      "撞木",
      ["しゅもく", "しもく"],
      [
        ["撞", "しゅ"],
        ["木", "もく"],
      ],
    ),
    [
      ["撞", "し"],
      ["木", "もく"],
    ],
  );
  // A replaced kana stays in a segment that keeps another kana, or is the same kana respelled.
  assert.deepEqual(
    near(
      "壱越",
      ["いちこつ", "いちこち"],
      [
        ["壱", "いち"],
        ["越", "こつ"],
      ],
    ),
    [
      ["壱", "いち"],
      ["越", "こち"],
    ],
  );
  assert.deepEqual(
    near(
      "何処",
      ["いずこ", "いづこ"],
      [
        ["何", "いず"],
        ["処", "こ"],
      ],
    ),
    [
      ["何", "いづ"],
      ["処", "こ"],
    ],
  );
  // A segment's only kana cannot be replaced, a full kana cannot be added, and literal kana must match.
  assert.equal(
    near(
      "祖父",
      ["じじ", "じい"],
      [
        ["祖", "じ"],
        ["父", "じ"],
      ],
    ),
    undefined,
  );
  assert.equal(
    near(
      "茄子",
      ["なす", "なすび"],
      [
        ["茄", "な"],
        ["子", "す"],
      ],
    ),
    undefined,
  );
  assert.equal(
    near(
      "商人",
      ["あきうど", "あきびと"],
      [
        ["商", "あき"],
        ["人", "うど"],
      ],
    ),
    undefined,
  );
  assert.equal(near("食べる", ["たべる", "たべろ"], [["食", "た"], "べる"]), undefined);
  // A contracted sound stays with its character, even at the start of a segment.
  assert.deepEqual(
    near(
      "仕様",
      ["しよう", "しょう"],
      [
        ["仕", "し"],
        ["様", "よう"],
      ],
    ),
    [
      ["仕", "し"],
      ["様", "ょう"],
    ],
  );
});
