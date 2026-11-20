# Studio Director — quiet toolbox implementation

## Product direction

Studio Director is a creative toolbox with an important conversational component, not merely a chat screen. Use the approved **Quiet Director** concept as the direction: a calm conversation with a discoverable **Actions** launcher beside the composer, an honest explicit-Read context affordance, and compact task-focused Read/Write surfaces. Keep a right rail as a possible future alternative, **not** part of this change.

Follow root `AGENTS.md`: 16px body and controls, 18px+ important labels/actions, 24–30px primary task heading where space allows, and no tiny permanent instructional clutter. Preserve real state and errors, and explicit Read and Write semantics.

## Codebase mapping

- `tool/tool.html` owns the shared Director drawer, composer, History dialog, Studio workbench, review dialogs, and raw I/O dialog.
- `tool/css/workspace_shell.css` owns the right-aligned resizable Studio drawer, its existing multi-column actions layout, composer sizing, and type hierarchy.
- `tool/js/director_chat.js` owns conversation mode, saved-history lifecycle, explicit Read receipts, message composer, revision mode, and existing History/I/O/new-conversation controls.
- `tool/js/studio_director_workbench.js` owns deterministic Project/Scene Read and Write selections, request scope, draft/review/apply, and suggested-action handoff. The backend must remain untouched.
- `tests/browser/helpers.cjs` and `tests/live/helpers.cjs` operate the real browser UI; migrate helpers when entry points move and add UI regression coverage.

## Safe phases

1. **Tool discovery:** Add a visible **Actions** launcher at the composer, exposing Read Project, Write Scene(s), Write Project, History, New conversation, and Model I/O. Retain existing DOM/action owners and hide redundant Studio-only header buttons. Keep normal Assistant and dedicated Revise Scenes unaffected.
2. **Focused surfaces:** Replace the persistent split-column action layout with an on-demand compact in-drawer dialog/sheet that houses the **same** Read/Write form elements. Open through existing workbench handlers so nothing changes about target selection, actual Read snapshots, model calls, review, or save.
3. **Readable composition:** Raise text in revised Studio elements to `AGENTS.md` levels, reduce repeated copy, preserve visible errors, and let the Studio chat input grow from a useful multi-line default up to a viewport-relative cap before it scrolls.
4. **Compatibility and verification:** Update existing browser helpers, add real-UI Playwright coverage for Actions, explicit Read, targeted Write, focus/escape, composer growth, and unchanged general Assistant/revision behavior. Review PR diff and GitHub checks. Live-model tests require an actual running WebCap + configured model; never claim to have run them unless observed.

## Guardrails

Keep `id`s and existing events for old workbench controls and dialogs to avoid breaking saved data, callbacks or direct callers. Do not redesign other Studio features. Do not modify the Director model request/response contract or create auto-reads/auto-writes. Review/save remains explicit. Maintain accessibility: menu expanded state, outside/Escape dismissal, focus return, disabled-state truth, and room for narrow or resized drawers.

## Acceptance

- Conversation-first Director visually shows a discoverable toolbox without header clutter; no form persists unless explicitly invoked.
- Read material is explicitly chosen and appended to the originating conversation; status never suggests implicit/automatic context.
- Write Scene(s) and Write Project open appropriate existing controls; draft/review/save continue to use current deterministic handlers.
- Chat input shows multiple lines and grows before scrolling.
- Relevant text follows `AGENTS.md`; no tiny captions are introduced.
- Normal Assistant and scoped Revise Scenes retain their behavior.
