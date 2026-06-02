# SuperSet Requirements

Last updated: 2026-06-02

## Purpose

SuperSet means one thing: search in more than one set (current folder plus subfolders), then materialize a new set from those cross-folder results.

This is a scope expansion of filtering, not a separate editing workflow.

## Product Position

- Safety and stability are higher priority than seamlessness.
- SuperSet must not make existing caption and media mutation paths fragile.
- If a design choice reduces coupling with the normal media list and editor path, prefer it.

## Core UX Contract

1. User explicitly opts in to recursive search via a dedicated checkbox in Advanced Filters.
2. Optional confirm prompt can fire on activation to emphasize wider scope and cost.
3. Recursive scope defaults to current folder plus subfolders, not whole root by default.
4. The checkbox only arms SuperSet; `Search` is the commit point.
5. `Search` is manual only, disables itself after a run, and re-enables when filters change.
6. `Clear All` clears filters, exits SuperSet, and restores the prior folder view.
7. Results render in a dedicated SuperSet list, not the normal media list.
8. SuperSet results are preview/metadata only; they reuse the preview surface, but do not expose an active media editing target.
9. Materialization uses the existing create-set path and consumes the full matched result set, not only visible rows.

## Entry and Visibility Rules

- Recursive control should always be visible in Advanced Filters.
- Do not hide the control dynamically based on folder context.
- If disabled behavior is used, keep it explainable and lightweight.

## Metadata Assumptions

- SuperSet search and spot-checking may rely on folder metadata that the app already indexes during normal folder entry.
- Do not add bespoke waiting, retry, or loading-state logic just for temporarily missing metadata.
- If metadata is not ready yet, the expected behavior is simply to search again once indexing catches up.
- Metadata-dependent filters should assume cache-first lookup and keep the flow simple.

## Safety Boundary

- SuperSet entry clears active media/config targets and stores results in a dedicated result collection.
- SuperSet result interactions must not set `state.currentItem`.
- SuperSet entry also clears `state.currentConfigFile` and empties `state.items`, so the app naturally behaves like a non-set folder.
- SuperSet list must not reuse normal media-list mutation handlers.
- While SuperSet results are active, caption editor and mutation actions are out of scope by state invalidation, not special guards.
- No prune, reset, rename, rate, tag, or image actions from SuperSet list.
- Failed saves, inert shortcuts, and no-target editor actions are acceptable if they do not mutate data or destabilize the app.

## State Contract

- Checking the Advanced Filters checkbox only arms SuperSet search; it does not change list visibility or clear active item state.
- Running `Search` enters SuperSet results mode.
- Entering results mode sets `state.currentItem = null`, `state.currentConfigFile = null`, and `state.items = []`.
- Results live under dedicated state such as `state.supersetResults` and `state.supersetCurrentResult`.
- Result preview may load caption text, media preview, tags, stars, flags, and metadata, but must not create a save target.
- Filter changes after a run mark results stale and re-enable `Search`; they do not auto-submit.
- Exiting SuperSet clears dedicated SuperSet state, refreshes the source folder, and does not restore a previously previewed media item.
- Folder navigation through normal path controls should be allowed to exit SuperSet by normal refresh behavior.

## Results Experience

- Dedicated SuperSet list element and controller.
- Hide or sideline the normal media list while SuperSet results are being viewed.
- `Exit SuperSet Search` should return to the current folder view and refresh it; no previous item restoration is required.
- Result sets may be large, so prioritize simple rendering and stability.
- Load results incrementally with `Load more` or infinite-scroll style chunks instead of rendering the entire set at once.
- Practical batch sizing can be in the 200-400 row range per chunk.
- Clicking an item should support spot-check validation:
  - show preview
  - show caption text
  - show relevant read-only item data such as tags, stars, flags, and metadata
- Deep metadata or caption editing workflows are intentionally out of scope.

## Materialization

- SuperSet feeds Create Set logic with source-relative item references from multiple folders.
- Materialization must use all matched result items, not only currently rendered or visible chunks.
- Source sets remain read-only.
- Destination is a brand-new set folder.
- Post-success: exit SuperSet, auto-navigate to the created set, then return to normal workflow.

