# Review / Output Workspace

Last reviewed against code: 2026-07-05

This document describes the shipped `Review / Output` workspace, not the broader planning notes in `docs/selection_report.md` or `docs/ui_gold_master.md`.

## Surface Layout

- The workspace lives in `tool/tool.html` under `#review-output-surface`.
- It is split into two side-by-side columns:
  - `Caption Checks`
  - `Dataset / Training`
- A compact summary strip shows:
  - current folder
  - visible media count
  - current scope (`Current folder`, `SuperSet`, or `Focus set`)

The preview iframe remains the single report/media surface. Review reports still render there.

## Frontend File Split

The current code is intentionally split by concern:

- `tool/js/review_output.js`
  - focus-set lifecycle
  - review/output summary updates
  - review availability / button visibility
  - caption review run flow
  - selection analysis run flow
  - report click handling (`postMessage` bridge)
  - training config list rendering
- `tool/js/stats.js`
  - review computation
  - phrase parsing / token analysis
  - balance phrase UI
- `tool/js/preview_pane.js`
  - review report HTML rendering
  - selection analysis HTML rendering
- `tool/js/ui.js`
  - shared shell behavior that is not specific to review/output

## Main Flow

1. User opens `Review / Output`.
2. User runs either:
   - `Selection Analysis`
   - `Review Captions`
3. `tool/js/review_output.js` gathers the visible media rows from the current filtered list.
4. `tool/js/stats.js` computes caption-review data when needed.
5. `tool/js/preview_pane.js` renders the resulting report into the preview iframe.
6. Clicking report links posts a message back to the parent app.
7. `tool/js/review_output.js` routes those events to:
   - media selection
   - token filter application
   - balance phrase filter application

## Focus Set Contract

Focus set remains a temporary browsing scope layered on top of the normal folder view.

- Report sections can activate a focus set.
- Returning from a focus set reruns the originating report type.
- Exiting a focus set returns to normal folder browsing without reopening the report.

This behavior is still frontend-only and does not depend on backend state.

## Training / Output Area

The right column is intentionally pragmatic:

- config files are discovered through `/fs/list_config`
- `Prepare Dataset` works from the current visible subset
- `Generate` creates missing dataset / training TOMLs when needed
- `Train` remains a command-preview flow

The workspace is meant to keep those related operations together rather than scattering them across the sidebar and editor.
