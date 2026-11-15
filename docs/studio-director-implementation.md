# Studio Director — implementation and acceptance

Original gap audit: `747a8ce9`, 2026-11-14. Requirements live in
[studio-director-contract.md](studio-director-contract.md). This file records
historical implementation gaps and acceptance evidence; it does not override the
contract or describe every item below as outstanding.

Current phase: focused code completion integrated through the bounded Scene
write and reviewed Project paths. The Director context fix and retained draft
reviews are prepared for separate browser/model acceptance. Passing code tests
does not prove model behavior or UX acceptance.

## Current position

The useful foundation already exists: real Project/Scene storage, H3 authoring,
per-Scene revision execution and saves, scoped field updates, reviews, progress,
conversation persistence and visible errors. Intent has been retired from active
authoring. The remaining work is to connect and prune these paths consistently.

| Gap | Current path/evidence | Correction |
|---|---|---|
| Model metadata can route a new Scene into existing-Scene review | `studio_director.py::chat_response_schema`, workbench `reviewCreativeCapture` | Bind creation/update scope and real targets in WebCap. Retire overlapping capture/readiness routing as the authority. |
| Scene request parameters differ by entry point | Single-Scene Apply carries title/prompt; multi-Scene creation carries duration; the direct shortcut accepts prompt only | One Scene content contract, with requested title/duration changes carried through. |
| Director authors several revisions in one response with conversation history | Workbench `prepareBatchScenes` | Use the existing bounded per-Scene execution pattern for Write Scene(s). |
| Existing revision sequence stops on its first item error | `llm_runner.py::revise_scenes_sequence` | Continue after isolated Scene failures, but stop for shared model/runtime/Project failures. Retain successes and report saved, failed and unattempted Scenes. Preserve Stop. |
| Automatic context is inconsistent | `sendMessage` consumes staged `sceneRead`; other paths still ask for explicit Read | Supply the fresh Scene prompt, duration, relevant Project/continuity facts and agreed decisions when needed; avoid whole-conversation payloads for simple edits. |
| A follow-up message discards proposals/actionability | `sendMessage` clears proposal state and marks readiness stale | Retain usable authored material while answering questions; replace it when the author requests a revision. |
| Direct save reporting can conflate persistence and refresh failure | Workbench `applyScenePrompt` and `openStudioDirectorScene` | Preserve the actual saved outcome if later refresh/receipt work fails. | 
| Generation and Scene-editor duration bounds disagree | `storyboard_generation.py::_scene_settings` accepts 4–15s; Scene inspector in `storyboard.js` uses 9–15s | Verify intended supported range and align the visible editor and all authoring paths; never silently clamp a requested duration. |
| Full-prompt revisions cannot mechanically prove creative preservation | Complete H3 Prompt is returned for a revision | Preserve non-target fields deterministically; test prompt fidelity with the real model and provide inspection/recovery rather than a second grading call. |
| Project creation with initial Scenes is multi-step | Project create and individual Scene save paths | Save Project before Scene calls; on later failure retain successes and report the incomplete result without implying an atomic commit. |
| Recovery currently remembers prompt strings only | Storyboard `scenePromptHistory` | Reuse bounded session history for fields actually changed, including manual edits; no cross-reload revision archive or LLM involvement. |

## Evidence and its limits

- Browser/model: a clear NEW twelve-second Scene request returned complete text
  but an invented `scene-new-logbook` saved ID; Review failed with "Select a saved
  Scene to review." Nothing was applied.
- Isolated store check: the single-Scene path saved a twelve-second prompt with
  the default six-second setting because duration was absent from the contract.
- Earlier browser/model checks: supplied-context questions worked; a targeted
  prompt revision and prompt-text recovery worked. These do not prove every
  entry point or model-dependent preservation requirement.
- Source: existing `revise_scenes_sequence` already loads a Scene, makes a bounded
  call and saves it before proceeding. It is the execution foundation to reuse.
