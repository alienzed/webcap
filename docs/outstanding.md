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
  - Three radio button options: POC (30 min), Normal (2-6h, default), Quality (6-12h+).
  - Mode persisted in config and available to backend Generate logic.
  - Next: implement backend generation logic per mode with mode-specific resolutions and sample counts.
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
- Caption requirement keyword highlighting:
  - Settings button (⚙) in Requirements tab opens modal for configuring keywords per requirement.
  - Users enter comma-separated keywords for each requirement; stored in folder_state.json.
  - When editing captions, requirements with matched keywords show green background highlight.
  - Highlight updates live as caption text changes.
  - Manual checkboxes remain fully under user control; highlighting is visual aid only.
  - Case-insensitive substring matching (e.g., "portrait" matches "Portrait photo").

## 1.0 Candidate
- No active blockers tracked for 1.0.
- Train action remains command-preview only by design.
- Legacy autoset remains available by design.

## Enhancements
- Review duplicate-token detection inside a single caption.
- Validate training command preview behavior when config keys are missing (should still provide useful output where possible).
- Maintain flags and metadata when Pruning/restoring/renaming.
- The Phrases Copy button should be a clipboard, not the word COPY

## 1.1 Ideas
- Caption highlighting: hover requirements/phrases to highlight matching words or phrases in the editor.
- We have caption requirements. We need a concept of Set Requirements, ideally self counting. For example, a good character LORA includes:
    6 front face close-ups
    6 three-quarter face close-ups
    3 side/profile shots
    6 head-and-shoulders
    5 half-body
    3 full-body
    3 expressive/candid shots
  It would be awesome to get a bird's eye view of where my set is relative this.
- Saveable/restorable 'sets. We write comments to config files now but recovering that state could be extremely time consuming in larger sets, I figure we can do better than that and actually save sets/training configs as little packages and reload them into the UI (even going so far as unpruning files, resetting captions (whoa there! hehe),etc...)

## Stabilization Mode
- App is in 1.0 lock-in mode: resist new feature work and prioritize targeted bug/regression fixes.

## Backlog (Do Not Implement Yet)
- Persist last selected working directory between refresh/restart (optional toggle in settings; safe fallback when missing).
- Create new sibling set folder from filtered/selected/rated items (including originals + folder metadata copy semantics).
- Optional phrase-tab auto-population from local `.txt` files (e.g., `expressions.txt`, `places.txt`, `lighting.txt`).
- Dataset inferred sample/megaframe/VRAM/time estimation.

## Nice to Haves (Out of Scope for Now)
- Video crop/clip workflow, likely via a modal backed by a mature lightweight library/tool rather than custom in-app editing.
- In-app training execution/orchestration for long-running jobs.
- TensorBoard lifecycle helpers.
- Broader multi-hour process orchestration in app.
- Set-wide search/replace for captions in the current folder only, with preview/confirmation before writing.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.
- Remove legacy/disabled UX paths that are now superseded by visibility gating.
- Audit remaining folder-load side effects and trim non-essential mutation paths.
- Reassess optional tag UX if it continues to add more cognitive load than value.
