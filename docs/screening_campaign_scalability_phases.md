# Screening and Campaigns: scalable 100+ epoch updates

This change is deliberately limited to deterministic, local work elimination.
The authoritative inference queue, campaign FIFO, Test Session lifecycle,
rating persistence, and recovery boundaries remain unchanged.

## Phase 1 — Manual Screening DOM reconciliation
- Build one index of existing epoch rows per changed matrix render (no per-epoch DOM query).
- Group saved units by round/epoch once for row visibility, per-case lookups and row signatures.
- Keep excluded, collapsed **row headers** mounted with their stable DOM identity; do not mount hidden previews until expanded.
- Remove only the affected preview children on collapse. Preserve selected previews on polls and reorder rather than recreating.
- Summarize per-round completed/failed unit counts in one pass.

## Phase 2 — Campaign render/leaderboard
- Group assessed units by epoch in one pass per ranking/summary render.
- Compare gallery revisions only for displayed media (the recent 40 by default, or the selected epoch).
- Preserve scoring weights, historical reentry logic, tie breaks, filters, preview identity and interactive controls.

## Phase 3 — Campaign worker CPU and filesystem checks
- Build an ephemeral round-local (round, epoch, case) index for unit lookup/creation.
- Check each planned unit once; preserve the same queue/pacing, interruption and cancellation behavior.
- For staging cleanup, skip session checks for units with saved frames: frame capture occurs only after the Test session reaches complete. Continue checking all uncaptured session references, including render failures.
- Group assessed units before Python ranking without changing scoring semantics.

## Phase 4 — Persistence boundaries (reviewed, not modified)
- Each worker progress save currently rewrites campaign.json and merges concurrently authored manual ratings/selections.
- Removing or batching those writes without redefining crash recovery could lose progress, ratings or deletion/cancellation markers.
- No save coalescing or throttling is included: changes to durability require a separate, explicit correctness proof.
- No new cache, dependency, scheduler lane or hard cap.

## Verification
- Node DOM regression: 100 epoch rows, 20 selected x 3 preview cards, unchanged-poll identity, expand/collapse, one changed preview.
- Python regression: 100-epoch weighted ranking and round boundaries, indexed unit identity, stale completed-session probe elimination.
- Existing `revamp-validation.yml` suite retains legacy Campaign, Test, Finder, UX and queue checks.
- Real-machine latency at 20/100/200 epochs is still a separate manual performance measurement, not a claimed benchmark.
