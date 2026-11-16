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
Review can be useful, but is not compulsory for every write. The launch action
must make clear whether the result will save directly or await review. Either
policy asks the LLM for the same complete material.

Model output is best-effort creative material, not authoritative application state. Preserve useful prose, independently valid fields, completed Scene results, and editable drafts when optional action hints or metadata are malformed. A malformed or unsupported operation-specific value can prevent that particular save or execution, but should not discard unrelated useful work. Prefer author edits, retry and existing recovery over model repair calls or extra readiness gates.

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
**Unsaved authored material belongs to the conversation/session, not a saved
Project or Scene.** Each response's actual authored fields remain independently
reopenable, editable and applicable, including after changing navigation. A
source/provenance reference and a suggested destination are metadata about that
material, not an irreversible attachment or permission to save. Projects own
material only after authoritative persistence.

### Read and context

Saved Project and Scene context is proposed from the current Studio selection, but
is supplied only after the author approves it through the existing Context (Read)
sidebar. The sidebar shows the Project and selected Overview/Scenes, with an
optional full preview. An approval is a local selection, not an LLM request or an
acknowledgement-only exchange. Later conversation turns refresh exactly the
approved saved fields without another confirmation; a new conversation or reload
starts without an approved scope. Write destinations are independent of Read
approval and never grant access to saved creative fields. Context can contain
approved excerpts from **multiple Projects simultaneously**, including a Scene
from an unrelated Project as a template for pacing, a character or staging.
Maintain provenance for each selected item; the current Studio Project may be
a convenient suggested source, never an automatic permission. The author may
change, revoke or inspect approved selections without changing the conversation
or its unsaved material. Do not require one global Project to own all Read items.
An explicitly launched, target-specific Project or Scene writer may read the
saved fields of that exact target as necessary to execute the selected operation;
that direct author action authorizes its known source. Opening or selecting a
Project alone, or mentioning it in ordinary chat, never does. Unrelated
reference Projects still require explicit Read approval.

A Scene correction such as "make it night" normally needs the current prompt,
duration, instruction and applicable Project/continuity constraints, not the
whole conversation or unrelated Project fields. Include prior agreed decisions
when they actually affect the requested edit. New Scene authoring can need
agreed Project direction; Project-wide questions can need broader saved material.
Supply what serves the task, without defaulting to everything. Identify the
supplied scope and do not claim to have read missing material.

Treat approved Read items as source references, not write targets. A saved Scene
from Project B can inform a new Scene destined for Project A or an entirely new
Project; transferring the creative idea does not transfer Project B's identity.
Use fresh saved values where current state matters. If current saved material
contradicts an older conversational assumption, do not silently draft against
the stale copy. Ordinary questions and brainstorming do not change saved records
or discard an available authored result.

### Write Project

Create or update the requested Project fields. Preserve unrelated values. Complete
field values must be returned, rather than promises or instructions for a later
draft. The author can review the small Project Overview where useful.

When the author requests a new Project with initial Scenes, save the Project
before writing its Scenes. Use the same Scene capability for each; a shared
direction or short per-Scene brief is request input, not a stored Intent layer.
Do not require all full Scene prompts in the Project-writing response. If a
later Scene fails, retain the created Project and successfully saved Scenes and
report what remains unfinished. The combined request is not atomic.

A Project field edit does not implicitly rewrite existing Scene prompts. For
requested Project-and-Scene changes, perform the Project write first, then the
Scene calls against the resulting saved Project. Report partial completion
honestly; phase 1 needs neither a giant combined review nor a compound LLM
capability.

### Write Scene(s)

A selection of Scenes is a finite call list for this same capability. Use one
bounded authoring call per Scene, reusing the stable revision-sequence pattern
where it fits. Carry the common instruction and only relevant context for each
Scene; connected Scenes may need shared constraints or prior saved results to
maintain continuity. Do not attach the full conversation to every call or add a
planning call when the instruction already suffices.

