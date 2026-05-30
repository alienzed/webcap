# Smart Set Requirements

Last updated: 2026-05-27

## Implementation Status (WIP)

This document is primarily a target requirements spec, not a full reflection of shipped behavior.

Current implementation status:
- `Create Set From Results` exists and is operational (`/fs/create_set_from_results`).
- Smart Set search/materialize UX is still in progress and does not yet match the full workflow described below.
- Treat the sections below as intended direction unless explicitly confirmed in code.

Reference for currently implemented set creation behavior:
- `docs/create_set_from_results.md`

## Purpose

Smart Set enables selective reuse of already-captioned media across existing sets.

It is designed for combining subsets into a new consolidated set (for example, "baseball players" or "baseballs only") without manual file-system drag/drop workflows.

Smart Set is not for discovering new uncataloged media. Inputs are existing media items that already have caption/tag signal.

## Product Principle

Simplicity and minimalism are paramount.

This is a satisfice feature: focused, functional, safe, and intentionally not over-engineered.

## High-Level Flow (Shippable)

1. User explicitly enters Smart Set mode from the top-level `Smart Set` button.
2. User defines filters in Smart Set workspace.
3. User clicks `Search` (manual run only).
4. Results load lazily; user sanity-checks and refines filters in the same workspace.
5. User clicks `Materialize`, provides required name and location.
6. App creates a brand-new consolidated set and auto-navigates to it.
7. Smart Set mode exits; user continues normal workflow (rate, prune, recaption, etc.).

## Scope and Safety

- Source sets are read-only during Smart Set operations.
- Materialization creates an independent copied set.
- Pruning in the new set affects the new set only, not sources.
- Smart Set behavior must not regress normal media-list behavior.

## Search Model

### Query Controls

- Dedicated path scope control (not a filter row).
- Path scope prefilled to the folder context that launched Smart Set.
- Path scope is editable.
- `Include subfolders` toggle is present and defaults to `on`.

### Filter Builder

- Rule-row model (email-rule style), not a single text box.
- Global combine mode is supported:
  - `Match all`
  - `Match any`
- At least one filter row is required to run search.
- Default starter row is pre-seeded as `caption contains [empty]`.

### Required Fields and Operators (Initial)

- Text field behavior: same as main filter for consistency.
- `contains` (required)
- `does not contain` (supported)
- `path` (required field)
- `star` multi-select with explicit `No stars`
- `flag` multi-select with explicit `No flag`

### Matching Semantics

- Text matching is case-insensitive.
- `contains` uses substring matching (not whole-word only).

### Interaction

- No auto-submit while editing filters.
- No advanced progress UI.
- Keep interaction plain and responsive.
- Clear/reset action is not required for v1.

## Results Workspace

- Search results and folder media list are different concerns.
- Results list is filename-only.
- No thumbnails in the results list.
- No per-item include/exclude checkbox workflow in Smart Set mode.
- If results are wrong, user refines filters and searches again.
- If results are broad, user can materialize and prune afterward.
- Clicking a filename loads preview/caption/details by reusing existing detail UI behavior.
- Results may lazy-load.

## Materialization

### Required Inputs

- Set name is required.
- Destination location is required.
- Destination defaults to current folder context.

### Validation

- Name collisions block submission with validation error.
- User must fix before submit.

### Copy Behavior

- Output is a brand-new consolidated set folder.
- Copy media and relevant sidecars/metadata needed for normal downstream workflows.
- Carry item-level metadata (including stars, flags, reviewed state).

### Duplicate Handling

1. Deduplicate identical content (hash-equivalent): keep one binary copy.
2. If identical binary has different captions/metadata, create a merged caption that is explicitly marked and appended with clear separator/marker.
3. Filename collisions (non-identical files): keep first filename, then suffix `_2`, `_3`, etc.

### Post-Create Navigation

- On success, auto-browse to the new materialized directory.
- Exit Smart Set mode.

## Smart Set Identity on Materialized Sets

- Materialized set opens like any normal set.
- Show visible `Smart Set` indicator/badge on sets with Smart Set provenance.

## Persistence

- Persist Smart Set recipe/state with folder state persistence (hidden config behavior already used by app).
- Persist exactly what is required to restore Smart Set filter configuration as previously set.
- Do not restore prior result snapshots.

## Out of Scope (for this requirement set)

- New-media discovery without captions/tags.
- Saved filter presets.
- Advanced progress instrumentation UX.
- Per-item pick-and-choose selection UX in Smart Set results.
- Auto-rematerialization behavior.
- Extra Smart Set-specific actions beyond future `Reopen Smart Filters` discussion.
