# Studio Director functional contract

**Authoritative design — 2026-11-17.** Supersedes earlier Director proposals, including conversational captures, Review/Apply, automatic action selection, abbreviated context, and standing production templates. The implementation tracker records actual code and verification status; historical design documents are not additional requirements.

## Vision

Studio Director is an imaginative, capable creative partner. The author can discuss ideas and make creative decisions in one ongoing conversation. The author explicitly invokes **Write → Project** or **Write → Scene(s)** when it is time to commit creative work. WebCap supplies the request and saves the resulting material. It is not a model supervisor or creative judge.

### 1. Ordinary conversation

- Open Studio Director as a normal, continuous conversation. Answer questions, challenge ideas constructively, and make useful recommendations.
- Read is a one-time user action, not an LLM call. The complete snapshot visible in chat is byte-for-byte the user-message content delivered to subsequent LLM requests; a reload preserves it. Chat **does not author application fields, invoke Write, offer structured draft captures, or save**. Any proposed Project or Scene work is discussion until the author clicks an explicit Write function.
- Chat receives only the concise creative-partner role and the complete persisted conversation, including past explicit Read snapshots. It receives **no H3 production reference, no Project/Scene writing schema, no model-facing capability catalog, and no save/review workflow instructions**.
- WebCap does not infer the author's intent from prose to choose a function. No hidden staging, readiness scoring, planning, repair, model action prediction, or permission to write follows from conversation.
- The original model output, including malformed or unexpected responses, and outbound request remain inspectable in I/O. No hidden rewrite, semantic grading, recovery or automatic retry.

### Optional Action Advisor

Unless disabled in Settings → Director, a completed, saved Studio conversation reply may launch an **independent sidecar on Director's selected model** to suggest zero to three next actions. It receives the conversation and known operation context under its own system prompt; its output is ephemeral UI advice, never a chat message, authoring result, saved Project field, or authorization. It may populate existing Read/Write controls only after the author clicks **Prepare**. The existing Read and Write buttons remain the sole execution triggers. Sidecar errors and incomplete suggestions must not interrupt conversation or manual workflows. See [Action Advisor MVP](studio-action-advisor-mvp.md).

### 2. Write functions

**The selected UI action is the operation.** The model receives the complete available conversation in order, including immutable Read messages, followed by that operation's focused task instruction, exact necessary saved material, task-specific guidance and **task-specific response schema**.

| Explicit action | Supplied task context | Expected model material |
| --- | --- | --- |
| Write → Project → Create | Conversation and the author's Write instruction; no unrelated saved Project | Any usable authored Project title, Concept, Visual / atmosphere or Invariants; absent fields stay empty |
| Write → Project → Revise | Conversation, selected saved Project fields and author instruction | Replacement values only for requested Project fields; Invariants are individual additions/updates, never deletion by omission |
| Write → Scene(s) → Create | Conversation, selected Project direction, relevant Scene continuity, author instruction and H3 reference | One or more independently usable complete H3 prompts with titles and durations |
| Write → Scene(s) → Revise | Conversation, exact selected saved Scene prompt(s), relevant continuity, author instruction and H3 reference | Revised full prompts for requested creative changes, and requested title/duration values |

New/existing and one/many are operation parameters, not additional LLM roles or workflows. Multiple selected Scenes can be written in focused per-Scene calls. Preserve independently saved work and report actual results.

**H3-specific guidance is supplied only with Write → Scene(s)** and with standalone specialist functions that explicitly author or analyze H3 prompts. It is not loaded into ordinary chat or Write → Project. No keyword heuristics determine whether the H3 guidance appears.

**Full conversation passthrough** means the entire available stored user/assistant conversation is sent, in order, without last-N slicing, character clipping, summarization, contraction, or curated excerpts. The system role and the targeted task payload are separate additions; they do not replace or shorten conversational messages. If a provider reports a real context limit, expose the actual error to the user. Do not preemptively shorten history.

### 3. Context and ownership

Four concepts remain distinct:

1. **Navigation:** which Project/Scene is open in Studio.
2. **Conversation attachment:** a deliberate working association, useful for labels or suggesting a target; not permission to read its saved content.
3. **Read snapshots:** each explicit Read captures the chosen fields from one Project at that moment, displays the exact snapshot in the conversation, and persists it as an ordinary message. Multiple Reads, including across Projects, accumulate in the same uninterrupted history. A pending Read is owned by the conversation active when the author invoked it: switching conversations before the saved Project fetch completes cancels that Read with a visible error, never writing into the newly selected conversation. Later edits never mutate prior snapshots; only another explicit Read captures new values. No standing approvals, refreshes, context subscriptions, system-message injection or additional model call.
4. **Write destination:** an explicit Project/Scene chosen for that operation. A Write action for a saved target may read its exact current saved baseline; it does not authorize unrelated sources.

