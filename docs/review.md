# Review / Output Workspace

Last reviewed against code: 2026-07-13

This document describes the shipped `Review / Output` workspace.

## Surface Layout

- The workspace lives in `tool/tool.html` under `#review-output-surface`.
- `Caption Checks` holds the phrase and rule controls.
- `Caption Sheet` opens the current visible captions in one read-only, spellchecked text area for proofreading and copying.
- A compact summary strip shows:
  - current folder
  - visible media count
  - current scope (`Current folder`, `SuperSet`, or `Focus set`)

The preview iframe remains the single report/media surface. `Review Set` renders one focused report there.

## Frontend File Split

The current code is intentionally split by concern:

- `tool/js/review_output.js`
  - focus-set lifecycle
  - review/output summary updates
  - review availability / button visibility
  - unified Review Set run flow
  - Caption Sheet rendering from the current visible media scope
  - report click handling (`postMessage` bridge)
  - training config list rendering
- `tool/js/stats.js`
  - review computation
  - phrase parsing / token analysis
  - balance phrase UI
- `tool/js/preview_pane.js`
  - Review Set report HTML rendering and lazy analysis-detail loading
- `tool/js/ui.js`
  - shared shell behavior that is not specific to review/output

## Main Flow

1. User opens `Review / Output`.
2. User runs `Review Set`.
3. `tool/js/review_output.js` gathers the visible media rows from the current filtered list.
4. `tool/js/stats.js` computes caption QA data.
5. `tool/js/preview_pane.js` renders caption issues first and loads the optional Analysis details only when opened.
6. Clicking report links posts a message back to the parent app.
7. `tool/js/review_output.js` routes those events to:
   - media selection
   - token filter application
   - balance phrase filter application

`Caption Sheet` is a separate review action. It gathers the same visible-media scope without introducing a second caption format or a bulk-save path.

## Focus Set Contract

Focus set remains a temporary browsing scope layered on top of the normal folder view.

- Report sections can activate a focus set.
- Returning from a focus set reruns Review Set.
- Exiting a focus set returns to normal folder browsing without reopening the report.

This behavior is still frontend-only and does not depend on backend state.

## Training Boundary

Training has its own workspace. Review Set remains focused on caption and dataset inspection; it does not host training controls or output.
