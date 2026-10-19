# Test Generations unified workspace revamp — implementation contract

Status: **Phase 0 inventory and phased execution plan. Implementation not yet complete.**
Reference: `AGENTS.md`, `docs/test_generations_assessment.md`, `docs/epoch_finder_vision.md`, `docs/run_analytics_reconciliation_plan.md`.
Design decision: gallery-first Explore workspace with Experiments and Checkpoints as equal navigational perspectives; the builder replaces the center/right region while the left rail remains.

## Non-negotiable parity

**This is a relocation and UX revamp, not a feature reduction.** Keep existing server execution routes, jobs, files, and semantics until replacements pass contract tests. Every existing action must remain reachable before its former surface is removed. No new queue, runtime lane, FS root, session migration, implicit scan or restart behavior, or localStorage.

Current code:
- `tool/tool.html`: separate Test Generations form, candidates, session results, Batch modal, Finder wizard and dashboard, References, Analytics.
- `tool/js/test_generations.js`: normal Test execution, frozen Base/staged LoRA conditions, saved Test sessions, candidate inclusion, weight sweep, session naming, preview/compare, folder review, ratings, Ask VL, prompt expectation analysis, wildcard Director, model settings, reference comparison, Batch UI and status.
- `tool/server/test_batch.py`: normal Test sessions repeated with fresh seeds, optional automatic Ask VL, server-owned batch execution/progress.
- `tool/js/epoch_finder.js`, `tool/server/epoch_finder.py`, `tool/server/epoch_finder_plan.py`: same-Set multi-run/checkpoint selection, set-grounded proposed test concepts, editable wildcards/roles, guided training references, rounds, per-epoch cases, retention, campaign pause/resume/stop, live frames, VL evaluations, reference comparisons, DINO evidence, rankings, campaign follow-ups and deletion.
- `tool/js/run_analytics.js`, `tool/server/run_analytics.py`: coverage, cohort-aware summaries, charts, sources, comparisons and optional Director interpretation.
- Existing `tests/test_test_generations_ui_contract.py`, `tests/test_test_batch.py`, `tests/test_epoch_finder.py`, `tests/test_epoch_finder_multirun.py`, `tests/test_generate_ui_contract.py` and run-analytics tests are baseline guardrails.

Do not interpret 'Batch' or 'campaign' as removable execution mechanisms; only their presentation boundaries are subject to consolidation.

## Product ownership and navigation

One top-level **Test Generations** workspace:
- Persistent **left rail**: Experiments (historical Test sessions and Finder campaigns, with clear source identity) and Checkpoints (Set/run/epoch). Existing References and Analytics remain discoverable as integrated tools until every capability has a verified new home.
- **Explore** (default for saved work): center image gallery, right inspector. Images dominate. Selecting a checkpoint gathers all attributable images from ordinary Test sessions, Batch sessions and Finder campaign units. Selecting an experiment gathers its results. Group multiple checkpoints; offer explicit comparison view.
- **Build**: preserves left rail, expands the builder over center + right. Starting from the ordinary Test prompt and staged candidate setup, expose repetitions/automatic VL, multiple checkpoints, wildcard dimensions/structured campaign evaluation, guided references and rounds/retention only when activated. Preserve quick actions and visible estimate. Launch returns to live results, without losing builder draft.
- Inspector owns selected image/checkpoint/experiment details and source navigation; existing normal-folder review remains available and canonical for ratings and annotations.

## Evidence and identity contract

Display existing persisted data; do not create a parallel canonical experiment or rating store. For each result, retain source (Test session vs campaign), recorded Set identity, run/job identity where present, checkpoint or staged LoRA identifier, source media path, resolved prompt, seed, generation settings, generated preview, ratings/VL/reference judgments, and missing-media state. An unknown or unrecorded checkpoint identity must be shown as **unattributed**, not silently inferred from filenames, epoch numbers alone, or loosely matched LoRA names. Distinguish a campaign ranking from Test-folder ratings; never silently unify their numeric meaning. Preserve read-only historical evidence and source links even if a media file has been pruned.

