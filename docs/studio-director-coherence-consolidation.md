# Studio Director / Director Tools reconciliation — implementation plan

Status: staged implementation, November 3, 2026. Follow [AGENTS.md](../AGENTS.md) and the [Studio Director materialization contract](studio-director-materialization-contract.md). This is a focused consolidation, not a new agent/tool-calling framework.

## Ownership decision

Studio Director owns creative conversation, suggestions, explicit Read, reviewed Write, and Project-level coherence analysis. Studio's existing author-operated generation workflow owns Take creation. Director Tools' older revision modal is transitional, not a second product direction.

The capability catalog is advisory, not an LLM tool dispatcher. In the consolidated interface, coherence remains a separately invoked Project utility, outside the three creative Write workflows. `project.coherence.check` can be suggested by `readiness.writeHint = "coherence-check"`, but the author must explicitly invoke the operation in Studio Director's Write panel. This avoids adding a second executor, automatic model-controlled filesystem reads, or hidden writes.

## Code audit

| Concern | Existing owner | Reconciliation |
| --- | --- | --- |
| Ordinary conversation and suggestion | `director_chat.js`, `studio_director.py` | Add one explicit coherence hint in the existing schema and catalog |
| Project coherence inference | `/fs/storyboard/director` -> `check_coherence_sequence`, `llm_runner.py` | Reuse the read-only sequential per-Scene analysis; no new backend execution route |
| Reviewed edits to many H3 Prompts | `studio_director_workbench.js`, `/fs/studio/director/scene-fields-batch` | Normalize findings into existing batch review; atomically apply only selected changes |
| Legacy Revise Scenes and Continuity preset | `storyboard.js:reviseScenes` | Studio Director already offers selected multi-Scene Write; do not replicate the legacy direct mutation path |
| Fresh Takes | Storyboard generation queue | Keep generation separate; coherence never schedules Takes |
| Legacy coherence review / Director Tools UI | `storyboard.js:showCoherenceReview`, `tool.html` | Retain temporarily until full acceptance; remove duplicate route and modal after verification |

## Safe phases

### Phase 1 — Contract and feature discovery (implemented in this branch)

- Add `project.coherence.check` to Studio Director's grounded capability catalog.
- Add `coherence-check` to the structured readiness schema, client validation, and conversational hint instructions.
- Expose an explicit Check Project coherence operation in Studio Director's existing Write selector.
- Keep all other conversations, Read delivery, and saved Project semantics unchanged.

### Phase 2 — Read-only analysis and reviewed Apply (implemented in this branch)

- Use the selected Studio Director model for the existing `check_coherence_sequence` job.
- Flush pending Project saves, then capture the selected Project's authoritative ID, updated timestamp, Scene order and saved H3 Prompts.
- Require saved H3 Prompts on every Scene, consistent with the existing analysis contract; fail visibly if absent.
- Validate complete Scene-ID coverage, original Prompt matching, nonempty proposals and unchanged Project timestamp before showing any review.
- Show only changed H3 Prompts in the existing multi-Scene editable review. The existing `scene-fields-batch` endpoint applies selected changes atomically with expected original values.
- On errors or changed Project state, do not offer a stale review. Do not generate Takes.

### Phase 3 — Acceptance tests (required before merge)

- Automated: JS Studio Director checks, Python Studio Director contract tests, existing batch Apply and Storyboard coherence worker tests.
- Runtime: `hi` succeeds through structured `studio_chat` (PR #858's version mismatch is addressed in the running backend), explicit user-requested coherence produces a suggestion, and selected Project checking produces either a no-changes receipt or an editable multi-Scene review.
- Reject an attempted stale apply; preserve untouched prompts, original Take metadata and Scene ordering. Verify cancellation, error visibility, progress, and a second run after an edit.
- Review with a real selected local model. Successful response parsing does not guarantee good judgments.
- This GitHub connector session cannot execute the local WebCap model, Node/Python test suites, or browser. These checks are **not** claimed as passed.

### Phase 4 — Legacy retirement (intentionally deferred until Phase 3 passes)

- Remove the independent Director Tools UI/modal, legacy revision/coherence UI wiring and per-modal instruction history.
- Audit all callers of `revise_scenes_sequence`, `check_coherence_sequence`, `apply_coherence` and the old generation side effect. Preserve shared backend operations only where still called, or migrate and retire with tests.
- Preserve existing direct editor-generation and local Prompt editing actions. Do not move Take generation into Studio Director.
- Reconcile the earlier [PR #858](https://github.com/alienzed/webcap/pull/858), which temporarily moves Director Tools into an overflow menu; the present branch intentionally stacks on it.

## Guardrails

- No automatic Project data attachment; a coherence check is an explicit author action with a visible Project target.
- No automatic saves, no broad JSON repair, no generic action executor, no automatic Take generation.
- Coherence means real audiovisual/timing contradictions, not forced narrative progression across independent Scenes or intentional variations.
- Avoid UI additions beyond the existing Write operation and current suggested-action area.
- Runtime failure or a real mismatch between authored and reviewed prompts must remain visible. Only retire the old UI when equivalence has actually been demonstrated.
