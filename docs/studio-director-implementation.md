# Studio Director — implementation and acceptance

[Functional contract](studio-director-contract.md) is authoritative. This file tracks the three-operation implementation and evidence; it does not define a competing architecture. The earlier incremental plans and audits from November 14 were superseded by the three-operation cutover in PR #950. Consult the PR history for original gap analyses.

## Scope correction — session material and independent references (2026-11-16)

The functional contract and [Studio user flows](studio-user-flows.md)
now clarify the original UX goal. This is an incremental correction to the
existing three operations, not an agent subsystem replacement:

1. **Documentation first:** distinguish authored conversation/session material,
   explicitly approved, independently sourced Read references, a suggested
   destination, and authoritative saved Project/Scene records.
2. **Acceptance tests next:** prove a pivot from a selected Project to a new
   Project; unsaved Scenes before choosing a destination; multiple Read sources
   from unrelated Projects; switching projects while preserving the session;
   a correctable default destination; and no second authoring call to reuse
   material. Capture a deterministic real UI/route result before widening code.
3. **Bounded code corrections:** use existing Context selection, session
   messages/raw responses, Project and Scene Review/Apply surfaces and existing
   save routes. Stop binding fresh creative material to selected Project/Scene
   IDs before an author confirms its destination. Do not erase historical drafts
   or invent model action parsing to choose a target.
4. **Schema/request alignment:** model-facing guidance requires requested
   authored fields, not merely optional hints. An explicitly launched authoring
   operation should use required fields appropriate to that operation; ordinary
   conversation still supports prose and best-effort partial results. Audit
   provider schema compatibility before requiring nested union constructs.
5. **Validation and risk:** focused deterministic tests must pass before
   claiming compatibility; live-model adherence and browser-level behavior
   require separate evidence. There is no new permission/quality gate or
   requirement to confirm every already-explicit direct save.

The historical #950 implementation status below is a dated snapshot and may
describe paths now being corrected; it is not proof that flexible sourcing or
destination-independent drafts already work.

## Implementation at the #950 handoff (2026-11-14)

Branch: `codex/studio-director-three-operations`. The implementation is code-complete for its scoped flow and has passed the focused GitHub Actions checks; real-browser/selected-model acceptance is **not recorded as passed**. Do not infer production reliability from mocked regression tests.

| Operation or boundary | Code state | Verification still useful |
| --- | --- | --- |
| **Read / conversation** | Fresh selected or explicitly resolved saved Project/Scene fields accompany a bounded conversation. Plain prose works, even without optional action metadata. No acknowledgment-only model call or automatic mutation. | Real model answers a saved Project/Scene question without cross-Project leakage |
| **Write Project** | One Project writer uses saved state, structured working fields, and existing reviewed/conflict-aware save routes. Unmentioned fields persist. | Create and revise; inspect persisted fields and unaffected Scenes |
| **Write Scene(s)** | One per-Scene writer serves creation, revision, and new Project initial Scenes. Targets are WebCap-bound; request carries full relevant Prompt plus requested changes. Title-only updates need no creative call. | New and revised Scenes with specified title/duration, including written-out durations |
| **Multiple Scenes** | Sequential bounded writes retain earlier saves on isolated failure, report saved/failed/not-attempted, and stop for cancellation or shared dependency errors. | Inject an isolated failure, then verify the next target and exact receipts |
| **Working drafts and context economy** | Structured complete fields persist separately from chat and survive ordinary follow-ups/session restoration. Bounded discussion and relevant saved/working fields replace whole-transcript replay and duplicated prompt receipts. | Follow up, reload, then apply already authored material without a redundant model call |
| **Recovery and integrity** | Real IDs, explicit destinations, optimistic save conflicts, existing Undo/Redo, and distinct post-save reporting errors are retained. Invalid optional data cannot erase usable independent results. | Conflict, failed save vs. failed refresh, and recovery in real UI |

### Best effort is not all-or-nothing

