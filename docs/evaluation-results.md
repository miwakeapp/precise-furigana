# Frozen diagnostic evaluation

Historical checkpoint: this panel was retired as a holdout during parity-first development on 2026-10-09. Its original artifacts and scores remain unchanged. Reviewed source evidence may now inform development; neither the old labels nor their scores provide an independent accuracy test of later generators. A new superiority claim requires a fresh evaluation.

The improved generator adds substantial supported detail without a measured regression against the initial generator in this panel. It has fewer unsupported boundaries than Lorenzi's reference, while Lorenzi still supplies more of the supported boundaries. This result does **not** establish corpus-wide superiority under the target of the finest supported alignment.

The candidate was frozen before scoring, and all labels were frozen before either system's alignments were shown to the adjudicators. The [evaluation protocol](evaluation-protocol.md) describes selection, independent second annotation, uncertainty, and limitations. Individual cases were quarantined during this evaluation; this historical report contains aggregates only.

## Resolved panel

Of 427 selected spelling–reading span families, two were excluded for prior exposure and 21 remain unresolved. The remaining 404 scored families belong to 396 distinct JMdict entries.

| System | Exact accepted alignment | Coarser than accepted | Contains unsupported boundaries | Unsupported boundary count | Missed boundary count |
| --- | ---: | ---: | ---: | ---: | ---: |
| Improved generator | 262 | 138 | 4 | 4 | 229 |
| Initial generator | 117 | 283 | 4 | 4 | 482 |
| Lorenzi reference | 326 | 11 | 67 | 72 | 87 |

“Unsupported” means absent from the accepted annotation, not an independently proven linguistic error. A coarser result omits supported boundaries but does not assert an unsupported one. Exactness accepts explicitly recorded alternatives, including numeral and omitted-particle rendering conventions. Boundary counts include target-span anchors, so a candidate that groups across the target span can miss those anchors too.

Compared with the initial generator, the improved generator dominates on 151 families, ties on 253, and loses on none. Compared with Lorenzi, it dominates on 66, loses on 125, ties on 209, and has four tradeoffs. Dominance requires no more unsupported boundaries and no more missed boundaries, with a strict improvement in at least one count; no arbitrary cost ratio collapses tradeoffs.

After grouping repeated entries, the comparison with Lorenzi has 63 generator-dominant entries, 123 reference-dominant entries, 206 ties, and four mixed or tradeoff entries. Entry grouping reduces one source of dependence but does not make all underlying linguistic phenomena independent.

## High-confidence subset

There are 281 eligible high-confidence cases after the exposure exclusions.

| System | Exact | Coarser | Contains unsupported boundaries | Unsupported boundary count | Missed boundary count |
| --- | ---: | ---: | ---: | ---: | ---: |
| Improved generator | 213 | 68 | 0 | 0 | 128 |
| Initial generator | 108 | 173 | 0 | 0 | 313 |
| Lorenzi reference | 217 | 8 | 56 | 61 | 78 |

The improved generator dominates the reference on 57 high-confidence families, loses on 56, ties on 164, and has four tradeoffs. At entry level, the respective win counts are 54 and 54. All 60 exact-agreement controls match the accepted labels for both systems. These counts support improved boundary safety and substantial gains over the initial implementation; they do not demonstrate that the remaining coverage gap has been closed.

## Selection strata

Strata describe the initial generator's diagnostic relationship to the reference, before the evaluated improvements. They are not final quality labels.

| Initial diagnostic stratum | Scored families | Generator dominates | Reference dominates | Tied | Tradeoff |
| --- | ---: | ---: | ---: | ---: | ---: |
| One missing character reading | 136 | 2 | 50 | 84 | 0 |
| Multiple missing character readings | 69 | 8 | 43 | 17 | 1 |
| Mixed kana span | 50 | 1 | 20 | 29 | 0 |
| Missing word unit | 23 | 2 | 9 | 12 | 0 |
| Incompatible boundaries | 59 | 48 | 3 | 5 | 3 |
| Initially finer | 7 | 5 | 0 | 2 | 0 |
| Exact-agreement controls | 60 | 0 | 0 | 60 | 0 |

The sample intentionally overrepresents rare incompatible boundaries relative to the much larger population of coarser results. Consequently, neither the raw win totals nor the exact/unsupported proportions are corpus-level accuracy estimates. A corpus-wide comparison requires a defensible sampling and weighting design covering the final disagreement population, together with further independent adjudication. The current panel was annotated by AI assistants, not human Japanese lexicographers.

## Reproducibility

- Candidate dataset SHA-256: `ff46c27a11ad425aa9524e8208419bbecd93d1f12e4ce75fbc21115889d4f7be`.
- Initial dataset SHA-256: `8472c2616b1fd67a8914ca6b1c5653af548d048066485db8ca35347b7b5008ff`.
- Lorenzi reference SHA-256: `1bb73eb2425f3813efed40ce67f0da65a6359c6fcb163d9304b9b3910f548b37`.
- Reconciled label SHA-256: `8a2bc9c8cfa3bc508273be2d69de1383f5c6a3a6cff4859c07d35b09752a9530`.
- Run: `node scripts/evaluate-holdout.mjs .cache/experiments/superiority-frozen-v3/precise-furigana.json`.
- Private outputs: `.cache/holdout-v1/evaluation/summary.json` and `cases.jsonl`.

The evaluation code is separate from the generator and does not affect the generator digest or require the reference during generation. Tests exercise literal kana normalization, supported versus unsupported boundaries, accepted alternatives, target location, and metric tradeoffs.
