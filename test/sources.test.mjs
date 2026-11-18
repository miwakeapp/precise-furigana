import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { extractJSONFromTGZ, fetchSources } from "../scripts/fetch-sources.mjs";
import {
  enumeratePairs,
  loadSources,
  makeCharacterReadings,
  makeIrregularWordReadings,
  makeNanoriReadings,
  makeWordReadings,
  sha256,
} from "../src/sources.mjs";

function kanji(text, tags = []) {
  return { text, tags, common: false };
}

function kana(text, appliesToKanji = ["*"], tags = []) {
  return { text, appliesToKanji, tags, common: false };
}

test("reading restrictions prevent an invalid Cartesian product", () => {
  const words = [
    {
      id: "1234567",
      kanji: [kanji("大人"), kanji("成人")],
      kana: [kana("おとな", ["大人"], ["gikun"]), kana("せいじん", ["成人"]), kana("せいにん")],
    },
  ];
  const pairs = [...enumeratePairs({ words })];
  assert.deepEqual(
    pairs.map((pair) => [pair.spelling, pair.reading]),
    [
      ["大人", "おとな"],
      ["成人", "せいじん"],
      ["大人", "せいにん"],
      ["成人", "せいにん"],
    ],
  );
  assert.equal(pairs[0].id, "1234567");
  assert.equal(pairs[1].kanjiIndex, 1);
  assert.equal(pairs[1].readingIndex, 1);
  assert.deepEqual(pairs[0].readingTags, ["gikun"]);
});

test("no-kanji readings remain separate even inside an entry with written forms", () => {
  const words = [
    { id: "1234567", kanji: [kanji("珈琲")], kana: [kana("コーヒー"), kana("カフェ", [])] },
    { id: "1234568", kanji: [], kana: [kana("ありがとう")] },
  ];
  const pairs = [...enumeratePairs({ words })];
  assert.deepEqual(
    pairs.map((pair) => [pair.spelling, pair.reading, pair.kind]),
    [
      ["珈琲", "コーヒー", "kanji"],
      ["カフェ", "カフェ", "kana"],
      ["ありがとう", "ありがとう", "kana"],
    ],
  );
  assert.equal(pairs[1].kanjiIndex, null);
  assert.equal(pairs[2].kanjiIndex, null);
});

test("unknown spelling restrictions and missing restrictions fail instead of inventing pairs", () => {
  const word = { id: "1234567", kanji: [kanji("日")], kana: [kana("ひ", ["月"])] };
  assert.throws(() => [...enumeratePairs({ words: [word] })], /Unknown restricted spelling/u);
  delete word.kana[0].appliesToKanji;
  assert.throws(() => [...enumeratePairs({ words: [word] })], /Missing reading restrictions/u);
});

test("character evidence preserves okurigana and affix annotations, excluding name and non-Japanese readings", () => {
  const characters = [
    {
      literal: "食",
      readingMeaning: {
        groups: [
          {
            readings: [
              { type: "ja_on", value: "ショク" },
              { type: "ja_kun", value: "た.べる" },
              { type: "ja_kun", value: "-ぐ.い" },
              { type: "pinyin", value: "shi2" },
              { type: "ja_on", value: "ショク" },
            ],
          },
        ],
        nanori: ["け"],
      },
    },
    { literal: "𠮟", readingMeaning: null },
  ];
  assert.deepEqual(
    [...makeCharacterReadings({ characters })],
    [["食", ["ショク", "た.べる", "-ぐ.い"]]],
  );
});

test("name readings remain separate from ordinary character readings and deduplicate exactly", () => {
  const kanjidic = {
    characters: [
      {
        literal: "井",
        readingMeaning: {
          groups: [{ readings: [{ type: "ja_kun", value: "い" }] }],
          nanori: ["いの", "さい", "いの"],
        },
      },
      {
        literal: "食",
        readingMeaning: {
          groups: [{ readings: [{ type: "ja_on", value: "ショク" }] }],
          nanori: [],
        },
      },
      { literal: "𠮟", readingMeaning: null },
    ],
  };
  assert.deepEqual([...makeNanoriReadings(kanjidic)], [["井", ["いの", "さい"]]]);
  assert.deepEqual(
    [...makeCharacterReadings(kanjidic)],
    [
      ["井", ["い"]],
      ["食", ["ショク"]],
    ],
  );
});

