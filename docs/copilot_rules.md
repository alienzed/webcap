
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

## 3. Solution Design Strategy
- **Default to wiring existing UI elements first.** Before suggesting backend work, WebCodecs APIs, or new infrastructure, check if UI controls already exist. Connect them with minimal event handlers or state updates.
- **Prefer reversible, one-file changes over architectural proposals.** Single-function additions and event listener wiring are preferred to multi-layer refactoring.
- **Ask "what's already wired?" not "what should we build?"** The simplest fix is usually connecting pieces that already exist.

---

## 4. UX Principles
- Minimal, context-aware UI; avoid clutter.
- All output and errors are visible and actionable.
- Busy/locked state is clearly indicated during mutations or script runs.
- No manual command typing for script actions; all arguments are inferred from context.

---

## 5. Non-Negotiables
- No regressions.
- App must remain portable (Python + browser only).
- Maintainability and clarity are prioritized over scalability or flexibility.

---

## 6. Error Handling
- All errors must be visible in the browser console.
- **Critical errors** (invariant violations, impossible states, or integrity threats) must break execution—never caught or logged.
- Non-critical errors may be logged for debugging, but never swallowed or ignored.
- Nothing intentionally coded is optional. No optional dependency guards (`if (typeof fn === 'function')`), no feature flags, no silent skips. If something is coded, it is required and must fail loudly if missing.

---

## 7. Analyzer Coherence
- New image-analysis features should live in their own backend helper file.
- Each analyzer should write one normalized nested block into `media_metadata.json`.
- Analyzer outputs should use app-defined field names, not raw library/model output shapes.
- Each analyzer should include its own `version` field for cache invalidation.
- UI code should read normalized metadata only and must not depend on library-specific fields.
- Prefer reusing an existing packaged dependency before adding a new model or runtime.
- Any new analysis dependency must justify its footprint in offline use, CPU/VRAM cost, and workflow value.
- Experimental analysis features must remain independent from caption editing, training config generation, and destructive actions.
