# Studio Director: expert-led side-panel implementation

Status: implementation sequence. Follow `AGENTS.md`, `docs/filesystem_state_contract.md`, and `docs/gpu_coordination_invariants.md`. This plan updates the design direction of PR #779; verify against current `main` before each phase.

## Product boundary

Studio Director is an expert conversational **interface** to existing WebCap Projects and Scenes, not a second authoring database. Keep existing Story IDs and JSON keys, Scenes, saved prompts, reference settings, Takes, generation queues, and editing ownership. The author controls creative intent and every applied mutation. The LLM is responsible for expert production judgment; WebCap supplies capabilities, structured inputs, validation, and deterministic persistence.

Director is constructively assertive: improve the author's vision rather than repeatedly substitute alternatives. Ask before inventing consequential premise changes, invent routine production details, develop material thoroughly, and advise about H3 feasibility. Visual style, pacing, formula, focus, variation, and dialogue are **assessment concepts**, not reasons to reintroduce deprecated fields.

## UX: conversation plus action rail

The desktop Director layout gives the conversation the wide primary column and a persistent right-hand side panel for **Read…**, **Write…**, contextual status, readiness, and operation feedback. Vertical space is scarce: keep selectors, forms, and receipts out of the top of the chat. The existing `director-chat-layout`, `director-chat-conversation`, and `director-chat-sidebar` are the starting point. At smaller widths, the side panel can collapse or overlay without covering unsent input. Follow AGENTS.md readable type and dominant-heading guidance.

The sidebar has a compact working-target label, two equally discoverable Read/Write actions, a short list of readiness checks, a short action/result status, and expandable details. Read/Write occupy the same rail; their progressive forms open in the rail or a focused review surface when dense editing requires it. Preserve the conversation and its draft during any action or navigation. Remove obsolete controls *from the new Director UI* after replacing their function; do not destroy historical data.

### Read…

No automatic Project/Scene material is injected merely because Studio navigation or chat selection changes. Director may recommend a **default selection** in the Read panel based on the current discussion, but the author sees and approves it. The picker selects a Project and granular fields: Concept, Visual / atmosphere, Invariants, Scene index, and nested per-Scene Intent / Prompt / relevant reference or generation fields. Expand Scenes on demand; do not eagerly load full Takes. Defaults are editable.

On Send, WebCap fetches **the selected saved field values**, identifies the Project/Scene stable IDs and field names, and passes a delimited structured snapshot to the LLM in the actual request. The LLM must itself acknowledge the Project and fields it received in the conversation. A WebCap-only receipt never substitutes for this acknowledgment. Show an explicit error for missing/mismatched acknowledgement; do not silently claim success. For ordinary conversation assume the model retains prior turns' knowledge; do not build perpetual auto-refresh or automatic context injection. State plainly when history compaction reduces that assurance.

Retire confusing `grant access -> model requests a read -> single continuation -> waiting for story` as the primary path. An intentional Read action is an explicit delivery operation, not merely permission. Avoid hidden workshop snapshots resent on every message. Keep historical attachments intact until separately reviewed migration.

### Write…

Director proposes intelligent defaults for the target Project/Scene, operation (create/update/insert), selected actual fields, and complete draft values based on the conversation. Opening Write never applies. The author can change every destination/selection, edit content in the **actual field review**, inspect existing values and proposed replacements, and Apply. Existing Story/Scene store operations remain authoritative; apply scoped edits with fresh-ID and collision checks. Adding initial Scenes to new Projects needs a compound reviewed operation before claiming atomicity. After Apply, the saved edited values become authoritative for subsequent Director work. Show exact success/failure in the rail and global Console.

No new Project outline layers, redundant guideline fields, continuity entry/exit editing or duplicated creative sources. Keep old persisted values readable where existing consumers require them, but remove deprecated authoring UI after verified parity.

### Readiness and expert guidance

A fixed vocabulary of up to ten dimensions with contextual applicability, at Project and Scene level: Concept, Characters (individual entries as needed), Setting, Action, Dialogue, Visual / atmosphere, Visual focus, Structure / formula, Variation / repetition, Production feasibility. Checkmarks mean Director judges a specific proposed piece of material sufficiently developed, **not** saved or mandatory. Each check opens a read-only popover containing the **complete, single-item proposal**, not a Project dump; no editing in the popover. Write opens the editable destination. Assessments may change as the discussion develops and never block Write.

Maintain concise built-in, authoritative WebCap capability facts and task-specific production guidance; retain the existing editable Playbook for reviewed empirical preferences and reusable lessons. Route production guidance consistently through conversational and prompt-authoring requests. Do not create a taxonomy engine or a second AI. Verify representative local-model behavior before trusting any generated checklist or default.

## Codebase-grounded starting points (main, 2026-10-28)

