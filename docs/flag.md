# Flag Feature Documentation

## Overview
The flag feature allows users to mark files or folders with a color-coded flag (red, yellow, orange, green) for organizational or workflow purposes. Flags are persistent and saved as part of the folder state.

---

## User Requirement
- Users must be able to flag any file or folder with a color (red, yellow, orange, green) or clear the flag.
- Flags must be visible in the UI (media/folder list) as colored dots.
- Flags must persist across reloads (saved in folder state).
- The UI must allow setting/clearing flags via context menu.
- No race conditions or data loss; changes must be explicit and reversible.

---

## Code Path & Chain

### 1. State Definition
- **File:** tool/js/constants.js
- **Variable:** `flags` in global `state` object
  - `flags: {}` (key: file/folder name, value: color string)

### 2. Flag Marking Logic
- **File:** tool/js/common.js
- **Function:** `markFlag(itemKey, color)`
  - Sets or deletes a flag for a given item.
  - Calls `saveFlags()` and `refreshCurrentDirectory()`.

### 3. Flag Persistence
- **File:** tool/js/common.js
- **Function:** `saveFlags()`
  - Calls `snapshotFolderStateFromDom()` (folder_state.js)
  - Calls `writeFolderStateFile()` (folder_state.js)
- **File:** tool/js/folder_state.js
  - `snapshotFolderStateFromDom()` includes `flags` in the saved state.
  - `applyFolderStateToDom()` restores `flags` to global state.

### 4. UI Rendering
- **File:** tool/js/media.js
  - Renders colored dots for flags in folder/media list using `FLAG_COLOR_MAP`.
- **File:** tool/js/ui.js
  - Handles custom renderers (e.g., flag row in context menu).
- **File:** tool/js/main.js
  - Context menu for folders includes a "Flag" action with color choices and a clear option.
  - Calls `markFlag()` on click.

---

## Function & Variable List
- `state.flags` (object)
- `markFlag(itemKey, color)`
- `saveFlags()`
- `snapshotFolderStateFromDom()`
- `applyFolderStateToDom()`
- `writeFolderStateFile(folderPath, folderState)`
- `FLAG_COLOR_MAP` (media.js)

---

## Trace Example (Folder Context Menu)
1. User right-clicks folder → context menu opens (main.js)
2. User clicks a flag color → `markFlag(key, color)` (main.js → common.js)
3. `markFlag` updates `state.flags`, calls `saveFlags()`
4. `saveFlags` snapshots state, calls `writeFolderStateFile` (AJAX to server)
5. UI refreshes, colored dot appears (media.js)
6. On reload, `applyFolderStateToDom` restores flags

---

## Implementation Review
- **Meets requirements:**
  - All flag actions are explicit, synchronous, and reversible.
  - No race-prone code in flag logic.
  - UI feedback is immediate and deterministic.
  - Flags persist and restore correctly.
- **No issues found.**

---

## Remaining Issues
- None. Implementation matches user requirements and coding preferences.

---

## See Also
- [common.js](../tool/js/common.js)
- [main.js](../tool/js/main.js)
- [media.js](../tool/js/media.js)
- [folder_state.js](../tool/js/folder_state.js)
- [constants.js](../tool/js/constants.js)
