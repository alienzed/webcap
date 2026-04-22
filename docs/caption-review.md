# PROMPT FOR AGENT (place at top of request):

"Trace the complete call chain for the Review Report feature, starting from all UI entry points down to every helper function (including all parsing, computation, and DOM helpers) that is directly or indirectly called. For each function in the chain, verify and report its existence in the codebase. If any function is missing, renamed, or not defined, explicitly flag it. List all function names, their file locations, and their relationships. Do not omit any helper or utility function that is called, even if it seems trivial."

# Review Report Feature: Function Map

This document lists all JavaScript functions directly involved in the Review Report feature of the webcap tool. These functions are responsible for wiring up the UI, running the review process, computing report data, and rendering the review report preview.

---

## In tool/js/caption_ui.js

### wireReviewActions()

### runReview()


## Function Existence Verification (Exhaustive)

Below is the complete call chain for the Review Report feature, with explicit verification of each function's existence in the codebase. Any missing, renamed, or undefined function is flagged.

---

### UI Entry Points (tool/js/caption_ui.js)

- **wireReviewActions** — Present
- **runReview** — Present

### Core Logic (tool/js/stats.js)

- **compute** — Present
- **renderReportPreview** — Present
- **buildCombinedCaptionsText** — Present
- **getOptionsFromDom** — Present
- **parsePhrases** — Present
- **parseTokenRules** — Present
- **computeLengthInsights** — Present
- **computeDuplicateInsights** — Present

### Utility/Helpers (tool/js/common.js)

- **tokenize** — Present
- **normalize** — Present
- **escapeHtml** — Present

### Referenced Constants (tool/js/constants.js)

- **TOKEN_BLACKLIST** — Present

### Referenced Functions (tool/js/stats.js)

- **normalizedCaptionKey** — **MISSING** (referenced in stats.js, but definition is deleted)

---

#### Relationships

- `wireReviewActions` wires up UI events to call `runReview`.

---

#### Missing or Broken Functions


All other functions in the call chain are present and defined in their respective files.
### compute(items, options)
- Core logic for analyzing caption data and generating the review report object.
- Handles required phrase checks, phrase counts, rule failures, and more.

### renderReportPreview(report)
- Renders the review report in the UI, including tables and lists for validation failures, required phrase misses, token stats, and outliers.

---

## Relationships
- `wireReviewActions()` (caption_ui.js) wires up UI events to call `runReview()`.
- `runReview()` (caption_ui.js) collects data and calls `compute()` (stats.js) and `renderReportPreview()` (stats.js).
- `renderReportPreview()` (stats.js) displays the computed report in the preview pane.

---

## Notes
- These functions are the main entry points and processing steps for the Review Report feature. Helper functions (e.g., for DOM updates or utility parsing) are not listed unless they are directly part of the review workflow.
- For further details, see the function definitions in their respective files.
