# Studio Director functional contract

Agreed with the author on 2026-11-14. This is the authoritative target contract
for active Studio Director behavior. Earlier Director audits and plans are
historical where they conflict with it. This document defines requirements;
it does not claim the current implementation satisfies them.

## Purpose and ownership

Studio Director is a Project workspace for creative discussion and authoring.
It has three operations: **Read**, **Write Project**, and **Write Scene(s)**.
Discussion is ordinary conversational behavior, not another mutation capability.
New/existing, one/many, and revision are parameters, not additional operations.

The LLM understands the creative request and returns complete material. WebCap
resolves real destinations, supplies context, validates results, prepares review
or directly applies as authorized, persists changes, and reports actual outcomes.
The LLM neither saves nor decides the execution policy. The same complete material
is returned whether WebCap will review it or save it directly.

The author establishes creative intent and controls consequential choices. Director
fills routine creative details without pestering the author. It asks a focused
question when ambiguity materially affects the result, including an unresolved
target or conflicting instructions.

## Shared request rules

Every authoring request must establish:

- Operation and create/update scope.
- Real Project/Scene targets, or explicit creation slots, bound by WebCap.
- The author instruction and relevant conversation/agreed decisions.
- Relevant saved baseline and creative constraints.
- Fields allowed to change, including any requested title/duration changes.
- Required complete outputs and applicable clip constraints.

WebCap may use a bounded model suggestion to interpret natural-language intent;
it must resolve and validate targets against actual state. Opening Scene 6 makes
Scene 6 the normal contextual target. Explicit named/numbered targets take
precedence; an explicit new-Scene request must not become an existing-Scene edit.
The LLM must never invent application IDs. Unresolved consequential targeting
requires clarification rather than a guess.

Asking about or revising the current Project/Scene authorizes WebCap to read the
relevant saved material as part of that request. No separate Read confirmation
or acknowledgement-only model call is required. WebCap visibly identifies the
context supplied, and supplies the actual content rather than IDs alone.
Project-wide questions may need the whole Project. Scope is driven by the request,
not by mandatory field picking. Missing context must not be represented as read.

Context and results must retain required information end to end. Unsupported
requests, insufficient context, and runtime limits must be explicit; never silently
truncate, substitute, clamp a requested value, or drop an output.

## Read

**Input:** question or discussion request, relevant conversation, and relevant
saved Project/Scene material where needed.

**Output:** a grounded answer, creative discussion, or a consequential clarification.
Questions receive answers; a factual answer does not need a drafting suggestion.
Read itself does not mutate saved records. The response must distinguish supplied
facts, proposed creative additions, and uncertainty.

## Write Project

**Input:** new/existing scope, agreed creative direction or requested changes,
relevant context, and current Project fields for an update.

**Output:** complete values for the requested Project fields: title, concept,
visual/atmosphere, and/or invariants. Omitted fields remain unchanged. A requested
field contains its full replacement material, not instructions for a later draft.

When requested, creation may also include complete initial Scenes. These use the
same Scene content contract as Write Scene(s). No separate outline-only format,
invented extra Scenes, or alternate Scene-save contract is needed.

## Write Scene(s)

**Input:** new/existing scope, one or multiple bound targets/creation slots,
instructions, relevant Project direction/invariants, current prompts for revisions,
and durations/other applicable clip constraints.

**Output:** a full usable H3 prompt for every Scene being written or revised, with
new titles or requested title changes and the agreed duration carried through.
All required subjects, actions, visual treatment, timing and sound instructions
must be present in the prompt according to the supported H3 authoring contract.
An outline, promise to draft, or list of titles is not a complete Scene output.

- Existing titles and durations remain unchanged unless requested or clearly agreed.
- New Scenes receive useful titles and the requested duration, or the existing
  WebCap default when no duration was specified. Prompt timing must match it.
- Requested title/duration changes are supported parameters; they must not be lost
  because one entry point carries fewer fields than another.
- Relevant established Project facts and unrelated authored material are preserved.
- Multi-Scene outputs cover the complete requested set and retain their bindings.
- A genuine no-change result is explicit, not an empty or incomplete draft labeled
  successful. Unsupported changes are reported rather than silently omitted.

Intent/summary is dormant legacy data. It is not a brief, required input, output,
capture destination, review field, or success criterion. Preserve old values in JSON
without migration, deletion, or copying them into Prompt. Missing/empty legacy
Intent must not prevent any supported active workflow.

## Discussion to execution

1. The author discusses or requests work in Director or uses an existing shortcut.
2. WebCap resolves scope and supplies the relevant context and operation contract.
3. The LLM returns the complete requested material in that call.
4. WebCap validates it and uses that exact material for display, review and saving.
5. WebCap reports the actual saved result, or the specific failure.

Complete material must remain accessible in the conversation and inspection UI.
Review must not trigger another drafting/extraction call for already authored work.
The author must not repeat an instruction or reselect an already resolved target.

Execution policies remain WebCap-owned:

- Conversational authoring prepares an editable review; Apply saves the approved
  material, including author edits made in review.
- The explicit Scene Revise shortcut applies its complete result directly with
  recent-edit recovery. This is an operation policy, not a different LLM authoring
  capability or permission decision delegated to the model.
- Context-only discussion does not save. No path reports a successful save before
  persistence succeeds. A later receipt/refresh failure is distinguished from a
  failed save so the author is not encouraged to repeat a successful mutation.

WebCap preserves unrelated fields and detects conflicting changes at the operation's
appropriate scope. Requested multi-item commits must not silently apply an
incomplete subset. Reuse existing atomic persistence and conflict handling.

## Finite scope and implementation boundaries

Check Coherence and Revise & Generate remain separate utilities. External LLM
buttons may remain outside Director for now. Takes, queueing, media inspection,
undo/redo and ordinary editor mechanics are WebCap features, not more Director
LLM capabilities. No automatic Take generation is added by this contract.

The model should not need readiness assessments, duplicate target identities,
capture variants, or UI bookkeeping to return usable material. WebCap can derive
controls from the operation, bound scope and validated result. Response formats
should be specific to the current request rather than one giant all-purpose schema.

Reuse the existing classic-script architecture, routes and save paths where they
fit. Three operations do not require a generic tool framework or three new backend
services. Retain legacy compatibility without advertising or routing active work
through retired authoring features.

## Acceptance and reliability

First-pass success means: correct operation and target, complete requested output,
requested count/duration/field scope preserved, usable H3 material, coherent visible
next action, and correct save behavior. A normal human approval/review is not a
repair round. Clarifying a consequential unresolved choice before drafting is valid.

Routine manual copying, repeated destination selection, missing-field repair,
invented IDs, or two/three drafting rounds to perform a clear bounded request count
as failures. They are not the expected workflow. Invalid results fail visibly before
mutation; diagnostic detail remains available in WebCap's shared Console and I/O.

The desired 99% first-pass reliability is an acceptance target, not an established
model guarantee. Verify it against the selected real model on representative flows;
schema/unit tests alone cannot establish creative adherence or a success rate.

The acceptance set must cover: grounded Read without mutation; new and existing
Projects; Project creation with requested initial Scenes; new single/multiple
Scenes with non-default durations; targeted and multi-Scene revision; combined
prompt/title/duration requests; exact authored-output reuse; unrelated-data
preservation; legacy Intent compatibility; ambiguity, conflict, malformed output
and runtime-limit failures. Audit the active guidance, schemas, routes, JS dispatch,
review UI and saves against this same set. Product expansion waits until these core
journeys are stable.
