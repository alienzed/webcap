# Background Deface Feature

## Overview
This feature allows the Deface operation (when run on a folder) to continue processing in the background if the user takes any action that clears or replaces the preview pane. This enables users to continue captioning or navigating while Deface runs, with a persistent status indicator and notification on completion.

## Requirements
- Deface streaming output is shown in the preview pane as usual when started.
- If the user takes any action that clears or replaces the preview pane (e.g., navigation, selection, editing), the Deface stream is automatically backgrounded:
  - The streaming output is hidden/minimized.
  - A persistent status indicator appears elsewhere in the UI (e.g., header or sidebar).
  - The user can continue using the app normally.
- When Deface completes (success or error):
  - A notification is shown (e.g., toast/banner).
  - The user can optionally click the indicator to review the output/log.
- Only one Deface background job is supported at a time (for simplicity).

## Implementation Details

### Files and Functions
- **common.js**
  - `clearEditorAndPreview()`: Central function called whenever the preview pane is cleared or replaced. Now calls `backgroundDefaceIfActive()` at the start.
  - `backgroundDefaceIfActive()`: New function. Detects if Deface is running in the preview pane and backgrounds it, showing a status indicator.
- **preview_pane.js**
  - `streamPreviewFromFetch()`: Streams output to the preview pane. Should set a global state flag (e.g., `state.defaceActive = true`) when Deface is running, and clear it on completion.
- **main.js**
  - Deface is triggered from the folder context menu, which calls `streamPreviewFromFetch`.
- **UI**
  - Add a status indicator element (e.g., `ui.defaceStatusEl`) to the header or sidebar.
  - Show/hide this indicator based on `state.defaceActive` and whether Deface is backgrounded.
  - Show a notification/toast when Deface completes.

### Triggers
- Any call to `clearEditorAndPreview()` (navigation, selection, etc.) triggers `backgroundDefaceIfActive()`.
- `backgroundDefaceIfActive()` checks if Deface is running and, if so, backgrounds it and updates the UI.

### Suggested Pseudocode

#### In preview_pane.js
```js
function streamPreviewFromFetch(url, body, ui, onDone, onError) {
  if (url === '/fs/deface') {
    state.defaceActive = true;
    state.defaceBackgrounded = false;
    // ...
  }
  // ...existing streaming logic...
  function finish() {
    state.defaceActive = false;
    state.defaceBackgrounded = false;
    // ...
    if (onDone) onDone();
    // Show notification if backgrounded
    if (state.defaceBackgrounded) showDefaceNotification();
  }
  // ...
}
```

#### In UI logic
- Add a persistent status indicator (e.g., spinner, progress bar) in the header/sidebar.
- When Deface completes, show a notification/toast.
- Allow clicking the indicator to swap the preview pane between the stream log (showing `state.defaceLogBuffer`) and the media preview.

## Preview Pane Behavior
The preview pane (`ui.previewEl`) is a single DOM element used for both the stream log (Deface/Autoset output) and the media/caption preview. Only one can be visible at a time. Swapping between them means overwriting the content of this element.

## Buffer and Swap Logic
To allow the user to swap between the stream log and the media preview:
- Buffer all streamed output in a variable (e.g., `state.defaceLogBuffer`) as it arrives.
- When the user backgrounds the stream (e.g., to review captions), stop updating the preview pane, but keep buffering output in the background.
- When the user wants to return to the stream log, re-render the buffered output to the preview pane and resume live updates.
- Provide a UI toggle (button or status indicator) to switch between the stream log and the media preview.

## UX Summary
- Only one thing (stream log or media preview) is visible in the preview area at a time.
- When Deface/Autoset is running, the stream log is shown in the preview area.
- If the user needs to review captions or media, the preview area swaps to show the media preview, but the stream continues in the background and its output is buffered.
- The user can switch back to the stream log at any time to see all output so far (and live updates if still running).
- A status indicator or button allows toggling between the stream log and the media preview.

This approach is intuitive, preserves all output, and allows seamless workflow switching without losing progress or information.

## Edge Cases
- If the user starts another Deface job while one is backgrounded, show a warning or prevent it.
- If the user navigates away and returns, the status indicator should persist until Deface completes.

## Summary
This approach ensures Deface can run in the background with minimal UI disruption, using a single, central trigger (`clearEditorAndPreview`) to background the job and update the UI accordingly.
