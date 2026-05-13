
# WebCap — Rules & Guardrails (Condensed)

---

## 1. Safety & Mutation
- All destructive actions (rename, prune, reset) must be explicitly triggered and fully reversible (originals always preserved).
- No destructive operation is allowed without user intent and recoverability.
- All mutations are explicit and require user confirmation or context menu action.

---

## 2. Coding & Architecture
- State is file-based; no database.
- Use plain global variables and functions—no modules, encapsulation, or async unless necessary for safety.
- Keep code simple, explicit, and minimal. Prefer modular files, but avoid unnecessary coupling.
- No arbitrary code execution; only hardcoded scripts and backend routes.
- All arguments to scripts/mutations are constructed explicitly in code.

---

## 3. UX Principles
- Minimal, context-aware UI; avoid clutter.
- All output and errors are visible and actionable.
- Busy/locked state is clearly indicated during mutations or script runs.
- No manual command typing for script actions; all arguments are inferred from context.

---

## 4. Non-Negotiables
- No regressions.
- App must remain portable (Python + browser only).
- Maintainability and clarity are prioritized over scalability or flexibility.

---

## 5. Error Handling
- All errors must be visible in the browser console.
- **Critical errors** (invariant violations, impossible states, or integrity threats) must break execution—never caught or logged.
- Non-critical errors may be logged for debugging, but never swallowed or ignored.
- Nothing intentionally coded is optional. No optional dependency guards (`if (typeof fn === 'function')`), no feature flags, no silent skips. If something is coded, it is required and must fail loudly if missing.
