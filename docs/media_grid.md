# Media Grid

## Goal

Turn Media Grid into the app's selection workspace.

This is where selection analysis becomes actionable:

- derive confident focus sets from existing metadata
- inspect those sets as thumbnails
- prune, rate, and tag from that same surface

The normal media list remains the primary folder browser and single-item editing surface. Grid becomes the place where the user works through curated subsets.

## Entry

Open Media Grid from the current working context.

Grid should inherit:

- current folder
- current filters
- current focus set, if active

The user should not rebuild scope after opening Grid. If the visible set is already correct, Grid should open on that set immediately.

## New Shape

Use a full-screen or near-full-screen modal workspace.

Grid is no longer just a plain thumbnail wall with batch controls. It becomes a three-part workspace:

- left rail: focus sets and compact filters
- center: thumbnail grid
- right rail: tags, ratings, and batch actions

Avoid rearranging the main app DOM. Grid should still be an independent workspace, but it should now absorb the nearby selection workflow that is currently split across tiny buttons and distant reports.

## Left Rail

The left rail should use vertical tabs and be collapsible.

Requirements:

- collapsed width should stay narrow, around icon-plus-tooltip territory
- expanded width should stay restrained so it does not meaningfully eat the grid
- target expanded width should feel closer to `220-260px` than a full sidebar
- collapse/expand state should be explicit and sticky during the session

The rail should contain two stacked sections:

1. `Focus Sets`
2. `Filters`

`Focus Sets` is the primary section and should always be visible.

`Filters` should be compact and collapsible inside the rail, not spread across the modal header.

## Focus Sets

Focus sets are the reason this workspace exists.

They should be:

- high precision
- easy to explain
- based on positive identity, not unknowns or analyzer uncertainty
- useful for real keep/prune decisions

We should not create sets for things we do not understand. False positives make the workspace feel untrustworthy.

### Initial Focus Sets

Start with confident sets only:

- `All`
- `Suggested`
- `Face Close`
- `Front Keepers`
- `3/4 Keepers`
- `Hands Near Face`
- `Arms Up / Gesture`
- `Simple Background Portraits`
- `Standing`
- `Seated`
- `Kneeling / Crouched`
- `Reclining`

These map cleanly to metadata we already have:

- `face_focus_bucket`
- `face_count`
- `largest_edge_clipped`
- `selection_pose_face_direction`
- `selection_pose_body_orientation`
- `selection_pose_pose_class`
- `selection_pose_arm_position`
- `selection_pose_expression_primary`
- `scene_complexity_bucket`
- existing `Suggested Candidates` scoring

### Set Rules

Each set should have:

- a stable name
- a count
- an exact predicate
- a healthy tooltip

Tooltips should explain:

- why the set exists
- exact signals used
- known bias / likely misses

Example:

`Front Keepers`

- why: front-facing portraits are often high-utility anchors
- signals: face direction `front`, body orientation `front` or `three_quarter`, usable face focus bucket
- bias: may miss strong profile or rear-view shots that are still valuable

### Suggested

`Suggested` can exist, but only if we keep it conservative.

It should continue to use the existing blended score, but present itself as:

- a precision-first subset
- not a full recommendation engine
- not a replacement for manual review

If it becomes noisy, we should tighten it or remove it.

## Filters

Yes, filters should come into Grid now, but only as mirrored controls.

That means:

- Grid does not own separate filter state
- Grid reads from existing list filters
- Grid writes back to existing list filters
- Grid dispatches the same events as the normal controls

This keeps one filtering language in the app.

### Filter Placement

Move the practical subset of filters into the left rail under `Filters`.

Recommended initial set:

- Search text
- Unreviewed
- Invalid AR
- Stars
- Flags

Keep these compact and collapsible so they support the focus sets instead of competing with them.

Do not move low-signal or rarely used controls into the first Grid pass:

- SuperSet
- Reviewed
- Incomplete
- Tag Mismatch
- Captionless

If hidden filters remain active outside what Grid exposes, show a small passive hint such as `Other filters active`.

## Center Grid

The center area remains the main canvas:

- dense thumbnail grid
- multi-select
- fast rating
- visual comparison

When a focus set is selected, the grid should immediately reflect that subset.

The active set name and count should be obvious, but the chrome should stay quiet.

## Right Rail

Keep the right rail for action, not navigation:

- grouped tag controls in configured order
- selection-aware tag state
- rating controls
- batch action status

Tag behavior stays simple:

- inactive tag: add to selected items
- mixed tag: add to selected items
- all-active tag: remove from selected items

## Scope

First meaningful pass should support:

- open Grid on the current visible scope
- left rail with collapsible vertical-tab focus sets
- compact mirrored filters inside the rail
- set counts and rich tooltips
- current visible subset as thumbnails
- multi-select items
- fast rating of selected items
- grouped tag sidebar with collapsible groups
- batch apply/remove tags from selected items
- select all visible
- clear selection
- visible progress/status for batch operations

## Out Of Scope For This Pass

Do not include:

- fuzzy or unknown-based focus sets
- alternate sorting systems
- folder navigation inside Grid
- caption editing
- caption helper panels
- QA panel
- metadata editing
- training/prep actions
- batch crop/reset/deface/remove-background/delete
- duplicate-analysis heuristics that are not already trustworthy

## Precision Standard

Selection-workspace advice must behave like an assistant, not a liability.

Rules:

- prefer omission over false positives
- do not create sets from `unknown` buckets
- do not group by weak heuristics just because the data exists
- every set should be explainable in one sentence
- every set should be auditable back to exact metadata fields

If a set is not precise enough, it should not ship.

## Implementation Notes

- Focus sets should be derived from the same metadata payload already used by Selection Analysis.
- Existing `Suggested Candidates`, face focus buckets, pose buckets, and scene complexity buckets should be reused before inventing new analyzers.
- Grid should prune/update from `getFilteredMediaItems(false)` after mirrored filter changes.
- Grid can own temporary multi-selection state, but persisted mutations must reuse existing app operations.
- Batch work should stay sequential and fail loudly.

## Future Review

Later, we should measure which metadata-derived sets are actually useful and remove the ones that do not help real selection decisions.

The point is not to display every metric we can compute. The point is to turn the valuable ones into trustworthy work surfaces.
