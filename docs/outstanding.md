This file tracks implemented work vs outstanding items.
Last reviewed: 2026-06-19.

## Paint Points

- Caption Template probably needs a 'i'

## Bugs
- 2026-07-02 triage pass
  - Quick wins / small-to-medium fixes:
    - Workbench layout regression: after collapsing the sidebar, entering Grid, then returning to item view, annotation groups can come back in the wrong horizontal/multi-column layout.
    - Group header highlight no longer clearly distinguishes `reviewed` from `caption-matched`; non-reviewed groups can read as green.
    - Auto-reviewed media-row state still feels spotty after N/A removal; verify checklist completion still drives `.media-item.reviewed`.

## Enhancements
- 2026-07-02 triage pass
  - Needs deeper discussion or inspection:
    - Strict saved-caption term reordering when group term order changes, only when exact term/affix matching succeeds.
    - Preview header polish pass: rethink information grouping and action layout instead of incremental patching.
    - Console behavior pass: define when the console is shown, hidden, or relocated across default, Grid, Focus, and config/editor surfaces.


## 1.1 Ideas


## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Avoid treating the current focused-annotation wizard as the primary home for blind "apply to all" tagging; at most, a sticky/stamping mode would be a temporary bridge, not the final UX.


## Nice to Haves (Out of Scope for Now)
- Review longest duplicate phrase detection inside a single caption.
- Chaos / clutter scoring for scene complexity.
- Lighting tone / color cast detection for warm, cool, or tinted scenes.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.


## Validate
- 2026-07-02 triage pass
  - Confirm whether the sidebar-collapse/Grid/item regression is a pure layout restore bug or an intentional multi-column threshold firing at the wrong time.
  - Confirm whether reviewed-row drift is caused by sync timing, invalidation logic, or stale render assumptions after N/A removal.
  - Recommended next implementation slice:
    - Check whether the remaining sidebar-collapse/Grid/item regression is CSS restore only or tied to workbench column-threshold recalculation.
    - Re-check auto-reviewed row sync after the N/A removal cleanup.
- In a group, I can't remove a pinned item. Can't a removal last for the session at least? or even just while inside this folder?
- Console floats over focus annotation modal (maybe minimize it, or fix z-index?)
- filling in the primer, this should be generatable

## Implemented
- Grid / batch curation updates:
  - Media Grid now supports right-click parity with media-list actions.
  - Grid supports batch tag application on multi-select.
  - Tag copy/paste works inside Grid.
  - Grid supports fullscreen item viewer with double-click open/close.
  - Grid tile thumbnails now favor full-item framing (`contain`) over square cover crops.
  - Grid sidebar tag groups support term editing entry points.
  - Grid tag chips now show subtle set-wide usage intensity rather than reading as a flat wall of identical pills.
  - Grid filter/header pass was simplified toward prune/tag/compare use instead of trying to mirror the full media list.
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
  - Legacy one-shot dataset route, context action, and script were retired in favor of explicit Prepare/Generate flow.
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
- Focused annotation workflow updates:
  - Traversal mode toggle is implemented (`Group-first` / `Item-first`).
  - Keyboard navigation is implemented (`Up`/`Down` items, `Left`/`Right` groups, `Enter` done, `N` for N/A, `S` skip).
- Quick-win cleanup follow-up:
  - Removed the stale Focus Set Grid action from the focus-set banner.
  - Preserved group-workbench scroll position across tag-triggered rerenders.
  - Deduplicated preview wheel navigation wiring so one gesture maps to one navigation step.
  - Simplified preview click reselection to restore list focus without re-clicking the active row.
- Annotation progress / primer updates:
  - Group completion indicator in the media list is implemented.
  - Primer-mode caption updates are no longer tracked as an outstanding validation issue.
