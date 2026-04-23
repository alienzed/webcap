# Prune Feature: Function Map

This document lists all DOM elements, JavaScript functions, and backend endpoints directly involved in the Prune feature of the webcap tool. Each step is traced from UI trigger to backend, with explicit verification of every function and variable.

---

## 1. DOM Element Trigger

- **Element:** Media list item context menu (right-click on a media file row)
- **File/Line:** tool/js/main.js (context menu handler for media items)
- **How Triggered:** User right-clicks a media file row; context menu appears with a "Prune" option.

---

## 2. Context Menu Action

- **Action:** "Prune" menu item is clicked.
- **File/Line:** tool/js/main.js (context menu action definition)
- **Function Called:** `pruneMedia(mediaItem)`
- **Parameter:** `mediaItem` (object representing the selected media file)
- **What it does:** Initiates the prune operation for the selected media file.

---

## 3. pruneMedia Function

- **Function:** `pruneMedia`
- **File/Line:** tool/js/media.js (line 1)
- **Parameters:** `mediaItem`
- **What it does:**
  - Confirms with the user.
  - Sends a POST request to `/media/prune` with `{ folder: state.folder, media: mediaItem.key }`.
  - Handles errors and updates status.
  - On success, calls `refreshCurrentDirectory()`.

### Functions/Helpers Called (in order):
1. `setStatus('No folder or media selected for prune')` — tool/js/common.js
2. `confirm(...)` — native JS
3. `setStatus('Prune cancelled')` — tool/js/common.js
4. `setStatus('Pruning media: ...')` — tool/js/common.js
5. `fetch('/media/prune', ...)` — native JS
6. `getErrorMessage(msg, resp.statusText)` — tool/js/common.js (line 53)
7. `setStatus('Prune failed: ...')` — tool/js/common.js
8. `setStatus('Media pruned: ...')` — tool/js/common.js
9. `refreshCurrentDirectory()` — tool/js/ui.js (line 233)

---

## 4. getErrorMessage Function

- **Function:** `getErrorMessage`
- **File/Line:** tool/js/common.js (line 53)
- **Parameters:** `responseText`, `fallback`
- **What it does:** Parses error response JSON, returns error message or fallback.

---

## 5. refreshCurrentDirectory Function

- **Function:** `refreshCurrentDirectory`
- **File/Line:** tool/js/ui.js (line 233)
- **Parameters:** None
- **What it does:**
  - Requests updated folder/file list from backend.
  - Updates UI and state.
  - Calls `clearEditorAndPreview()` and `renderFileList()`.

### Functions/Helpers Called (in order):
1. `clearEditorAndPreview()` — tool/js/common.js
2. `renderFileList(ui.filterEl.value)` — tool/js/media.js (line 274)

---

## 6. clearEditorAndPreview Function

- **Function:** `clearEditorAndPreview`
- **File/Line:** tool/js/common.js
- **Parameters:** None
- **What it does:** Clears the editor and preview pane in the UI.

---

## 7. renderFileList Function

- **Function:** `renderFileList`
- **File/Line:** tool/js/media.js (line 274)
- **Parameters:** None (uses global state/UI)
- **What it does:** Renders the list of media files and folders in the UI.

---

## 8. Backend Endpoint

- **Endpoint:** `/media/prune`
- **File/Line:** tool/server/app.py (line 283)
- **What it does:** Moves the media file to the `originals` folder, handling name conflicts and updating the file system.

---

## Function Existence Verification (Exhaustive)

- `pruneMedia` — Present (tool/js/media.js)
- `setStatus` — Present (tool/js/common.js)
- `getErrorMessage` — Present (tool/js/common.js)
- `refreshCurrentDirectory` — Present (tool/js/ui.js)
- `clearEditorAndPreview` — Present (tool/js/common.js)
- `renderFileList` — Present (tool/js/media.js)
- Backend `/media/prune` — Present (tool/server/app.py)
- All referenced variables (`state`, `mediaItem`, `ui`) — Present and initialized in tool/js/constants.js

---

## Relationships

- **DOM context menu** → `pruneMedia(mediaItem)` → `/media/prune` (backend) → UI refresh via `refreshCurrentDirectory()` → `clearEditorAndPreview()` and `renderFileList()`

---

## Notes
- Every function, variable, and endpoint in the call chain is present and defined in its respective file.
- For further details, see the function definitions in their respective files.