LLM output can be useful even when its wrapper, action hint, rationale, title or duration metadata is wrong or absent. Preserve valid fields, prose, editable drafts and previously saved Scenes. Validate only what the specific operation needs to save or execute. If a requested duration cannot run, retain its Prompt for correction rather than silently substituting an unrelated value. Do not add a grading model, repair loop, speculative guard or alternative writer system. Refer to `AGENTS.md` for repository-wide guidance.

### Remaining boundaries, not release claims

- Historical Workshop, advanced Read, readiness/capture, and other legacy helpers still exist in places. Their **active caller status must be checked** before deleting them. Their presence does not mean they remain the authoritative Studio Director path.
- Independent Revise & Generate and Check Coherence utilities remain separate; their distinct functions should not be removed as Director cleanup.
- Model adherence, UI correctness, and complete end-to-end creative preservation require real-browser/selected-model checks. Passing CI is evidence for deterministic logic, not a guarantee about model behavior.
- README describes the intended merged behavior after #950; older releases still expose their older workflow.

## Focused acceptance checklist

1. **Read:** Ask for exact saved Project title and selected Scene constraints. Confirm the current Project/Scene is used, answer is visible, no write occurs and one conversation model call is made.
2. **Write Project:** Create then revise Project fields. Inspect actual persisted values, unrelated fields and existing Scenes.
3. **Write Scenes:** Create a Scene with a nondefault duration, revise a different selected Scene, and verify full Prompt, title, duration and target. Confirm unsupported duration preserves the draft for correction.
4. **Working draft:** Request material, ask a follow-up, restore the conversation, then apply previously completed structured material without regenerating it.
5. **Partial work:** Fail one Scene in a multi-Scene request; verify earlier success, later attempts where safe, cancellation and truthful saved/failed/not-attempted reporting.
6. **Recovery:** Exercise explicit target ambiguity, concurrent edit conflict, Undo/Redo, and a successful save followed by a refresh or receipt failure.
7. **Model variations:** Verify a plain-text Read response, malformed optional action/metadata, and a partial structured draft still leave all usable output available.

Log selected model, source commit, request/response, persisted effects and any concrete failure. Fix demonstrated failures locally; do not invent additional gates to handle hypothetical mistakes.

## Evidence and ownership

### Browser acceptance follow-up (2026-11-14)

Validated against the code through `a920111d` plus the focused acceptance fixes,
using `remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m`:

- The local development environment had two WebCap processes listening on port
  4200. Replaced them with one current backend and verified its live capability
  catalog before running further model calls. Earlier mixed-version results do
  not establish failures of the cutover.
- Read returned current saved Project/Scene facts and accepted prose. Corrected
  the plain-response action fallback so a factual question ending with "make no
  changes" does not offer an unrelated Scene write.
- Created `Window Light` with a full prompt spanning twelve seconds and verified
  its saved title and twelve-second duration in the editor.
- Created `Acceptance — Night Tram` through Project review, followed by two
  separate initial Scene writes. Both complete prompts saved with the reviewed
  titles and eight-second durations. This exposed missing progress/completion
  receipt kinds in conversation persistence; the validator now accepts those
  app-generated receipts. Confirmed the complete conversation saves and restores.
- Revised both saved Scenes sequentially to remove music. Observed the first
  save before the second; both titles, durations and other creative details
  remained intact. Undo/Redo restored the expected prompt values.
- Reviewed and applied a Project-style-only revision; checked the saved title,
  Concept and current Scene prompt were unchanged.
- Closing/reopening Director and visiting Prep then returning retained the
  conversation and unsent draft. A complete saved prompt requested in chat was
  available verbatim through the full-response expansion.

Focused regressions passed: 20 Node three-operation checks and three Python
conversation receipt/persistence checks. This normal-flow pass does not cover
injected item/runtime failures, cancellation, concurrent edit conflicts or
post-save refresh failures, and is not a statistical model-reliability claim.

