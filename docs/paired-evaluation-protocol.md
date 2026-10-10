# Paired probability-sample evaluation

Historical checkpoint: this panel was retired as a holdout during parity-first development on 2026-10-09. Its original artifacts and scores remain unchanged. Reviewed source evidence may now inform development; neither the old labels nor their scores provide an independent accuracy test of later generators. A new superiority claim requires a fresh evaluation.

This is a protocol and reporting tool for a **new** audit, not evidence that the candidate already outperforms Lorenzi. The earlier [diagnostic holdout](evaluation-results.md) deliberately sampled difficult span families and cannot supply the population weights for this test. No individual labels or packets from that holdout were inspected when writing this protocol.

## Target and population

The linguistic target remains the finest independently supported spelling–reading alignment. Character correspondences supported by phonetic ateji, name readings, morphology, or regular sound changes qualify. Whole-word dictionary typography alone does not invalidate a supported character split. Unsupported residual assignments do not qualify. The following convention policy is declared before selecting this audit:

- Positional numeral notation can permit both a complete numeric run and defensible place-value attachment choices. Accept those alternatives only where the notation genuinely creates a rendering convention, explicitly listing complete mappings that account for every written symbol and spoken mora. This does not relax independently clear lexical boundaries such as `三[さん]人[にん]`. Do not invent ownership of silent zero or place symbols; retain uncertainty when the evidence does not establish the permitted alternatives.
- Missing or silent particles can permit different attachment or grouping of the same spoken phrase. Accept alternate complete mappings only when the blind adjudicators independently justify them and the difference is confined to that convention. Preserve indisputable supported boundaries outside the affected span. If the finite supported alternatives cannot be specified without viewing system outputs, mark the pair unresolved.

Every accepted alternative is an explicit complete segment array. A convention never automatically accepts all coarser groupings, and ambiguity must not be manufactured to neutralize an independently supported gain. Labels may explicitly assign an empty reading to a nonempty written span only under a declared numeral or particle convention with evidence; empty written bases are not permitted. An unwritten sound must have a justified attachment in each accepted complete mapping, or remain unresolved.

The sampling unit is one complete, distinct JMdict entry/spelling/normalized-reading record, with duplicate equivalent records collapsed by a frozen rule. The comparison population consists of all such records having unambiguous, comparable alignments from both frozen systems. Tabulate the entire allJMdict frame, comparable population, exact-boundary agreement population, each disagreement stratum, and every reason for exclusion. A missing or uncomparable reference record is outside this comparison, not a reference error. Complete candidate coverage of all 324,992 records and superiority over the comparable subset are different claims. An unqualified claim of superiority over all JMdict additionally needs a predeclared comparison policy for missing reference outputs and an evaluation covering that policy.

The primary endpoint is the candidate's exact accepted alignment rate minus the reference's rate over the comparison population. Each pair contributes +1 if only the candidate is exact, −1 if only the reference is exact, and zero if both or neither are exact. The endpoint rewards supported completeness and rejects unsupported precision without assigning an arbitrary exchange rate to their boundary counts. Agreement under the exact boundary normalization used by the scorer implies a paired zero even if both alignments are wrong.

## Checkpoint before annotation

Freeze the candidate dataset, reference snapshot, source dictionaries, normalization and scorer code, full frame and exclusion counts, family map, sampling code, seed, sample allocation, and this protocol before drawing or inspecting the new sample. Record their SHA-256 digests in the audit checkpoint. Keep all artifacts local. The example allocation below is a proposed recipe, not a claim that an audit has been frozen or run:

- Seed: `precise-furigana-paired-alljmdict-2026-10-09-v1`.
- Independently sample without replacement `min(400, population size)` pairs from each final discrepancy category: candidate coarser, candidate finer, and incompatible boundaries.
- Independently sample `min(100, population size)` exact-boundary agreement controls.
- Use all selected rows and one final analysis at two-sided 95% confidence. Do not stop early when a favorable result appears or increase the sample after inspecting labels. A later independent audit requires a new checkpoint and a plan accounting for repeated testing if its results are combined with this one.

