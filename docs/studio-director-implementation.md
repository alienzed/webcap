# Studio Director — implementation map

[Normative contract](studio-director-contract.md) is authoritative. This
document describes the concrete implementation routes and verification, not
an alternative behavior model. Previous plans with combined Chat/Review
authoring are obsolete and available in Git history.

## Owner and request sequence

- Chat UI and conversation storage: `tool/js/director_chat.js` and
  `tool/server/director_chat_history.py`.
- Focused guidance and response shapes: `tool/server/studio_director.py`
  and the `/fs/director/chat` dispatch in `tool/server/app.py`.
- Explicit Write panel, deterministic operation/Scene selection, editor
  integration and field history: `tool/js/studio_director_workbench.js` plus
  the existing Storyboard editor and revision-history owners.
- Save routes: existing Project creation, Project field revision, Scene
  creation and Scene field revision APIs. Saved Project/Scene data is
  authoritative. `recordApplied` records only actual confirmed saves.

## Delivery invariants

Chat → no schema → plain text → conversation persistence.
Write → task-specific guidance/schema → structured response → the same
operation's typed field mapping → deterministic selected target → editor and
History. No Review. Never parse conversational prose to select a UI action.
Do not duplicate conversation inside a JSON payload. Keep full request and
raw response accessible in I/O even when the operation errors.

Correctness is verified at the WebCap boundaries: selected destination, field
mapping, request operation/schema, authoritative saved result, editor update,
History and I/O. WebCap does not evaluate creative semantics or introduce
repair/extraction calls. Invalid application wiring must fail visibly.
A provider's nonideal content is an input to improving guidance, not to
inventing runtime judging.

## Cleanup order

1. Remove obsolete combined Chat authoring and legacy UI suggestions.
2. Remove legacy Review dialogs, controllers, draft orchestration and
   readiness/capture paths after tracing all callers.
3. Consolidate duplicate Write callers so each explicit operation owns its
   focused request/response/save contract.
4. Verify History on exact target fields and I/O on errors; do not build a
   parallel safety workflow.
5. Replace old test expectations and run unit, Playwright/mock, Playwright/live
   and relevant CI regression suites before merging.

Do not preserve active old routes just to satisfy outdated tests. Do not
remove unrelated First Cut, Develop Scenes, Enhance Prompt, or independent
Storyboard/Workshop features as collateral cleanup.

## Release status

PR #1021 is work in progress. The functional contract is frozen for this
refactor. An individual successful syntax check or mocked request does
not establish runtime acceptance. CI results and live Playwright evidence
determine merge readiness.