- Prior browser acceptance found a correct plain-text Read rejected by a mandatory response wrapper, and non-default duration lost on a Scene. These failures motivated #949 and the #950 cutover.
- #950's focused tests cover plain-text Read, optional malformed action, correct target binding, sparse working-draft fields, persisted draft reuse, worded duration, incremental Scene results and save receipts. The missing optional `reply` case also has a focused regression.
- The #950 head was checked against GitHub Actions before merging; all seven reported workflows passed at `997e263f4c0b08fbe261d4e052e0a530d12a3944`. Documentation-only commits came afterward and require their own check status.
- No real-browser/model acceptance was executed in this session. Record it separately rather than rewriting this file as though it happened.

The stable source of truth is the actual saved Project/Scene state and execution receipts, not chat claims, readiness scoring or the model's creative self-assessment.

## Orphan cleanup and remaining callers (2026-11-14)

The current Studio Director implementation is the three-operation Read, Write Project and Write Scene(s) handoff. The follow-up orphan audit made these bounded changes on `cleanup/studio-director-orphans`:

1. **Confirmed inert UI:** deleted the hidden readiness/creative-assessment panel, its unused dialog and no-op presentation bridge. The existing I/O inspector still shows raw and parsed responses; it no longer offers the retired `readiness.capture` review button that only led to a dead-end notice.
2. **Retired guideline proposal:** deleted the permanently hidden Story-guideline proposal button, its single event caller, local proposal/parse/review functions and its dedicated LLM operation/schema. Saved legacy guidelines and other Storyboard guideline tools remain unchanged.
3. **Conversation compatibility:** stopped feeding historical readiness metadata to an inert UI, but preserved old chat records and `readiness` serialization/validation. No migration, bulk history rewrite or new gate was added.
4. **Focused coverage:** removed the retired operation from route tests and added regression checks that the obsolete UI/actions are gone while I/O and the active Write/Scene review controls remain.

**Retained deliberately:** the explicit legacy Read panel is hidden but still has working bindings, an outbound bridge and compatibility tests; the timed-shot Workshop has a callable frontend event path and possible restored-session context; the old Scene/sequence preparation paths still have call sites in the bridge. Delete these only in a separately verified caller-migration phase, not by removing markup and leaving event handlers broken. The active Project/Scene writers, current Scene review, multi-Scene incremental saves, Check Coherence and Revise & Generate remain in place.

**Acceptance:** focused CI validates code/contracts and avoids claiming real-model acceptance. Inspect a restored legacy Studio conversation and the current Write/Scene flow in a browser before claiming full UI acceptance. This cleanup does not change normal model calls, save semantics, Project identity, Undo/Redo or generation.

## Legacy authoring caller cutover — safe phases (2026-11-14)

The authoritative behavior remains [the three-operation contract](studio-director-contract.md). This change is a *caller cleanup*, not a new Scene writer or review system. The current Draft panel's **Create Scene** already calls `writeNewScene`; **Revise selected Scenes** already calls `prepareBatchScenes` and the canonical `writeSelectedScene` once per target. Suggested actions and Project initial Scenes also use the one-Scene operation. Preserve all of these.

1. **Trace and freeze:** Identify the active Draft-panel and suggested-action callers versus hidden older controls. Verify that `studio_scene_draft` and `studio_scene_sequence_draft` are invoked only by hidden preparation functions; `studio_scene_batch_draft` and `studio_playbook_draft` have no app-side invoker. Keep restored sessions, partial drafts, conflicts and incremental saving intact.
2. **Retire redundant entry paths:** Remove the permanently hidden **Prepare a Scene / Prepare Scenes** entry point, its obsolete `prepareWrite('scene'|'scenes')` branches and separate model requests. Retain the existing Scene review and Apply functions because the canonical new-Scene writer and restored legacy drafts still use them. Keep visible Write/Draft affordances and the standalone Project creation/revision paths.
3. **Retire server-only operation contracts:** Remove the four unused Scene/Playbook operation names and response schemas from `/fs/director/chat`, leaving `studio_scene_field_draft`, `studio_project_draft`, `studio_brief_draft`, `studio_chat` and legacy Workshop untouched. Reject retired operation requests through the normal unsupported-operation error rather than silently rerouting old external callers.
4. **Tests and audit:** Verify the exact active Draft routes, the lack of hidden entry points and retired operation names, and the retained canonical model schema/review/Apply controls. Run the existing Studio, Storyboard and persistence checks. Real-model/browser acceptance remains a separate check, particularly for restored conversations and incomplete Scene results.

