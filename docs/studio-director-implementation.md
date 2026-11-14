# Studio Director — implementation and acceptance

Current code audit: `747a8ce9`, 2026-11-14. Requirements live in
[studio-director-contract.md](studio-director-contract.md). This file records the
implementation work and evidence; it does not add capabilities or override policy.

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
| Existing revision sequence stops on its first item error | `llm_runner.py::revise_scenes_sequence` | Isolate item failures, retain successes, continue the finite list, report exact outcomes. Preserve cancellation. |
| Automatic context is inconsistent | `sendMessage` consumes staged `sceneRead`; other paths still ask for explicit Read | Supply the necessary context for the actual request. Simple corrections do not need whole-conversation payloads. |
| A follow-up message discards proposals/actionability | `sendMessage` clears proposal state and marks readiness stale | Retain usable authored material while answering questions; replace it when the author requests a revision. |
| Direct save reporting can conflate persistence and refresh failure | Workbench `applyScenePrompt` and `openStudioDirectorScene` | Preserve the actual saved outcome if later refresh/receipt work fails. |
| Recovery currently remembers prompt strings only | Storyboard `scenePromptHistory` | Basic per-field previous/next for Director-touched editable values; no LLM involvement or revision archive. |

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
Add per-item failure reporting/continuation and retain existing Stop. Keep each
request bounded; simple corrections do not need the full conversation. This is
Write Scene(s), not another LLM capability or alternate batch authoring system.
Do not add a generic orchestrator or routine retries.

### 3. Finish Project writing, automatic context and the conversation handoff

Align new/existing Project writes around the agreed Project fields. Requested
initial Scenes use the Scene calls. Mixed Project/Scene intentions use those same
operations, not an all-at-once authoring schema. Prune stale model guidance,
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
   unrelated fields and existing Scenes preserved.
3. Request a new Scene with a non-default duration: correct creation target, full
   prompt, title and matching saved duration; existing Scenes preserved.
4. Make a simple correction to one Scene: short per-Scene context, complete minimally
   revised prompt, correct save; no second extraction/drafting call.
5. Request title/duration changes alongside a prompt: all requested values survive;
   unrelated fields do not change.
6. Apply one instruction to a selected Scene list: one bounded call per Scene,
   incremental saves and progress, no full conversation required for a simple tweak.
7. Simulate an item failure: that Scene fails visibly, subsequent items still run,
   successful items remain saved, final counts are honest. Stop still stops.
8. Ask a question about an authored result: the same result remains actionable.
9. Save successfully, then simulate refresh/receipt failure: report the saved outcome
   accurately rather than inviting a duplicate write.
10. Recover recent field values through previous/next. Legacy Intent data survives
    ordinary saves without entering the active authoring contract.

Passing this small set is a release gate for the core journeys, not statistical
proof of 99% reliability. Expand testing only for demonstrated failures or changes.
