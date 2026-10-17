# Epoch Finder IA and design implementation phases

## Grounded inventory
- `tool/js/epoch_finder.js` formerly auto-selected the first campaign on refresh, and had no deselect/new-campaign affordance.
- `tool/server/epoch_finder.py` already exposes persisted campaign unit prompts, first frames, group judgments, errors, rounds, and scores; no new backend execution or scoring lane needed.
- The sidebar wizard is conceptually distinct from a running campaign, but existing HTML did not make that distinction explicit.
- Campaign list metadata now includes `modelId` so the selected working model controls presentation only, not execution.

## Phase 1: safe navigation (applied)
- Add New Campaign action and stop auto-selecting the first campaign.
- Filter listed campaigns by working model and return to the new-campaign state on model change. Previously running campaigns continue untouched on the backend.
- Preserve the ability to select saved campaigns. Verify returning to H3 shows its campaigns again and does not restart any worker.

## Phase 2: focus and inspect evidence (applied, initial iteration)
- Clicking an epoch selects it and exposes a larger frame viewer, next/previous navigation, original-resolution open, resolved prompt, individual VL judgments, and missing/pruned-frame status.
- Retain current evidence gallery as a navigation overview. The original stored image is never changed.
- Keep image and VL requests read-only, no rescans and no new persistence.

## Phase 3: rankings and navigation refinement (deferred for explicit browser feedback)
- Consider explicit round/status filters, per-epoch denominator/trend, focused grid/list toggle, prompt copy, keyboard navigation, full-screen lightbox and assessment updates without full rerender.
- Multi-run candidate identity is deferred; campaigns remain one saved training run each.
- Copy to Test is already a separate PR and not automatically included here.

## Verification and safety
- JS syntax is checked. Python execution, browser visual/responsive checks, image errors, H3/Krea2 switching, asynchronous status refresh, and real-training-machine smoke are outstanding.
- Model changes must **never** pause, stop, delete, or resume campaigns; the browser only filters and navigates.
- Follow AGENTS.md: no new queue, scan, localStorage state, or hidden retention policy.
