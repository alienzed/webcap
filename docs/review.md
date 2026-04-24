# Review Feature: Technical Architecture and Flow

This document provides a comprehensive, rewrite-ready breakdown of the Review feature in webcap. It covers UI entry points, function call chains, data flow, event handling, and all relevant functions.

---

## High-Level Flow

1. **User Action**: User clicks "Review Captions" or "Stats Run" button.
2. **UI Handler**: `runReview()` (ui.js) collects all media items and captions, gathers review options from the DOM.
3. **Computation**: Calls `compute()` (stats.js) to analyze captions for required phrases, phrase counts, rule failures, tokens, lengths, and duplicates.
4. **Report Rendering**: Passes the computed report to `renderReportPreview()` (stats.js), which generates an interactive HTML report in the preview pane.
5. **Cross-Frame Event**: Clicking a report link sends a `postMessage` to the parent window.
6. **Selection Handling**: The main UI listens for this message and calls `selectByFileName()` or `applyTokenFilter()`, updating selection, focus set, and preview/editor.

---

## UI Entry Points and User Actions

- **Buttons**:
  - "Review Captions" (`review-captions-btn`)
  - "Stats Run" (`stats-run-btn`)
- **Event Wiring**:
  - Both buttons are wired to call `runReview()`.
- **User Actions**:
  - Clicking either button triggers review computation and report rendering.
  - Clicking a file/token link in the report triggers a postMessage event to the parent UI.

---

## Function Call Chains

- **runReview()** (ui.js)
  - Collects media items and captions into a results array.
  - Gets review options from the DOM (`getOptionsFromDom()`).
  - Calls `compute(results, options)` (stats.js).
- **compute()** (stats.js)
  - Analyzes captions for required phrases, phrase counts, rule failures, tokens, lengths, duplicates.
  - Returns a report object.
- **renderReportPreview(report)** (stats.js)
  - Renders the report as HTML in the preview pane.
  - Adds interactive buttons for each file/token issue, wired to postMessage events.

---

## postMessage Bridge and Selection Logic

- **Report HTML (renderReportPreview in stats.js):**
  - Each file/token button sends a `postMessage` to the parent window:
    - File links: `{ type: "caption-review-select", fileName, focusFiles, focusSource }`
    - Token links: `{ type: "caption-review-token", token }`
- **Main UI Listener (ui.js):**
  - Registers `addEventListener('message', ...)`.
  - On message:
    - If `type === 'caption-review-select'`, calls `selectByFileName()`
    - If `type === 'caption-review-token'`, calls `applyTokenFilter()`
- **Selection Handling:**
  - `selectByFileName`: Activates focus set, selects media, updates preview/editor.
  - `applyTokenFilter`: Sets filter input, triggers file list re-render.

---

## Data Flow and State Transitions

- **Initial State**:
  - `state.items`: Array of media items with `fileName`, `caption`, etc.
  - `ui.editorEl`, `ui.previewEl`, `ui.filterEl`: Main UI elements.
- **Review Trigger**:
  - User clicks a review button; `runReview()` collects items and options.
- **Computation**:
  - `compute()` analyzes and returns a report object.
- **Report Rendering**:
  - `renderReportPreview()` writes HTML into the preview pane.
- **User Interaction with Report**:
  - Clicking a file/token link sends a postMessage to the parent.
- **Selection Handling**:
  - Focus set and selection are updated; preview/editor reflect the selection.

---

## Relevant Functions and Their Roles

**UI Layer (ui.js):**
- `runReview()`: Main entry point for review computation and report rendering.
- `selectByFileName(fileName, focusFiles, focusSource)`: Handles selection from report links.
- `applyTokenFilter(token)`: Applies a filter to the file list.
- `activateFocusSet(fileNames, source)`: Activates a focus set for highlighting/filtering.
- `clearFocusSet()`: Clears the current focus set.
- `renderFileList(filter)`: Renders the list of media items.
- `refreshCurrentDirectory()`: Reloads the current folder and media items.

**Stats/Computation Layer (stats.js):**
- `compute(items, options)`: Core computation for review analysis.
- `renderReportPreview(report)`: Renders the interactive HTML report.
- `parseTokenRules(multiline)`, `normalize(text)`, `tokenize(text)`, etc.: Helpers.

**Media/Preview Layer (media.js):**
- `selectPathMedia(mediaItem)`: Loads and previews a media item.
- `renderPathPreview(folder, mediaName)`: Renders the media preview.

**Common/Utility (common.js):**
- `setStatus(text)`: Updates the UI status bar.
- `getFileExtension(name)`, `getErrorMessage(responseText, fallback)`: Utility helpers.

**Event Bridge:**
- `addEventListener('message', ...)` (ui.js): Receives postMessage events and routes them to selection/filter handlers.

---

## Notes for Rewriting

- All state is managed via plain global variables (`state`, `ui`).
- All DOM updates are explicit and synchronous.
- The preview pane is a single iframe reused for both report and media preview.
- The Review feature is fully decoupled from the backend; it operates on the current in-memory state.
- All cross-frame communication uses postMessage with explicit message types.

---

This document is sufficient to fully rewrite the Review feature, including all UI, computation, and event handling logic.
