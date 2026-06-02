# SuperSet Requirements

Last updated: 2026-06-01

## Purpose

SuperSet means one thing: search in more than one set (current folder plus subfolders), then materialize a new set from those cross-folder results.

This is a scope expansion of filtering, not a separate editing workflow.

## Product Position

- Safety and stability are higher priority than seamlessness.
- SuperSet must not make existing caption and media mutation paths fragile.
- If a design choice reduces coupling with the normal media list and editor path, prefer it.

## Core UX Contract

1. User explicitly opts in to recursive search via a dedicated control in Advanced Filters.
2. Optional confirm prompt can fire on activation to emphasize wider scope and cost.
3. Recursive scope defaults to current folder plus subfolders, not whole root by default.
4. When recursive search is active, SuperSet search is manual only via a `Search` button.
5. `Search` can disable itself after a run and re-enable when filters change.
6. `Clear All` should clear recursive-search state and exit SuperSet results.
7. Results render in a dedicated SuperSet list, not the normal media list.
8. SuperSet results are browse and validate only, with preview and read-only caption visibility.
9. Materialization uses a dedicated action path from SuperSet results.

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

- SuperSet result interactions must not set `state.currentItem`.
- SuperSet list must not reuse normal media-list mutation handlers.
- While SuperSet results are active, caption editor and mutation actions are out of scope.
- No prune, reset, rename, rate, tag, or image actions from SuperSet list.

## Results Experience

- Dedicated SuperSet list element and controller.
- Hide or sideline the normal media list while SuperSet results are being viewed.
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
- Post-success: auto-navigate to the created set, then return to normal workflow.

See: `docs/create_set_from_results.md`

## Out Of Scope

- Full Smart Set workspace mode UX.
- Dedicated rule-builder separate from existing filters.
- Rich per-item inclusion and exclusion controls inside SuperSet results.
- Reusing the existing media list edit pipeline for SuperSet rows.
- Any feature that increases coupling risk with normal edit and caption flows.
