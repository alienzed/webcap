
# WebCap — Spec v8

## 1. Purpose
A portable, local-first app for media dataset curation and training, with explicit, minimal, and safe workflows. Supports two main user modes and a set of hardcoded WSL script integrations for end-to-end dataset preparation and training.

---

## 2. Architecture & Modules
- **Module A: Page Mode** — Local HTML page editing from templates.
- **Module B: Caption Mode** — Caption editing, review, stats, validation, prune, autoset, and WSL script actions.
- **Backend:** Python server for file operations, autoset, and script execution.
- **Frontend:** Modular JS orchestrating UI, file ops, and script triggers.

---

## 3. User Workflows

### 3.1 Caption Mode
- Back end config path for dataset navigation.
- Per-file caption editing with autosave and media preview.
- Combined review: aggregate captions, stats, validation, and interactive report.
- Context menu: Rename and Prune (safe, recoverable, non-destructive).
- Autoset: One-click dataset TOML generation.
- WSL Scripts: Hardcoded actions for anonymization, renaming, tensorboard, and training.

---

## 4. Config File Management
- On entering Caption Mode, ensures `configlo.toml`, `confighi.toml`, `dataset.lo.toml`, `dataset.hi.toml` exist in the working folder.
- Missing files are created from `/templates/default/` with correct dataset paths.

---

## 5. WSL Script Integration
- Only a fixed set of scripts are supported (deface/anonymize, rename anonymized, autoset, tensorboard, training).
- Each script is invoked via a dedicated UI action and backend handler.
- All arguments are constructed from app context (folder, config, etc.).
- No manual command typing; all logic is explicit in code.
- Output is always shown; UI is locked during execution.
- No arbitrary code execution.

---

## 6. UI/UX Principles
- Minimal, explicit, and context-aware UI.
- Single menu/modal for all script actions.
- Busy/locked state during mutations or script runs.
- Output and errors are always visible and actionable.

---

## 7. Feature List & Operational Checklist
- Page Mode: edit/save/preview, media upload.
- Caption Mode: select/edit/autosave, review, stats, validation, prune, rename, autoset.
- WSL Scripts: anonymize, rename, tensorboard, training.
- Config file management.
- Modular JS and backend.
- All destructive actions are recoverable (trash, backup).

---

## 8. Asynchronous Media Processing & Safety Features (v8+)

- **Async 16fps Conversion:**
	- On folder load, videos not at 16fps are converted asynchronously.
	- Originals are atomically copied to `/originals` before mutation.
	- Conversion progress is non-blocking; UI remains responsive.
	- Manual context menu action also available.

- **Async Deface Integration:**
	- Deface can be triggered per-file or per-folder (context menu).
	- Originals are always backed up before mutation.
	- If no face is detected (no visual change), the original is kept.
	- "Restore Original" context action restores the untouched file.

- **Metadata Extraction & Caching:**
	- FPS, duration, frame count, AR, etc. are extracted asynchronously (ffprobe) and cached.
	- Metadata is shown in the Review Report; never blocks UI.

- **Safe File Operations:**
	- All mutations are atomic and recoverable.
	- No destructive action occurs unless originals are safely backed up.
	- If a backup exists and matches, mutation is skipped; if not, user is prompted or operation is skipped.

- **Context Menu Actions:**
	- File/folder context menus provide: Deface, Deface… (custom args), Convert to 16fps, Restore Original.
	- No new top-level UI elements; all actions are contextual and explicit.

---

## 9. Reference: Rules & Guardrails
See `copilot_rules.md` for all safety, mutation, and coding rules.
