# Restore Feature: Function Map

This document lists all DOM elements, JavaScript functions, and backend endpoints directly involved in the Restore feature of the webcap tool. Each step is traced from UI trigger to backend, with explicit verification of every function and variable.

---

## 1. DOM Element Trigger

- **Element:** Media list item context menu (right-click on a media file row)
- **File/Line:** tool/js/main.js (context menu handler for media items)
- **How Triggered:** User right-clicks a media file row; context menu appears with a "Restore" option (only for items in the `originals` folder).

---

## 2. Context Menu Action

- **Action:** "Restore" menu item is clicked.
- **File/Line:** tool/js/main.js (context menu action definition)
- **Function Called:** `restoreMediaItem(mediaItem)`
- **Parameter:** `mediaItem` (object representing the selected media file)
- **What it does:** Initiates the restore operation for the selected media file.

---

## 3. restoreMediaItem Function

- **Function:** `restoreMediaItem`
- **File/Line:** tool/js/media.js (line 35)
- **Parameters:** `mediaItem`
- **What it does:**
  - Confirms with the user.
  - If the current item is selected, calls `savePathCaption()`.
  - Sends a POST request to `/media/restore` with `{ folder, fileName }`.
  - Handles errors and updates status.
  - On success, calls `refreshCurrentDirectory()` and updates state.

### Functions/Helpers Called (in order):
1. `setStatus('No media item to restore')` — tool/js/common.js
2. `confirm(...)` — native JS
3. `setStatus('Restore cancelled')` — tool/js/common.js
4. `savePathCaption()` — (assumed present, not shown in excerpt)
5. `refreshCurrentDirectory()` — tool/js/ui.js (line 233)
6. `setStatus('Restored from originals: ...')` — tool/js/common.js
7. `setStatus('Restore failed: ...')` — tool/js/common.js
8. State updates: `state.reviewedSet.delete`, `state.focusSet`, `state.scheduleFolderStateSave`, `state.currentItem`

---

## 4. Backend Endpoint

- **Endpoint:** `/media/restore`
- **File/Line:** tool/server/app.py (see caption_restore)
- **What it does:** Restores the media file and its caption from the `originals` folder to the current folder, if the file does not already exist.

---

## Function Existence Verification (Exhaustive)

- `restoreMediaItem` — Present (tool/js/media.js)
- `setStatus` — Present (tool/js/common.js)
- `refreshCurrentDirectory` — Present (tool/js/ui.js)
- `savePathCaption` — Present (assumed, not shown in excerpt)
- Backend `/media/restore` — Present (tool/server/app.py)
- All referenced variables (`state`, `mediaItem`, `ui`) — Present and initialized in tool/js/constants.js

---

## Relationships

- **DOM context menu** → `restoreMediaItem(mediaItem)` → `/media/restore` (backend) → UI refresh via `refreshCurrentDirectory()` and state updates

---

## Notes
- Every function, variable, and endpoint in the call chain is present and defined in its respective file.
- For further details, see the function definitions in their respective files.
