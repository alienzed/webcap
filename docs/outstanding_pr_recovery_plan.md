# Recovery of outstanding requested WebCap features (2026-10-19)

Grounded in `AGENTS.md`, current main, and PRs #487, #468, #317, #86, #380.
Do not merge stale feature branches wholesale. Preserve file-based state, existing queue ownership and FIFO/lane-sticky GPU coordination; no new services or UI frameworks.

## Phase 1 — Neutral base buttons and compact Batch receipts (#487)
- Update the global default button style to neutral using existing theme tokens, keeping explicit action accents.
- Apply small per-session running/completed/error status affordances while maintaining actual session IDs, accessible titles, and existing Batch launch/session navigation.
- Verify light/dark styles, focus, action contrast and Batch reconciliation.

## Phase 2 — One-shot Storyboard Concept expansion (#86)
- Preserve the original Concept as the sole restore point until explicitly restored, even across manual edits.
- Make Expand unavailable once expanded, show Restore Original; enforce the same transition server-side.
- Restore must clear the prior concept marker, allowing subsequent expansion.
- Exercise expand/edit/re-expand failure/restore/expand contract without disturbing Scenes.

## Phase 3 — Queue drag-and-drop (#468)
- Reuse existing native drag/drop gesture patterns; drag handles only on queued Inference and Training rows. Retain accessible Up/Down actions.
- Drop means insertion, not swapping; backend queue order must match rendered order, keeping running/backlog/nonqueued jobs fixed.
- No DnD for LLM FIFO, no new scheduling priority, locks, or persistence; reject stale/not-queued operations visibly.
- Validate reorder in both directions with mixed queued and running jobs and controls after live reconciliation.

## Phase 4 — Training History Continue epoch extension (#317)
- Only History Continue on a recorded, resumed run; derive observed saved epoch from real captured run artifacts and effective recorded plan.
- If <=5 epochs remain, ask for an increased *total* target before allocating any work; cancelling has no side effects.
- Rewrite only the new continuation job's copied config; preserve original capture and checkpoint; record the effective target for later Continues.
- Runtime training GPU evidence is unavailable on this development host: validate mocked filesystem/route-level behavior, never infer live training state.

## Phase 5 — Test evaluation consolidation (#380)
- Adapt the prior Evaluate/Compare menu idea to current Test Generations, References and batch/session UX.
- Retain existing evaluation algorithms and result ownership. Offer Original, VL Reference, DINOv2 Reference, and an explicit Evaluate All.
- For All, require one shared reference choice and run reference comparisons in order and original VL afterward; propagate stop/failure clearly and do not start subsequent steps on failure.
- Maintain progress, model/scope and session identity; validate existing stop and retry behavior.

## Final audit
- Source-level contracts plus runnable focused suites where the environment supports them; review actual diff for unrelated changes.
- Explicitly flag browser/GPU tests unavailable from the GitHub connector environment.
- Merge only after reviewing the reconciled work. Close superseded original PRs after equivalence is established.