- New Scenes receive full usable H3 prompts, useful titles and requested durations,
  or the existing WebCap default when no duration was specified.
- Preserve unrelated saved fields deterministically. For full-prompt revisions,
  instruct the model to retain unaffected details, but do not treat schema
  validity as proof of semantic preservation. Keep the result inspectable and
  recoverable. Existing titles and durations remain unchanged unless requested.
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

Ordinary Director chat does not save. When the author requests creative
material, the model returns the actual complete requested fields in that same
response. WebCap offers Review/Apply because fields were received, not because
it parsed the author's prose, trusted a model action hint, or promised another
authoring call. The author may first develop material, pivot to a new Project
mid-conversation, or choose a different Project when applying it. No new model
call is required solely to decide or change the destination.

### Conversation material, provenance and destination

The conversation/session owns unsaved Project and Scene drafts, including
multiple alternatives across responses. Provenance records which approved saved
reference(s), if any, influenced a draft; it is not a required Project link.
The current Project/Scene, last explicitly selected destination and source
provenance can suggest a destination without imposing it. Reuse the existing
Project and Scene review forms to show the suggested target, allow correction
and then confirm Apply. **A selected Project, approved Read source, or model
claim never independently authorizes a write.** If a target is deterministically
known from an explicitly launched operation, the normal advertised direct-save
path remains available; otherwise use the existing Review/Apply confirmation.
Do not invent a confidence score, prose classifier, or extra generic agent layer.

A revision of existing saved fields requires the actual approved source
material for authorship; an unsaved draft can instead be authored without any
Project selection. Moving a draft between new-Project creation, an existing
Project revision and Scene insertion must retain its material while using the
appropriate existing save route. Project and Scene IDs are selected and
validated by WebCap at Apply, not issued by the model. Destination selection
must not alter an already launched in-flight operation's frozen target.

### Request and response schemas

For explicitly selected authoring operations, request complete fields through
an operation-specific schema with those requested fields required: a new
Project's title, Concept, Visual / atmosphere and Invariants; the particular
fields of an existing Project revision; new Scene records with title, duration
and full H3 Prompt; and existing Scene replacements with full Prompt when
creative content changes, plus requested title/duration changes. A conversation
may freely mix discussion and structured material, but a schema that allows
only an action promise or prose is not an adequate authoring contract. WebCap
must not require unrelated fields merely to revise one field. Keep every
independently useful returned field/record when a model nevertheless returns
incomplete material, and expose the unmet request without erasing partial work.

Once launched, Scene writes normally save each successful result as it finishes.
Make that direct-save behavior visible before launch and report each actual save.
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
list is not an all-or-nothing transaction: apply successes as they finish and
continue after isolated, item-specific failures. Stop remaining work when a
shared dependency makes further attempts invalid (for example, a missing
Project, unavailable model/runtime, or cancellation). Report saved, failed and
not-attempted targets accurately. Cancellation does not undo earlier saves or
guarantee interruption of an already-running call. Do not build general
retry/resume machinery as a prerequisite.

WebCap preserves unrelated fields, uses existing conflict/persistence safeguards,
and distinguishes a failed save from a later refresh or conversation-receipt failure.
Navigation must not change an already launched operation's targets.

Recovery is bounded, session-only previous/next history for fields actually
edited, including manual and Director changes. Reuse existing editor/history
mechanics where possible; do not silently overwrite newer conflicting edits.
History clears on reload. This is WebCap functionality, not another model task,
durable archive, or compulsory diff/review workflow.

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

The desired 99% first-pass reliability is an empirical quality target, not a
phase-1 statistical release claim. Test deterministic correctness (targets,
fields and saves) separately from model-dependent creative adherence with the
selected real model. A small acceptance suite finds regressions but cannot
establish a percentage. Clear bounded requests should work without repair
rounds; clarify consequential ambiguity without pestering the author.

Reuse the current classic-script architecture, routes, persistence and stable Scene
revision machinery. Consolidation means consistent behavior and contracts, not a
new generic agent framework or a requirement to rename every internal function.
