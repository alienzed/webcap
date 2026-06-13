This file tracks implemented work vs outstanding items.
Last reviewed: 2026-06-11.


## Enhancements
- Deprecate legacy autoset.py script
- Add a conservative face ROI mode for face-specific analysis only: use the existing CenterFace / `face_focus` bbox as a padded crop for face direction / expression analysis when the padded ROI is both meaningfully smaller than the full frame and still at least `192 px` on its short side; keep body/pose analysis on the full image and fall back to full-image face analysis when ROI is not clearly beneficial.
- Apply a tag to an entire set - or finally explore multi-select in the media list (probably more involved). Select All could be enough...
- n/a in a group is sort of incompatible with having other tags selected. I am not sure we'd deselect tags on n/a click, but n/a probably shouldn't be available to click on if another item is selected - let's discuss if this is worth the complexity.
- Consider making annotation an assisted Wizard like flow - provided by a modal entered into purposefully.
- Annotation throughput priorities (ranked by expected ROI):
  1. Group completion indicator in media list. (Partial: Incomplete filter is implemented; per-row indicator is pending.)
     - Value: High; gives clear annotation progress and "what is left" targeting.
     - Complexity: Medium (derived per-item status + filter hook).
     - Some media items will purposefully not meet certain groups, so we need to be careful about how loudly we visually indicate incompleteness, or provide means to strike a group for an item so that it doesn't knock it's score.
  2. Batch apply tags on multi-select.
     - Value: High in bursts, especially for contiguous scenes/outfits/locations.
     - Complexity: Medium/high (selection model + safe bulk mutate UX).
     - Note: Revisit after proving item-level annotate strip speed, since complexity is higher.
     - Questionably useful if the idea is to pretag, but is a set has captions, filtering by some tokens could be a good opportunity to batch tag. It's less clear why I would do this though since tags right now primarily serve for the caption template.
  3. Caption scaffold from annotation tags.
     - Value: Medium; helps reduce blank-page start cost during Caption step.
     - Complexity: Medium (template mapping + insertion rules).
     - Note: Useful, but less urgent than annotation velocity wins above.

## 1.1 Ideas

## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)


## Nice to Haves (Out of Scope for Now)
- Review longest duplicate phrase detection inside a single caption.
- Chaos / clutter scoring for scene complexity.
- Lighting tone / color cast detection for warm, cool, or tinted scenes.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.


## Implemented
- Preview quick actions (pre-implementation decision):
  - Images: always-visible primary actions are `Crop` and `Deface`.
  - Videos: always-visible primary actions are `Clip` and `Deface`.
  - Keep full action parity via a secondary `More/Actions` menu (do not hide capabilities relative to media-list context menu).
- Mutation indicators:
  - Media rows now show a mutation badge when media differs from baseline/original.
  - Preview overlay now shows a `Mutated` indicator for the selected media.
  - Mutation state persists in folder state (`mutated_media_keys`).
  - Supported images (`.jpg/.jpeg/.png/.webp`) are reconciled with deterministic hash checks against `originals/`.
  - Videos remain best-effort mutation tracking (action-sourced + persisted).
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
- Deface video truncation fix:
  - Stop writing deface output back to the same source path during processing.
  - Let `deface` emit its default `_anonymized` sibling output, then replace the original on success.
  - This avoids partial/shortened video outputs caused by same-path read/write during anonymization.
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
  - Mouse wheel over preview also navigates previous/next media (with cooldown).
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
  - Unreviewed only.
  - Incomplete only (requirement groups not fully satisfied; N/A counts complete).
  - Tag Mismatch only (no tags, or item tags not found in caption text).
  - Multi-select stars filter (includes `No Star`).
  - Multi-select flag filter (includes `No Flag`).
  - Invalid AR (shows only items with unsupported aspect ratios).
  - Advanced Filters info/help button.
- Filter text supports comma-separated include terms and exclude terms (prefix `-` or `!`).
- Tag/caption mismatch highlighting now uses strict token matching with allowances for plural forms and punctuation normalization.
- Balance phrases can be added from free text; catalog terms are now optional suggestions.
- Primer/caption UX updates:
  - `Reset` renamed to `Reapply` (`Undo Reapply`).
  - Floating `Apply Primer` action appears when a caption is missing and primer text is in effect.
  - While editing primer template, captionless items update live only when editor still matches primer-derived text (safe no-overwrite behavior).
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
- Prune/restore now preserves item metadata state in folder state so restored items keep their prior reviewed/rating/mutation markers.
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
- Advanced mapping/rules UX refresh:
  - Review `Rules` moved to structured row editor modal.
  - Config `Mappings` moved to structured row editor modal.
  - Legacy advanced textareas removed from active UI.
  - Folder state now stores `stats.reviewRules` and `primer.mappings` as structured arrays.
- Video: Flip Horizontal action for any video file (context menu, in-place, no folder reload).
- Video: Only show 'Clip...' for videos in src_videos folder.
- Video: V2 features and polish tracked (see video_clip.md).
- Config snapshot: Only file names are printed, not full captions.
- Caption highlighting: hover requirements/phrases to highlight matching words or phrases in the editor.
