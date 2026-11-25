# Studio Director UX polish

## Scope and contract

Implement the browser audit's twelve small improvements using the existing
classic-script owners. Preserve exact conversation contents, outbound model
messages, saved Project/Scene values, explicit Read/Write semantics, mutation
routes, and queue behavior. No new dependencies, model requests, timers, storage
roots, or startup work. Errors remain visible and diagnostic details accessible.

## Phase 1 — Conversation presentation

- `tool/js/director_chat.js`, `tool/css/workspace_shell.css`: present explicit
  Read snapshots and successful Apply receipts as compact expandable cards.
  Derive summaries only from received material; retain the exact original text
  in each disclosure and in model context/history. Unrecognized material stays
  inspectable without blocking useful conversation.
- Reconcile existing message rows by their rendered content so expanded details,
  selection, and scroll survive unrelated UI refreshes.
- Give Director prose a longer preview and a conventional Show more control.
- Present known protocol-generated legacy history titles readably without
  rewriting stored titles. Ordinary/manual titles retain their text.
- Keep progress phases, elapsed time, queue position, and available throughput
  visible; put runtime identity and request counts in the existing inspector.

Validation: exact Read persistence/request tests, history tests, message disclosure
and DOM identity regressions, existing Director tests.

## Phase 2 — Identity and feedback

- `tool/js/director_chat.js`, `tool/tool.html`: restore the conversation heading
  when leaving revision mode. Move the existing Project mismatch action beside
  the Director header, naming both the conversation Project and open Project.
  Reuse its existing explicit action; navigation never changes the attachment.
- `tool/js/studio_director_workbench.js`: clear successful feedback when entering
  another action, while preserving operation errors.
- Distinguish saved prompt history from pending timed-shot proposals in the
  shared revision dialog.

Validation: mode switching, mismatch visibility and explicit target change,
Read-to-Write transition, historical versus pending revision labels.

## Phase 3 — Project and Scene layout

- `tool/tool.html`, `tool/css/storyboard.css`: give the Project title a full row
  and primary visual weight; keep Icon/Status below it. Allow Project tools to
  wrap within their actual available width without overflowing the Scene pane.
- `tool/js/storyboard.js`: make the existing unavailable ComfyUI explanation
  readable beside LoRA controls, preserving detailed error tooltips/logs.
- Check desktop and narrower layouts with populated Projects and Scenes.

Validation: browser checks at 1440px and 1100px, focused Scene view, expanded
overview, Director with/without action panel; syntax and relevant regression
suites. Use disposable browser fixtures for writes. Keep the user's running
server and authored data intact.

## Delivery

Review the diff, run relevant checks, commit on `codex/studio-director-ux-polish`,
then fast-forward `main` to the verified commit. Stop only for a concrete blocker
or a decision that changes functionality or the authorized scope.

## Completed validation

All three phases are implemented. The mismatch action retains its existing
on-demand placement for unattached conversations and is prominent when an
attached conversation differs from the open Project. General Chat hides it.

- JavaScript syntax checks and `git diff --check`: passed.
- All root `studio_*`, `storyboard_*`, and `director_*` Node test files:
  **271 passed, 1 skipped, 0 failed**. Coverage includes byte-for-byte Read
  context, saved history, explicit destinations, preserved disclosure nodes and
  scroll, real progress telemetry, and General Chat behavior.
- `studio-ux-polish.spec.cjs` plus `studio-director-quiet-tools.spec.cjs`:
  **7 passed** in both light and dark themes. The real Flask routes and history
  store were tested in a disposable copy on port 4202; only the external model
  endpoint used controlled responses. The user's server stayed on port 4200.
  Desktop 1440px and medium 1100px layouts were visually reviewed.
- Python `test_director_chat_history.py`, `test_llm_prompt_copy_diagnostic.py`,
  and `test_storyboard_ui_contract.py`: **81 passed, 47 failed**. Running the
  identical checks against an archived copy of unchanged `main` at `a8a533791`
  produced the identical 47 failing test IDs; there are **zero new failures**.
  Existing failures include retired UI/source assertions and an older freeform
  request contract. No production behavior was changed to satisfy stale tests.
- One existing Node history-selection mock lacked the already-required
  `studioWorkspaceVisible` function; the fixture now supplies it. Other touched
  mocks gained the standard DOM methods used by keyed row reconciliation.

No backend, request serializer, persisted history format, model guidance,
mutation endpoint, queue policy, polling interval, or startup work was changed.
