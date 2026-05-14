This file tracks implemented work vs outstanding items.

## Implemented
- Utility bar introduced (path tooltip button, settings, reboot/reload-config, help).
- App settings modal can edit and save `config.json`; reboot reloads runtime config.
- Training area updates:
  - Config files shown in grouped HI/LO columns.
  - `Generate` and `Prepare Dataset` remain explicit actions.
  - Train action currently prints command preview to console (not owning full run lifecycle).
  - Legacy autoset remains available from current-folder context menu.
- Keyboard/media navigation:
  - `ArrowUp` / `ArrowDown` selects previous/next media when a media item is selected.
  - `Delete` triggers prune prompt/action for selected media.
  - After prune, next item selection is attempted (silent no-op at end of list).
- Metadata/rating updates:
  - 5-star rating row added as first line in Metadata tab (click to set 1..5).
  - `1..5` keyboard shortcuts set selected media star rating.
  - `0` keyboard shortcut clears/unsets rating.
  - Ratings persist in folder state (`ratings_by_media`).
  - Metadata fields `Bitrate` and `Color` are commented out (non-destructive hide).
- Advanced filters added (chevron beside filter input):
  - Missing captions only.
  - Reviewed only.
  - Stars filter (`> N`).
  - Flag filter.
- Existing confirmed behavior retained:
  - Rename reselection via `pendingSelectFileName`.
  - Prune backup behavior (`pruned_` in `originals`).
  - Missing-caption highlighting + clear-on-save refresh in list.
  - Context menu flag dots resized/improved.
  - Console auto-append and auto-scroll.
  - Open in Explorer support.
  - Captions save only when changed.
- Selection-driven dataset preparation and snapshotting:
  - Prepare can run on visible subset with explicit partial-set confirmation.
  - Prepare records strict selection metadata in `auto_dataset/prep_manifest.json`.
  - Generate prepends structured selection snapshot comments to dataset TOMLs.
- Config behavior updates:
  - Config templates are created at Generate time, not on directory load.
  - Settings modal now reads saved config from disk on load.
- Media list polish:
  - Selected row now auto-scrolls into view after keyboard navigation, prune-next selection, and direct file selection.

## Outstanding (Active)
- Validate training command preview behavior when config keys are missing (should still provide useful output where possible).

## Stabilization Mode
- App is in lock-in mode: resist new feature work and prioritize targeted bug/regression fixes.

## Backlog (Do Not Implement Yet)
- Persist last selected working directory between refresh/restart (optional toggle in settings; safe fallback when missing).
- Create new sibling set folder from filtered/selected/rated items (including originals + folder metadata copy semantics).
- Set-wide search/replace (current folder only).
- Optional phrase-tab auto-population from local `.txt` files (e.g., `expressions.txt`, `places.txt`, `lighting.txt`).
- Dataset inferred sample/megaframe/VRAM/time estimation.
- Further reduce full-directory refreshes for operations that can be local DOM/state updates.

## Nice to Haves (Out of Scope for Now)
- In-app training execution/orchestration for long-running jobs.
- TensorBoard lifecycle helpers.
- Broader multi-hour process orchestration in app.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.
- Remove legacy/disabled UX paths that are now superseded by visibility gating.
- Audit remaining folder-load side effects and trim non-essential mutation paths.
- Reassess optional tag UX if it continues to add more cognitive load than value.
