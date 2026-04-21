# WebCap — Rules & Guardrails

This document defines all safety, mutation, and coding rules for the WebCap project. It is referenced by the main spec and must be followed for all development and maintenance.

---

## 1. Safety & Mutation Rules
- No destructive filesystem operations without explicit user action and recoverability.
- All destructive actions (rename, prune, reset) must ensure a copy exists in the `originals` folder before removal or overwrite. Reversibility is guaranteed by the presence of the original in `originals`.
- No permanent delete workflow in the UI.
- Combined review text is never written to disk as a media caption.
- All mutations are explicit and require user confirmation or context menu action.
- UI does not require everything to be async, but safety does matter.

---

## 2. Coding & Architectural Guidelines
- No database dependency; all state is file-based.
- Keep implementation simple, explicit, and minimal.
- Use plain global variables and functions for all state and logic. Do not use IIFE, encapsulation, or modular patterns. If a global name collision occurs, it should throw an error and be fixed explicitly. This is intentional for maximal debuggability and clarity.
- Prefer modular files over large, mixed-condition files.
- Reuse shared helpers where behavior is identical.
- Avoid new cross-module coupling unless needed for UX continuity.
- No arbitrary code execution; only hardcoded scripts and backend routes are allowed.
- All arguments to scripts and mutations are constructed explicitly in code.

---

## 3. UX Principles
- Minimal, context-aware UI; avoid clutter and unnecessary buttons.
- All output and errors are visible and actionable.
- Busy/locked state is clearly indicated during mutations or script runs.
- No manual command typing for script actions; all arguments are inferred from context.

---

## 4. Non-Negotiables
- No regressions.
- App must remain portable (Python + browser only).
- Minimize destructive filesystem operations.
- Maintainability and clarity are prioritized over scalability or flexibility.
