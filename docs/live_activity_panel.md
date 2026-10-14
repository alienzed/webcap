# Live Activity Panel — Product Direction

**Status:** agreed direction with three presentation decisions locked and a few remaining interaction details; **not yet implemented**. This is a UX plan, not a change to the current execution or queue contract. See `docs/execution_queue.md` for what ships now and `docs/queue-semantics.md` for execution semantics.

## Problem to solve

WebCap has useful, resource-rich Director progress cards, a floating global progress follower, and a separate Activity drawer. Those surfaces overlap spatially and functionally. The current Activity experience concentrates on recently completed work, which is rarely worth opening. The real value is understanding **what is happening now** without losing the current workspace.

## Agreed direction

1. **One substantial floating live-activity surface**, rather than competing Director/Activity floating cards and a separate general Activity drawer. It is temporary, dismissible, and reopened from the existing global header activity control. It may occupy a meaningful portion (roughly up to half) of the right-side work area when useful. Readability and graph size matter more than making it tiny. Position it below the global header, without obscuring the header or controls behind it when dismissed.
2. **Lead with the local GPU-owning operation and its active lane when there is one.** If no local GPU lane owns execution, fall back to the relevant current operation (including remote LLM work), without claiming it uses local GPU resources. Present a clear name, phase/status, meaningful progress, elapsed time, and an actionable link to the owning workflow. Show that lane's immediately relevant queue context **inside the primary card** (e.g., running, next, waiting), not in a generic footer and not as a competing queue-management view. Never invent percentages or stages.
3. **Resource graphs are a first-class part of the card**, not exclusive to Director/LLM work. Reuse/consolidate the existing GPU/resource time-series visuals and underlying measurements wherever applicable to local GPU workloads such as LLM, Inference, and Training. Graphs show observed **machine resources**, not an assertion that every visible change is caused by the displayed job. Remote LLM work must not be represented as local GPU usage. Make missing/unavailable telemetry explicit rather than fabricate it.
4. **Short, legible activity rows below the card**, in an expandable section *within the same floating surface*, give ongoing/queued work and recent completions **equal visibility**, rather than relegating completions to a separate hidden history view. Keep recent completion receipts bounded so they cannot crowd out live work. Rows provide direct navigation to their owning screen/item. These should be single-line rows, **not tiny type**. A click must retain relevant job, Story, Scene, Session, or source context; opening an unrelated feature landing screen is insufficient. This section is secondary to the primary live operation.
5. **Other queues get little or no default real estate.** A generic “3 Training items queued” count is rarely worth persistent display. The owning Training and Inference workspaces already provide complete details a click away. Idle lanes should not fill the card; an abbreviated cue for another *currently relevant* lane is acceptable.
6. **Opening policy:** Short, interactive actions (for example Director/LLM assistance) automatically surface the card. Long-running Training and bulk Inference do not auto-open it; they update header status and remain available on demand. **Closing the card is presentation-only.** It does not pause, reset, stop, cancel, reorder, or modify work. The global header control remains the reliable way to reopen the same surface. The card is not intended to remain permanently open on top of the user's workspace, particularly throughout multi-hour Training runs.
7. **Preserve execution ownership.** Activity remains a passive projection of authoritative lane/domain state. Inference Queue retains its separate scheduling-management surface and actions; Training retains its mature queue, runtime, checkpoint/recovery, and controls; LLM retains its session-bound queue/reset semantics. No new polling owner, queue, persisted activity state, or GPU arbitration logic is justified by this redesign.
8. **Keep useful contextual feedback until replacement is proven.** Existing Director resource graphs and action-specific controls must not disappear prematurely. Consolidation must avoid duplicated overlapping global cards while retaining feature-owned actions and progress detail.

## Intended information hierarchy

- **Primary:** current local GPU-owning operation/lane when available, otherwise current non-GPU work; phase, elapsed/progress, live resource graphs where observed, and that lane's relevant queue context.
- **Secondary, expandable:** other ongoing/queued operations **and** bounded recent completions, presented as equally visible, legible single-line activity rows; rows navigate directly to the right context.
- **Elsewhere:** full Inference Queue ordering, Backlog and dispatch actions; Training queue and history; full logs/errors in global Console.

The Activity card is **a live operations companion, not a completion-history dashboard or another scheduler**. A queue summary is for orientation, not for managing queue state.

## Implementation boundaries

- Prefer evolving `tool/js/activity_monitor.js` and the shared `tool/js/progress_card.js`; verify existing graphs and telemetry adapters in Director clients before deciding how to reuse them.
- Respect the app's permanent header, static overlay root, and existing shell ownership. Do not add a second overlay or independent Activity controller.
- Preserve DOM identity/scroll/expanded state during polling; update rows by stable identity rather than redrawing interactive areas wholesale.
- Keep the global Console as the diagnostic home; Activity can display the failure and link to its owner, but does not swallow underlying errors.
- Make one safe UI slice at a time: **(a)** unify global presentation and dismissal, **(b)** add resource graph reuse with truthful metrics, **(c)** add navigable concise rows and active-lane queue context, **(d)** retire redundant general Activity drawer after parity and smoke checks. No Training backend changes.
- Confirm that multiple simultaneously active domains (e.g., remote LLM alongside local GPU work) are presented honestly; do not assume all work is mutually exclusive.
- Refresh stale shell/UI tests only where they encode superseded presentation, and smoke-test Generate, Storyboard, Test, Director, Inference, and Training navigation and stop scopes.

## Locked presentation decisions (2026-10-13)

1. **Automatic opening:** short, interactive operations only; long-running work does not automatically raise the panel.
2. **Primary operation:** the **current local GPU owner**, whenever one exists. Simultaneous remote LLM activity belongs in secondary rows. When no GPU owner exists, show the relevant current non-GPU operation without suggesting local GPU ownership.
3. **Expandable rows:** ongoing/queued work and recent completions **equally**, with bounded history, readable one-line rows, and direct navigation.

## Remaining product questions (do not silently decide)

- **Dismissal persistence:** After the user manually closes the panel, should a subsequent short operation reopen it, or should it stay suppressed until manually reopened? Recommended default: respect manual dismissal for the current session.
- **Idle closure:** Should an open panel automatically close when all work becomes idle, or stay visible until explicitly dismissed? Avoid disappearing before a recently completed result is readable.

These are presentation decisions only. They must not change queue ownership, scheduling, stop scope, or recovery.
