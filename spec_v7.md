# WebCap — Spec v7.2 (Current Architecture)

## 1. Purpose
Define the current portable local app architecture with two active user modes and one unified caption workflow:
- Module A: Local Page Tool
- Module B: Caption + Review (caption editing, combined review, stats, validation)

This document reflects current behavior and guardrails, including in-app prune and pre-training autoset execution.

---

## 2a. Config File Creation and Population
The application automatically ensures that required config files (`configlo.toml`, `confighi.toml`, `dataset.lo.toml`, `dataset.hi.toml`) exist in the selected working directory when entering Caption Mode. If any are missing, they are created from template files in `/templates/default/`, with dataset paths substituted as appropriate. This guarantees a valid configuration environment for all core workflows without manual file setup.

This behavior is implemented in the frontend and is required for correct operation and user experience.

## 2. Global Non-Negotiables
- No regressions in Module A.
- No database dependency.
- Portable where Python + browser work.
- Keep implementation simple and explicit.
- Prefer modular files over large mixed-condition files.
- Minimize destructive filesystem operations.

---

## 3. Active Modes
### 3.1 Page Mode (Module A)
Goal:
- Create/edit local HTML pages from template.

High-level behavior:
- Left: page list/filter/actions
- Middle: raw HTML editor
- Right: live preview
- Debounced save
- Save-before-switch behavior
- Media drop/upload support

### 3.2 Caption Mode (Module B)
Goal:
- Edit per-file captions and review full dataset quality in one workspace.

High-level behavior:
- Folder picker flow (Chromium browsers)
- Left: folder/file list + filter + review actions + stats/validation controls
- Left actions include: `Review Captions`, `Prune Selected`, `Run Autoset`
- Middle: caption editor (per-file) or combined captions (review action)
- Right: media preview (per-file) or stats/validation report (review action)

Notes:
- Standalone Stats mode is retired from normal navigation.
- URL `mode=stats` is treated as caption mode.

---

## 4. Unified Caption + Review Workflow
### 4.1 Per-file captioning
- Selecting a media file loads matching caption text (`.txt`) in center pane.
- Right pane shows media preview.
- Caption autosaves via debounce while editing.

### 4.2 Review action (implicit, same screen)
- `Review Captions` action:
  - saves current selection first,
  - builds combined captions text for all currently listed media,
  - computes stats/validation using current Stats & Validation inputs,
  - shows combined text in center,
  - shows report in right pane,
  - keeps file list active.
- Clicking a file row returns to normal per-file view (caption + media preview).

### 4.3 Report interactions
- Validation failure filename is clickable:
  - selects corresponding file in left list,
  - loads caption + media,
  - scrolls selected row into view.
- Top/Rare token entries are clickable:
  - push token into filter input,
  - trigger normal list filter flow.
- Missing-required-phrase entries are clickable:
  - selects corresponding file in left list,
  - loads caption + media,
  - scrolls selected row into view.

### 4.4 Row context menu interactions
- Right-click on a media row opens a context menu (not immediate prompt).
- Context actions:
  - `Rename`
  - `Prune`
- `Prune` moves selected media and paired caption to `.caption_trash` under current folder.

### 4.5 Pre-training autoset action
- `Run Autoset` action executes `scripts/autoset.py --master .` from repository root.
- Right pane shows textual command output (stdout/stderr combined) after run completion.
- Status row reflects running/completed/failed state.
- Backend route: `POST /caption/run_autoset`.

---

## 5. Scope of Review/Stats Computation
- Computation is based on currently open file list in caption mode (current folder context).
- Non-recursive by default (one folder at a time through navigation).

---

## 6. Safety Rules
### 6.1 No combined-caption write risk
- Combined review text is not tied to a concrete media item.
- Save path requires a selected concrete item and non-review state.

### 6.2 Rename safety backup
- Before rename mutation, original media and paired caption are copied to `.caption_trash` under current folder.
- Backup copy is overwrite-allowed (single practical undo copy behavior).
- No automatic deletion from trash.

### 6.3 Prune safety behavior
- Prune is non-destructive relative to dataset recovery expectations.
- Prune operation copies media and paired caption into `.caption_trash` with unique stamped names, then removes originals from working folder.
- No automatic deletion from `.caption_trash`.

### 6.4 Mutation boundaries
- No permanent delete workflow is introduced in UI.
- Rename and prune remain explicit via row context menu.
- Toolbar-level `Prune Selected` uses the same safe prune mechanism as context menu prune.

---

## 7. Modularity Contract
Current modular split:
- `tool/js/caption_mode.js`: caption mode orchestration and core selection/save flow
- `tool/js/caption_review.js`: review/stats bridge and report interaction handlers
- `tool/js/caption_list.js`: file list rendering, row context menu, rename + safe prune operations
- `tool/js/caption_ops.js`: caption read/save helpers
- `tool/js/stats_engine.js`: pure stats/validation computation
- `tool/js/stats_view.js`: stats controls/report rendering helpers
- `tool/server/app.py`: HTTP routes including autoset execution endpoint

Rules:
- Keep business concerns isolated by module.
- Reuse shared helpers where behavior is identical.
- Avoid new cross-module coupling unless needed for UX continuity.

---

## 8. Validation Inputs and Outputs
Inputs:
- Required key phrase
- Balance phrases (one per line)
- Token rules (`token => phrase`)

Outputs:
- Coverage summary
- Missing required phrase list
- Balance counts + percentages
- Validation mismatch list
- Top tokens / rare tokens

Token filtering note:
- Built-in blacklist removes common non-informative tokens/pronouns from token stats.

---

## 9. Success Criteria
- Page mode behavior remains stable.
- Captioning and review happen in one coherent workflow.
- Clicking report failures accelerates correction loop.
- Combined review remains non-destructive.
- Rename retains practical recoverability through `.caption_trash`.
- Prune is available in-app and preserves recoverability through `.caption_trash`.
- Autoset can be triggered in-app and returns actionable output in right pane.
- Codebase remains modular and maintainable.

---

## 10. Operational Smoke Checklist
1. Open Page mode, edit/save/preview page as normal.
2. Open Caption mode, choose folder, select file, edit caption, autosave.
3. Trigger Review Captions and verify combined text + report generation.
4. Click validation failure and verify file selection + media load + row scroll.
5. Click token and verify filter is applied.
6. Click missing-required item and verify file selection + media load + row scroll.
7. Right-click media row and verify context menu shows `Rename` + `Prune`.
8. Rename file and verify `.caption_trash` receives original media (+ caption if present).
9. Prune selected/context-row item and verify source files leave working folder and appear in `.caption_trash`.
10. Run Autoset and verify right pane shows command output and status updates.
11. Confirm combined review text cannot be saved into a single caption file.

---

END
