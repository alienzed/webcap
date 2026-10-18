# Unified Job Queues — implementation phases

## Scope and invariants
Frontend-first global drawer, reusing the existing inference, LLM and training queues. No queue/scheduler/GPU policy change. Follow AGENTS.md and docs/gpu_coordination_invariants.md. Keep read-only Activity separate.

## Phase 1 — shell (implemented)
Extend the existing Inference Queue drawer in tool/tool.html to three tabs. Retain the inference queue implementation, UI ownership and DOM identifiers used elsewhere in the app. Preserve drawer exclusivity with Activity and Director chat.

## Phase 2 — shared projection (implemented)
tool/js/job_queues.js provides one compact presentation for LLM and Training jobs with lane-specific title/details/action mapping. Both lanes share job row structure, status styling, elapsed presentation, action handling and keyed DOM reconciliation. Inference retains its mature Queue/Backlog sections and existing controls.

## Phase 3 — LLM (implemented)
Read GET /fs/director/queue; cancel pending/stop active through POST /fs/director/job with cancel_job; global reset through the same route. No added pause or reorder behavior. The browser may discard running results according to existing backend reset semantics. Request state remains ephemeral.

## Phase 4 — Training (implemented)
Read GET /fs/training_runner/status; use existing stop, reorder and resume_queue routes. Display set, stage, progress, resume and errors when available. Preserve Training workspace's detailed queue UI and checkpoint-safe Pause/Finish semantics. No training runtime changes.

## Phase 5 — verification (pending runtime execution)
Regression checks on a running WebCap instance:
- Simultaneously populated lanes show accurate tab counts, active job first and per-lane context
- Inference Queue/Backlog/Pause/Resume/reordering remains unchanged
- LLM cancel/reset rejects abandoned results; remote LLM does not claim the local GPU
- Training queued cancel/reorder and active Stop/Pause/Finish preserve checkpoint behavior
- Drawer/Activity mutual exclusion, Escape/outside close, tab keyboard navigation
- Polling does not destroy row DOM identity, focus or scroll
- Failures log to global Console; no navigation starts work
- Existing frontend shell and backend queue tests pass

## Risks and boundaries
- Backend contract has existing LLM cancel/reset and Training controls: no backend architectural changes are required.
- Do not share scheduling, persistence or GPU ownership logic across lanes.
- Do not remove the Training workspace's richer run-management UI.
- Before merge, execute the existing tests and browser smoke checks. The development environment used here cannot launch or inspect the real training machine.