- Existing automated tests cover many schema, routing and persistence cases.
  They do not establish real-model first-pass reliability.

## Safe implementation sequence

### 1. Write one Scene reliably

Align the supported Scene fields and their validation/save handling first. Cover
creation, revision and requested title/duration changes without requiring Intent.
Reuse existing per-Scene authoring and persistence behavior. Preserve the separate
Revise & Generate utility and its optional production handoff; do not introduce
automatic Take generation into Director writes.

Prove creation and revision end to end: correct target, required context, complete
output, requested title/duration preserved through saving, accurate outcome and
basic field recovery. Establish the consistent Scene result used by each entry
point before extending it to a list.

### 2. Repeat that Scene write over a selected list

Use the same single-Scene behavior for each selected item, applying each success.
Add per-item failure reporting/continuation and retain existing Stop. Stop
the list for a common dependency failure rather than repeating a predictable
failure. Include shared continuity constraints or prior saved Scene results
where needed; simple corrections do not need the full conversation. This is
Write Scene(s), not another LLM capability or alternate batch authoring system.
Do not add a generic orchestrator or routine retries.

### 3. Finish Project writing, automatic context and the conversation handoff

Align new/existing Project writes around the agreed Project fields. Requested
initial Scenes use the Scene calls. Mixed Project/Scene intentions use those same
operations, with the Project saved first and partial Scene results reported,
not an all-at-once authoring schema. Prune stale model guidance,
readiness/capture requirements and duplicate active paths. Preserve compatibility
data and working unrelated editor/production functionality.

WebCap resolves destinations and supplies required baselines/constraints. Give the
model the narrow authoring task, not UI state management. Eliminate redundant
explicit Read/acknowledgement handoffs for authorized questions and revisions.
Use the targeted launch action for conversational write requests; retain direct
launch shortcuts. Reuse already authored complete material rather than drafting it
again. Replace competing active schemas/dispatch paths as their consumers migrate.

Retain authored results through follow-up questions. Reflect actual saved values
in conversation and distinguish subsequent reporting failures. Provide the basic
per-field recovery controls. Keep status legible and contextual; do not add
assessment dashboards or permanent explanatory paragraphs.
Outcomes and recovery are part of each phase's acceptance, not a final polish pass.

## Ownership and stable handoffs

- **Implementation owner (ChatGPT):** owns product code, guidance/schema alignment,
  focused regression checks and fixes. Complete one bounded phase and hand over a
  stable commit. Passing automated checks is not browser/model acceptance.
- **Acceptance owner (Codex/browser agent):** tests the handed-over commit with the
  real browser and selected model. Report concrete reproductions, expected/actual
  behavior, saved effects and evidence. Do not edit product code concurrently;
  the implementation owner fixes findings unless ownership is explicitly handed over.
- **Author:** resolves material product-scope or control decisions. Ordinary
  implementation choices and hypothetical edge cases are not escalated routinely.

Do not test against a tree being edited or an unresolved merge. Each handoff names
the commit, changed behavior, checks run, known limitations and cases to verify.
The running app must serve that code, with backend changes loaded and the intended
model available. The acceptance report identifies the same commit/model and
separates real-browser/model evidence from automated coverage. Fix and recheck
failures within the phase before expanding scope.

## Small acceptance set

Use focused automated checks for deterministic behavior, followed by simple real
browser/model flows. Record model, exact task, context scope, number of authoring
calls, returned material, bound targets, saved values and actual failures. No Takes
are needed for Director acceptance. Restore test edits or use disposable data.

1. Ask a saved Scene question: context is supplied, answer is grounded, nothing saves.
2. Discuss a Project and launch its write: complete agreed fields, usable destination,
   unrelated fields and existing Scenes preserved. For a new Project with initial
   Scenes, verify accurate partial completion if a later Scene fails.
