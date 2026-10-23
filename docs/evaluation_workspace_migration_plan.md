# Evaluation workspace: safe IA migration

## Goal and non-negotiables

Rename **Test Generations** to **Evaluation** in the user-facing application flow:
**Prep → Training → Evaluation → Generations → Storyboard**.

Organize Evaluation around the thing being varied, not the implementation of the
campaign engine:

| Method | Existing capability | Route |
| --- | --- | --- |
| Prompt Tests | Frozen-prompt Test generations, repeats, sweeps, ratings, Ask VL | `tests` |
| Manual Screening | Human-reviewed checkpoint × wildcard variation matrix, successive rounds | `screening` |
| Campaigns | Automated epoch qualification, multi-round VL/reference/DINO workflows | `finder` |
| Insights | Existing analysis, checkpoint/history inspection and review | `analytics` |
| References (utility) | Training reference selection needed by existing comparisons | `references` |

**Invariants:** No lost reachable controls, no renamed filesystem identities, no
schema migration, no inference queue/GPU changes, no implicit cancellation, no
reparenting another controller's live DOM, no reset of user edits on navigation,
no invented scoring claims. Preserve Tests, Screening, Campaigns, References,
Insights, training run selection, staging, ratings, VL/DINO options, history,
deep links, and back navigation. Keep errors visible through WebCap's Console.
Follow [AGENTS.md](../AGENTS.md), particularly ownership, live DOM identity,
reversible state, KISS, and queue invariants.

## Phase 1 — Native shell and honest names

- Rename only visible Evaluation labels in the application rail, header and
  Training handoff; keep internal `test-generations-*` IDs and
  `/fs/test_generations` routes to avoid corrupting callers/data.
- Replace old top-level navigation with Prompt Tests / Manual Screening /
  Campaigns / Insights; keep References reachable as a subordinate utility.
- Use **one persistent, normal-flow navigation row** so scrolling forms do not
  move beneath it. Keep the existing layout and controller-owned DOM intact.
- Remove unused Build/Explore perspective and experimental unified shell from
  the loaded HTML/script list. Do not delete underlying generated evidence or
  server gallery APIs: useful data access remains available to Insights and
  existing clients.

**Gate:** No duplicate navigation and all existing native owners and actions
are present under Evaluation.

## Phase 2 — Distinct methods, one proven engine

- Continue using `epoch_finder.js` and `epoch_finder.py` under their stable
  implementation names.
- Route `screening` and `finder` separately, using the existing
  `campaign.mode === 'manual'` discriminator and persisted campaign IDs.
- Filter history lists by method *and* model; keep histories as stored, not
  copied or transformed. Opening a deep-linked history item resolves the
  correct Evaluation method even if its mode was not known from the list.
- Preserve explicit returns to Tests and Insights, including checkpoint media
  dialogs. Do not overwrite an editable Screening prompt when merely reading
  historical rounds. Reuse Set-owned workspace prompt initialization.
- Do **not** split workers, scoring, queue lanes, directories, endpoints, or
  campaign records just for UI independence.

**Gate:** Both campaign types remain creatable, resumable and inspectable;
cross-surface navigation returns to its source.

## Phase 3 — Screening rounds visually shrink

- Backend already persists `kept` selections and freezes them into each
  `_screening_next_round` plan. **Do not change that backend contract.**
- In an active Manual Screening, display only currently selected epoch pills
  in the next-round picker. Deselection reduces the visible count immediately.
- Provide **Show excluded epochs** to restore previously removed or newly
  available epochs without losing any selection/provenance; leave the button
  explicit and reversible.
- Historical round matrices use their frozen `plan.epochs` and remain
  readable, rated and inspectable even for excluded candidates.
- Preserve keyed rows, scroll, card playback/ratings, and in-flight rendering
  updates; only reconcile affected picker elements.

**Gate:** Round 1 choices → deselect epochs → visible list shrinks →
Round 2 receives only kept epochs → Round 1 history remains → an excluded
epoch can be reintroduced for a subsequent round.

## Phase 4 — Parity tests and handoff

- Retire obsolete tests that require the old experimental UI; replace them
  with contracts proving the native Evaluation shell, method isolation,
  persisted history, original controls, references, and direct returns.
- Continue to run existing backend Manual Screening queue/round/rating/keep
  tests without modifying scheduling.
- Verify JS parsing, navigation behavior, and relevant tests. Confirm in a
  running browser that **all five destinations** are reachable, old history is
  readable, both campaign types launch, per-round progress works, the
  Test session form survives method changes, and the layout has no scroll
  overlap at normal and narrow widths.
- Keep deployment separately reviewable in a PR. Do not merge until CI and
  interactive smoke tests have been reviewed.

## Outside this cleanup

Do not introduce a new Evaluation abstraction/framework or migrate data to
prove a new IA. Assess the actual value of VL Compare/DINOv2 later with
human-labelled evidence. Keep References until their consumers are explicitly
retired. Improving Campaign gamification, Insights reasoning, and form-default
persistence are independent follow-ups, not excuses to delay an honest usable
navigation.

## Implementation touchpoints

- `tool/tool.html`, `tool/css/epoch_finder.css`
- `tool/js/epoch_finder.js` (navigation, method-specific history, picker)
- `tool/js/test_generations.js`, `tool/js/workspace_shell.js`
- `tool/js/run_analytics.js` (origin-aware back)
- Existing authoritative backend: `tool/server/epoch_finder.py`
- Contract tests in `tests/test_test_workspace_permanent_tabs.py`,
  `tests/test_test_surface_context_navigation.test.cjs`,
  `tests/test_epoch_finder.py` and Evaluation parity contracts

This is intentionally a frontend IA migration with a small Screening picker
presentation enhancement, **not** a rewrite of inference or scoring.
