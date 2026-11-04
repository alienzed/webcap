# Studio Director: production capability and information architecture audit

Date: 2026-11-03. Implemented in PR #859. Grounded in `AGENTS.md`, `tool/js/storyboard.js`, `tool/js/studio_director_workbench.js`, `tool/js/director_chat.js` and `tool/tool.html`.

## Core IA principle

Simplify **discovery and implementation**, not Director's useful capabilities. Studio Director is both a creative collaborator and a production assistant. An author-reviewed field edit and a long-running production pass are deliberately different: neither must pretend to be the other.

### Current user-facing IA

| Entry | Purpose | Scope and commit behavior |
| --- | --- | --- |
| **Read…** | Explicitly provide Project Overview and independently chosen complete Scenes | Nothing sent until Send; exact model receipt |
| **Write…** | Create Project, Revise Project or Write Scenes (add or revise one/many) | Editable review followed by Apply; field-scoped saves |
| **Revise & Generate…** | Run an instruction/preset across **all Scenes in the open Project**, optionally generate fresh Takes | Starts existing `revise_scenes_sequence` job; may save revisions as it runs; existing Takes retained |
| **Check Project coherence** | Optional specialist comparison of saved H3 Prompts | Separate reviewed prompt corrections; may also be invoked from the production preset |
| **Chat** | Short creative discussion and contextual recommendations | No implicit Reads or writes; saved history |

**Implemented this turn:** moved the existing `storyboard-director-tools-btn` directly into the Director actions row, below Read and Write. Kept the existing modal, model selector, custom/continuity/coherence presets, prompt history, job scheduling, progress, stops and optional Take generation. Renamed its presentation to **Revise & Generate** and made it disclose its exact Project scope and auto-saving production semantics. No new LLM operation, parsing schema, job processor or save endpoint was introduced.

## Codebase audit

- `storyboard.js:reviseScenes(instruction, modelId, generateFreshTakes, continuityContext)` runs the already-supported `revise_scenes_sequence` job against the current open Project and its full Scene order. Optional `generateFreshTakes` is passed unchanged. Revisions can be partially saved if a later Scene fails.
- `studio_director_workbench.js:prepareBatchScenes/applyBatchScenes` is an **editable/atomic reviewed** revision for selected existing Scenes and selected creative fields, distinct from the long-running production pass.
- `storyboard.js:runDirectorToolsCoherence` and `studio_director_workbench.js:prepareProjectCoherence` are two paths for coherence. Both are useful but differ in results/review. Do not consolidate without an explicit parity test.
- The old modal uses `storyState.story` (the open Project), **not** the Project selected in the Write panel. The new target label makes this distinction visible. Do not silently make a different selected Project the target.
- The legacy modal's Director model selector uses Storyboard state. The conversation model and production model may be chosen separately; the UI must show the actual production model.
- The older production path can queue fresh Takes and is not a reviewed-Apply flow. This is a legitimate, explicit capability difference rather than an architectural aberration.

## UX risks and next polish pass (in priority order)

1. **Outcome clarity:** keep a clear distinction between editable Write review and direct production execution. Never label the latter as reviewed Apply.
2. **Target clarity:** show open Project and the all-Scenes scope near the Run action; if the Write selector points elsewhere, don't imply that it controls the production action.
3. **Model clarity:** make the actual production-model selection understandable alongside the separate chat model. Audit readiness/disabled states on Studio entry.
4. **Coherence duplication:** evaluate whether the two coherence affordances can share one review presentation and still preserve deliberate execution modes. Do not delete one merely to reduce menu counts.
5. **Navigation hierarchy:** Read, Write, Revise & Generate are primary verbs; detailed presets, Take generation and technical settings belong within their respective flows. Avoid moving high-value commands back into an anonymous overflow menu.
6. **Progress and errors:** verify that running/stopped/partial-save states are visible in Activity and global Console, with no false guarantee of atomic rollback.
7. **Responsive/accessibility:** verify three-button layout at narrow widths, focus restoration and modal close behavior using an actual browser.

## Acceptance / stop boundary

Static UI and routing checks pass for the direct integration. Real-browser and real-model verification has not been performed. Test: open a Project, run a normal revision with Takes unchecked, repeat with fresh Takes checked, continuity preset, coherence preset, cancel/stop and error mid-sequence, activity reporting, and session persistence. Keep the original production backend and controls until those tests pass. Scope beyond current functionality should be a separate design decision.
