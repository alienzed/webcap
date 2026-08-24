# Review / Output Workspace

Last reviewed against code: 2026-08-24

This document describes the shipped `Review / Output` workspace.

## Surface Layout

- The center workspace lives under `#review-output-surface`; the right-side artifacts live under `#review-detail-surface`.
- `Caption Checks` holds the phrase and rule controls, and **Run Caption Review** is the explicit report action.
- `Caption Sheet` is always visible below the setup. It reflects the current visible scope in one read-only, spellchecked text area for proofreading and copying.
- A compact summary strip shows:
  - current folder
  - visible media count
  - current scope (`Current folder`, `SuperSet`, or `Focus set`)

The right artifact tabs are **Media Metadata**, **Caption Report**, and **Prune Candidates**. Metadata loads for the current scope when Review opens. Caption Report stays empty until explicitly run. Annotation's preview iframe remains independent.

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

1. User opens Review and sees the current Caption Sheet and Media Metadata.
2. User adjusts caption checks when needed and runs **Run Caption Review**.
3. `tool/js/review_output.js` gathers the visible media rows from the current filtered list.
4. `tool/js/stats.js` computes caption QA data.
5. `tool/js/preview_pane.js` renders caption issues in the dedicated right-side report iframe and loads optional **Curation Signals** only when opened.
6. Clicking report links posts a message back to the parent app.
7. `tool/js/review_output.js` routes those events to:
   - media selection
   - token filter application
   - balance phrase filter application

`Caption Sheet` gathers the same visible-media scope without introducing a second caption format or a bulk-save path.

## Focus Set Contract

Focus set remains a temporary browsing scope layered on top of the normal folder view.

- Report sections can activate a focus set.
- Returning from a focus set reruns Review Set.
- Exiting a focus set returns to normal folder browsing without reopening the report.

This behavior is still frontend-only and does not depend on backend state.

## Training Boundary

Training has its own workspace. Review Set remains focused on caption and dataset inspection; it does not host training controls or output.