Changing navigation, opening a chat, performing a Read or selecting a Write target must not silently change the other identities. Conversation history survives those transitions. WebCap owns IDs, destination resolution and persistence; model output never authorizes a different destination.

### 4. Saving and History

- **There is no Director Review stage.** Explicit Write is the user's save instruction. Save returned fields directly to the frozen selected destination using existing deterministic file-backed operations.
- No extra consent, edit-preview or review gate between a successful explicit Write response and save.
- Save only supported values actually returned within the explicitly selected Project fields; preserve unrelated saved fields. A scoped Revise with one requested field cannot write other fields, even if the model returns them. Invariant suggestions match saved entries by category and title and apply as atomic add/update operations; omissions never delete unrelated entries. Explicit user-authored removals remain separate intentional operations.
- The system's existing field-scoped History/Undo/Redo is the user recovery mechanism. Do not create parallel model-repair or proposal-management systems.
- A title-only literal edit need not invoke a creative model; a creative prompt revision returns the full new prompt.
- Use current authoritative saved values to address actual mechanical write conflicts. Report what saved and what did not; never claim success based on an action hint, a promise, or an unconfirmed receipt.
- Chat and Write operate in the same conversation; neither a new Project nor a saved Scene ends that conversation or silently reattaches it.

### 5. WebCap's deliberately narrow role

WebCap assembles the explicit request, passes the unabridged conversation, parses the task's structured result for deterministic field assignment, commits available values, keeps field History, and exposes actual I/O and errors. It **does not decide whether a model response is artistically good, sufficient, meaningful, or complete**.

If JSON cannot be parsed or cannot be assigned mechanically to the requested fields, display the raw response and actual error. If a provider returns gibberish, display it. Do not add synthetic defaults, recovery prompts, heuristics, extra grading, retries, or speculative gates to compensate for model behavior. A bad request/guidance/schema may be the real fault; diagnose its outbound form rather than assuming the model needs supervision.

Keep only the mechanical requirements necessary to store values in the real data format. Project Create and Revise response schemas have no arbitrary character, count, or completeness limits: Project Create accepts useful non-Concept material; Revise requests only chosen fields and preserves absent fields. Ignore unusable individual entries with a visible explanation while saving independent usable values; keep raw output in I/O. Real persistence failures remain errors. A model response with fewer creative details than the author wanted is not for WebCap to judge. When multiple independent records can be persisted, preserve actual successes and accurately report real per-record failures.

### Visual Direction in Revise Scenes

Visual Direction is an explicit preset in the Storyboard Revise & Generate workflow. It uses the empirically selected complete-visual-exhaustiveness instruction as an actual LLM system message, with the Project overview, visual atmosphere, invariants, H3 prompting guidance, reference mode, and one Scene's details and existing prompt supplied separately as user context.

The operation processes only the selected Scenes, one request per Scene, through the existing Director model selection, queue and GPU coordination. The target picker defaults to all Scenes and supports selecting one or more individual Scenes. It does not receive Director chat history or other Scene prompts. It may make context-grounded creative decisions to complete the intended visuals; its boundary is staying focused on the current Scene rather than adding its own story or unrelated developments.

Successful prompt revisions use the existing Scene prompt persistence and History mechanism. An unchanged result does not rewrite the Scene. Fresh Take generation remains optional and applies only to the selected Scenes. First Cut and the existing standard/continuity/coherence paths remain unchanged.

### 6. Existing specialist tools

Preserve useful standalone Scene development, Revise Scenes, First Cut and optional coherence functions, and their own necessary context and response contracts. They are not implicitly launched by conversation and are not discarded merely because older Director orchestration called them. Retire redundant authoring paths only after tracing the last real caller. Continue loading old Project/Scene data without destructive migrations.

### 7. Verification

Evaluate actual outbound request messages and schemas, raw provider responses, confirmed saved values, History and the browser interaction separately. Tests must cover normal conversation without H3 guidance or implicit writes; explicit Project/Scene writing with full conversation; navigation/attachment/Read/destination independence; exact visible Read payload equals LLM history after reload and source mutation; new and revised Scenes; multi-Scene partial failure; raw JSON/model error visibility; Concept-empty Project creation; unrestricted Project text and Invariant counts; single-field Project Revise with off-scope model output; omitted or invalid Invariants not deleting saved entries; and working standalone specialist tools.

Static and mocked tests do not establish live-model reliability. Do not weaken a failed test simply to align with a new string or accepted output format. A verified defect in request assembly or saving is a WebCap defect; model creativity is not a WebCap gate.

## Related material

- [Studio implementation and acceptance](studio-director-implementation.md) — code status and evidence, not a second feature contract.
- [Studio user flows](studio-user-flows.md) — user journeys; historical Review assertions are superseded by this document.
- [Director behavioral audit](studio-director-behavioral-contract.md) — useful historical failure analysis; previous Review, chat-capture and abbreviated-history instructions are superseded.
- [AGENTS.md](../AGENTS.md) — repository development rules.
