# WebCap — Specification

## 1. Purpose & Scope
A portable, local-first app for media caption curation and review. Focus: explicit, minimal, and safe workflows for efficient, reliable caption editing and dataset review.

---

## 2. Architecture Overview
- **Backend:** Python server for file operations, autoset, and review logic.
- **Frontend:** Modular JavaScript for UI, file operations, and review/stats.

---


## 3. Core Workflows
- Dataset navigation via backend config path.
- Per-file caption editing with autosave and media preview.
- Combined review: aggregate captions, stats, validation, and interactive report.
- Context menu for all file/folder actions (see Features section).
- Flagging and review state for workflow management.
- Folder renaming (except protected folders).

---


## 4. UI/UX Principles
- Minimal, explicit, context-aware UI.
- Synchronous/blocking actions allowed for correctness.
- Output and errors are always visible and actionable. Do not hide errors; broken app > hidden errors.


## 5. Persistent State (`.webcap_state.json`)
- Stored per-folder.
- Fields: `flags`, `reviewedKeys`, `stats`, `primer`.
- All state changes must be snapshotted/restored explicitly in JS (`snapshotFolderStateFromDom`, `applyFolderStateToDom`).
- Example structure:
	```
	{
		"flags": { "originals": "red", "myvideo.mp4": "yellow" },
		"reviewedKeys": ["img1.jpg", "clip2.mp4"],
		"stats": { ... },
		"primer": { ... }
	}
	```

---
- Deface: anonymize video files via context menu, with threshold prompt.

---

## Rules & Guardrails
See `copilot_rules.md` for all safety, mutation, and coding rules.


---

## Media Metadata Panel (New Feature)

- When a media file is selected, a small info panel appears below the preview area showing key metadata: duration, resolution, fps, codec, file size, and container format.
- Metadata is extracted using ffprobe (from ffmpeg) on the backend and returned as part of the media/caption load endpoint.
- The panel updates on media selection and is always visible when a media file is selected.
- If metadata is unavailable, fields display "N/A".

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

---

## 7. Folder Load Logic Summary

| Condition on Folder Load         | Action                                                                 |
|----------------------------------|------------------------------------------------------------------------|
| Folder is `originals` or `auto_dataset` | No config/originals logic triggered.                            |
| Folder contains no media files   | No config/originals created/modified.                                 |
| Folder contains media files      | Originals folder and config files created/updated as needed.           |

---

## 8. Recovery and Rebuild

- If the `originals/` folder or any config file is deleted or lost, simply reloading the set folder in the app will automatically recreate and repopulate them as described above, provided media files are present.
- All destructive actions are recoverable via the `originals/` folder; no trash or state file is used.
## 6. Feature Definitions

### 6.1. Originals Folder (Media Backup)
- **Purpose:** Backup for all media files in a set folder; enables safe, reversible destructive actions.
- **Automatic Creation:** On folder load, if media files exist, backend ensures `originals/` exists and all media are backed up (hash-based, only if missing/changed).
- **Protection:** Cannot rename/delete `originals` folder.
- **No Manual Management:** App guarantees correctness; user never manages this folder directly.
- **Recovery:** Reloading a set folder restores missing originals if media files are present.

### 6.2. Config File Creation
- **Purpose:** Each set folder must have `configlo.toml`, `confighi.toml`, `dataset.lo.toml`, `dataset.hi.toml` for downstream processing.
- **Automatic Creation:** On folder load, backend copies missing config files from templates if media files exist.
- **No Manual Management:** App guarantees presence/correctness; templates are copied as-is.

### 6.3. Restore
- **Trigger:** Only for files in `originals` folder (i.e., when the user is viewing the `originals` subfolder of a set folder).
- **Action:** Copies the selected file **and its caption** (if present) from the current `originals` folder to its parent (set) folder.
- **Rules:**
	- The operation is a one-way copy: the file and caption remain in `originals` and are added to the parent folder if and only if they do not already exist there.
	- **Never overwrites:** If the file (or caption) already exists in the parent folder, display an error and do nothing.
	- After a successful restore, the UI should notify the user and (optionally) offer to open or refresh the parent folder, but should **not** refresh or alter the current `originals` folder view or state.
	- No state in the `originals` folder is changed by Restore.

### 6.4. Reset
- **Trigger:** Only for files in set folders with an equivalent original.
- **Action:** Overwrites the main file with the original, regardless of current content.
- **Rules:** Always overwrites, but only if the original exists.

### 6.5. Prune
- **Action:** Removes the file from the main set.
- **Recovery:** File is recoverable from `originals` unless it was never backed up.

### 6.6. Rename (File/Folder)
- **Action:** Rename via context menu.
- **Rules:** Not available for protected folders (e.g., `originals`).

### 6.7. Deface
- **Action:** Anonymize video files via context menu, with threshold prompt.
- **Recovery:** Original is backed up in `originals`.

### 6.8. Flag (Color Marker)
- **Action:** Set/clear color flag for any file/folder.
- **Persistence:** Stored in `.webcap_state.json`, visible in UI.

### 6.9. Reviewed State
- **Action:** Double-click file to toggle reviewed status (green highlight).
- **Persistence:** Stored in `.webcap_state.json`.

### 6.10. Stats & Primer Fields
- **Action:** Editable per-folder, auto-saved, used for review/validation.

---