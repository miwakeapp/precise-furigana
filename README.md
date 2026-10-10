# Precise furigana

An independently implemented Node.js generator for furigana alignments covering every permitted spelling/reading pair in JMdict. The source of truth is the versioned generator, checksum-locked dictionaries and character-reading bundles, and documented lexical evidence and review annotations. Release JSON is a reproducible build product.

The project seeks the finest supported boundaries. 日本 becomes 日[に]本[ほん], 時計 becomes 時[と]計[けい], and phonetic ateji such as 珈琲 becomes 珈[コー]琲[ヒー]. Whole-word readings such as 大人[おとな] remain grouped when individual sound assignments lack support. Literal kana, sound changes, and alternate spellings provide additional evidence. A native word's history or a dictionary's whole-word ruby does not rule out a supported phonetic spelling assignment: each split is justified by character readings or evidence local to the named word.

The accepted local build has an aggregate boundary advantage over a frozen Lorenzi generator run on the same JMdict input. Across the 323,370 pairs where both outputs satisfy reconstruction and nonempty-segment requirements, independently reviewed source judgments give a conservative lower bound of **368 fewer boundary errors**. Every unresolved difference is charged against this generator. This is a finite-corpus, source-conditional result; it does not establish superiority on every word, absolute accuracy, or performance on future releases. [The quality audit](docs/quality-audit.md) gives the definition, counts, exclusions, and artifact bindings.

All 324,992 candidate records reconstruct their input exactly. The reference has 1,622 contract failures: 1,070 merely omit middle dots and are not counted as linguistic errors; the other 552 receive no boundary-loss judgment. Among jointly valid pairs, 321,029 have equal boundaries, 1,309 are finer here, 721 are coarser, and 311 conflict. Those geometric relations alone are not correctness labels.

The latest pass changes only reviewed data: 574 new local facts, one refinement to an existing fact, and three ownership corrections. The full build changes 580 records exactly as reviewed, with 889 added and three removed explicit boundaries. No runtime module or heuristic was added. The inventory now contains 1,900 local facts and 38 exact annotations. Remaining uncertain cases stay visible; preserving this measured output provides a baseline for subsequent simplification.

All work remains local, and no release has been published. The weekly workflow below is prepared for a future authorized publication. Historical blind panels and the probability audit remain frozen and are now retired as holdouts; their scores do not validate later versions. The present bound uses reviewed development evidence and pessimistic accounting of the complete disagreement population, rather than reusing those scores as an accuracy estimate.

## Run

Requires Node.js 22.2 or later. There are no npm dependencies and no published npm package.

The build and evaluation scripts request a 4 GiB V8 old-space limit for the complete corpus. The accepted full build was checked with this explicit limit; smaller runtime defaults have exhausted the heap during development.

```sh
npm ci
npm run fetch
npm test
npm run evaluate
npm run build
npm run validate
```

`fetch` downloads the exact upstream release pinned in `data/sources.lock.json`; subsequent generation runs offline. To deliberately choose the newest upstream release:

```sh
npm run fetch -- --update
npm run evaluate
npm run build
npm run validate
```

Downloads remain in `.cache/sources/`. Generated artifacts go into `dist/`. `validate` verifies complete pair coverage, reading restrictions, exact reconstruction, generator and source provenance, gzip contents, and file checksums. The evaluation is bound to the same generator, inputs, configuration, and regression fixtures as the database.

Inspect a word and the reasoning used for its boundaries:

```sh
npm run inspect -- 日本 にほん
npm run inspect -- 欠片 かけら
```

## Data format

The canonical release format is UTF-8 JSON, indexed by the original string JMdict ID. The gzip artifact contains exactly the same JSON. Compression handles repetitive property names well, while readable records make debugging, corrections, and schema evolution easier than a custom delimiter format. Original strings are preserved, including punctuation and kana script.

```json
{
  "schemaVersion": 1,
  "metadata": {},
  "entries": {
    "1582710": [
      {
        "written": "日本",
        "reading": "にほん",
        "segments": [["日", "に"], ["本", "ほん"]],
        "status": "aligned",
        "evidence": ["phonological", "character"]
      }
    ]
  }
}
```

The abbreviated example omits metadata and the second reading for readability. The complete schema is in [schema.json](schema.json).

- A string segment is literal text appearing identically in the written form and reading.
- A two-element array is `[written text, reading]`. Both values are nonempty.
- Concatenating segment text reconstructs `written` exactly; concatenating readings reconstructs `reading` exactly.
- Katakana spelling with hiragana reading uses a tuple, even when the kana are phonetically equivalent. Normalization is only for matching.
- A record exists for every permitted written-form/reading pair. Kana-only entries and explicitly standalone kana readings have literal records. Reading restrictions prevent invalid spelling/reading combinations. Search-only spellings remain included.
- Output order follows stable upstream entry/reading/spelling order. The source release, archive and JSON digests, generator digest, configuration, annotation digest, and counts are embedded in metadata. No build timestamp makes identical inputs produce different bytes.

