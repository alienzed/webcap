# Unified Live Activity Panel — Implementation Plan

**Status:** implementation drafted on feature branch; validation still required before merge. Companion UX contract: `docs/live_activity_panel.md`.

## Codebase findings

- `tool/js/activity_monitor.js` owns the Activity snapshot poller, drawer, separate progress follower, completion receipts, and navigation. Consolidate here; do not add a UI state owner.
- `tool/js/progress_card.js` is already shared presentation for Training/Inference/locally published work; use it for the primary operation.
- `tool/js/workspace_shell.js` already polls `/fs/system_status`. Feed the same observed resource values to the floating graph; while the panel is open, request a faster refresh through this **existing** poll owner.
- Generate, Storyboard, and Test contain the precedent for 60-second GPU/VRAM/RAM/thermal graphs. Reuse that visual vocabulary; do not rewrite their contextual actions or remove Stop controls without a parity test.
- `tool/server/activity_monitor.py` already exposes passive active snapshots and `gpuOwner`. The existing inference snapshot can project queued jobs for direct navigation, without becoming a scheduler.
- Training has its own stable runner/UI. The Activity panel is **read-only** and makes no Training runner, queue, or recovery changes.

## Safe implementation slices

1. **One presentation surface:** move the existing Activity DOM to the overlay root, retire the duplicate follower, connect header and rail entry points to one open state. Preserve escape/outside-click and Inference drawer mutual exclusion.
2. **Live primary card:** select the current GPU-owner lane first; fall back to current non-GPU activity. Reuse `ProgressCard` without inventing progress; show only relevant queue counts next to the primary card.
3. **Resource history:** sample truthful local machine GPU/VRAM/RAM/temperature telemetry via the existing system status endpoint and poller; use the existing Director SVG conventions. Remote work is never labeled as local GPU consumption.
4. **Compact activity rows:** preserve keyed rows for other active work; add passive, job-aware queued rows and bounded recent completions; keep expansion and scroll stable while polling.
5. **Lifecycle:** auto-open for short Director work, not bulk Inference/Training; manual close silences the **displayed primary lane** until explicit manual reopen or new page session; automatic idle close leaves lane unsilenced. Let recent completion receipts remain briefly readable but expire.
6. **Validation and retirement:** update shell contract tests, check syntax, verify resource series and row targets, smoke-test Director/Generate/Storyboard/Test/Training, confirm no duplicate global card and no inference scheduling regressions. Do not merge without execution-level verification or explicit acknowledgement of unavailable test environment.

## Risk and validation notes

- Presentation-only changes must never call a Stop/Reset action implicitly. Director Stop is lane-wide, whereas Inference Stop is job-local; existing owning workflows retain their controls.
- Activity reads must stay passive. Pending-job projections are for navigation, not dispatch or reordering.
- Training runner behavior is explicitly excluded.
- External GitHub access is available via the connected GitHub plugin, but the container cannot resolve github.com for a checkout. Consequently, local end-to-end browser smoke tests cannot be claimed in this environment; review CI/check results when available.
