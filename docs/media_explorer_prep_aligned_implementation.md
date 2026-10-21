# Media Explorer — Prep-aligned browsing implementation (2026-10-20)

## Grounding
- `tool/js/media_explorer.js` and `tool/css/media_explorer.css` already own Explorer sources, gallery, Loupe, Compare, selection and an independent inspector.
- `tool/server/external_media.py` already owns read-only recursive discovery, source-local technical metadata, paging, and the active-root snapshot.
- `tool/js/media.js` / `media_grid_*.js` and Prep's `tool/tool.html` own Set editing state. **Do not modify or mount them**.
- Root `AGENTS.md`: keep ownership separate, no new framework/persistence gates, preserve keyed interactive DOM and global Console errors, readable 16px controls.

## Safe sequence
1. **Folder/sorting data contract.** Retain the recursive discovery index but expose a current-directory view and immediate children; default UI to nonrecursive. Filter/sort before paging, support reverse order and file-size/random sort. Preserve technical metadata writer, old generated-media routes and existing internal recursive queries. Test root, nesting, recursion, ordering, and path validation.
2. **Prep-familiar workspace.** Keep source rail; mount resizable 260px media list beside an unconstrained preview/grid and docked inspector. Move existing filters above the media list, retain existing Gallery/Loupe/Compare and workflow provenance. List selects in-page preview; Grid uses existing Explorer cards. Keep the same source modes and no duplicate Prep DOM/state. Test selection, switching and responsive behavior.
3. **Long collection browsing.** Replace visible Load More action with scroll-triggered incremental loading over authoritative globally sorted results. Preserve keyed thumbnails, playback, selection, active item and scroll on soft discovery refresh. Display true counts, current folder path and metadata progress, including during incomplete discovery.
4. **Source-preserving exports.** Add Explorer-owned Copy to Set / Clip to Set for external files: destination under configured FS_ROOT, select existing Set or create a child Set, never alter source, refuse silent overwrite, show explicit destination and completion/error. Use installed ffmpeg for clips; do not invoke Prep's editing state or mutate an external file. Add focused tests for destination containment, basename collision, and read-only source.
5. **Verification.** Run `tests/test_external_media.py`, `tests/media_explorer.test.js`, targeted UI and API tests. Check List/Grid/Single/Compare/inspector, large monitor and narrower viewport, ongoing discovery, and existing source routes. No changes to Prep files.

## Boundaries
- Files allowed: `tool/server/external_media.py`, `tool/js/media_explorer.js`, `tool/css/media_explorer.css`, Explorer markup in `tool/tool.html`, Explorer-specific tests, this document.
- Keep source rail; no dashboard chrome or new persistent media index.
- Default external browsing is the current folder, recursive only on user request; operations follow explicitly displayed scope.
- The media list is resizable; the centre gets remaining monitor width. Maintain existing Explorer Grid, Loupe, Compare, and generated-source navigation.
