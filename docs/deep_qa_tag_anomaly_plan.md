# Deep QA — statistical annotation anomaly investigation

## Code-grounded baseline (2026-10-26)
- `tool/js/qa_workbench.js`: `qaBuildAssociationFindings` counts group-qualified tags and co-occurrences, but only outputs the best relation per source and at most 3 candidate patterns. `qaComputeFindings` labels these as unverified observations.
- `qaRunNextDeepScanBatch` sends the full selected tag inventory to `/fs/qa/deep-scan`, not its statistical candidates.
- `tool/server/app.py`: set-review route already collects saved Sight records (no Vision call).
- `tool/server/qa_llm_contract.py`: `build_set_review_request` supplies aggregate saved Sight plus tags and limits Director to five investigations; prompt prioritizes general semantic omissions, not actionable tag mistakes.
- `AGENTS.md`: use small local changes, existing state/route, on-demand work, visible errors, manual reversible edits.

## Safe phases
1. **Preserve baseline and tests**: establish branch, document contracts, add deterministic examples (69/70 co-tag, genuine view-dependent exception, rare conflicting combination, under-tagged items). Verify no changed behavior outside user-initiated QA.
2. **Statistical candidate ranking**: enhance existing association detector, retain per-file evidence and source/target supports, control high-volume correlations, distinguish *possible omission* from *unusual combination*, handle visibility/viewpoint effects as hypothesis rather than automatic rejection; avoid combinatorial or prompt explosion.
3. **Director integration**: pass bounded, ranked candidate questions from `qaRunNextDeepScanBatch` through existing route into `build_set_review_request`; keep aggregate Sight, use it as qualified evidence rather than fact; instruct Director to investigate candidate anomalies and dismiss legitimate exceptions. Preserve existing response schema and manual review.
4. **Verification & audit**: JS syntax, Python compile, isolated deterministic checks, request contract tests, stale-session/cancel behavior, empty/no-Sight datasets, large sets, AGENTS.md review; verify only QA files changed.
5. **Merge gate**: only merge after review and checks; document remaining manual browser verification. No auto tag/caption edits, no new surface, no new state files.

## Scope
Deep QA should surface plausible human omissions, stray/extra tags, and contradictions with named files and statistics; do not critique intended dataset composition or claim correlation proves an error.
