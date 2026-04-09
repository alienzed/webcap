# WebCap — Spec v7 (Dual Module, High-Level)

## 1. Purpose
Define two modules inside one portable local app:
- Module A: Local Page Tool (current behavior)
- Module B: Caption Assistant (new mode)

This document is a planning reference only. It does not authorize behavior changes without validation.

---

## 2. Global Non-Negotiables
- No regressions in Module A.
- No database.
- No installer required.
- Portable where Python + browser work.
- Keep implementation simple and fault-averse.
- Prefer separate module files over shared conditional logic.
- Target file size ceiling: 400 lines per file.

---

## 3. Module A: Local Page Tool (Existing)
### Goal
Create and edit small local HTML pages with local media support.

### High-Level Requirements
- Create page folders from template.
- Edit raw HTML in center pane.
- Live preview HTML in right pane.
- List/filter pages in left sidebar.
- Debounced save while editing.
- Save current page before switching pages.
- Drag/drop video to copy into page-local media folder.
- Append valid video markup into editor after upload.
- Keep current route and UI behavior stable.

### Out of Scope for Module A
- Caption workflows.
- Cross-folder media browsing outside page folders.

---

## 4. Module B: Caption Assistant (New)
### Goal
Caption media in existing folders with fewer clicks than VSCode split workflow.

### High-Level Requirements
- User can open media either by choosing a folder in Chromium browsers or by opening an absolute folder path.
- Sidebar lists media files (images + videos).
- In Choose Folder flow, media can be discovered recursively in subfolders.
- `.txt` files should be hidden when practical.
- Selecting media:
  - shows media preview on right pane (`<video>` or `<img>`), and
  - loads matching caption text in center editor.
- Caption filename convention:
  - same basename as media file,
  - `.txt` extension,
  - stored in the same folder as media.
- If caption file is missing, support creating it implicitly.
- Plain text only (no rich text, no markdown, no SRT features).
- Save behavior should be immediate/debounced and reliable.
- Do not copy or move media files.
- App leaves no extra trace besides caption text edits.

### Nice-to-Have (Only if Simple)
- Easy switch to a different folder.

### Out of Scope for Module B
- Custom full file explorer equivalent to VSCode.
- Database metadata/indexing.

### Runtime Notes
- Core app remains cross-platform.
- Choose Folder flow depends on browser support for directory picker APIs (Chromium browsers).
- Open Path flow remains available as fallback.

---

## 5. Shared UI Contract
Three-pane layout remains consistent:
- Left: list/navigation/actions
- Middle: text editor
- Right: preview pane

Current app layout should be reused where possible without coupling module logic.

---

## 6. Modularity Contract
- No mixed business logic in single files via mode conditionals.
- Shared code allowed only for low-level primitives (IO helpers, status updates, simple HTTP helpers, debounce).
- Module-specific workflows remain in separate files.
- If sharing introduces risk, duplicate safely.

---

## 7. Safety and Validation Gates
Before Module B implementation:
1. Modularize Module A in small, reversible steps.
2. Validate behavior after each step using a fixed smoke checklist.
3. Proceed to Module B only after Module A passes unchanged behavior checks.

Regression policy:
- Stop immediately on unexpected behavior drift.
- Revert the last change set and redesign the step.

---

## 8. Success Criteria
- Module A remains functionally unchanged.
- Module B enables fast caption workflow:
  - pick folder,
  - pick media,
  - edit matching caption,
  - preview media continuously.
- Architecture stays maintainable and modular under file size limits.

---

## 9. Git Rollback Command (Return to Current Snapshot)
Run from repository root:

```bash
git reset --hard e78f34d4ee8709b207b0753281b4b1f1a4715e37
git clean -fd
```

Pinned commit:
- short: `e78f34d4ee87`
- full: `e78f34d4ee8709b207b0753281b4b1f1a4715e37`

Notes:
- This resets all tracked file changes to this exact commit.
- This also removes untracked files and directories.

---

## 10. Immediate Next Step (Before Any Refactor)
Create and use a fixed smoke checklist for Module A. No modularization step is allowed unless this checklist passes before and after the step.

Smoke checklist (Module A):
1. Start server and open the tool.
2. Create a test page.
3. Type HTML in editor and confirm preview updates.
4. Wait for debounce and confirm save persisted.
5. Switch pages and confirm current page saves before load.
6. Drop a supported video and confirm upload + inserted markup.
7. Open page in new tab and confirm media path works.

Execution rule:
- Refactor only one micro-step at a time.
- Re-run the full checklist after each micro-step.
- If any item fails, stop and revert the last micro-step.

---

END