Selection within a stratum must be uniform over its complete pair frame. Sorting by a seeded cryptographic random rank is acceptable if the randomization scheme is frozen and the seed is selected without searching for favorable samples; record deterministic tie handling. Do not select one representative of a family and copy its label to its relatives. Diagnostic strata determine inclusion probabilities, not which output is correct.

Before labels, assign family identifiers using lexical information available without adjudication; at minimum preserve JMdict entry identity, and record any independently justified grouping of orthographic relatives. Freeze that mapping and its limitations. Previously discussed examples and training exposure must be disclosed. Excluding them changes the target population unless their contribution is separately evaluated; a convenience exclusion must not silently retain an all-population claim.

## Blind judgments and scoring

Randomize packet order and suppress system outputs, discrepancy category, and the agreement/control designation. Annotators receive the complete spelling and reading, contextual lexical information, and the pinned independent source evidence. They record all accepted alignments, evidence, and uncertainty before either system's output is revealed. Obtain independent second annotation and reconcile disagreements under the same blind conditions; retain both initial label sets and the reconciliation record. State whether the annotators are AI assistants or human Japanese lexicographers. Do not imply that two AI judgments establish human expert validation.

Score complete pairs against the frozen accepted alternatives. The two systems use the same normalization, label set, and scorer. A resolved label produces a Boolean exactness outcome for each system. An unresolved judgment produces an unknown outcome, represented as `null`, rather than removal from the denominator. If only one system's exactness can be established without revealing the other, the other remains unknown. A missing or invalid candidate output for a pair in the frozen comparison frame must be adjudicated under a predeclared failure policy; do not delete the pair after selection.

The primary analysis includes moderate-confidence resolved labels. High-confidence-only and confidence-stratified results are diagnostic sensitivity views, never replacements for the complete random sample. Report unsupported and missed boundaries, exact/coarser/unsupported statuses, and Pareto wins/losses/tradeoffs as secondary outcomes. Their raw totals do not replace the primary endpoint, and additional inferential claims need their own predeclared uncertainty and multiplicity treatment. More splits alone are not evidence of superiority.

## Estimation and uncertainty

Let `N` be the comparison population including agreement pairs, `N_h` the number of disagreement pairs in stratum `h`, and `n_h` its fixed sample size. For fully resolved samples, the estimate is `sum_h (N_h / N) × mean_h(candidateExact − referenceExact)`. Equivalently, a sampled pair carries inverse inclusion weight `N_h / n_h`; raw wins from equally sized, differently populated strata must not simply be pooled.

For an unknown Boolean exactness outcome, allow both zero and one. Each row then has a lower and upper paired difference; replacing every unresolved outcome by its least or most favorable value gives a population-weighted estimated range. The report has no single primary point estimate while any positive-mass stratum is unresolved or unsampled. Retain all rows even when their uncertainty makes the conclusion inconclusive.

