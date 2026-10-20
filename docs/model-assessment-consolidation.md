# Model Assessment consolidation

## Product contract

- Assess only capabilities actually used by WebCap.
- Every inference should yield as many defensible measurements as possible.
- Completed compatible probes are reusable across runs; retry failures once after missing probes for the same model.
- Primary UI: model, validated structured output, generation tokens/second, technical assessment with optional advisory quality.
- Never interpret a token budget, an old prose result, or a model-provider hint as proven structured output capacity.
- Keep history as diagnostic evidence, not the normal navigation experience.

## Phase 1 — reusable evidence and scheduling (implemented on this branch)

Owner: `tool/server/model_lab.py`.
- Reuse matching completed local attempts using the same model reference, probe kind, and, for Vision, Set/file/group context.
- Legacy prose does not qualify as structured JSON evidence; old Vision, thinking, and Schema Assist attempts may be reused where equivalent.
- Allow Director-only assessment without a Set.
- Missing tasks run first; one retry for failed tasks at the end of each model's pass.
- If no work is needed, return a no-work response and avoid writing another run.
- Do not start operations without a user action; preserve existing server-owned worker and GPU lane.

## Phase 2 — production-shaped assessment and summary (implemented on this branch)

Owners: `tool/server/model_lab.py`, `tool/server/llm_runner.py`, `tool/server/model_lab_quality.py`, `tool/js/diagnostics.js`.
- Replace generic prose in new assessment runs with actual Storyboard Scene-plan JSON generation (2K; optional extended 4K/8K/16K).
- Validate parsed Scene count, fields, continuity-shaped task requirements, prompt substance and complete finish; failed validation does not prove usable output.
- Preserve raw evidence only in the existing journal, and expose compact verified measurements separately.
- Use runtime-reported generation speed where available, otherwise disclose effective throughput.
- Judge saved production Scene JSON and vocabulary-schema output, without another inference from the assessed model.
- Keep advice from the LLM judge distinguishable from deterministic qualification.
- Legacy calibrations and their scores remain historical, not automatic proof of structured output.

## Phase 3 — one calm UI (implemented partially)

Owners: `tool/tool.html`, `tool/js/diagnostics.js`, `tool/css/modals.css`.
- Primary CTA: Complete Missing Tests; no-op when all compatible tests exist.
- Primary table: Model / verified structured output / tokens per second / assessment, with contextual details.
- Removed the old specialist launch buttons; progress stays in Model Assessment.
- Retained old hidden panels and scripts **temporarily** because their initialization and legacy API contracts still have consumers; not complete until deletion pass.

## Assessment progress card (implemented on this branch)

- Backend owns a stable list of planned logical probe identities derived from frozen run configuration, including optional reference-model tasks. Reused evidence contributes to completed progress at startup.
- Journal-persisted `work` separates planned, completed, reused, skipped, final failures, pending retries, currently running, resolved and remaining; additional attempts do not add to the denominator.
- A probe that fails its first attempt remains outstanding while awaiting its single deferred retry. Terminal failures and skips are resolved work, not successes. Stopped/interrupted runs retain outstanding work.
- Existing LLM job status transitions identify queued, starting, running and finishing without adding another polling loop. Existing shared ProgressCard shows the current model/probe, status, successful vs planned counts, remaining work, elapsed wall time and determinate resolved/planned progress.
- The determinate bar measures work resolution, **not** qualification, pass rate, percentage of wall time or ETA. Historical runs lacking a reliable frozen probe plan stay indeterminate.
- Restart reconciliation recomputes the saved counts after interrupting unfinished attempts. No background scans, extra GPU scheduling or independent UI state are introduced.
- Regressions are covered by `tests/test_model_lab.py`, `tests/test_model_lab_progress.js`, and the focused Model Assessment GitHub Actions workflow.

## Phase 4 — legacy deletion and consumer migration (pending validation)

- Audit all references before removing `tool/js/director_model_test.js`, `tool/js/model_lab.js` specialist UI, and their HTML/CSS. Move retained progress/poll state to the single assessment owner without browser sequencing.
- Migrate compact Storyboard Director advice in `tool/server/storyboard_llm_runtime.py` off legacy prose capacity. Preserve the semantics of serious observed model warnings, thinking controls and individual-scene guidance; do not regress normal inference.
- Keep export/import and historical reports readable without keeping the old testing engines launchable.
- Remove orphan tests only after replacing assertions for old UI and prose behavior with current contract tests.
- Do not remove H3 hardware calibration: it measures a separate production capability.

## Validation gate before merging

- Targeted pytest suites for Model Lab, Director/Storyboard integration, assessment transfer and persisted evidence.
- JS syntax, Diagnostics event wiring and model-row UX.
- Explicit Director-only assessment, fresh model, complete/no-op, partial completion, stop/resume, per-model failure retry, legacy import, and mixed Vision+Director paths.
- Ensure source-runtime speed remains distinct from current-host measurements.
- No new state root, scheduler, inference priority, persistent UI state, dependency, or hidden automatic scanning; follow `AGENTS.md`.

This PR deliberately keeps specialist backend code and hidden panels until their consumers and tests have been migrated. A removed launcher is not the same as deleting a subsystem.
