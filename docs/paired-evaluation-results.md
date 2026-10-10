# Paired probability audit

Historical checkpoint: this panel was retired as a holdout during parity-first development on 2026-10-09. Its original artifacts and scores remain unchanged. Reviewed source evidence may now inform development; neither the old labels nor their scores provide an independent accuracy test of later generators. A new superiority claim requires a fresh evaluation.

The first frozen probability audit does **not establish corpus-wide superiority**. The candidate-minus-reference difference in exact accepted alignment rate has a conservative 95% interval of **−0.888 to +0.784 percentage points** over the comparable population. Neither system's overall advantage is established. The [predeclared protocol](paired-evaluation-protocol.md) specifies the target, sampling, complete-pair judgments, unresolved outcomes, and uncertainty calculation.

The candidate's finer alignments are strongly supported by the blind judgments, while supported precision gaps remain where it is coarser. Uncertainty is concentrated in that larger stratum. Resolved-only totals, high-confidence subsets, and unweighted wins cannot replace the complete weighted result.

## Results

All 1,093 selected pairs received final blind judgments: 740 resolved and 353 unresolved. The estimate remains a range, **−0.756 to +0.652 percentage points**, because unresolved outcomes stay in the denominator with their least and most favorable possible values. The confidence interval additionally accounts for sampling uncertainty; there is no identified single point estimate.

| Alignment stratum | Candidate-only exact wins | Reference-only exact wins | Ties | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Candidate coarser: 400 sampled from 2,516 | 19 | 104 | 28 | 249 |
| Candidate finer: census of 350 | 323 | 7 | 6 | 14 |
| Incompatible: census of 243 | 108 | 13 | 34 | 88 |

These are raw pair counts. Each sampled coarser pair represents 6.29 population pairs; each pair in the other two rows represents one. Consequently, pooling the raw wins would give a misleading impression of the corpus result.

Among the 642 resolved disagreement pairs, the candidate has 499 exact, 122 coarser, and 21 unsupported outputs; the reference has 173 exact, 334 coarser, and 135 unsupported outputs. Their unsupported-boundary totals are 21 and 146, respectively. These descriptive totals likewise require population weights and retain no inference for the 351 unresolved disagreement pairs. The 100 agreement controls contain 98 resolved exact agreements and two unresolved cases; they do not certify the full agreement population's absolute accuracy.

The initial judges agreed on accepted outcomes for 835 pairs and differed on 258. Final reconciliation differs from both initial outcomes on 15 pairs. Final confidence is high for 185 pairs, moderate for 555, and low for the 353 unresolved pairs. These are AI judgments, conditional on source interpretation and the declared alignment policy; the interval does not cover shared annotation errors.

## Frozen population and method

The v13 candidate covers all 324,992 permitted pairs across 218,863 JMdict entries. Collapsing equivalent records within each entry produces 323,519 distinct audit units. The frozen reference permits an unambiguous comparison for 236,972 units; 86,175 have no matching reference pair and 372 have ambiguous reference segmentation. Those 86,547 units are outside the accuracy comparison. Coverage of all JMdict and superior alignment accuracy on the comparable population are separate claims.

| Frozen alignment relation | Population pairs | Sampled pairs |
| --- | ---: | ---: |
| Candidate coarser | 2,516 | 400 |
| Candidate finer | 350 | 350 |
| Incompatible boundaries | 243 | 243 |
| Identical boundaries | 233,863 | 100 |

The complete sample contains 1,093 pairs from 967 entry families. The fixed seed is `precise-furigana-paired-alljmdict-2026-10-09-v1`; no sample was selected for favorable outcomes. The two smaller disagreement strata are censuses. Alignment relations determine sampling weights and do not indicate which system is correct.

Two separate fresh AI sessions received only the randomized blind packet, protocol, and independently checkable source evidence. Each labeled every pair with its finest supported complete mapping or explicit uncertainty. Neither saw system outputs, categories, development decisions, or the other's initial judgments. The implementation agent does not adjudicate sampled linguistic cases. Both initial documents passed complete schema, coverage, reconstruction, and binding checks and were frozen before the third blind reconciliation began. Independent AI judgments can still share errors; this is not human lexicographer validation.

During annotation, both judges received identical abstract clarifications about script-equivalent kana runs, name readings as sound evidence outside names, and recording multiple independently supported complete alternatives. These interpret the existing normalization and target; neither the protocol nor scorer changed. The questions and answers contain no sampled words, proposed labels, system outputs, or comparison categories and are retained in the private methodology log. Genuine uncertainty remains unresolved rather than being replaced by a list of unverified mechanical fits.

Initial judge A resolved 671 pairs and left 422 unresolved; judge B resolved 665 and left 428 unresolved. Those counts do not measure either system's accuracy. The initial documents remained unchanged during reconciliation. Two fresh blind assistants reviewed disjoint portions of the packet; the lead reconciler reviewed every recommendation and retained responsibility for all final labels. Their assistance is disclosed in the frozen annotator record.

The full candidate, reference, sources, protocol, frame, code, and sampling rules were checkpointed before selection. Input trust anchors were recorded outside the audit before annotation began. The initial-label and clarification-log hashes were recorded after annotation and before reconciliation:

| Artifact | SHA-256 |
| --- | --- |
| Candidate JSON | `2adf8a95cf12ab300677c22e51611a5a10fa064a9b96736a7daa709c91a8032c` |
| Reference snapshot | `1bb73eb2425f3813efed40ce67f0da65a6359c6fcb163d9304b9b3910f548b37` |
| Audit checkpoint | `ba47fc5f9fd9821d83c7eceb04b97674f980929a98185b2b81255782259cb3dd` |
| Blind packet | `020cea0642510108bb7c2228daaaeaed6633c45c51fbc1423d033055940caa50` |
| Protocol | `e45ca5c848060b8718ab7f577d32fa38d0d8d60dc5daf97aa409694eb6a6e40a` |
| Initial labels A | `b628fd6e944bd410eb4dcf642c259af59c861d6e4ec114f4d9b1249a8c88dba5` |
| Initial labels B | `41d76465e9e960a690afa1fd5746e27518782ddc2b3686d4a513289bf6dff0db` |
| Initial-label freeze | `ee814dd31a7f7b5746597234ce5585fd58c84ca3dd2c4a62b55981c368f10491` |
| Shared clarification log at initial freeze | `ecf5e68c12621d6e29f343c046788b68ed1061a84053037dc41aabcb817af9fb` |
| Final reconciliation | `2942753f2a80ccf0201b8519e9d6ef40d60594934460eeb6030babbdca06a463` |
| Adjudication freeze before scoring | `2a8f21bf4d7ea060cb0cc6efa68e88d09ab77bc5f6dc2f71ad32e57bdfebe8b6` |
| Aggregate scored report | `b42a1a6070f2e60b3be03a06c3217dd0c37b4d3c9d6509aa7e1d4eef8122a787` |

Private audit artifacts are in `.cache/paired-audit-v1/`; the aggregate machine-readable result is `scored/report.json` there. External anchors are preserved in `.cache/experiments/paired-audit-v1-trust-anchors.json`, `paired-audit-v1-initial-trust-anchors.json`, and `paired-audit-v1-adjudication-trust-anchors.json`. Individual frames, alignments, labels, and scores were sealed during this audit. They are now retired development material; the clean implementation agent still receives only separately reviewed source facts. Everything remains local.

The audit identifies the next development priority: independently supported detail in the remaining opaque spans. It does not justify importing reference answers or promoting uncertain character assignments. Any later candidate needs a new frozen evaluation and a plan accounting for repeated testing; this audit must not be silently reused as an independent test after tuning.
