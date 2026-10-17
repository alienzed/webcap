# Epoch Finder — checkpoint evidence consolidation

## Product contract (agreed)
Epoch Finder screens every selected saved epoch before narrowing; its purpose is discovery and a dynamic, evidence-driven shortlist, **not** choosing the final winner. Humans promote interesting checkpoints to Test Generations and retain their own ratings. No evaluator alone should hide an exceptional candidate once multiple methods have been validated. Missing evaluations are not failures.

Campaigns are experiments; a checkpoint is identified by **source training run ID + epoch number**. Preserve each evaluator's observations and method, protocol, sample count, human assessments, and failures. Compatible protocols may eventually combine. Incompatible protocols must remain separate. The training trajectory and cross-run parameter analysis belong in Run Analytics, not this screen.

## Codebase baseline (main after PRs #376 and #391)
- `tool/server/epoch_finder.py`: `campaign.json` owns durable source `jobId`, epoch-specific units and attribute, reference VL and DINO assessments. `_rank` computes weighted concept-match percentage *inside one campaign*; `_select_next_epochs` narrows solely on that metric. Do not silently change this semantics.
- `tool/js/epoch_finder.js`: campaign-specific wizard, leaderboard, drilldown, gallery and Copy Epoch to Test. Campaigns remain independently selectable.
- `tool/server/epoch_test_bench.py`: Test session result ratings and saved VL assessment summaries are already separately aggregated across sessions by staged candidate file name. `test_reference.py` owns independently saved reference results.
- `tool/server/workflow_gate.py`: shared FIFO workflow admission. Do not introduce new queue or GPU scheduler.
- PR #391 added inspection layout and prompts; postponed optional disagreement/Director and base-model baseline work, none of which is required for evidence consolidation.

## Phases

### Phase 1 — safe read-only projection (implemented in this branch)
Add `checkpoint_evidence` operation in Epoch Finder. Read existing campaign JSON and group by saved run ID + epoch. Return **per-campaign** concept score, number of evaluated renders, weighted matched observations, failed units, RVN verdict counts, and DINO comparison count. Never average scores across campaigns or rescore saved data. No additional persistent file, scan, queue, or background job. No change to existing campaign ranking or pruning. Tests exercise identity isolation, partial coverage and independent campaigns.

### Phase 2 — visible checkpoint evidence (implemented in this branch)
The existing Epoch Finder frame inspector has a collapsed, on-demand 'Evidence from other campaigns' section. Clicking Load calls the Phase 1 read-only endpoint only on user request (never on polling). It displays per-campaign concept results, evaluated render count, weighted observations, reference VL verdict counts, DINO comparison counts and failed units; each protocol remains independent. The user remains in the existing inspector, with no new page or background processing. Cross-campaign jump links and individual human rating joins are deferred to the later handoff phase.

### Phase 3 — follow-up campaigns (implemented, pending machine verification)
The existing campaign action **Test selected epochs again** opens the ordinary editable Epoch Finder wizard, seeded from the originating campaign's run, epochs, prompt, concept, dimensions, reference selections, evaluators and round controls. The ordinary epoch picker allows any saved epoch to be added or removed; users can keep prior test dimensions or customize them. The new campaign receives fresh round seeds, a parent campaign ID, ordinary explicit Launch and independent persisted evidence. Backend validation rejects parent/run mismatches. This is a linked *new campaign*, not modification of a completed campaign. No new queue or storage roots.

Machine verification must cover wizard preset carryover, frozen references and settings across both supported model families, no auto-launch, user-customized epoch selection, source campaign unchanged, and correct continued FIFO admission. This is not a bit-identical replay: seeds are fresh by design.

### Phase 4 — human handoff and shortlist
Verify real staged-checkpoint provenance: Test candidate aggregation currently keys by **staged filename**, not by training run ID/epoch. Reuse an existing reversible mapping when copying to Test; otherwise add a tiny provenance field to the staged candidate/session record rather than a separate store. Read existing human ratings and Test VL/reference results through that mapping. Show automated and human scores separately; no score fusion yet.
Use transparent per-evaluator candidate discovery (including alternative strong signals) once RVN/DINO validity is demonstrated. Preserve the existing concept-fidelity ranking as a legacy view. Recommended shortlist must be dynamically recomputed, with promoted/manual selections separately identifiable. No forced number of finalists, numeric DINO threshold or forced diversity.

### Phase 5 — empirical calibration and optional combined sorting (deferred)
Compare automatic results with actual human-rated images. Only after enough trustworthy paired evidence, evaluate normalization/weighting and an optional combined sort. Do not add confidence formulas, proactive test recommendation, automatic Director ratings or Run Analytics to these initial phases.

## Verification / release gates
- Python tests: `python -m pytest tests/test_epoch_finder.py tests/test_epoch_checkpoint_evidence.py tests/test_epoch_reference.py tests/test_test_reference.py`.
- Manual browser: multiple campaigns of same run with different prompts/settings; inspect counts and score separation; another run with matching epoch number never leaks; interrupted/failed campaign survives; deleting a campaign immediately removes its projections.
- Before phases 3/4: actual H3 and Krea2 generation, user-directed cancellation/resume, references, Test copy + re-rate + revisit; verify no accidental staging cleanup or change to existing Test ratings.
- External code integration cannot be runtime-tested in the GitHub connector environment; do not merge without local regression/smoke confirmation.

## Explicit non-goals
No new storage system, queue/lane, automatic scans, score fusion, hidden state, change to progressive elimination or global ranking by DINO, premature Run Analytics graph, or autonomous winner selection.
