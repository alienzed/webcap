This file tracks implemented work vs outstanding items.
Last reviewed: 2026-05-19.

## Bugs


## Enhancements
- A way to visually show in the media list when an item has a star rating. I'm not sure we NEED to show how many stars, just something that clearly denotes 'this item has a rating'. I was even thinking of having the number of star really really tiny beneath the name, only a few pixels tall, like, that would be enough for my needs. OR, we do the opposite, right now we have a background color for missing captions, maybe there's a way to do something similar for missing rating.
- Dataset inferred sample/megaframe/VRAM/time estimation.

## 1.1 Ideas
- We have caption requirements. We need a concept of Set Requirements, ideally self counting. For example, a good character LORA includes:
    6 front face close-ups
    6 three-quarter face close-ups
    3 side/profile shots
    6 head-and-shoulders
    5 half-body
    3 full-body
    3 expressive/candid shots
  It would be awesome to get a bird's eye view of where my set is relative this.
  Parked long-term (no immediate pain).

## Stabilization Mode
- App is in 1.0 lock-in mode: resist new feature work and prioritize targeted bug/regression fixes.

## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Parked long-term; no immediate pain.
- Persist last selected working directory between refresh/restart (optional toggle in settings; safe fallback when missing).
- **Save/load sets as packages:** Instead of only writing selection/caption info as comments in config files, support saving and restoring sets (including selection, captions, flags, ratings, etc.) as explicit package files. This would allow fast recovery, sharing, and reproducibility, and could enable advanced features like unpruning files or resetting captions when loading a saved set.

## Nice to Haves (Out of Scope for Now)
- Validate training command preview behavior when config keys are missing (should still provide useful output where possible).
- Maintain flags and metadata when Pruning/restoring/renaming.
- Review duplicate-token detection inside a single caption.
- Audit remaining folder-load side effects and trim non-essential mutation paths.
- Video clip V2 ergonomics polish (timeline UX, additional controls) as tracked in `video_clip.md`.
- In-app training execution/orchestration for long-running jobs.
- TensorBoard lifecycle helpers.
- Broader multi-hour process orchestration in app.
- Set-wide search/replace for captions in the current folder only, with preview/confirmation before writing.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.


## Implemented
- Legacy/superseded UX cleanup pass:
  - Removed duplicate `focus-set-exit-btn` markup path.
  - Removed dead `up-one-directory-row` wiring and stale references.
  - Simplified set-workspace visibility gating to the canonical `sidebar-workspace` path.
- Opening a config file now closes the status console panel.
- Image transforms for still images:
  - Rotate Left 90 deg
  - Rotate Right 90 deg
  - Flip Vertical
  - Flip Horizontal
- Crop modal supports arbitrary image rotation angle (slider/input + reset) and persists rotated crop output.
- Phrase actions are toggle-based: clicking a matched phrase removes it; otherwise inserts at cursor.
- Cropper selection includes soft snap toward an 8px grid; finalized crop dimensions are snapped/clamped for safer outputs.
- Review captions operates on the currently visible/filtered set.
- Persist caption requirement keywords in folder state (`tool/js/folder_state.js`).
- Review captions now runs on the current filtered view (uses `tool/js/media.js` and `tool/js/ui.js`).
- Print MegaFramePixels value next to bucket as comment.
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
  - `G`/`Y`/`O`/`B`/`R` keyboard shortcuts set selected media flag color (green/yellow/orange/blue/red).
  - Ratings persist in folder state (`ratings_by_media`).
  - Metadata fields `Bitrate` and `Color` are commented out (non-destructive hide).
- Advanced filters added (chevron beside filter input):
  - Missing captions only.
  - Reviewed only.
  - Stars filter (`> N`).
  - Cumulative flag filter.
  - Invalid AR (shows only items with unsupported aspect ratios).
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
- File operation UX optimizations:
  - Reset: reselects the just-reset item after metadata refresh, no full folder reload.
  - Rename: updates state and reloads preview in place (or just refreshes list if not selected).
  - Crop: reloads preview for the current item (file mutated in place, same metadata query).
  - Deface: reloads preview for the current item (file mutated in place, same metadata query).
  - All four operations now avoid unnecessary full-directory refreshes.
- Sidebar tab defaults:
  - Config tab is now selected by default when loading set mode (Review tab still opens when clicking "Review Captions").
- Metadata/AR display:
  - Unsupported aspect ratios shown in red.
  - Supported aspect ratios shown in green, with bucket name in parenthesis if it differs from native value (e.g., "1.78 (16:9)").
- Training mode selector in app settings:
  - Two radio button options: POC (30 min), Normal (2-6h, default).
  - Mode persisted in config and available to backend Generate logic.
  - Quality mode remains supported for generate/train flows.
- Phrase auto-insert duplicate detection:
  - Phrase insertion now checks for existing exact phrase (case-insensitive word-boundary match).
  - If phrase already exists, shows status "Phrase already exists in caption." and skips insertion.
  - Visual feedback via standard status line (no disruption to caption).
- Clear All filters button:
  - Button positioned between filter text input and advanced filter toggle chevron.
  - Clears text filter, all advanced filter checkboxes, and stars/flag selections.
  - Re-renders file list immediately after clearing all filters.
- Similar captions detection in review report:
  - Uses Levenshtein distance algorithm to detect captions with 80%+ similarity.
  - Displays similar caption groups in new "Similar Captions (80%+)" panel in review report.
  - Positioned to the right of Duplicate Captions and Validation Failures on flexible 3-column grid.
  - Shows similarity percentage, file count, and sample text for each group.
  - Clickable file links in similar groups trigger focus set selection like duplicate captions.
- Filter summary row now shows folder-level rating progress (`Rated A/B`) and no longer exposes the inline `Prepare` quick link.
- Caption requirement keyword highlighting:
  - Settings button (gear icon) in Requirements tab opens modal for configuring keywords per requirement.
  - Users enter comma-separated keywords for each requirement; stored in folder_state.json.
  - When editing captions, requirements with matched keywords show green background highlight.
  - Highlight updates live as caption text changes.
  - Manual checkboxes remain fully under user control; highlighting is visual aid only.
  - Case-insensitive substring matching (e.g., "portrait" matches "Portrait photo").
- Video: Flip Horizontal action for any video file (context menu, in-place, no folder reload).
- Video: Only show 'Clip...' for videos in src_videos folder.
- Video: V2 features and polish tracked (see video_clip.md).
- Config snapshot: Only file names are printed, not full captions.
- Caption highlighting: hover requirements/phrases to highlight matching words or phrases in the editor.