`status` describes algorithmic support:

| Status | Meaning |
| --- | --- |
| `aligned` | The model found supported boundaries. This includes dictionary-backed whole-word groups and is not a correctness probability. |
| `ambiguous` | Equally scored best paths disagree, or an attested kana spelling differs from the reading. Tied paths retain only their shared boundaries. |
| `fallback` | Some reading assignment lacks dictionary or sound-change support. |
| `reviewed` | A documented, independently curated annotation supplies the alignment. |

`evidence` has one label per segment: `literal`, `character`, `phonological`, `dictionary`, `ambiguous`, `fallback`, or `reviewed`. The inspection command exposes detailed sound-change rules, graph scores, and any locally inferred sound assignment. Scores rank paths within a word; they are not calibrated confidence estimates. A whole-word JMdict edge always exists for source pairs, so an `aligned` result can still leave internal boundaries unresolved.

## Algorithm and experiments

The engine searches a weighted graph of positions in the written form and reading. Edges represent literal kana, KANJIDIC character readings, restricted productive sound changes, or attested JMdict word spans. An attested compound can stay grouped while surrounding words split. When best paths tie, the result contains only boundaries present in every best path.

A final bounded search can infer the remaining sound of one character in an attested word of two to six characters. Each proposed path allows at most three kana in that unsupported assignment, preserves every earlier boundary, and marks the result `fallback`. Fully supported refinements take precedence; inferred sounds never become evidence for other words. Guards withhold disputed particle boundaries, suspicious sound onsets, positional-numeral assignments, and independently reviewed unresolved cases. This inference improves coverage but does not turn the remaining sound into a verified character reading.

KANJIDIC okurigana annotations identify the part belonging to the character. Nanori, complete kun readings, and readings inferred from single-kanji JMdict spellings supply weaker evidence inside attested compounds. This supplementary evidence may add boundaries but cannot move stronger ones. Explicit irregular readings restrict weak extrapolation while preserving independently supported character and word boundaries.

When one spelling can be obtained from another spelling of the same entry by deleting kana, the fuller spelling can supply boundaries for the abbreviated form. For example, 書き換え supports 書[かき]換[か]え in 書換え. Kana-written siblings and single-kanji substitutions also provide local evidence. Reading restrictions still apply; ambiguous mappings, conflicting witnesses, and mappings that absorb a preceding character's okurigana are rejected. Transfers are local to the attested word, including occurrences within longer words.

Sound-change rules distinguish on-readings from kun-readings and preserve literal kana. Broadly truncating every reading would split 朔日 incorrectly. Voicing can also affect a dictionary compound unit, such as 相撲 in 花相撲. A constrained kana mismatch can preserve surrounding boundaries while explicitly reporting ambiguity. [The experiments](docs/experiments.md) record corpus-wide effects and rejected generalizations.

Phonetic ateji is a precision opportunity. A local refinement pass uses bounded correspondences between the spelling's on-readings and its attested sound, plus exact kun readings. A unique best character split can become reusable evidence for that word, including within compounds. The `ateji` tag alone does not justify a split, and the resulting readings do not become globally available for unrelated words.

Same-entry reading variants can establish vowel-length correspondences without moving a known boundary. Independently reviewed boundaries for the exact target word take precedence over these transfers: for example, 玄[くろ]人[うと] prevents a shorter くろと reading from assigning the extra vowel to 玄. Literal kana inside dictionary spans expose boundaries shared by every admissible placement; omitted particles remain localized rather than becoming invented character readings. Decimal and fullwidth spelling equivalents preserve supported surrounding boundaries, with positional numeral runs retained as units unless an explicitly reviewed local allocation establishes finer ownership.

Explicit Japanese readings from Unicode Unihan and pinned Japanese and English Wiktionary bundles add character evidence where KANJIDIC2 is incomplete. Exact allocations retain priority, source restrictions apply, and multiple complete allocations remain grouped. Dictionary definitions of standalone number words support alignments such as ３[スリー]Ｄ[ディー] and Ｇ[ジー]１０[テン].

