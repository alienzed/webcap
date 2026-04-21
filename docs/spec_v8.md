
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