3. Request a new Scene with a non-default duration: correct creation target, full
   prompt, title and matching saved duration; existing Scenes preserved. Verify
   the selected duration is valid and editable in both Director and Storyboard.
4. Make a simple correction to one Scene: short per-Scene context, complete minimally
   revised prompt, correct save; no second extraction/drafting call. Inspect
   whether existing actions/dialogue actually survived the rewrite.
5. Request title/duration changes alongside a prompt: all requested values survive;
   unrelated fields do not change.
6. Apply one instruction to a selected Scene list: one bounded call per Scene,
   incremental saves and progress, no full conversation required for a simple tweak.
7. Simulate an isolated item failure: that Scene fails visibly, subsequent items
   still run, successful items remain saved, final counts are honest. Also test
   a shared model/runtime failure: remaining items do not run. Stop still stops.
8. Ask a question about an authored result: the same result remains actionable.
9. Save successfully, then simulate refresh/receipt failure: report the saved outcome
   accurately rather than inviting a duplicate write.
10. Recover recent field values through previous/next. Legacy Intent data survives
    ordinary saves without entering the active authoring contract.

Passing this small set is a release gate for the core journeys, not statistical
proof of 99% reliability. Expand testing only for demonstrated failures or changes.

## Three-operation replacement cutover (2026-11-14)

This section supersedes the incremental-routing instructions above. Keep the functional contract authoritative; do not perpetuate a separate Director architecture to accommodate historical states. This is a cutover, not an optional parallel Director implementation.

### Ownership and one execution path

- **Read:** WebCap loads fresh saved Project/Scene context from its selected or explicitly named target, sends the user's question and relevant saved fields, and displays the model's answer verbatim. A plain-text answer is valid. No readiness response, permission ceremony, explicit acknowledgment call, review, or mutation.
- **Write Project:** WebCap binds an existing Project or an explicit new-Project destination before writing. The model returns complete authored values for requested title, Concept, Visual/atmosphere, and Invariants. Preserve all unaffected fields and existing Scenes. The same Project writer serves creation and revision; review is useful for Project creation or broad field edits, not a universal gate.
- **Write Scene(s):** WebCap binds the destination Project and the exact existing Scene IDs, or an insertion destination for new Scenes. The model sees the existing prompt for revisions, the requested change, current duration, and pertinent Project constraints; it returns complete prompt/title/requested duration values. The same Scene writer serves new/existing and one/many; repeat a bounded call per Scene. Save successful Scenes incrementally, show exact outcomes, and stop remaining items only for cancellation or a genuine shared dependency error.

The model may suggest a **kind of next operation and a concise creative instruction** in the conversation. That suggestion is not an authorization or a target binding. Only WebCap resolves and validates actual IDs against its saved Project and Scene list. Explicit, verifiable user references take precedence over an incidental editor selection. A real ambiguity produces one visible 'Unclear target: select Project and Scene(s)' action; never invent IDs or silently target a different Scene. A launch freezes the bound IDs, instruction, and write policy before the asynchronous model call.

Ordinary chat and Read accept prose. A small optional action suggestion may accompany a conversational reply, but absence, invalidity, or failure to parse an optional action cannot invalidate a useful answer. Structured creative output is required only for fields being authored. Invariant entries have their existing saved identity shape; avoid a second readiness/capture schema. A complete usable draft already supplied in conversation is retained as an actionable result without an extraction/repair call. Do not silently substitute a default duration when a different duration was explicitly requested; keep the useful prompt and request the specific missing value instead.

### Phased cutover and deletions

