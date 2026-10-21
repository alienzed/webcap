# Session-only instruction recall — phased implementation

## Existing behavior and scope
- `tool/js/director_chat.js` implements a RAM-only submitted-message history, with Up/Down navigation and unsent draft restoration. Preserve its chat conversation and UI unchanged.
- `tool/js/storyboard.js` submits instructions in Scene Refine (`[data-director-correction]`), Director Tools Revise Scenes (`#storyboard-director-tools-instruction`), and Insert/Extend Scene (`#storyboard-scene-creation-instruction`).
- `tool/js/generate.js` submits Prompt Assistant instructions from `#generate-director-instruction`.
- Saved Scene prompts, Story concepts/notes, the Generate main prompt/Prompt Library, request diagnostics and queued job data are **not** this feature. Retain their existing save/undo/restore semantics.

## Safe phases
1. **Plain JS RAM helper**: one small `createSessionPromptHistory()`, separate instances per workflow. Record trimmed, non-empty submitted text (deduplicate consecutive identical submissions). Up/Down navigation at first/last line; preserve a typed draft and restore it on Down. Leave ordinary multiline caret navigation and modified keys alone; dispatch `input` after recall so existing UI updates. No storage, backend, event bus or new modal.
2. **Storyboard wiring**: use existing scene-list delegation so rerendered Scene Refine inputs work; bind static Director Tools and scene insertion/extension fields. Record only after existing validation, at request initiation—not on keystrokes, presets, request previews, or returned LLM output. Revise/Scene creation history shared by their respective action families, but independent from Refine and Generate.
3. **Generate wiring**: attach the helper to Prompt Assistant instruction and record on the actual request path, including after any optional LoRA planning. No change to prompt authoring or automatic clearing.
4. **Tests/review**: test Up/Down, first/last multiline boundaries, draft restoration, separate histories, duplicate/empty entries, and no persistence. Check sources' actual submit paths and input listeners. Run focused existing JS tests and relevant CI, then merge if green.

## AGENTS.md invariants
Minimal explicit UI change, no new gates, no `localStorage`/file writes, no Prep changes, no synthetic submission, no staleness validation. History is lost upon reload. Do not interfere with existing Director Chat arrows or Storyboard Enter-to-refine.
