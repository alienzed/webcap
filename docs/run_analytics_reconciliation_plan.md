# Run Analytics reconciliation — implementation plan
Status: implementation branch `fix/run-analytics-deep-reconcile`. Read with `docs/run_analytics.md`, `AGENTS.md`.

## Phase A — evidence contract
- Use recorded Set/run/epoch IDs exclusively; correct live saved checkpoint discovery through existing training artifact reader.
- Count only measured epochs; do not double-count shared campaigns/sessions.
- Split frozen Test generation cohorts by strength and VL model/rubric; show per-epoch session sources, exclude missing provenance from comparisons.
- Show only actual completed rounds; reuse loaded campaign snapshots rather than revisiting filesystem for each run.
- Protect against data loss and synthetic scores: archive/deleted evidence remains explicitly missing.

## Phase B — flow correctness
- Changing run selection invalidates previous analysis/Director state, including stale in-flight requests.
- Director preview is explicit, computed on demand, and content-fingerprinted; execution rechecks same facts and rejects stale previews.
- Exact run+epoch and session navigation, with visible source-unavailable failure.

## Phase C — UI/IA
- Overview first: deterministic findings/limitations, then coverage, one selected metric/protocol and comparative chart, checkpoint table, optional Director.
- Add first-class compatible cohort picker; preserve source filter settings and selections while switching views; no automatic scans/inference.
- Legible chart ticks, real gaps from actual missing observations, accessible table and states, responsive sidebar.

## Phase D — verification
- Regression cases for frozen cohort keys (including VL/rubric/strength), source sessions, unscored and interrupted rounds, live/archive coverage, stale preview.
- Validate syntactic wiring of classic scripts, validate PR diff and documentation.
- True training-machine validation requires that machine's real data, unavailable from GitHub.

Decision defaults: 1–6 same-Set runs; user-triggered Director; no new persistence/queue; scope only recorded evidence.