1. **Replace Read and conversation handoff:** remove model-generated readiness/checks/capture as the conversation gate; accept direct replies; retain chat persistence, I/O diagnostics, model selection, and Stop. Verify Read against a real Project and real model.
2. **Replace authoring routing:** one Project writer and one per-Scene writer exposed through simple user-triggered actions. Bind targets in WebCap; reuse the existing Project/Scene mutation routes and accurate receipts. Verify new Project, revision, new Scene with nondefault duration, and one Scene correction before proceeding.
3. **Repeat and simplify:** multiple Scenes use the single-Scene writer sequentially. Isolated failures continue; shared failures/Stop halt the rest. Verify saved/failed/not-attempted counts and preserve already saved results. Eliminate redundant Director-only draft/review paths after the last active caller moves.
4. **Cut over and delete:** remove Advanced Read permission/ack paths, readiness/assessment UI and model schema, duplicate Scene creation/extraction, unused timed-shot Workshop/Guidelines entry points, orphaned reviews and dead test fixtures. Retain independent Revise & Generate and Check Coherence tools; remove only their overlapping ordinary Scene-revision entry. Old chat data and dormant Scene Intent remain readable but never determine execution.
5. **Acceptance and merge:** inspect code on the stable branch, run focused JS/Python tests and verify every operation in a real browser against the selected real LLM; distinguish automated coverage from browser acceptance. Merge only after the replacement paths are verified. Keep main unchanged until that point. No new generic dispatcher, retries, creative quality gates, or model calls for action parsing.

**Concrete release criteria:** Read works in one model call and never saves; Project writes hit the selected Project and preserve unrelated fields; Scene create/revise writes save correct title/prompt/duration and preserve unrelated Scenes; ambiguous targets request selection; partial successes survive and receipts remain accurate; conversation follow-ups retain useful material; Undo/Redo and independent Studio utilities are unaffected. Inspect actual saved data for each acceptance, not just button or status behavior.


## Efficiency audit: finish the three operations, not another Director subsystem (2026-11-14)

**Decision:** WebCap, not the LLM's conversation history, owns the structured state of work. Treat conversation as short creative context, not as a database or a request to reconstruct earlier outputs. This section refines the three-operation cutover above; it does not add a fourth operation or another orchestration framework.

**One small working draft per Studio conversation, separate from saved Project/Scene records.** It contains only complete replacement values actually authored, separated into Project fields and Scene fields, associated with WebCap-resolved target IDs where known. A new-Scene draft can remain unbound until the author chooses a destination. Each useful structured response updates only its supplied fields. Unmentioned fields are retained; a malformed *optional* value does not erase valid fields. The selected target, revision baseline and actual save remain controlled by WebCap. Drafts must survive ordinary follow-up questions and session restore. They are not silently saved. Never infer a complete Prompt by scraping prose, and never ask a second LLM to recover already structured material.

**Read:** supply one fresh, relevant saved snapshot for the selected or explicitly referenced Project/Scene and only useful short conversational decisions. Return plain prose or a structured response with optional draft field changes. No mandatory readiness/capture, separate permission ceremony, model acknowledgment or draft-to-save transition. Historical chat and large receipts are not automatically model context.

**Write Project:** resolve destination, take existing saved fields and any corresponding complete working-draft fields, author requested replacements only, merge them without touching unrelated values, review if useful and save using existing conflict-aware Project routes. New Project + Scenes means Project save followed by the *same* one-Scene writer repeated, with honest partial results.

**Write Scene(s):** freeze the real Project/Scene targets when launched. One current Scene Prompt and necessary Project/continuity constraints per write, not the full conversation each time. Request only changed fields; a modified Prompt is still the complete replacement Prompt. Use the same writer for creation, revision and each selected Scene. Preserve explicit author duration and original title/duration unless changed. Save successful Scenes individually and preserve results on later errors. A literal title change can use the existing field save directly. Reuse complete, structured, already-authored material instead of drafting it again.

**Remove resource waste rather than adding caching/orchestration:** avoid resending whole conversations, copies of saved values in chat receipts, redundant Read/context probes, repeated guidance or Project-list fetches within a single launch, duplicate readiness and recommendation evaluation, and multiple competing Scene authoring schemas. Keep request assembly small and deterministic; prefer a fresh bounded fetch to a new cache invalidation system. Project guidance is supplied where relevant, full H3 production guidance only for Prompt authoring. Detailed raw input/output remains accessible on demand through diagnostics, not repeated in model context or always-visible panels.