See: `docs/create_set_from_results.md`

## Implementation Checklist

1. Add the SuperSet checkbox at the bottom of Advanced Filters.
2. Add a dedicated `Search` button that appears when SuperSet is armed.
3. Disable `Search` after a completed run and re-enable it on filter changes.
4. Add dedicated SuperSet result state; do not store results in `state.items`.
5. On Search, clear `state.currentItem`, `state.currentConfigFile`, and `state.items`.
6. Hide the normal media list while SuperSet results are active.
7. Render results through a dedicated list that visually resembles the media list.
8. Make result row clicks call preview/caption/metadata loading without `selectPathMedia()`.
9. Keep set-scoped workspace actions hidden by relying on empty `state.items`.
10. Wire `Clear All`, checkbox uncheck, and `Exit SuperSet Search` to exit and refresh the source folder.
11. Wire Copy Set from SuperSet to all matched `state.supersetResults`, not rendered rows.
12. After Copy Set succeeds, exit SuperSet and navigate to the new set folder.
13. Remove, hide, or explicitly deprecate the old `Smart` utility-button prompt flow.

## Risk Register

### Uh Oh

- Reusing normal media-list row handlers could call `selectPathMedia()` and recreate `state.currentItem`, which re-enables normal caption/media mutation paths.
- Copy Set could accidentally read visible normal media rows instead of full SuperSet results, creating incomplete or wrong sets.
- The legacy `Smart` utility button could remain as a competing prompt-based materialization path with different behavior.
- Config UI could remain reachable and set `state.currentConfigFile`, allowing config saves while the app appears to be in browse-only SuperSet results.
- Exit paths could leave stale `state.supersetResults` or stale result selection visible after folder navigation or Clear All.
- Result preview could resolve paths against the wrong folder, causing caption/preview mismatches or copying the wrong source item.

### Needs Eyes

- Set-scoped actions should hide naturally because `state.items = []`; if any remain visible, Train/Prepare/Review may run against no rows or the wrong context.
- The path utility may navigate while results are active; the minimal safe behavior is to clear SuperSet state during the resulting folder refresh.
- Filter changes must clearly mark results stale; stale result display is mostly UX confusion, but stale Copy Set inputs would be a real materialization bug.
- Detail panels may retain stale media-facing values unless result clicks overwrite or clear them; this is visual confusion unless it creates a save target.
- Large result sets can overload rendering if all rows mount at once; chunked display avoids UI stalls while still copying all matched rows.
- Source files can disappear between search and Copy Set; this should fail visibly during materialization, not silently create a partial set.

### Probably Fine

- Review Captions should be hidden or disabled by the empty-item non-set context; direct invocation should only report that no media is available.
- Train/Prepare/Generate controls should disappear with the set workspace; if directly invoked with empty items, they should no-op or fail without mutation.
- Wheel navigation and media movement shortcuts already depend on `state.currentItem`; with no active item they should fail inertly.
- Rating, flag, delete, rename, and F2 shortcuts should no-op because there is no active item or filename.
- Old report links or `selectByFileName()` calls can fail to find a file while `state.items = []`; this is harmless unless surfaced as primary UI.
- Missing or stale result preview should be treated as a display failure unless the item is still included in a Copy Set request.

### Who Cares

- Editor autosave with no `state.currentItem` and no `state.currentConfigFile` may log or skip because there is no valid target.
- Ctrl+S can fail, reject, or print status when no save target exists; immutable SuperSet captions are not meant to be saved.
- Caption helper, phrase, requirement, and tag controls can be inert or say that no media is selected.
- Keyboard shortcuts can remain registered if they naturally do nothing without an active item.
- Status logging does not need expansion just to explain invalid saves or inert shortcuts.

## Out Of Scope

- Full Smart Set workspace mode UX.
- Dedicated rule-builder separate from existing filters.
- Rich per-item inclusion and exclusion controls inside SuperSet results.
- Reusing the existing media list edit pipeline for SuperSet rows.
- Any feature that increases coupling risk with normal edit and caption flows.
- Fixing harmless failures caused by intentionally invalidated edit state.