Important potential gap: ordinary Test sessions use staged LoRA candidates and may not consistently record the same Set/run/epoch identity as Finder. Resolve this with a read-only provenance audit first; add only the minimal explicit producer metadata on *future* runs if necessary, without retroactively guessing historical identities.

## Safe phases and acceptance gates

### Phase 0 — baseline contracts (no UI removal)
Map each control/route, DOM owner, stored fields, and execution state transition. Capture a parity checklist including Normal, Weight Sweep, Base, staged LoRA include/exclude, copying training candidates, per-model settings, recent/wildcard prompts, session name, seed and fixed conditions, Batch with/without VL, stale/broken partial sessions, normal review-folder ratings, Ask VL, references, campaigns, multi-run choices, wildcard proposal/role editing, guided reference picker, cases/rounds/retention, live leaderboard, follow-ups, pause/resume/stop, DINO/reference comparison, Analytics and Director. Automated baseline tests must pass before relocation.

### Phase 1 — additive shell
Implement Explore/Build switching with an unchanged persistent left rail. Host existing UI through explicit ownership functions, not by querying another feature's DOM to borrow controls. Keep all existing navigation reachable. No server changes. Preserve focus, selected session/checkpoint, gallery scroll and expanded builder state across transitions. Validate model/Set switching and browser refresh.

### Phase 2 — common read-only gallery
Add one presentation adapter over *existing* Test and campaign result payloads; no saved-file rewrite. Stable image IDs, incremental DOM updates, lazy media, explicit pending/failed/missing frames. Inspector points back to the original session/campaign and normal review. Add checkpoint-by-run browsing with proved identities. Test at least one checkpoint with both an ordinary Test session and campaign; check no double counting, no wrong-run leakage.

### Phase 3 — full-width everyday builder
Relocate the actual Test controls to Build without changing IDs, supported inputs or execution semantics. Move Batch count/fresh-seed and optional automatic VL into progressive sections while retaining server-owned Batch processing. Keep normal and weight-sweep modes, stage candidate inclusion, Base, reference and wildcard helpers. Verify deterministic frozen settings across a session and unchanged queue behavior.

### Phase 4 — advanced Finder builder
Relocate the real guided multi-run/checkpoint setup, set-derived proposal, wildcard attributes/roles, training reference picker, cases, rounds/retention and estimate. Keep existing Finder execution routes and state machine. Integrate real campaign progress/results into Explore; retain legacy Finder entry until parity is proven. Verify campaign pause/resume/stop never depends on browser presence.

### Phase 5 — cross-perspective workflow
Image-to-source, image-to-repeat, checkpoint-to-generate, compare selected checkpoints, recent/pinned filters as existing state permits. Reuse existing generation, Inspector, Activity and normal review surfaces; no new annotations or orchestration. Preserve selected gallery and builder draft when switching. Ensure no unnecessary full redraws.

### Phase 6 — audit, migration-free cutover
End-to-end browser QA at normal and narrow widths with live Test, Batch and Finder records; automated server/frontend tests; keyboard/accessible action parity; performance checks on hundreds of results; interrupted or pruned jobs; refresh and Set/model switch; activity queue correctness. Audit old/new control-by-control and do not remove original panels or navigation until every feature is demonstrably available and tested in the new home. Update docs only after functionality is true; remove duplicate presentation, not underlying evidence.

## Merge discipline

Prefer independently reviewable commits/PRs aligned to the phases; a phase is merged only when its acceptance tests and hostile regression audit pass. The initial implementation can use an explicit reversible, opt-in workspace state; do not flip the default early. Never ship an empty placeholder in place of an existing control. Decisions to surface to the user only when a real data/provenance limitation prevents correctly displaying historical results or when an unavoidable functionality tradeoff is demonstrated.

## Concrete limitations at planning time

The repository sources show that Test sessions and campaigns currently have different recorded data shapes; reliable cross-source image attribution requires an explicit code-level provenance audit and representative saved data. The GitHub code view alone cannot prove that every historical ordinary Test session names a checkpoint uniquely. Do not promise universal historical coverage until verified. Training-machine smoke tests require the user's actual WebCap runtime, and must not be represented as passed by static code inspection.