**Honest operation boundaries:** a proposed action is only a launch affordance. Missing optional suggestion metadata must not invalidate Read. An unknown destination asks for one selection; it must not quietly switch the saved destination or ask the model for IDs. Progress, cancellation, conflict checks, session-only recovery, and truthful post-save receipts remain WebCap responsibilities. A save succeeding before a refresh/receipt failure is reported as saved; an unchanged result is not counted as saved.

### Prove the simplified flow

- **Read:** grounded Project and Scene answers with no mutation, no acknowledgment-only call, and no growing receipt/history payload.
- **Working material:** receive a structured Project or Scene replacement, follow up with a change to one field, retain the rest, reload the conversation, then apply the same complete values without regeneration.
- **Project:** create or revise requested fields, preserve untouched Project fields and Scenes; new Project plus Scenes retains successful portions.
- **Scenes:** create one, create several, revise one, revise several, preserve exact duration/title and the selected target. Verify one bounded authoring call per Scene when content isn't already available.
- **Failure/recovery:** ambiguous target selection, isolated failure followed by further work, cancellation, unchanged result, conflict handling, successful save with later refresh/receipt failure, Undo/Redo.

**Priority order:** first persistent structured working state and the Read/write handoff; next the minimal scoped request context and singular writer paths; finally delete displaced UI/schema helpers and obsolete tests. Do not build generalized patch engines, state machines, model classification calls, or speculative blockers. Real-model browser acceptance is still required before calling this finished.


## Three-operation efficiency audit and targeted fixes (2026-11-14)

Reviewed the actual Read, Project Write, Scene Write and Project-with-initial-Scenes execution paths against the authoritative three-operation contract. These are **reductions to the existing paths**, not a new controller or proposal system:

- **Conversation payloads:** send the latest user instruction intact, bounded recent discussion only, and the relevant fresh saved fields plus separately retained unsaved working fields. Omit saved-field receipts and full authored Scene prompt echoes from future model context. The complete writer output remains in the structured working draft and I/O diagnostics, not as an invented conversational turn.
- **Reusing model work:** completed Project and Scene writer outputs enter the conversation's durable, structured working draft before review/save. Later writes reuse matching complete fields without an extraction call. An explicit `save/apply that draft` is not confused with `use brighter lighting`, which is new work. Manual Project review can reuse durable fields after reopening a conversation.
- **One active Scene result contract:** new Scene, revised Scene and initial Scenes created alongside a new Project each ask for the same single Scene field JSON object (`prompt`, optional `title` and `durationSeconds`). The Project's initial-Scene save loop remains incremental; legacy multi-Scene/Workshop helpers are not replaced until last-caller verification.
- **Saved-baseline ownership:** the model receives unsaved working fields for creative continuity, while WebCap fetches the actual saved Scene/Project for binding, optimistic concurrency and save. Worded durations such as “twelve seconds” are interpreted by WebCap, not left to fallible optional metadata.
- **Correctness beats cosmetic request savings:** author-supplied saved Project names must resolve even without the word “Project”. Keep the lightweight current Project-list lookup rather than heuristically skipping it and risking edits to an unrelated selected Project. Avoid caches, permission gates, repair-model calls and speculative strict output rejection.
- **Remaining limitations:** real-browser/model acceptance is still required; inactive historical Read/Workshop/sequence and review code remains subject to caller verification before removal. Do not merge solely because mocked/model-free CI passes.

Additional focused regressions cover bounded context, literal Project-name targeting, draft reuse versus creative instructions, one-Scene schemas across entry points, durable draft follow-ups, written-out duration, saved-field receipts and partial Scene successes.