The English bundle contains 3,560 distinct character/reading pairs across 2,243 characters, represented by 3,726 source records. Its importer reads pinned primary Wiktionary page revisions and retains complete on-readings, explicitly complete kun-readings, and explicitly marked character-reading prefixes. Unmarked kun forms and inferred truncations are excluded. The character-evidence pass uses exact sounds and preserves earlier boundaries. A separate final pass tests bounded sound changes in explicitly listed on-readings, recording the original source and transformation; kun-readings remain exact. These final allocations apply only to attested whole pairs and do not become general character readings. See [dictionary sources](docs/data-sources.md#english-wiktionary-character-readings) for the bundle digest, source provenance, and reproducible import command.

That listed-reading pass also combines exact sounds from the existing inventories so an allocation can use different sources for neighboring characters. It retains the restrictions and witnesses of each source, excludes a JMdict reading inferred from the target pair itself, and checks Korean transcription against the neighboring source syllables. A unique complete allocation can refine an opaque span while preserving every earlier boundary and explicit contrary lexical allocation. The v18 integration adds 298 boundaries across 258 records, including supported splits in 明日 and 海老, without an additional pipeline stage.

Listed Korean sound compatibility supplies another final refinement. Every character must have an explicit KANJIDIC2 `korean_h` reading whose bounded kana transcription matches one unique complete allocation of an attested pair. Eligibility requires an applicable Korean source-language tag or an all-katakana reading. The pass preserves existing boundaries, excludes liaison and assimilation contexts, and records the original source forms and transcription steps. These are local sound correspondences, including phonetic ateji, and do not establish Korean etymology. Its deliberately limited transcription follows [TUFS's kana description](https://www.tufs.ac.jp/ts/personal/choes/Jnotice.html), with [Korean sound-change contexts](https://www.korean.go.kr/front_eng/roman/roman_01.do) withheld. Use `--no-korean-readings` to disable this pass or `--no-untagged-katakana-korean` to require the source-language tag. Both switches work with build and evaluation commands.

On-reading spelling refinement recognizes equivalent long-vowel notation such as 警[ケー]察[サツ] from the listed ケイ and サツ readings. Each refined span needs a unique complete allocation and an actual notation change on an explicitly typed on reading; kun companions remain literal. It preserves earlier boundaries, applies the irregular-subword guards, and records the original KANJIDIC2 or typed Wiktionary forms. These exact-pair results do not become reusable character readings. Use `--no-on-reading-spelling` with build or evaluation to disable it; the existing Japanese and English character-source switches also govern its optional Wiktionary evidence.

A reviewed lexical dataset covers word-specific correspondences that should not become general pronunciation rules, including 可愛[かわい] as 可[か]愛[わい] and 真似[まね] as 真[ま]似[ね]. Each named unit records its sound evidence, sources, and two AI reviews. Some moderately supported facts have a single lexical source; independent reviews do not establish independent dictionary corroboration. Internal boundaries can refine a uniquely placed word occurrence across compatible existing cuts. Repeated occurrences are resolved separately, and already assigned literal kana retain their sound ownership. A longer reviewed context can reject a shorter word occurrence whose outer edge contradicts its explicit internal boundary; conflicting internal cuts remain unresolved. The final evidence passes also run without the lexical cuts; compatible results from both paths are combined so a coarse local fact cannot suppress a separately supported finer split. These reviews are development evidence, not a blind accuracy estimate or human lexicographer certification.

Supported word boundaries can also be reused after an independent allocation from the raw character sources. Source units contain two to eight Han characters, need evidence for every character, and must reproduce the earlier source-word alignment. A unique compatible occurrence can contribute internal cuts to a longer attested word, preserving uncertainty around unwritten particles. For example, 禍[まが]津[つ]日[ひ] supports 禍[まが]津[つ]日神[ひのかみ]. This is a single pass with no recursive learning; use `--no-source-unit-transfers` to disable it.

Silent middle dots need not prevent distant character alignment. An attested spelling without dots in the same entry supplies independently recomputed raw-dictionary boundaries for the dotted spelling, provided their readings match exactly. Cuts immediately beside a dot remain withheld because the format gives every segment a nonempty reading; other compatible cuts transfer while preserving every earlier boundary. Both spelling/reading pairs must satisfy JMdict restrictions. Without an attested sibling, a generated spelling can supply cuts only when there is exactly one complete allocation from literal kana and listed KANJIDIC character readings, and the independent raw aligner agrees. Generated spellings remain explicitly distinguished from attested evidence. Use `--no-virtual-separator-sources` to disable this alternative, or `--no-separator-transfers` to disable the entire pass.

Alternate spellings can also preserve boundaries inside a shared stretch of text. Both spellings need the same permitted reading, and the source's independently recomputed raw alignment must agree with its earlier accepted boundaries. Only a uniquely placed complete shared stretch supplies internal cuts; its outer edges remain withheld, earlier target cuts survive, and conflicting local evidence vetoes the transfer. For example, 奈良時代 can support 寧楽時[ならじ]代[だい] without assigning the sound なら to either unfamiliar character. For equal-length spellings with unchanged Han positions, independently owned kana can also correspond through script, historical spelling, voicing, or vowel-mark differences. The donor must establish each changed kana’s one-to-one sound ownership; ambiguous or inferred kana anchors cannot supply it. Existing shared-run cuts are retained before a whole-spelling kana projection is applied. This final nonrecursive pass is disabled by `--no-shared-run-transfers` or `--no-variants`.

Regular verb continuatives, derived from JMdict conjugation classes, can supply omitted okurigana before another kanji: 植える supports 植[うえ] in 植木鉢. These remain weaker than direct character evidence and require an exact attested compound context. Irregular classes, expressions, and detectable verb compounds are excluded. Their corpus ablation produced 785 additional splits without shifting an existing boundary; the audited sample and remaining uncertainty are documented in the experiments.

The hand-authored regression suite covers regular compounds, irregular readings, kana boundaries, voicing, gemination, iteration marks, search-only spellings, and reported defects in other datasets. It is deliberately challenging and is **not** a random held-out sample of the dictionary. Unit tests additionally cover ambiguity, malformed input, source restrictions, Unicode preservation, and release integrity.

Compare any two complete builds and retain every changed pair:

```sh
npm run compare -- before.json after.json --output dist/changes.jsonl
```

Independent switches support experiments without editing source:

```sh
npm run build -- --no-contraction --output .cache/no-contraction
npm run build -- --no-phonology --output .cache/no-phonology
npm run build -- --learn-readings --output .cache/learned
npm run build -- --no-variants --output .cache/no-variants
npm run build -- --no-continuatives --output .cache/no-continuatives
```

Global reading learning is experimental and disabled by default: improvements in coverage can introduce wrong character boundaries. Nondefault configurations cannot be published by the release script.

The optional reference comparison reads a **separately obtained** Lorenzi snapshot from `.cache/reference/furigana.txt`:

```sh
npm run compare:reference
```

It writes complete disagreements and a bounded diagnostic summary to `dist/`. Reference agreement is not accuracy: the reference contains known errors, excludes whole-word alignments, and includes name-dictionary records. The comparator joins actual JMdict IDs, accounts for kana script and legacy empty-base segments, and reports unmatched or ambiguous rows separately. Reference files are neither generator inputs nor release assets.

## Weekly releases

[The release workflow](.github/workflows/release.yml) is configured for Tuesdays at 12:17 JST, after the usual upstream Monday release. It also supports manual dispatch from the default branch. Once deployed, it resolves the latest complete upstream source release, runs tests and the regression suite, builds and validates the database, and creates a content-addressed GitHub release. No generated data or source-lock update is pushed to the default branch; the exact updated lock is included in each release.

Assets are `precise-furigana.json`, `precise-furigana.json.gz`, `manifest.json`, `sources.lock.json`, `evaluation.json`, `schema.json`, and `NOTICE`. Repeated identical builds reuse the existing release. An incomplete existing release fails explicitly and needs inspection; it is never silently treated as successful. Changed generator output produces a different release tag even if upstream data is unchanged.

Preview the release title, tag, and notes locally without publishing:

```sh
node scripts/release.mjs
```

Publishing requires `--publish`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, and `GH_TOKEN`; the workflow supplies them. A GitHub remote and an authorized initial publication are needed to activate scheduled releases. GitHub schedules are best-effort; they do not promise an exact release time.

## Corrections and licensing

The generator was written without access to other furigana implementations. A separate research agent examined public behavior and reported cases; only behavioral requirements were passed to the implementer. No upstream source code or exception list was imported.

`data/annotations.json` contains narrowly scoped, independently justified corrections that must replace an existing allocation. Each annotation identifies the JMdict ID, exact spelling and reading, segments, rationale, and sources. Duplicate or stale annotations fail the build. The 38 current records include corrections to 鶏冠, 長刀, 敷詰める, 果敢無い, vowel ownership in 豆豉醤, and spellings with omitted particles. Other reviewed lexical facts refine compatible boundaries through `data/lexical-evidence.json`.

Lexical facts remain local unless their `reusableSegments` indices explicitly identify reviewed, complete character sounds. These sounds enter the existing exact search with their source provenance and donor-family exclusions. This lets one documented allocation improve related words without creating a separate exception for each. Local contractions and raw foreign transcription evidence retain their context restrictions.

Original code is [MIT licensed](LICENSE). Generated data, reviewed lexical facts, annotations, and dictionary-derived test data are **CC BY-SA 4.0**, with attribution to EDRDG, Wiktionary contributors, and the reviewed JmdictFurigana candidate data. Unicode Unihan's license notice is also preserved. See [NOTICE](NOTICE) and [dictionary sources](docs/data-sources.md). Reproducible inputs and automated refreshes make data maintenance independent of a dictionary application's deployment cycle.
