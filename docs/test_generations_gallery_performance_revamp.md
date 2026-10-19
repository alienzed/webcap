# Test Generations visual workspace: performance and mockup-parity correction

## Contract
This work corrects the shipped unified Test Generations interface, not its generation engines. Follow `AGENTS.md`: source feature controllers own their state and handlers; no new queue, database, cache root, guessed provenance, background rescan or localStorage. Never remove or replace Test, Batch, Finder, References, Analytics or source review tools before their actions remain reachable.

Reference design: `test-generations-full-workspace-builder.html` (approved interactive mockup). Explicit target dimensions: ~232px left rail, flexible gallery, ~304px contextual inspector; Build consumes center + inspector while retaining left rail. Gallery is image-first, not an unlimited 10-column grid. Builder has usable form widths, coherent settings and candidate organization, and a functional preview of what will run.

## Phase A — bounded discovery and correctness
1. Introduce server-filtered, bounded result pages (default 36/48, max 96) sorted predictably newest first. Return a compact catalog and counts, but only selected-page media. Avoid loading ratings/VL per session during discovery; request heavy detail for a selected result only if needed.
2. Use source-set/run/epoch from recorded provenance for checkpoint groupings, do not fabricate identities for unattributed Base or legacy results.
3. Preserve historical session and campaign navigability, including pruned media and inactive checkpoints, and keep precise Activity routes.

Gate: server tests with >one page of Test/Finder records, checkpoint filter, stable ordering, explicit missing data, no saved-file mutation. A single refresh must not trigger hundreds of media requests.

## Phase B — bounded media rendering
1. Render at most one result page at a time. Never set `src` for offscreen previews; cap concurrent loads and give videos a visible seek frame or graceful playable fallback.
2. Display video tiles at the actual media aspect ratio (landscape H3 videos) instead of forcing portrait. Keep separate original media/controls on inspection.
3. Coalesce status-triggered updates and do not redraw unchanged galleries; preserve selected image and scroll.

Gate: DOM tests with hundreds of fixture entries show bounded loaded elements/URLs, selection and scroll stability, and correct image vs video semantics.

## Phase C — actual mockup layout and builder ownership
1. Restore proportional left rail / visual center / inspector and sensible card sizes (around 240px, at most 4–5 at typical desktop). Search and filters are visible, actions compact; no nested scroll traps.
2. Give Build the center+right columns. Move the native Test controls *with their original structural styling* and handlers; use clear generation setup and staged candidates zones, reserve an actual execution context/preview at the right.
3. Finder/References/Analytics retain controllers, their real advanced setup and original fallback. Avoid wrapping controls in contexts which make their inputs expand to full width, or hide essential buttons.
4. Keep navigable source result details and side-by-side/compare abilities in the native view until the new surface faithfully supports them.

Gate: real `tool/tool.html` DOM transitions, CSS contract tests, screenshot-width sanity, all native buttons/inputs retaining nodes and event handlers.

## Phase D — hostile audit and safe merge
- Run JavaScript/Python syntax, targeted server pagination/identity tests, full actual-markup DOM tests, and Test/Batch/Finder/Analytics regression comparisons versus pristine main.
- Diff every changed frontend/backend contract for retained capability.
- CI pass required before merging; no claim of real GPU/media-size benchmark without running the user's workload.
- Preserve old interfaces as a fallback through runtime validation. Only deprecate them in a separate verified cutover.
