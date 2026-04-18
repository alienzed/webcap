
# WebCap — Spec v9

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
- Context menu: Rename (file/folder), Prune, Restore, Reset (all safe, recoverable, non-destructive; all reversibility is via the `originals` folder, no trash or state file).
- Folder renaming is supported via context menu, except for protected folders (e.g., `originals`).

---

## 4. UI/UX Principles
- Minimal, explicit, and context-aware UI.
- Actions that must finish before workflow continues can be synchronous. We do not need to be clever/fancy with the UX.
- Output and errors are always visible and actionable. Do not hide errors; broken app > hidden errors

---

## 5. Feature List & Operational Checklist
- Select/edit/autosave captions, review, stats, validation, prune, rename (file/folder), restore, reset, autoset.
- Modular JS and backend.
- All destructive actions are recoverable via the `originals` folder (no trash or state file).
- No `.caption_trash` or `pruned.json` is used; all state is managed by presence of originals only.
- Context menu options are context-aware (e.g., protected folders like `originals` do not show Rename).

---

## Rules & Guardrails
See `copilot_rules.md` for all safety, mutation, and coding rules.