**Retained on purpose:** legacy Read/explicit story inspection and Workshop still have independent state and stored-conversation compatibility; their removal needs a separate migration and acceptance check. The old single-Scene review dialog and draft state also remain for historical capture compatibility. The absence of app callers for an API operation does not establish that no external script has ever used it; retire only the explicitly unadvertised compatibility operations, with visible 400 responses for unsupported direct calls. No new permissions, LLM calls, repair loops or save gates are introduced.

## Browser-only textarea revisions (2026-11-14)

**Scope:** One generic revision navigator for editable WebCap textareas, not a second Studio-specific Undo/Redo stack. No server storage, chat persistence, model calls, diffing, branching, similarity scoring or retention cap.

Safe phases:

1. **Identify ownership and context:** Existing static textareas use their IDs; Scene fields incorporate the current Project and Scene ID; caption/config editor reuses its existing autosave target key. Generated editor rows use their available data identity and field selector. DOM re-creation reattaches to the same browser-memory `Map` without restoring stale content into the field.
2. **Shared capture and interaction:** Capture an initial value, then a new distinct value after **10 seconds of inactivity**. The tiny previous/count/next control is positioned inside the focused textarea with padding for text clearance. Browsing changes the displayed value but never emits an input/save event; leaving an unedited preview restores the actual value. Editing an older value makes it the next newest snapshot after inactivity; all intervening versions remain.
3. **Retire competing Studio history UI:** Remove Storyboard's per-Scene server-writing Undo/Redo buttons and client stack, and the Director Project Overview Undo button, bridge and local receipt. The existing browser-native text editing shortcuts and separate submitted-instruction recall stay intact. Leave the obsolete backend Project Undo API untouched in this narrow pass to avoid breaking external clients; it is no longer invoked by Studio UI.
4. **Regression audit:** Exercise repeated edits, stable keys through rerender, distinct Scene and caption targets, idle capture, navigation without persistence and editing an older version. Run focused Studio/UI tests and the repository CI suites. Check actual browser layout separately where a modal/top-layer or unusually small textarea changes positioning.

The new history is intentionally best-effort. Programmatic rewrites do not trigger explicit pre-replacement checkpoints; a previous value is available only if it has already been observed. Existing application autosave remains the authority for persistence.

## Scene header / Project Tools cutover (2026-11-15)

This is a localized Storyboard UX change, not a new Director operation or model contract.

1. **Inventory and ownership:** Keep context-specific Concept, Atmosphere, Invariants, Scene Revise, generation, LoRA and First Cut actions in place. The existing `storyboard-director-tools-modal` remains the owner of batch Revise & Generate/Continuity/Coherence. Director chat remains independently available.
2. **Rehome navigation:** Place Project Tools beside Generate/Cancel Takes in the Scene header, move Sequence to the trailing end of the Scene strip and combine its plus/Extend Story into one menu choosing Add Blank Scene or Extend Story with Director. Keep Scene card context actions and Sequence readiness/state logic intact.
3. **Add scoped deterministic editing:** The Project Tools menu opens Find & Replace of saved Scene Prompt text. Count matches against the current Project; after user-authorized Replace All, flush saved edits, reload authoritative Project state, then reuse normal `update_scene` operations per changed Scene. No LLM calls, regex mode, additional conversation or server endpoint. Preserve completed Scene saves if a later request fails and visibly report partial completion.
4. **Validate and audit:** Focused UI contract and pure matching tests plus existing Scene/Director regressions and CI. Browser layout/overlay acceptance remains separate. Do not merge before correcting actual test failures.

The pre-existing Studio Director workbench coherence path remains for restored/advanced conversation compatibility; the new Project Tools entry intentionally opens the independent Storyboard coherence workflow. A separate review can consolidate that duplicate later.
