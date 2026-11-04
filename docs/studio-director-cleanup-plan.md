# Studio Director cleanup implementation plan

Status: phases 1–3 implemented on PR #859; Studio-specific automated checks passed on the completed code run. Phase 4 awaits real-model/browser parity acceptance before the transitional Director Tools modal is removed. No changes have been merged into main. See `AGENTS.md` (especially How To Make Changes, Mutation Safety, LLM Guidance, and UX Guidance).

## Ownership and safe boundaries

Studio Director owns ordinary creative conversation, explicit Read, the three reviewed Write goals (Create Project, Revise Project, Write Scenes), creative capture and optional explicit coherence review. WebCap owns Project/Scene IDs, ordering, invariant associations, persistence, conflict checks and production controls. Preserve the existing save endpoints and Review/Apply dialogs that are still reachable.

## Phase 1 — Reachability before deletion

- Audit references in `tool/js/studio_director_workbench.js`, `tool/js/director_chat.js`, `tool/tool.html`, associated tests, and the server routes.
- Confirm that legacy workbench Scene Move/Duplicate/Split/Invariant-link and H3 Playbook actions have no current Workbench entry point, but Scene-capture review, batch Scene review, explicit coherence and Undo **are live**.
- Do not confuse retired LLM operations with shared Studio mechanics or manually operated features in `storyboard.js`.

## Phase 2 — Remove dead workbench UI and implementation

- Remove orphaned operations, prompts, state, HTML controls, event handlers and review dialogs only where the active Director workflow cannot reach them.
- Keep `showSceneReview`/`applyScene` for completed Scene-field capture, `prepareBatchScenes`/`applyBatchScenes` for multi-Scene revision, and `prepareProjectCoherence` for the explicit utility.
- Preserve `readPayload`, explicit read receipt, undo after saved Project revisions, and the existing chat persistence.
- Use existing tests to prove the remaining review paths retain optimistic conflict checks and approved-only mutations.

## Phase 3 — Shrink active model guidance without format migration

- Remove stale instructions/names and duplicate LLM-directed mechanics in the Studio chat prompt.
- Keep the current `reply` + `readiness` schema while capture, field preselection and saved session readers depend on it. Most routine replies use empty readiness; keeping a stable schema avoids introducing parser/rejection failures as part of cleanup.
- Model returns creative content and minimal optional metadata; WebCap binds destinations and performs deterministic operations.

## Phase 4 — Reconcile transitional Director Tools and historical contracts

- Verify its unique work (e.g. legacy continuity analysis) against explicit coherence and reviewed Write.
- Remove parallel UI **only when supported parity is demonstrated**, not merely because it looks redundant. Keep backend endpoints consumed by Studio or manually operated workflows.
- Update authoritative docs; mark historical contracts as historical rather than deleting potentially useful design rationale.

## Phase 5 — Verify then close cleanup

- Node JS syntax/contracts and Python Studio tests in GitHub Actions; inspect failing logs and adjust tests only for intentionally retired UI.
- Smoke coverage: short chat, explicit Read+receipt, Project create/revise, Scene create/batch revise, full captured Scene update, coherence review, save conflicts, history reload, cancellation and safe Apply.
- Real-model/browser validation is required before claiming runtime reliability or retiring transitional Director Tools.

### Stop conditions

Stop a destructive deletion if its last consumer is ambiguous, another supported feature uses it, or automated acceptance contradicts the reachability audit. Protect shared endpoints and data compatibility; report a concrete blocker rather than invent a replacement.

## Execution checkpoint — 2026-11-03

- **Done:** Removed unreachable workbench Scene Move/Duplicate/Split, standalone Invariant linking, legacy one-off Scene drafting, and Playbook edit/review paths. Removed their inactive dialogs/controls and one orphan CSS rule. Preserved Scene capture review, batch field updates, explicit coherence, Read/receipts, undo and persistence.
- **Done:** Shortened `studioDirectorChatRequestMessages` instruction text by roughly 2.2k characters and strongly prefers empty readiness metadata for ordinary 1–3 sentence exchanges. Deliberately retained the established response schema and saved session format.
- **Done:** Updated regression tests that still expected retired UI and prompts; Studio Director and Storyboard scene-header CI checks passed on the tested code revision.
- **Deferred for proof, not design:** `storyboard.js` still exposes the older Director Tools modal with a direct multi-Scene revision path and optional fresh-Take generation. This is still a distinct author-operated action, not proven equivalent to reviewed Write Scenes; removing it prematurely would lose capability. Verify the intended replacement against real runtime before deletion.
- **Next acceptance:** Real-model conversation, Read receipt, reviewed Project/Scene Apply, captured-field Apply, conflict behavior, persisted chat reload, and coherence check. Follow up by retiring the legacy modal when supported parity is confirmed. Other repository CI regressions outside Studio remain a separate concern.

**Do not mistake the retained manual Storyboard mechanics and stable API routes for unfinished Director LLM contracts.** The active Director creative menu, routing and prompt now have a focused scope.