test("word evidence deduplicates valid pairs without guessing readings for individual characters", () => {
  const words = [
    { id: "1234567", kanji: [kanji("大人"), kanji("成人")], kana: [kana("おとな", ["大人"])] },
    { id: "1234568", kanji: [kanji("大人")], kana: [kana("おとな"), kana("たいじん")] },
    { id: "1234569", kanji: [], kana: [kana("ありがとう")] },
  ];
  assert.deepEqual([...makeWordReadings({ words })], [["大人", ["おとな", "たいじん"]]]);
});

test("irregular word evidence respects both pair restrictions and spelling-specific ateji tags", () => {
  const words = [
    {
      id: "1234567",
      kanji: [kanji("明日"), kanji("翌日")],
      kana: [kana("あす", ["明日"], ["gikun"]), kana("みょうにち", ["明日"])],
    },
    { id: "1234568", kanji: [kanji("明日")], kana: [kana("あす", ["*"], ["gikun"])] },
    {
      id: "1234569",
      kanji: [kanji("阿呆", ["ateji"]), kanji("阿房")],
      kana: [kana("あほ", ["*"], ["gikun"])],
    },
    { id: "1234570", kanji: [kanji("昨日")], kana: [kana("きのう", [], ["gikun"])] },
  ];
  assert.deepEqual(
    [...makeIrregularWordReadings({ words })],
    [
      ["明日", ["あす"]],
      ["阿房", ["あほ"]],
    ],
  );
});

function makeTGZ(files) {
  const chunks = [];
  for (const [name, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    header.fill(32, 148, 156);
    header[156] = 48;
    const checksum = header.reduce((total, value) => total + value, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test("archive extraction selects one JSON member and rejects ambiguous archives", () => {
  const bytes = extractJSONFromTGZ(
    makeTGZ({ "LICENSE.txt": "license", "dictionary.json": '{"words":[]}' }),
  );
  assert.equal(bytes.toString(), '{"words":[]}');
  assert.throws(
    () => extractJSONFromTGZ(makeTGZ({ "a.json": "{}", "b.json": "{}" })),
    /exactly one JSON/u,
  );
  assert.throws(
    () => extractJSONFromTGZ(makeTGZ({ "README.txt": "no dictionary" })),
    /No JSON file/u,
  );
});

test("locked acquisition and loading verify archives and JSON independently", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "precise-furigana-sources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "sources.lock.json");
  const lock = { schemaVersion: 1, sources: {} };
  for (const [name, dictionary] of Object.entries({
    jmdict: { commonOnly: false, words: [], version: "3.6.2", dictDate: "2026-01-01" },
    kanjidic: { characters: [], version: "3.6.2", dictDate: "2026-01-01" },
  })) {
    const json = JSON.stringify(dictionary);
    const archive = makeTGZ({ [`${name}.json`]: json });
    const source = {
      asset: `${name}.json.tgz`,
      file: `${name}.json`,
      sha256: sha256(archive),
      jsonSHA256: sha256(Buffer.from(json)),
      bytes: archive.length,
    };
    lock.sources[name] = source;
    await writeFile(join(directory, source.asset), archive);
  }
  await writeFile(lockPath, JSON.stringify(lock));
  const before = await readFile(lockPath, "utf8");
  await fetchSources({ cacheDirectory: directory, lockPath });
  assert.equal(await readFile(lockPath, "utf8"), before);
  const sources = await loadSources({ cacheDirectory: directory, lockPath });
  assert.deepEqual(sources.jmdict.words, []);
  await writeFile(join(directory, "jmdict.json"), '{"words": ["tampered"]}');
  await assert.rejects(loadSources({ cacheDirectory: directory, lockPath }), /Checksum mismatch/u);
  await fetchSources({ cacheDirectory: directory, lockPath });
  assert.deepEqual((await loadSources({ cacheDirectory: directory, lockPath })).jmdict.words, []);
  const unihanText = "U+5FC3\tkJapanese\tシン こころ\n";
  lock.lexicalSources = {
    unihan: { file: "Unihan-Readings.txt", textSHA256: sha256(Buffer.from(unihanText)) },
  };
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(join(directory, "Unihan-Readings.txt"), unihanText);
  assert.equal((await loadSources({ cacheDirectory: directory, lockPath })).unihanText, unihanText);
  await writeFile(join(directory, "Unihan-Readings.txt"), unihanText.replace("こころ", "invalid"));
  await assert.rejects(
    loadSources({ cacheDirectory: directory, lockPath }),
    /Checksum mismatch for cached Unihan/u,
  );
  await writeFile(join(directory, "jmdict.json.tgz"), "corrupt archive");
  await assert.rejects(
    fetchSources({ cacheDirectory: directory, lockPath }),
    /Checksum or size mismatch/u,
  );
});