The primary confidence interval uses bounded finite-population sampling, not a normal approximation. For each sampled stratum, set `rho_h = min(1 − (n_h − 1) / N_h, (1 − n_h / N_h) × (1 + 1 / n_h))`. With `w_h = N_h / N` and `alpha = 0.05`, the radius is `sqrt(2 × log(2 / alpha) × sum_h w_h² × rho_h / n_h)`. Subtract it from the estimated lower outcome and add it to the estimated upper outcome, intersecting with deterministic bounds from the observed and remaining finite population. A census has zero sampling uncertainty; an unsampled stratum retains its entire possible contribution. The derivation combines the moment-generating-function bounds in Propositions 2.2 and 2.3 of [Bardenet and Maillard (2015)](https://arxiv.org/abs/1309.4029) for independent stratum draws and allocates half the error probability to each tail. This conservative interval remains nonzero when a small sample happens to contain identical outcomes.

The reported design standard error is supplementary: it uses the usual sample variance and finite-population correction, and is unavailable for unresolved outcomes or a noncensus sample of size one. It must not be substituted for the primary confidence bound when a zero sample variance creates a spurious appearance of certainty.

Pair sampling does not assume that linguistic families have independent error rates. Conditional on fixed judgments for a finite frame, randomness comes from the sampling design, which is why family correlation does not invalidate the paired population estimate or its bound. This does not protect against shared annotation mistakes. Report sampled family count, the largest family's sample count and estimated population weight, and the descriptive change in the lower estimate when one sampled family's labels all become unresolved. This is an annotation sensitivity measure, not a cluster confidence interval; it cannot account for related but unsampled annotation errors. Do not reinterpret a pair sample as a random family sample or bootstrap arbitrary family means as if they had equal inclusion probabilities.

Agreement controls measure possible shared failures. Report their raw exactness outcomes, uncertainty, and confidence assessment separately. A small clean control sample does not certify the entire agreement population. An optional absolute-accuracy estimate must combine the agreement stratum and every disagreement stratum using their population weights and its own uncertainty calculation; the paired tool does not produce such an estimate.

## Reporting tool

Prepare the frozen population and blind packets with `node scripts/prepare-paired-audit.mjs FROZEN-DATASET.json --output NEW-AUDIT-DIRECTORY`. The tool refuses an existing directory, verifies the complete JMdict pair population and source lock, writes the complete frame and a checkpoint of input/code hashes before sampling, and uses the fixed seed and allocation above. Keep `frame.sealed.jsonl` and `manifest.sealed.jsonl` away from annotators; provide only `blind-packet.jsonl`. The current family map uses JMdict entry IDs and does not merge relatives across entries. Preparation is not annotation or a superiority result.

Record the emitted checkpoint SHA256 outside the audit files before annotation. Keep the two initial judges separate: each receives only the blind packet, this frozen protocol, and independent evidence. Do not give either judge the sealed frame/manifest, system outputs, or the other's initial labels. Their complete initial label documents use this shape (the values below are synthetic):

```json
{
  "schemaVersion": 1,
  "role": "initial",
  "checkpointSHA256": "<recorded checkpoint SHA256>",
  "blindPacketSHA256": "<frozen packet SHA256>",
  "protocolSHA256": "<frozen protocol SHA256>",
  "annotator": { "id": "judge-a", "kind": "ai", "description": "Model/version and independent session identity, or human qualifications" },
  "declarations": { "blindedToSystemOutputs": true, "independentOfOtherInitialLabels": true },
  "labels": [
    {
      "auditId": "P0001",
      "status": "resolved",
      "accepted": [[["甲", "こう"], ["乙", "おつ"]]],
      "confidence": "moderate",
      "rationale": "Independent justification of the complete sound mapping.",
      "evidence": ["Pinned primary source URL or other independently checkable evidence."],
      "conventions": []
    }
  ]
}
```

Use distinct initial annotator IDs and disclose `kind` as `human` or `ai`; an AI description identifies its model and separate session. Confidence is `high`, `moderate`, or `low`. Every selected pair appears exactly once in each document. An unresolved label has `status: "unresolved"`, `accepted: null`, a rationale, and an evidence array that may be empty. A resolved label requires at least one independent evidence item. Optional convention choices are expressed in the required `conventions` array using `positional-numeral` and/or `particle-attachment`. Accepted mappings reconstruct the complete spelling and normalized reading; no candidate/reference output, status, or score fields belong in a label document.

Freeze both initial documents before reconciliation. The reconciler receives both frozen initial judgments and the same blind material, still without outputs or discrepancy categories. Its document has `role: "reconciliation"`, its own annotator description, `declarations: { "blindedToSystemOutputs": true, "initialLabelsReviewed": true }`, and `initialLabelSHA256` containing the two initial document hashes in order. The remaining fields and complete label schema are identical. Retain all initial judgments and final rationales, including when reconciliation changes both initial outcomes.

Before revealing any output, create `adjudication.frozen.json` with `schemaVersion: 1`, the same `checkpointSHA256`, `blindPacketSHA256`, and `protocolSHA256`, and `frozenBeforeSystemOutputsRevealed: true`. Its `initialLabels` array contains two `{ "file": "initial-a.json", "bytes": 123, "sha256": "<SHA256>" }` fingerprints in the declared order; `reconciliation` contains the same fingerprint shape for the final document. Names are distinct local `.json` filenames relative to the adjudication file. Record the SHA256 of this freeze file outside the scoring directory before scoring. Byte counts and hashes are computed from the exact saved file bytes, including newlines.

Run `node scripts/score-paired-audit.mjs AUDIT-DIRECTORY --checkpoint-sha256 RECORDED-HASH --adjudication adjudication.frozen.json --adjudication-sha256 RECORDED-HASH --output NEW-SCORE-DIRECTORY`. Use `--cache DIRECTORY` when the pinned dictionaries are outside the default source cache. The verifier authenticates every checkpoint input and code fingerprint, source-lock contents, protocol, Node/Unicode runtime, complete frame, deterministic selected manifest, packet evidence, population counts, both initial label sets, reconciliation, and the supplied trust anchors. It requires the full sample, derives strata and weights from the authenticated frame, and fixes `alpha` to `0.05`; callers cannot supply favorable replacement populations or omit uncertain rows. Restore the frozen code/runtime and source files to replay an older audit.

The scorer writes `report.json` with aggregate results, a private `scores.sealed.jsonl`, and a private `analysis-input.sealed.json` in a new directory with owner-only permissions. Its terminal output contains only the aggregate report. Both resolved and unresolved labels remain in the primary analysis regardless of confidence. Agreement controls are reported separately and are mechanically zero in the paired endpoint. Initial agreement, annotator identities, confidence counts, raw secondary outcomes, and a descriptive high-confidence view remain visible in the aggregate report. Hashes establish the artifact chain and declarations record the blind procedure; software cannot prove honest independence, correct source interpretation, or the absence of shared annotation mistakes.

`node scripts/evaluate-paired-audit.mjs FROZEN-AUDIT-SCORES.json` remains a low-level statistics utility. Its raw input is **not** sufficient evidence of an authenticated audit. The verified scorer produces the following shape in its sealed analysis input:

```json
{
  "sharedPairs": 800,
  "outsideComparisonPairs": 20,
  "alpha": 0.05,
  "strata": [
    {
      "id": "coarser",
      "populationPairs": 200,
      "samples": [
        { "pairId": "pair-a", "familyId": "family-a", "candidateExact": true, "referenceExact": false },
        { "pairId": "pair-b", "familyId": "family-b", "candidateExact": null, "referenceExact": null }
      ]
    }
  ]
}
```

These numbers are synthetic. The verified scorer retains all three disagreement categories, including empty populations; an incomplete selected label set is rejected until the missing pairs are explicitly labeled unresolved or resolved. `sharedPairs` counts only records with mechanically identical normalized alignment points, not all pairs matching a heuristic or all controls. The output retains raw stratum populations, sample counts, outcomes, weights, estimated ranges, full uncertainty, and aggregate family sensitivity. Keep individual scores quarantined from implementation work.

A positive lower endpoint supports a candidate advantage in exact accepted alignment rate over the frozen comparable population, conditional on the adjudication and predeclared conventions. It does not establish that every subgroup improved, that the labels are infallible, or that missing reference outputs have been beaten. A confidence interval crossing zero leaves superiority unproven. A negative upper endpoint supports a reference advantage. Report the observed result whichever direction it takes. Tuning against any result from this audit makes the next candidate require fresh independent evaluation.
