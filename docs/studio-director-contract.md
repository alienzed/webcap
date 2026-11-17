# Studio Director — normative Chat and Write contract

**Authoritative strategy, November 17, 2026.** Applies with `AGENTS.md`.
Older Studio design documents and historic tests are evidence only, not competing contracts.

## The complete flow

**Chat → explicit Write → LLM response → target fields → History.**

**Chat** is a natural creative conversation. Send all user and Director turns in
chronological order, no fixed cap, clipping, summarization or compaction. The
model returns prose. Chat does not author fields, recommend WebCap actions, claim
saves, parse user prose as commands, or return a combined `reply/changes` schema.

**Write** is a user-selected interface operation. Choose Create Project, Revise
Overview, Create Scene(s), or Revise Scene(s). Each operation sends one clear,
focused writing request with the complete actual conversation, relevant saved
baseline and the correct production reference, plus its operation-specific
structured response format. Do not repeat the conversation inside a JSON field,
supply redundant schemas, send workflow instructions to the model, or append
model-discovered actions. The LLM is entrusted with the creative work. Follow
proven narrow-generation patterns from First Cut, Develop Scenes and Enhance
Prompt; retain their quality, independence and guidance.

**Apply** is deterministic: the operation that requested the response maps
received structured values to the intended fields. WebCap does not judge
creativity, inspect prose for meaning, score compliance, invent fallback content,
run automatic repairs or reject a response on speculative semantic grounds.
WebCap must remain a **dumb waiter**, not a gate or a judge. Its obligations are
correct request routing, output structure handling, deterministic targeting,
persistence and honest operational errors. Fail loudly on genuine API, provider,
transport, unsupported field type, missing target or save errors, not subjective
quality complaints. A malformed response is diagnostic evidence for debugging
request/guidance/schema; preserve it fully in I/O. Do not silently drop an
otherwise available response or preemptively create a new review procedure.

**History** provides backward/forward recovery of successful field writes,
including manual and Director edits. Direct writes update the editor via its
existing field-history mechanism. **Review is removed**, not preserved as an
alternative for new operations. History is the recovery workflow, not a
validation gate. If History fails, fix History rather than reintroducing Review.

**I/O** exposes complete copyable sent messages and raw provider responses,
including unsuccessful requests and responses that could not be applied.
Do not erase an LLM response because saving it failed, and do not misreport
application failure as a creative failure. No speculative draft storage or
parallel chat/field deliverables: Chat delivers prose, Write delivers fields.

## Boundaries and focused payloads

WebCap decides the operation, destination, field names, selected Scene IDs,
save order and authoritative saved values. The model never chooses IDs, actions
or destinations by prose. Navigation, deliberate conversation attachment,
explicitly approved Read sources, and current Write destination remain distinct.
An explicit Write may read its selected target's current saved baseline;
arbitrary unrelated saved Projects do not become implicit context.

Chat receives its concise creative primer and the full real conversation.
An approved Read source is included only if explicitly selected. Chat does not
receive H3 production templates, field schemas or Write controls.

Write receives the same chronological conversation, a *single* operation-local
task payload, exact requested fields, saved baseline/continuity material needed
for that task, and only relevant authoring guidance. Include H3 reference for
writing H3 prompts, not title-only/Overview operations. Preserve prompt-specific
templates and real model guidance; avoid prohibitions, duplicate instructions,
irrelevant optional schema properties, explanatory rationales as mandatory fields,
or model-facing WebCap implementation jargon.

Write schemas should describe expected output positively and require the actual
requested fields, as the app's proven authoring operations do. A schema is a
transport agreement, not a semantic quality verdict. Map real returned fields
rather than judging whether an LLM's creative choice was sufficiently good.
New Scene writes should handle the actual records returned, not assume the
requested count is proof. Actual save responses determine success; report
unsaved records and technical errors truthfully.

No last-eight history cap. Do not predict model-specific context limits or
introduce automatic compaction now. A provider context error is visible in I/O
and Console; compaction can be designed later using observed behavior.

## Remove the old system

Delete runtime paths for conversational structured authoring, LLM-generated
write actions/readiness, Review/Apply modals and controllers, alternate authoring
pipelines, retained draft orchestration and speculative validation/repair.
Do not leave hidden live pathways or feature flags. Old saved conversations
and Projects must still open without executing legacy authoring actions;
archive-read compatibility may be a small inert rendering adapter, not a
second executable architecture. Historic data need not be migrated, modified
or destroyed.

## Acceptance and evidence

Tests must exercise real visible actions:
Chat (more than eight turns) → Write Project → Chat → Write Scene →
Revise Scene title/prompt/duration, switching navigation where appropriate,
observing actual fields, History backward/forward and persistence. Confirm
the exact prompt/schema sent for each action, no duplicated context, no
Chat-field interpretation, no H3 formatting prompt in ordinary Chat, no
second Review prompt, correct selective field writes, and full copyable I/O
on an LLM error, malformed response or application failure.

Update Node/Python deterministic contracts and Playwright mock and live flows,
not only source-pattern assertions. Preserve tests of still-supported
functions; remove or replace tests asserting behavior explicitly retired by
this contract. Do not mark tests as passing when they haven't executed.

Do not merge until architecture and checks conform to this contract.
