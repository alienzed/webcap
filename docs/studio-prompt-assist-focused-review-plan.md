# Prompt Assist — focused finding review

## Why

The Scene-level Prompt Assist model produces useful, appropriately detailed corrections, but the current modal renders every finding as a large editable form in one tall list. Six findings become six competing blocks. Keep every bit of useful model material; simplify what is visible at once.

## Codebase grounding

- `tool/js/storyboard.js` owns `promptAssistSession`, `renderPromptAssistFindings`, `openPromptAssist`, and `applyPromptAssistFinding`. Apply uses the existing `/fs/storyboard/prompt-assist/apply` route and refreshes the authoritative saved Scene prompt.
- `tool/tool.html` contains separate Prompt Assist and Project Deep QA modal shells. The latter must remain unchanged.
- `tool/css/storyboard.css` owns shared Assist styling. Scope new presentation rules to `#storyboard-prompt-assist-modal`, so the Project Deep QA list is preserved.
- `tests/live/studio-prompt-assist-deep-qa.spec.cjs` is a **real-model**, opt-in Playwright journey (it includes Project Deep QA followed by Scene Prompt Assist). `tests/browser/` runs the local real app with a controlled inference endpoint and provides supplemental deterministic UI coverage.
- `docs/studio-prompt-assist-project-deep-qa.md` remains the behavior contract: one Scene, editable exact-excerpt corrections, independent successive applies, optional Deep QA context, no hidden rereads, and no model or persistence changes in this UX revision.

## Safe implementation phases

1. **Focus without losing material.** Keep the same findings and original Scene text. Introduce one visible finding and `Previous`/`Next` with honest `Finding N of M` and `K applied` status. Keep the full Scene prompt in a readily available expandable section, not a competing wall of text.
2. **Roomy editable work surface.** Use the available modal width for the complete problem, suggested fix, exact source excerpt, and editable replacement, with readable AGENTS.md typography (16px body/controls, 18px+ key labels/actions). No summarization, truncation, extra model calls, or replacement of the current Apply endpoint. Project Deep QA modal stays as is.
3. **Progress and state.** Preserve edited replacements when moving between findings. After an actual successful save, mark that finding applied, update the authoritative source text, then advance to the next unapplied finding (wrapping to unresolved items if necessary). Keep previous/applied items inspectable and distinguish failures from saved results. No auto-apply or mandatory completion.
4. **Verification.** Add real-browser Playwright UI regression coverage for navigation, draft retention, one-card-at-a-time rendering, source visibility, and apply advancement. Update the real-model Prompt Assist journey to verify the new interface and actual saved Scene without relying on the old stacked-card/Applied-button location. Run relevant tests and audit diff/CI; never represent CI syntax checks as a live-model pass.

## Acceptance

- One finding is visible at a time; details stay complete and legible.
- The active Scene and exact saved prompt are available without displacing the primary finding.
- One Apply saves only the explicit replacement and advances after success; nav never saves.
- Editor changes survive Next/Previous until applied; applied findings can be revisited.
- Zero findings and discarded model records show accurate, readable state.
- The same guarded backend apply and Scene refresh remain authoritative.
- No behavior or style change to Project Deep QA, Visual Direction, or Scene authoring.