- `tool/tool.html` already contains `director-chat-layout` with conversation and `director-chat-sidebar`. Its `director-studio-flow` rail holds separate Project capture, grant/read controls and Scene starters. **Reuse that DOM ownership and replace its competing entries in stages**.
- `tool/js/director_chat.js` has `startStudioWorkshop()`, an automatic introductory LLM request after new chat; remove that unsolicited inference and allow immediate typing. It has separate `studioProjectProposal`, `studioScenesProposal`, `studioBriefProposal`, `studioSceneProposal` and historical snapshot state: unify interaction without deleting unsaved work.
- `studioDirectorChatRequestMessages` currently advertises `[[WEBCAP_READ:...]]` and `resumeStudioAfterRead` supports exactly one read with a no-more-reads instruction. This is not the desired explicit, acknowledged Read. Keep the operational boundary but replace that UX; test actual outgoing messages.
- `tool/server/studio_director.py` contains a manually maintained ACTIONS list, H3 guidance, and `read_story_scope` for brief/index/scene/prompt/takes. Extend the existing storage-backed read contract rather than modeling a duplicate Project.
- `tool/server/storyboard_llm_contract.py` and the Director context documents own overlapping prompt instructions and legacy entry/exit schema. Audit composed requests end-to-end, not just individual template files.
- `tool/server/storyboard_store.py` owns Project/Scene state; `tool/server/director_chat_history.py` owns conversation history. Keep those responsibilities separated.
- `AGENTS.md` prohibits silent operational failures, arbitrary gating, generic frameworks, and incidental filesystem roots. Preserve GPU queue invariants and unrelated Studio workflows.

## Safe delivery phases

### Phase 1 — Stabilize and make room (small standalone PR)

- Remove unsolicited opening model calls; permit immediate composing.
- Preserve draft, history, queue and failure reporting.
- Review existing rail sizing and Studio-only visibility; avoid relocating general Assistant UI.
- Acceptance: opening/new Studio conversation generates **zero** model work until explicit Send; old conversations still load; empty state does not promise auto questions.

### Phase 2 — Read vertical slice

- Replace legacy grant/inspect ceremony with one explicit selection panel using existing Project listing and scoped read endpoints.
- Show Project and nested Scenes with actual field checkboxes; label every field with its storage target. Fetch only selected values.
- Send an intentionally delimited context payload with the user's request and require an **LLM-authored** acknowledgement of selected field names/IDs; mismatches are visible. Store the delivery event with conversation history and render it legibly.
- Acceptance: a user says “inspect the Project”, chooses Project/fields, sends, and the model acknowledges exactly what it saw and gives a substantive assessment. No automatic context from navigation; no “waiting for story” if delivery succeeded. Reopen conversation with honest history.

### Phase 3 — Write vertical slice

- Single Write entry with target, operation, chosen existing fields, proposal, editable before/after review and explicit Apply.
- Reuse existing scoped updates and Scene insertion; add compound Project+Scenes operation only where the existing backend cannot preserve atomicity.
- After Apply, make final edited content authoritative in subsequent model context; verify Scene prompts and Takes remain untouched by unrelated changes.
- Acceptance: create Project, update Project Concept, insert Scene, edit Scene Intent/prompt, narrow dialogue revision; cancel or failure leaves existing saved material intact. Never apply on opening Write.

### Phase 4 — Expertise and readiness

- Consolidate persona/field maps and task-specific expert guidance. Verify actual composed requests for chat, Read, Write drafting, Develop, prompt revision.
- Introduce bounded task-relevant readiness outputs only after local-model testing. Show single-field full-text popovers in rail, at Project and Scene scopes.
- Use LLM-informed wizard defaults where available, not hardcoded creative conclusions. Uncertain defaults remain editable and visibly uncertain.
- Add reviewed Playbook improvement proposals using the existing settings store.
- Acceptance: delegated character invention; original dialogue draft; precise identity reuse, believable contextual change, substantial first-Scene action; no unnecessary premise replacement or creativity gates.

### Phase 5 — Remove replaced UX and polish

- Remove retired Director buttons/fields and obsolete handlers **only after** Read/Write and regression tests cover their supported operations. Preserve old persisted values without re-exposing deprecated authoring controls.
- Side rail: scrollable independent of chat, keyboard navigable, clear empty/sending/failure/complete states, 16px body/control baseline, responsive fallback, focused review layout.
- Acceptance: full brainstorm -> readiness -> explicit Read -> LLM acknowledgment -> reviewed Write -> saved Scene -> reopen -> revise flow. Exercise browser, real local LLM, and generation-specific tests separately; do not claim browser/model/H3 acceptance from static assertions.

## Test obligations and audit gates

Every phase: inspect current main and changed paths, minimize the diff, run relevant Python/JS tests and static checks, identify test results honestly, and review for regressions in General Assistant, Studio, persistence, older conversations, Project/Scene editing, generation settings, and Takes. No merge of a phase that merely makes the interface appear to work while the LLM has not received context.

## Scope exclusions

No video/Takes visual inspection project, database, automatic Project ingestion, hidden field syncing, background QA scans, hypothetical multi-model orchestration, new intermediate Story/Scene entities, or field explosion. Ideas/Studio Blocks remain an independent feature that Director may explicitly Read later.
