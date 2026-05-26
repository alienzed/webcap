# State + Metadata Consolidation Audit

Last reviewed: 2026-05-25

## Goal
Define a safe path to make runtime data contracts explicit and reduce split-brain state, starting with the `Invalid AR` filter bug.

## Why This Audit Exists
- `Invalid AR` currently filters from `state.items`, but AR is not populated there.
- AR metadata was loaded into a separate in-memory cache.
- Result: filter can silently produce incorrect results.

## Current Runtime Data Flow
1. Folder load calls `/fs/describe` and builds `state.items` in `tool/js/ui.js`.
2. `state.items` currently includes:
- `label`
- `key`
- `fileName`
- `caption`
- `hasCaption`
3. Metadata is fetched asynchronously after list render via `refreshMediaResolutionCache()` in `tool/js/item_details.js`.
4. Metadata is merged into matching `state.items[*].metadata` rows.

## Confirmed Contract Mismatch
- `Invalid AR` filter reads `item.aspect_ratio || item.ar` in `tool/js/media.js`.
- No active folder-load path populates either key on `state.items`.
- Therefore the filter checks keys that do not exist in normal runtime flow.

## Metadata Read Paths Today
Confirmed consumers of `state.items[*].metadata`:
- Item metadata panel (`tool/js/item_details.js`)
- Selected-item status resolution text (`tool/js/media.js` via `getResolutionForMedia`)
- Video clip resolution fallback (`tool/js/video_clip.js`)

Notably, review report metadata table fetches `/fs/media_metadata` directly in iframe context and does not depend on the in-memory cache.

## Other Non-`state` Runtime Stores (Frontend)
These are separate globals today:
- `captionItemTagsByMedia`
- `checklistCheckedByMedia`
- `checklistKeywordsByItem`

This is manageable, but it means data contracts are implicit and can drift.

## Consolidation Options
### Option A: Patch only Invalid AR to read metadata cache
- Fastest bug fix.
- Keeps split data sources for filters.
- Higher long-term fragility.

### Option B: Keep cache, also project metadata onto `state.items` (recommended bridge)
- Preserve async behavior and load speed.
- Keep existing cache consumers working.
- Establish `state.items` as canonical filter source.
- Low-to-moderate implementation risk.

### Option C: One-pass full consolidation (remove separate metadata cache immediately)
- Cleanest end state.
- Higher immediate blast radius across metadata panel + clip flow + status usage.
- Not recommended in stabilization mode without progressive checkpoints.

## Recommendation
Proceed with Option B first.

Reasoning:
- Fixes current bug with minimal behavior risk.
- Avoids route changes.
- Avoids large refactor in one pass.
- Creates a path to retire duplicate cache references after verification.

## Canonical Field Contract Proposal
Use a single canonical AR source on `state.items` and stop dual-key probing.

Proposed canonical per-item metadata shape added after metadata fetch:
- `item.metadata = { ... }` full metadata row
- `item.metadata.aspect = "<w:h>"` canonical AR for filters

Alternative is flattening all metadata fields onto item root. Nested `item.metadata` is cleaner and less collision-prone.

## Phased Plan
### Phase 1: Bridge + bug fix
- On metadata fetch completion, merge metadata rows into matching `state.items`.
- Use `item.metadata.aspect` as the canonical AR field.
- Update `Invalid AR` to read canonical item field only.
- If metadata is not ready when toggling `Invalid AR`, provide explicit status feedback (no silent false-negative).

### Phase 2: Metadata read migration
- Move metadata panel/status/video-clip reads to `state.items` (or helper that reads canonical item metadata).
- Keep migration surface narrow by using helper readers keyed by `fileName`.

### Phase 3: Cache retirement
- Remove unreferenced metadata cache globals and helper paths.
- Keep one canonical runtime source for filterable/displayable media metadata.

## Scope and Feasibility
### One-pass implementation feasibility
- Technically feasible.
- Not recommended for current risk posture.

### Estimated scope by phase
- Phase 1: small (targeted, low blast radius)
- Phase 2: medium (cross-file read-path migration)
- Phase 3: small (cleanup)

## Guardrails Before/While Implementing
- Define and document canonical item metadata schema in code comments.
- Add focused tests for `Invalid AR` with:
- metadata ready
- metadata not ready
- mixed supported/unsupported AR sets
- Add defensive checks so filters fail loudly in debug mode if expected fields are missing.

## Immediate Next Steps
1. Add targeted Invalid AR tests around metadata-ready and metadata-loading behavior.
2. Keep key-audit guardrails in place for future filter additions.
3. Continue periodic dead-key sweeps when adding new UI filters.

### Phase 1 status
- Completed.
- Metadata now projects onto `state.items` after async metadata fetch:
  - `item.metadata`
- `Invalid AR` now reads canonical `item.metadata.aspect` only.
- If user enables `Invalid AR` while metadata is still loading, toggle is blocked with explicit status feedback (no silent false-negative).
- Additional dead-key guard fixed: F2 rename now checks `state.currentItem.fileName` instead of non-existent `state.currentItem.type`.

### Phase 2 status
- Completed.
- Metadata panel now reads metadata via `state.items` helper path (`getMetadataForMedia`).
- Selected-item status resolution now resolves from `state.items[*].metadata.resolution` via `getResolutionForMedia`.
- Video clip resolution fallback now reads metadata via `getMetadataForMedia`.

### Phase 3 status
- Completed.
- Removed legacy metadata cache globals (`mediaResolutionByFile`, `mediaMetadataByFile`).
- `state.items[*].metadata` is now the sole frontend runtime source for loaded media metadata.

## `state.items` Read/Write Key Audit (Safety Pass)
Scope: `tool/js/*` runtime reads/writes for list items and current selected media item.

### Confirmed `state.items` keys written on folder load
- `label`
- `key`
- `fileName`
- `caption`
- `hasCaption`

### Confirmed post-load mutations
- `caption` (save path)
- `hasCaption` (save path)
- `fileName` (rename path via `state.currentItem`)

### Confirmed valid reads
- `label`, `key`, `fileName`, `caption`, `hasCaption`

### Confirmed dead/mismatched reads
1. `item.aspect_ratio || item.ar` in `Invalid AR` filter.
- Neither key is populated in normal load flow.

2. `state.currentItem.type === 'media'` in F2 rename keyboard handler.
- No active assignment of `type` to `state.currentItem` was found in frontend code.
- No `type: 'media'` object construction for list items was found.

### Result
- Additional mismatch exists beyond AR (`currentItem.type` guard).
- No other `state.items` key mismatches were found in this pass.
