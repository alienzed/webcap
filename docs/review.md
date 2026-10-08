# Review / Output Workspace

Last reviewed against code: 2026-08-24

This document describes the shipped `Review / Output` workspace.

## Surface Layout

- The center workspace lives under `#review-output-surface`; the right-side artifacts live under `#review-detail-surface`.
- The center workspace is a `Review Set` header plus a large read-only, spellchecked `Caption Sheet` for the current visible scope.
- The header shows the current folder and visible media count. Scope only appears when a Focus Set or SuperSet changes the normal folder scope.
- `Caption Report` owns the optional phrase, balance, and rule controls in a collapsed `Review options` disclosure. Opening that tab builds its report once; **Refresh** reruns it after option changes.

The right artifact tabs are **Media Metadata**, **Caption Report**, and **Prune Candidates**. Metadata loads for the current scope when Review opens and supports sortable columns plus optional aspect-ratio grouping. Annotation's preview iframe remains independent.

## Frontend File Split

The current code is intentionally split by concern:

- `tool/js/review_output.js`
  - focus-set lifecycle
  - review/output summary updates
  - review availability / button visibility
  - unified Review Set run flow
  - Caption Sheet rendering from the current visible media scope
  - report click handling (`postMessage` bridge)
- `tool/js/stats.js`
  - review computation
  - phrase parsing / token analysis
  - balance phrase UI
- `tool/js/preview_pane.js`
  - Review Set report HTML rendering and lazy analysis-detail loading
- `tool/js/ui.js`
  - shared shell behavior that is not specific to review/output

## Progressive Focus Review

**Focus Review** is the item-by-item bridge between Focus Caption and Set-level QA. It reuses the existing Single Item / Caption Assist presentation instead of introducing another workspace.

- Scope is captured from the current visible items when Focus Review starts.
- Only items with an existing saved caption are included.
- The saved caption is presented directly as the editable candidate; opening an item does not call the Director.
- Existing deterministic caption checks (selected annotations missing from the caption, unreviewed annotation groups) are reused immediately.
- If Caption Vision is enabled, the current item may run the existing item-scoped Vision validation and compact Vision Extras. The next item may be prefetched one deep with those same item-scoped Vision tasks.
- The Director is only invoked by an explicit corrective action such as **Fix**, **Blend**, or rewrite/regenerate.
- **Keep → Next** advances without rewriting an unchanged caption. **Save → Next** writes an edited/re-generated caption, then advances.
- Navigation refuses to discard unsaved review edits implicitly; **Skip** is the explicit discard-and-advance action.
- Review progress is browser-session workflow state only. Focus Review does not add a durable caption-reviewed flag and does not replace aggregate QA.

## Main Flow

1. User opens Review and sees the current Caption Sheet and Media Metadata.
2. User opens Caption Report when caption analysis is needed, adjusts Review options if desired, and uses **Refresh** to rerun it.
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
