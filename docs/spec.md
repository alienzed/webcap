---

## Destructive Actions: Explicit Definitions

- **Restore:**
	- Only available for files inside an `originals` folder (i.e., when the user is viewing the `originals` subfolder of a set folder).
	- When triggered, copies the selected file **and its caption** (if present) from the current `originals` folder to its parent (set) folder.
	- The operation is a one-way copy: the file and caption remain in `originals` and are added to the parent folder if and only if they do not already exist there.
	- **Never overwrites:** If the file (or caption) already exists in the parent folder, display an error and do nothing.
	- After a successful restore, the UI should notify the user and (optionally) offer to open or refresh the parent folder, but should **not** refresh or alter the current `originals` folder view or state.
	- No state in the `originals` folder is changed by Restore.

- **Reset:**
	- Only available for files in set folders with an equivalent original.
	- Overwrites the main file with the original, regardless of current content.
	- Always overwrites, but only if the original exists.

- **Prune:**
	- Removes the file from the main set.
	- File is recoverable from `originals` unless it was never backed up.
# WebCap — Spec v10

## 1. Purpose
A portable, local-first app dedicated to media caption curation and review, with explicit, minimal, and safe workflows. All features are focused on efficient, reliable caption editing and dataset review.

---

## 2. Architecture
- **Backend:** Python server for file operations, autoset, and review.
- **Frontend:** Modular JS orchestrating UI, file ops, and review/stats logic.

---

## 3. User Workflows
- Dataset navigation via backend config path.
- Per-file caption editing with autosave and media preview.
- Combined review: aggregate captions, stats, validation, and interactive report.
- Context menu: Rename (file/folder), Prune, Restore, Reset, Deface, Flag (all safe, recoverable, non-destructive; all reversibility is via the `originals` folder, no trash or state file).
- Flag (color) any file or folder for custom workflow (e.g., review, needs work, etc). Flags are visible in the UI and persist in state.
- Mark files as reviewed (double-click, green highlight, persists in state).
- Folder renaming is supported via context menu, except for protected folders (e.g., `originals`).

---

## 4. UI/UX Principles
- Minimal, explicit, and context-aware UI.
- Actions that must finish before workflow continues can be synchronous. We do not need to be clever/fancy with the UX.
- Output and errors are always visible and actionable. Do not hide errors; broken app > hidden errors

---

## 5. Feature List & Operational Checklist
- Select/edit/autosave captions, review, stats, validation, prune, rename (file/folder), restore, reset, autoset, deface, flag (color) any file or folder.
- Modular JS and backend.
- All destructive actions are recoverable via the `originals` folder (no trash or state file).
- No `.caption_trash` or `pruned.json` is used; all state is managed by presence of originals only.
- Context menu options are context-aware (e.g., protected folders like `originals` do not show Rename).
- Flags (color markers) can be set/cleared for any file or folder; visible in the media list and persisted in `.webcap_state.json`.
- Reviewed state: double-click a file to toggle reviewed status (highlighted in UI, persists in state).
- Stats and Primer fields: editable per-folder, auto-saved, used for review/validation.
- Deface: anonymize video files via context menu, with threshold prompt.
---

## 6. State File Structure (`.webcap_state.json`)

All persistent state for a folder is stored in `.webcap_state.json` in that folder. Every field in this file must be explicitly snapshotted when saving, and explicitly restored/applied when loading, in the JS code (`snapshotFolderStateFromDom` and `applyFolderStateToDom`).

**If you add new fields to the state file, you MUST update both functions to include and restore them.**

Example structure:

```
{
	"flags": {
		"originals": "red",         // folder flag
		"myvideo.mp4": "yellow"     // file flag
	},
	"reviewedKeys": ["img1.jpg", "clip2.mp4"],
	"stats": {
		"requiredPhrase": "",
		"phrases": "",
		"tokenRules": ""
	},
	"primer": {
		"template": "",
		"defaults": "",
		"mappings": ""
	}
}
```

- `flags`: object mapping file/folder names to color strings (e.g., "red", "yellow").
- `reviewedKeys`: array of file names marked as reviewed.
- `stats`/`primer`: per-folder metadata for review/validation.

---

## Rules & Guardrails
See `copilot_rules.md` for all safety, mutation, and coding rules.

---

## Originals and Config File Creation Logic (Active Features)

### Originals Folder (Media Backup)

- **Purpose:** The `originals/` folder in each set folder serves as a backup for all media files (video and image) in that set. All destructive or lossy actions (prune, reset, rename, deface, etc.) are reversible by restoring from this folder.
- **Automatic Creation:** The app automatically creates and maintains the `originals/` folder as follows:
  - On every folder load (when the folder is described or listed in the UI), the backend checks if the folder is a valid set folder (not `originals`, not `auto_dataset`, not empty of media files).
  - If at least one media file is present, the backend ensures the `originals/` folder exists and that every media file is backed up there.
  - If the folder contains no media files, no `originals/` folder is created or modified.
  - The originals backup is hash-based: files are only copied if missing or if their content has changed.
- **Protection:** The UI and backend block renaming or deleting the `originals` folder to prevent accidental data loss.
- **No Manual Management:** Users never need to manually create, move, or manage the `originals/` folder; the app guarantees its correctness and safety.

### Config File Creation

- **Purpose:** Each set folder must contain four configuration files: `configlo.toml`, `confighi.toml`, `dataset.lo.toml`, and `dataset.hi.toml`. These are required for downstream processing and are treated as first-class entries in the media list.
- **Automatic Creation:** The app ensures these config files are present as follows:
  - On every folder load (when the folder is described or listed in the UI), the backend checks if the folder is a valid set folder (not `originals`, not `auto_dataset`, not empty of media files).
  - If at least one media file is present, the backend checks for each config file and copies it from the templates directory if missing.
  - No string substitution or dynamic editing is performed; the template is copied as-is.
  - If the folder contains no media files, no config files are created or modified.
- **No Manual Management:** Users never need to manually create or edit these config files; the app guarantees their presence and correctness.

### Summary Table

| Condition on Folder Load         | Action                                                                 |
|----------------------------------|------------------------------------------------------------------------|
| Folder is `originals` or `auto_dataset` | No config or originals logic is triggered.                            |
| Folder contains no media files   | No config files or originals folder are created or modified.           |
| Folder contains media files      | Originals folder is created/updated and all media files are backed up. |
|                                  | Config files are created from templates if missing.                    |

### Recovery and Rebuild

- If the `originals/` folder or any config file is deleted or lost, simply reloading the set folder in the app will automatically recreate and repopulate them as described above, provided media files are present.
- All destructive actions are recoverable via the `originals/` folder; no trash or state file is used.
