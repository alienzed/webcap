# Studio Director functional contract — phase 1

Agreed with the author on 2026-11-14. This is the authoritative target behavior,
not a claim that the implementation is complete. Use
[studio-director-implementation.md](studio-director-implementation.md) for the
current gaps, implementation sequence and acceptance checks. Older Director plans
are historical wherever they conflict with these two documents.

## 1. Keep two contracts separate

**WebCap ↔ LLM:** provide a bounded task and its necessary material; receive a
complete answer or complete authored field values. Three capabilities suffice:
**Read**, **Write Project**, **Write Scene(s)**.

**WebCap ↔ author:** resolve destinations, offer the appropriate launch action,
run work, display results, save, provide basic recovery, and explain actual failures.
Review can be useful, but is not a compulsory step for every write. Its presence
must not change the material the LLM is asked to return.

The LLM does not manage UI controls, permissions, save policy, real IDs, queues,
readiness scores or recovery. WebCap does not act as a creative-quality judge.
It checks the mechanical requirements needed to execute the operation correctly.
Core authoring uses a consistent field/result structure. Ordinary discussion and
utility briefs can remain prose; WebCap need not mine arbitrary prose for writes.

## 2. The three capabilities

| Capability | Input to the LLM | Output from the LLM |
|---|---|---|
| Read | Question or discussion request, plus relevant supplied material | Grounded answer, creative discussion, a useful brief, or one consequential clarification |
| Write Project | Instruction, relevant agreed direction, and current Project values when revising | Complete values for the Project fields being authored: title, concept, visual/atmosphere and/or invariants |
| Write Scene(s) | Instruction and the current Scene prompt when revising, plus only the constraints/context needed for that task | Complete usable H3 prompt when creating or revising creative content, with a useful new title or requested title/duration changes |

New/existing and one/many are parameters, not more capabilities. WebCap owns source
and destination bindings. The model authors the material it was given and asked
for; it need not know which editor or drawer is open or invent application IDs.

### Read and context

Asking about or revising a Project/Scene authorizes relevant saved context to be
supplied automatically. No redundant Read permission or acknowledgement-only call
is required. WebCap identifies the supplied scope without protocol clutter.

A Scene correction such as "make it night" normally needs the current prompt and
the correction, not the whole conversation or Project Overview. New Scene authoring
can need agreed Project direction. Project-wide discussion can need the Project's
material. Supply that context when it serves the task; do not attach everything
by default. The model must distinguish supplied facts from creative suggestions
and must not claim to have read material that was not supplied.

Use fresh saved values where current state matters. Ordinary questions and
brainstorming do not change saved records or discard an available authored result.

### Write Project

Create or update the requested Project fields. Preserve unrelated values. Complete
field values must be returned, rather than promises or instructions for a later
draft. The author can review the small Project Overview where useful.

When the author requests a new Project with initial Scenes, use the same Scene
writing capability for those Scenes. Do not force all their full prompts into the
Project-writing response. A shared direction or short per-Scene brief is sufficient
input to the Scene calls. There is no stored outline/Intent authoring layer.

A Project field edit does not implicitly rewrite Scene prompts. If the author asks
for both Project and Scene changes, WebCap performs the needed Project work and
Scene calls in a sensible order, using the agreed direction. Phase 1 does not need
a giant combined review or a new compound LLM capability.

### Write Scene(s)

A selection of Scenes is a call list for this same capability. Use one bounded
Scene-authoring call per Scene, following the stable revision-sequence pattern.
A common instruction can be reused across the list. There is no mandatory extra
planning call when the author's instruction already suffices.

- New Scenes receive full usable H3 prompts, useful titles and requested durations,
  or the existing WebCap default when no duration was specified.
- Revisions preserve unrelated authored content. Existing titles and durations
  remain unchanged unless the author requests a change.
- Requested title/duration changes must survive the entire path to saving. Prompt
  timing and the saved duration must agree.
- Title-only changes do not require rewriting the prompt. WebCap can perform a
  literal field change without an unnecessary creative LLM call.
- Use one proposed version per Scene. Alternatives can be discussed; phase 1 does
  not include multiple complete-version management.
- A no-change result is stated honestly. An outline, empty response or promise to
  draft is not a successful creative Scene write.

Intent/summary remains dormant legacy data in JSON. Preserve it without migration,
deletion or copying into Prompt. It is not an active brief, output, validation
requirement or review destination. Old Projects continue to load and save.

## 3. WebCap execution and interaction

Ordinary Director chat does not save. A conversational request to write/revise
produces an appropriate targeted launch action before execution. WebCap establishes
the destination and selected scope; ask the author to choose only when it is not
obvious. New material can be drafted before choosing/creating its destination;
an existing revision requires its actual source material before authoring.

Once launched, Scene writes normally save each successful result as it finishes.
The explicit Scene Revise shortcut is a direct launch of the same capability.
New/existing and one/many should not multiply the model-facing contracts.
WebCap may use review where it genuinely helps the operation; do not add universal
review gates, readiness gates or model approval rituals.

If complete material has already been authored in the conversation, WebCap reuses
it for display, review or saving. It does not ask the LLM to regenerate/extract it
just to make it actionable. If only a brief exists, the launch action performs the
actual authoring. The author should not need to repeat the instruction or resolve
the same destination again.

Each Scene's write is one coherent save of its requested changed fields. A call
list is not an all-or-nothing transaction: apply successes as they finish, continue
after individual failures, and report the actual saved/failed counts and targets.
A failed Scene is not a successful one; failures must be visible and diagnosable.
Cancellation stops remaining work and must not be represented as undoing saves
that already completed. Do not build retry/resume machinery as a prerequisite.

WebCap preserves unrelated fields, uses existing conflict/persistence safeguards,
and distinguishes a failed save from a later refresh or conversation-receipt failure.
Navigation must not change an already launched operation's targets.

Recovery is basic, bounded, in-memory previous/next state per editable field,
including fields changed by Director. It is WebCap functionality, not another
model task, an infinite revision archive, or a compulsory diff/review workflow.

## 4. Scope and limits

Revise & Generate and Check Coherence may remain separate utilities. Director can
produce an ordinary revision brief for them; copy/paste is acceptable for that
handoff. External LLM buttons can remain outside Director. This contract does not
add Take generation, media inspection, queue controls or other model capabilities.

The no-retyping/no-extraction requirement applies to core Project/Scene authoring,
not every useful conversational output. Keep phase 1 to ordinary clear workflows;
unsupported elaborate requests can be stated as such instead of adding exceptions.

Mechanical validation covers real target bindings, required outputs, field types,
supported limits and save integrity. It does not certify creative quality. Runtime
and output failures must be visible; do not silently truncate or drop required
material. Do not add a creative grading call or routine repair loop.

The desired 99% first-pass reliability must be measured against the selected real
model. Tests of JSON shape and save plumbing do not establish that rate. Clear
bounded requests should work without repair rounds; genuine consequential ambiguity
can be clarified. Fill routine creative details without pestering the author.

Reuse the current classic-script architecture, routes, persistence and stable Scene
revision machinery. Consolidation means consistent behavior and contracts, not a
new generic agent framework or a requirement to rename every internal function.
