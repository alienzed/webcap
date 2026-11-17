# Studio Director — Chat and explicit Write contract

**Status:** Normative design for Studio Director. Updated November 17, 2026.
This document replaces the earlier combined conversation/authoring strategy in full.
Use it alongside `AGENTS.md`; an older design document, test or historical
transcript does not override this contract.

## Purpose

Studio Director is a creative collaborator and a focused author. The two tasks
are **separate LLM operations**, not separate personalities inferred from prose.
Reliability comes from the author deliberately choosing the operation, and WebCap
supplying only the instructions and response format for that operation.

### Normal path

1. **Chat:** User and Director discuss creative ideas naturally. The model returns
   ordinary text. Chat never produces, requests, extracts, or applies structured
   Project/Scene field values, actions, write hints or readiness metadata.
2. **Write:** The author chooses an explicit operation and destination in WebCap
   (Create Project, revise Overview, create Scene(s), revise selected Scene(s)).
   WebCap gives the model the full conversation, relevant *explicitly authorized*
   saved source fields, an exact operation-specific creative task and response
   schema. The model returns authored material, not conversational commentary.
3. **Apply:** WebCap consumes the structured result in the same operation that
   requested it. It maps *received* field values to the explicitly selected
   target, saves valid independently usable work through existing persistence,
   updates the editor and field history, and reports actual partial or full saves.
   No intermediate Review/Apply ceremony is required for new writes.
4. **Continue:** New Chat turns see the actual conversation, including the
   Director's earlier *chat* replies; structured authoring payloads are not
   written back as chat text. The saved Project/Scene is authoritative and
   available to subsequent writes via their explicitly chosen targets.

**The ordinary Chat response is never a Write trigger.** There is no intent
classification, prose parsing for commands or destinations, model-suggested
action object, readiness scoring, automatic authoring, or second assessment call.

## Requests and guidance

**Chat:** A short creative-conversation system primer, the complete chronological
user/assistant exchange and any author-approved saved Read references. Natural
text output only. Do not include H3 production templates, field definitions,
JSON response schemas, multi-role instructions, hidden action contracts,
unrequested project navigation, or backend write metadata.

**Write:** Operation-specific creative guidance, precisely scoped requested field
names and required output fields, the **same full chronological chat exchange**
(as distinct `user`/`assistant` messages), and one final targeted writing
instruction with its explicit saved baseline/constraints. Do not duplicate the
conversation inside an embedded `discussion` JSON property, and do not send
unrelated saved projects or UI state. H3 production guidance appears only for
operations writing H3 prompts, not title-only or Overview changes. Existing
successful First Cut, Develop Scenes and Enhance Prompt prompt expertise must
not be diluted in this refactor.

**Context:** No arbitrary last-eight cap, character clipping, hidden summaries
or automatic compaction. Expose actual provider/context-limit failures.
Model-specific context measurement and compaction are later work, not a reason
to silently drop history now.

**Independent identities:** Visible Project/Scene navigation, deliberate
conversation attachment, explicitly approved saved Read references, and the
current Write destination are distinct. None silently changes another.
An explicit Write authorizes reading *its own selected saved baseline* for
revision; it does not authorize reading arbitrary projects. A model never
chooses IDs, a save target or a write operation by its wording.

## One contract per operation

- **Chat:** No structured response schema; plain text, one displayed answer.
- **Create Project:** Author requested Project title, Concept, Visual /
  atmosphere and useful Invariants. A response may include initial Scene briefs;
  these are separately processed only when complete. Absent optional initial
  material must not invalidate a useful Project.
- **Revise Overview:** Require only specifically selected Project fields;
  return complete replacements for them. Never insist on rewriting unrelated
  fields because an optional schema property happens to exist.
- **Create Scene(s):** Ask for full generatable prompt, useful title and supported
  duration for each authored Scene. Accept the **actual number of complete
  returned records**, including more or fewer than requested; report shortfalls
  honestly. Each saved Scene remains independently useful if another fails.
- **Revise Scene(s):** Require only selected fields. Title-only/duration-only
  changes must not require a new prompt. Prompt revisions should preserve
  unaffected creative decisions, but WebCap must not implement story-specific
  semantic validators or replace model creative judgment with brittle heuristics.
  Each selected Scene has its own deterministic target and save result.

Schema-required fields should match the operation's real expectations. Use a
small, purposeful schema without redundant optional properties or boilerplate
`rationale` requirements merely for compatibility. Structure is a transport
contract, **not** a proof that requested creative content is semantically
correct, nor a license to throw away useful partial material.

Parse **structured output as structured output**, not conversation prose.
Keep actual received fields/records even if a different requested field is
missing or invalid. Apply valid independent pieces; expose incomplete pieces
through the operation's own editable/error surface and I/O diagnostics,
without inventing default creative values, silently coercing semantic content,
repairing via regex or making an automatic second LLM call. Only the actual
persistence response proves a save. A model's textual claim does not.

Every interface action has exactly one traceable route:
**UI selection → task instruction → request contract → model response
→ operation-owned parser → typed field mapping → authoritative save
→ editor/history and truthful receipt.** The route must be the same for
direct shortcuts and the Write panel where they represent the same task.

## Interface, lifecycle and cleanup

New Write results go to editable fields via existing persistence and undo/redo
history; they do **not** wait for a new Review modal or conversational proposal.
Existing chat text remains readable. Old stored structured messages may be
shown as inert archive content, but cannot launch hidden legacy write actions.
Preserve existing saved Project/Scene data and old conversation files; no data
migration or deletion is authorized.

Remove **dead execution paths**, including combined Chat response parsers,
conversational Write suggestions, model action metadata, readiness processing,
legacy review-only controllers and duplicated authoring routes, once their
actual callers and compatibility requirements are traced. Do not keep two
competing active architectures under a permanent feature flag. Compatibility
for reading old stored data should be localized and inert, not a second system.

Keep plain classic JavaScript, Python backend and file-based storage. Do not
introduce orchestration layers, a new agent, speculative retries, automatic
compaction, blanket validators, creative grading, or extra model calls.

## Tests and acceptance

Update deterministic unit tests and Playwright tests together with the code.
Retire *obsolete assumptions*, not entire useful test suites. Exercise the
complete Chat → Write Project → Chat → Write Scene → revise title, prompt and
duration path with mock and real providers. Inspect exact outgoing messages
and schemas for all operations; verify conversation roles, complete history,
no production reference in Chat, focused H3 reference only where needed,
unrelated saved-field isolation, target binding and actual persisted edits.

Test partial Project/Scene output, mixed complete and incomplete Scenes,
returned extra Scenes, unchanged revisions, invalid duration, failed writes,
post-save reporting failures, changing navigation, explicit Read approval and
restoring old conversations. Confirm field history recovers direct changes.
Playwright must exercise actual visible controls and saved results—not only
assert that DOM elements exist. Separate deterministic correctness from
real-model semantic observations and do not claim runtime verification without
running it.

The feature branch is not ready to merge while these checks fail or are unrun.
Rollback via Git must remain possible without corrupting saved data.
