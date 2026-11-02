# Prompt Tests consolidation / Manual Screening retirement

Status: **In progress; draft PR #852.** Follow [AGENTS.md](../AGENTS.md): preserve Campaigns, queue invariants, visible errors, and explicitly destructive changes.

## Product contract
- Matrix X rejects the entire staged candidate, cancels its queued work, requests termination of running work, waits until that work is terminal, and then deletes the staged checkpoint and its results in the currently selected Test session. Do not delete historical results in other sessions or the source training checkpoint.
- Matrix checkbox only selects/deselects participation in future tests.
- Remove the redundant Matrix Skip button/endpoint.
- Retire Manual Screening, including navigation, own wizard, review, unique per-round actions and dead tests/styles. Preserve Campaigns, Insights, References and shared Test preview/queue infrastructure.
- Do not automatically delete persisted historical Screening artifacts; user can explicitly remove them.

## Phase 1 — X cancellation and deletion (code committed, not validated)
Touch `tool/server/epoch_test_bench.py`, `tool/js/test_generations.js`, `tests/test_matrix_skip_and_columns.py`.
- Existing `test_remove_candidate` formerly rejected active sessions. Persist `pendingCandidateRemovals` before stopping candidate jobs, cancel pending, stop active, and finalize after termination via ordinary status reconciliation.
- Preserve distinct confirmation and output; avoid hiding failures. Confirm that delayed/repeated requests are idempotent and no unrelated candidate job is cancelled.
- **Static audit gate:** verify fully queued, running, transitioning-to-running, finished, multi-candidate, user reload/restart, and weight-sweep code paths; browser and Python execution tests are intentionally not a merge requirement for this request.
- **Review before merge:** `_sync_inference_session` early returns for deferred sessions; ensure pending rejection is handled before the deferred work materializes and no unintended candidate runs. Confirm all in-flight jobs cannot subsequently reference a deleted staged checkpoint. Verify repeated UI polling does not leave an indefinitely disabled X.

## Phase 2 — Hide/retire Manual Screening UI
- `tool/tool.html`: remove tab, manual wizard, manual round history and review (not Campaigns markup).
- `tool/js/epoch_finder.js`: remove screening-only state, route, event handlers, round rendering, and dependencies; retain the Campaigns/Insights/read-only checkpoint test-membership bridge and all cross-workspace route contracts. Avoid broad refactors of Campaigns.
- `tool/css/epoch_finder.css`: remove screening-only rules; preserve the Campaigns epoch/checkpoint styling.

## Phase 3 — Remove unique backend workflow
- `tool/server/epoch_finder.py`: remove manual campaign creation, round selection/actions, manual review/rating/VL, skip and manual scheduling branches only after checking references. Keep campaign scoring, auto-pruning, reference comparison, status, deletion, and Insights.
- `tool/server/epoch_test_bench.py` and folder state: remove `test_save_manual_settings` and unused manual settings reads after verifying there are no consumers. Preserve previous stored data without a migration.
- Historical manual campaign cleanup must remain possible (e.g. storage deletion), even after the UI path is gone. Do not delete folders as part of deployment.

## Phase 4 — Documentation, regressions, cleanup
- Update evaluation navigation documentation and remove obsolete screening-only tests and docs while retaining historical designs where valuable.
- Audit code references across `tool/`, `tests/`, and `docs/` for `screening`, `manual`, `test_skip_candidate`, `skippedCandidates` and `data-matrix-skip`. Some words may legitimately describe other campaign concepts.
- Test: Prompt Tests creation/exhaustive wildcard Matrix, per-item and bulk ratings, VL, X destruction, selection, stopped/queued jobs; Campaigns launch and progress, Insights, References, deep-link routing, and data deletion.
- Only merge after static dependency and source-contract review, and ensure the cleanup does not break Campaigns. Browser and Python test execution are deliberately excluded by request.

## Validation scope
Static source-contract and dependency review; no browser or Python tests per the current request. Historical Screening artifacts are not deleted automatically.
