# Studio Director — conversational production contract and incremental delivery

Status: **audited plan** against main commit 95434633d4ad65702bf55df8bb9f1c3b9e35b710 (2026-10-27). Codebase statuses and revised gates below take precedence over older proposals. This is a design contract, not implemented code. Follow AGENTS.md and docs/filesystem_state_contract.md.

## North star

One creator turns an idea, gag, visual, episode, or developing narrative into **renderable short video Scenes** using one Studio Director conversation. Director is a creative collaborator **and** an operator of documented WebCap capabilities; it is not a generic chat pretending to be a video editor.

Creative discovery is flexible; production operations are precise. The initial user input may be *nothing*: opening a new Director conversation starts a one-question-at-a-time Writer's Workshop. Director can riff from a short, editable opening script, challenge weak ideas, and help discover **the core appeal**. A clear idea can become one tentative Scene immediately; a complex project can evolve one Scene at a time. There are no required title, ending, Scene count, beat map, or placeholder Scene 1/2 before a Scene 3.

### Non-negotiable interaction rules

1. **General Chat remains app-wide and unconstrained. Studio Director lives inside Studio** (the UI name for the existing Storyboard workspace). Histories remain independent; the existing app-data chat-session store is reused.
2. **Context is explicit**: navigation never attaches a Story, revises chat history, or selects an editing target. Buttons prepare **editable** instructions and **inspectable** snapshot attachments; nothing runs because of a button that merely opens Director.
3. A conversation is not *owned by* a Story or permanently bound to it. Story references in history are informational. For any real mutation, resolve an explicit stable ID and obtain fresh authoritative state. Never use a stale attachment as write authority.
4. Every mutation produces a visible before/after diff; narrow, clear changes may be applied with Undo, high-impact/structural changes require review and Apply; Director asks before extending requested scope. No silent mutations.
5. **No field explosion**: Concept (including *Core Appeal*), Style, Invariants are the only proposed authoritative creative Story fields. The existing five Guidelines and Scene subfields remain readable for legacy projects until individually mapped, migrated, and tested; no destructive auto-migration.
6. Director knows **hard generation contracts** and a user-editable, model-specific **Production Playbook**, including *soft* empirical constraints and successes. Hard limits are validated in code; soft guidance is advisory and learned, not falsely guaranteed. Request a maximum of two Scenes => schema/parser/validation enforce at most two.
7. A beat is not necessarily a Scene. A Scene is a renderable clip; a project can be shorter than one narrative arc or a long series. No implicit need for an intro, outro, or common formula.
8. Technical generation prompt is **derived production material**, not an additional required creative input. Director first understands the action and why it matters. Actual generated Takes and user-authored prompts are retained unless a reviewed operation changes them.
9. Loading the selected model and kicking off the first question happens **on explicit opening of a new Studio Director conversation**, not on hidden workspace startup and not on reopening an existing session.
10. Truthful progress: clear *Exploring → Draft available → Reviewed → Ready to generate → Takes*, each derived from real state. No invented percent complete, fake rewards, or score badges. Offer next actions generously sized; keep the editor visible.

## Current code: preserve and reuse

- `tool/server/storyboard_store.py`: authoritative Story JSON, stable `sceneOrder` + `scenes[id]`, tentative `add_scene`, `update_scene`, `reorder_scenes`, `update_story`, takes and prompt restore paths. `STORYBOARD_VERSION=1`. Do not rename the disk keys in this phase.
- `tool/server/app.py`: `/fs/storyboard` operations and `/fs/director/chat` / job lifecycle. `storyboard_workshop_shots` and `storyboard_story_guidelines` already support schema-constrained proposals + explicit reviews, but are separate UX paths.
- `tool/server/storyboard_llm_contract.py`, `docs/mmh3-prompt-runtime-context.txt`, `docs/storyboard-director-context.txt`: existing production constraints and prompt templates. Reuse rather than duplicate instructions, audit wording for conflicts.
- `tool/js/director_chat.js`: durable per-mode conversations recently implemented in `tool/server/director_chat_history.py`, visible/inspectable attachments, activity and model load status. Refactor **incrementally**.
- `tool/js/storyboard.js`: owner of live Studio DOM, Story/Scene editor state and save flushing. Do not let Director reach into arbitrary editor fields to create its own competing state.

### Risk to address first

Current Story attachment serializes Overview, Guidelines and only Scene titles/summaries; a specific Scene attachment contains prompt. A 'whole project' context action must **truthfully show exactly what is included**. The working Workshop snapshot currently also injects context implicitly. No new silent context. Current chat request puts attached references in the latest user message on *every turn*; this is convenient but not equivalent to immutable historical attachment messages. Make attachment a historical event in a later safe phase with explicit migrations and tests.


## Severity-ranked codebase findings (main)

The audit distinguishes **confirmed workflow defects**, partial implementations, and future choices. Scope is Studio Director and its integration only; **do not rebuild Storyboard**.

| Severity | Confirmed finding | Code reference | Concrete plan response |
| --- | --- | --- | --- |
| **P0 · missing** | Director cannot create a new Story from an unbound conversation. The current Scene-draft flow requires exactly one attached existing Story. | tool/js/director_chat.js:1133-1140,1200-1220; tool/server/app.py:1910-1934 | Add reviewed Project creation, optionally with first tentative Scene, reusing Story creation/store primitives. No implicit Story binding or opening. |
| **P0 · partial** | Current tentative insertion is serialized and atomic for Story JSON, but conflict checking compares whole-Story updatedAt. Existing editor update_story/update_scene/reorder operations lack general expected-field checks; prompt/Guideline review handles only selected fields. | tool/server/storyboard_store.py:861-939,1207-1218,1252-1280,1648-1660; tool/js/storyboard.js:4660-4830 | New Director Apply actions check **only fields actually changed** and relevant Scene order, after coordinating pending saves; commit all selected changes once; guarded Undo. Do not broadly rewrite the existing editor. |
| **P1 · partial** | Explicit attachment snapshots are mutable map entries and are inserted into the last user message **every turn**. Whole-Story context contains Scene titles/summaries, not full Scene prompts. Workshop has a separate implicit Scene snapshot. | tool/js/director_chat.js:1539-1618; tool/js/storyboard.js:7037+ | Historical, immutable, inspectable attachment events; accurate field/scope labeling and exact outbound-request inspection. No navigation-driven changes or silent refresh. |
| **P1 · missing** | Long conversations resend the entire transcript and attachments. There is no token budget or reviewed compaction; the runtime permits truncated freeform results. | tool/js/director_chat.js:1359-1415,1942-2041; tool/server/director_chat_history.py:84-188; tool/server/storyboard_llm_runtime.py:1934-2055 | Show approximate context use, retain full archive, offer explicit editable decision-preserving compression for outbound prompts; no silently lost turns, background summaries or duplicate raw output storage. |
| **P1 · partial** | Studio production guidance always includes the full H3 prompt skeleton during brainstorming, then stacks legacy Workshop primer. Old Storyboard operations separately add Director context, Guidelines and H3 syntax. Human docs still describe Guidelines as primary. | tool/server/studio_director.py:12-70; tool/js/director_chat.js:43-52,1539-1587; tool/server/storyboard_llm_contract.py:278-439; docs/storyboard_llm_guidance.md | Assign one owner per guidance type; inject full H3 syntax only for prompt-writing jobs; measure before/after actual payload tokens; preserve legacy operation results until parity passes. |
| **P1 · partial** | A wide pinned Studio drawer, large composer, persistent History, real model loading and an editable Scene proposal already work. No user-adjustable width, no unified brief review tray, and several Director buttons still own separate workflows. | tool/css/workspace_shell.css:2291-2525; tool/tool.html:2076-2190; tool/js/director_chat.js:1169-1358; tool/js/storyboard.js:1648-2338 | Extend **only** Studio Director with resize/expand and contextual proposal/context displays; keep the Scene editor, existing buttons, Takes and generation UI intact. |
| **P2 · partial/missing** | Settings already edits generation_model_guidance for MiniMax H3 and Studio consumes it. Storage Manager does not inventory Director conversations for count/size/bulk clearing. | tool/js/app_settings.js:50-51,342,384; tool/server/config.py:397-403; tool/server/studio_director.py:45-70; tool/server/storage_manager.py:1059-1138 | Reuse existing editable guidance, don't add a second Playbook store; add explicit Settings/Storage Manager session category management without touching Stories/Takes. |

### Confirmed existing capabilities: do not rebuild

- **Complete:** Story creation, stable Story/Scene IDs and ordering, prompt-free tentative Scene insertion at start/end/before/after, app-data chat/draft persistence, initial Workshop question on explicit opening, explicit Scene review, model progress, atomic Story JSON writes, existing prompt revision/restore, Take controls.
- **Partial:** human-readable action catalog (not an executable API), Scene/Guideline review/Apply, revisions and Undo only for selected existing workflows, project context viewer, docked UI.
- **Missing:** unbound reviewed Project creation, unified Concept/Style/Invariants extraction, field-scoped reviewed multi-field Apply/Undo, attachment history events, explicit context compaction, chat Storage Manager scope, consistently routed Director buttons.
- **Architecture:** retain plain JS, existing Flask routes, storyboard_store mutation lock, centralized filesystem helpers. No generic service layer, agent runner, framework, database or new Story schema solely for tidiness. A common dispatcher is only justified after two concrete implemented actions expose true repeated logic.

## Logical data contract (v2 target; v1 disk stays compatible)

**Authoritative storage stays v1** in output/storyboards/<story-id>/story.json. The term Project is UI language, not a second object. The following mapping supersedes the previously illustrative v2 object:

| Meaning to Director | Actual canonical field | Compatibility rule |
| --- | --- | --- |
| Concept, with Core Appeal | story.concept | Core Appeal is a clear subsection or sentence **within** Concept. No persisted coreAppeal or creative object. |
| Creative vibe / visual identity | story.style | Use existing Style string and visual controls. |
| Established facts | story.invariants[] | Existing entries are {kind,title,text}; **no stable invariant ID** exists (storyboard_store.py:200-219). Avoid automatic UUID migration. |
| Renderable Scene and order | story.scenes[scene-id], story.sceneOrder[] | Scene IDs are stable; numbering is presentation only. |
| Tentative Scene intent / title | scene.summary, scene.title | No new intent field; title may be blank; prompt may be blank. |
| Model-ready prompt | scene.prompt | Existing prompt is authoritative, editable and never implicitly regenerated. |
| Physical/production state | existing durationSeconds, aspectRatio, samplingMode, references, takes, takeOrder, etc. | Preserve generation settings, references, old Takes and provenance. |
| Legacy authored planning | story.guidelines; scene.entryState / exitState / notes / invariantRefs / sharedContextRefs | Continue displaying and honoring existing populated values until reviewed consolidation. Default new extraction does not need to populate them. |

**Identity caveat:** Scene invariantRefs resolve by **{kind,title}**, not invariant UUID (storyboard_store.py:231-251,392-414). Renaming a referenced invariant must explicitly coordinate its references in reviewed Apply or surface a conflict; don't silently break them. Story/Scene reference-frame metadata is separate.

**Scene count:** targetSceneCount can be null for Auto (storyboard_store.py:324-336). The legacy New Story UI initializes 12 (storyboard.js:4410-4430); **Studio Director's unbound create must not** assume 12 Scenes or a Story arc.

**Unbound project.create extraction schema (proposed):**

    {
      "schemaVersion": 1,
      "operation": "project.create",
      "proposal": {
        "title": "",
        "concept": "Premise. Core Appeal: the audience anticipates the accident.",
        "style": "",
        "invariants": [{"kind": "character", "title": "Coach", "text": "Blue windbreaker"}],
        "firstScene": {"title": "", "summary": "The coach demonstrates the move."}
      }
    }

All proposal values are editable. firstScene, style and invariants are optional; empty title is valid, empty Scene list is valid. Require at least an approved Concept or first-Scene idea for a meaningful creation action, but don't force a full Story. One reviewed, serialized operation constructs a new Story and optional first Scene under **one authoritative JSON commit**, with supporting Take directories initialized and any pre-commit failure rolled back. Return stable IDs and an explicit **Open Project** action; do not auto-attach, navigate, or rewrite the conversation.

### Playbook (Settings, future phase)

**Partially implemented already:** Settings owns editable generation_model_guidance[minimax_h3] and studio_director.py reads it. Keep **that as the only user-editable source**; no parallel playbooks.json, duplicated concept fields, or per-Story Playbook copies. Additional headings (successes, observed risks, user lessons) can be sections of the existing text, not required new schema. Immutable H3 technical/runtime constraints stay in code / docs/mmh3-prompt-runtime-context.txt.

**Ownership and injection order:** (1) validated technical/runtime constraints; (2) explicitly approved Story/Scene facts and current user's direction; (3) optional model-specific practical tips; (4) task-scoped response schema. Studio Writer's Workshop voice lives in studio_director.py. H3 full prompt shape is owned by mmh3-prompt-runtime-context.txt and used for production prompts, **not repeatedly for ordinary brainstorming**. Legacy operation-specific prompts stay in storyboard_llm_contract.py during transition. Audit duplicate language in STORYBOARD_WORKSHOP_PRIMER, storyboard-director-context.txt and storyboard_llm_guidance.md; remove only confirmed redundant model-facing instructions after parity checks.

### Conversation metadata

Retain current app-data state/director_chats/<timestamp-id>/conversation.json and its existing fields (director_chat_history.py:24-35,136-177). Preserve **original** transcript indefinitely until the user explicitly deletes it; compaction must not rewrite earlier turns. Future attachments are immutable, inspectable **historical events**, each recording the supplied snapshot, source label/ID and time; reattaching makes a new event, not a live link. No copy of the whole transcript in story.json. Store action receipts as small target/field/outcome/time summaries and optional bounded inverse patches, not duplicated prompt/response logs.

**Context budgeting:** ordinary replies stay freeform. For each actual request, assemble workshop voice, relevant explicitly chosen historical context, recent turns and (after review) an editable concise creative-decision summary. Determine advertised/configured model context size when possible, reserve room for output and overhead, show token **estimates** as estimates. If too large, explain and offer **Compact / Select less** before sending; no hidden history truncation or automatic summary replacement. Preserve Core Appeal and committed creative decisions in the reviewed compaction. Conversation remains readable if its referenced Story is deleted. Session count/bytes and explicit clear by category belong in Settings and Storage Manager; defer auto-retention until demonstrated need.

## Text-based Director API (one documented action catalog)

The LLM never emits executable code, arbitrary HTTP calls, or a whole replacement `story.json`. It chooses among explicit operations. A structured response is distinct from normal conversational prose:

```json
{
  "message": "I see why the football gag works. Let's make the anticipation visible.",
  "suggestion": {
    "type": "scene.draft",
    "label": "Draft the impact Scene",
    "target": {"storyId": "story-uuid", "sceneId": null},
    "arguments": {"intent": "The impending accident is visible to the audience", "placement": "end"},
    "requiresApproval": true
  }
}
```

The actual schema in a given phase may use fewer fields; it must have an explicit schema version, enums, stable target IDs, bounded argument shapes, max outputs/Scenes and a strict parser. **The backend validates all arguments** against current saved Story versions. If a small local model cannot reliably emit this structure, report the failure, preserve the conversation and fall back to discussing a proposal; don't execute malformed output or pretend a model action succeeded. Provide a model-contract probe before enabling unattended action selection.

| API operation | Inputs / read authority | Outcome and safety |
| --- | --- | --- |
| `conversation.ask` | Conversation + selected playbook | Plain reply, next focused question |
| `context.inspect` | Explicit Story/Scene IDs, or user-selected snapshot | Read-only, show exact supplied fields |
| `project.brief.propose` | Chat excerpt + explicitly selected current Story | Concept / Style / Invariants suggestion with source excerpts; diff + Apply |
| `scene.draft` | Chat + optional Story target, placement, limit (default 1) | Tentative Scene intent(s), **no required prompt**; reviewed creation, stable IDs |
| `scene.revise` | Explicit Story/Scene IDs and expected version | Changed fields only; compare and review, preserve Takes |
| `scene.move` | Explicit IDs and before/after/start/end | Reviewed reorder using stable `sceneOrder`, no ghost Scenes |
| `scene.prompt.propose` | Reviewed intent, playbook, prompt template, scene technical settings | Schema-valid generation prompt, review separately, no auto-generating Takes |
| `takes.review` | Explicit selected Take IDs, available metadata | Read-only observations and possible next experiment |
| `history.restore` | Approved revision identifier | Restore related fields atomically with conflict checks |

The UI buttons ('Revise Scene', 'Develop', 'Prepare prompt', etc.) prefill **instruction + optional explicit context preview**, not new chat modes. Server calls use one small dispatcher reusing authoritative Storyboard operations rather than a second mutation engine. Any structural or multi-Scene action is review-first, with full set of diffs, not partial success.

## Extracting fields from conversation

1. **Brainstorm:** natural dialogue with an implicit Writer's Workshop start; ask one useful question, allow divergence, avoid writing Story fields.
2. **Recognize readiness:** Director can say “The core appeal seems clear; draft a Scene?” This is a recommendation, not authority to mutate data.
3. **Explicit 'Capture idea / Draft Scene / Propose Story brief' action:** send current conversation plus explicitly selected Story data, model-specific guidance and target constraints to a **schema-constrained extraction operation**. Return only affected `concept`, `style`, `invariants`, or candidate Scenes; never assume all sections require content.
4. **Grounding/consistency:** show the key decision(s) extracted, compare to authoritative fields, flag conflicting legacy guidance and the Scenes likely affected. Ask before expanding requested scope.
5. **Review + commit:** show a readable diff. User edits extracted text or approves; server validates versions and allowed fields. One multi-field action is one revision receipt/undo unit, bounded history with clear-history control.
6. **Producing:** after Scene intent is approved, propose the H3 prompt using the existing template. Mark readiness only when actual required prompt/settings are present. Test Takes, learn, revise locally.

## Studio UI / interaction design

- Rename **Storyboard** to **Studio** in the user-facing navigation, not filesystem/API keys.
- Director is an explicit Studio-only, **dockable/expandable workbench** alongside Scenes. General Chat remains independent. Leave Studio => Director panel closes (history persists); don't move or delete the conversation.
- Generous canvas: 16–18px body, 18–20px actions, clear 26px primary heading, large multi-line composer; wide model/activity controls, no micro-buttons. Dock for side-by-side Scene comparison, expand for writing.
- Empty Studio Director: strong “Let's make something” welcome + Writer's Workshop **starts on explicit opening**, loads model, asks its own first question. Reopen existing conversation => simply resume.
- **Three practical surfaces, not three chat modes**: conversation; context/creative decisions rail; action proposal/diff tray. Side details are collapsible while conversation remains central.
- Context chips always indicate exactly *what is attached* and allow inspection/copy/removal. A button opening Director may prepare a draft instruction and context preview but does not inject content or send until acknowledged. Model-specific production guidance is the one documented automatic exception.
- Suggested next moves (“Explore the hook”, “Capture the idea”, “Draft one Scene”, “Prepare for H3”) are **truthful affordances**. They may populate an editable message or open a reviewed action. Avoid arbitrary scoring and fake achievements.
- Large proposal card includes *What would change*, risk, highlighted before/after, Approve/Apply, Edit, Discard; show conflicts as concrete.
- Show model loading, token activity, draft/proposal state, persistence errors. Preserve input focus and drafts across workbench switches.

## Phased implementation and acceptance gates

### Phase 0 — Shipped in PR #752: documentation, Writer's Workshop and legible Studio Director foundation
- [x] Save this decision contract.
- [x] Studio nav label; Studio Director identity and generous workspace typography.
- [x] New Studio Director conversation automatically begins an actual model exchange on explicit open, using concise implicit creative guidance, without fabricating a persisted user message; ask one question at a time.
- [x] Reopening sessions does not restart; general Chat does not inherit Studio instructions. Model unavailable => conspicuous retry/failure, no fabricated reply.
- [x] Add tests and inspect CI; no Story mutations.

### Phase 1 — Structured action proposal, extraction and review (first action in PR #754)

- [x] `scene.draft`: an explicit **Prepare a Scene** action extracts exactly one tentative Scene from conversation into an editable review. Apply creates it at Start/End/Before/After using a stable ID, no prompt or ghost Scenes, optimistic Story version guard, and an action receipt in conversation. Requires explicitly attached Story reference; the current workspace does not silently pick a target. Future work: persist in-progress proposals across refresh and support creating a new Project directly from the conversation.
- [ ] Add versioned action catalog and schema; prototype representative small local models with `conversation.ask` and `project.brief.propose`; enforce no silent mutation.
- [ ] 'Capture creative brief' extraction against explicit Story, with Concept/Style/Invariants review and atomic change receipt.
- [x] 'Draft one tentative Scene' including placement before/after/first/last (zero Scenes valid); one reviewed commit; never infer destination solely from navigation.
- [ ] Enhance context viewer with full field selection, exact request inspector and historical attachment events.

### Phase 2 — Scene life cycle
- [ ] Scene intent → H3 prompt proposal → review → existing Take generation; keep existing prompt template and sampling controls.
- [ ] Scene revision/move/insert with versioned diffs and bounded multi-field revision history / Undo.
- [ ] Replace redundant Director Tools entry points with buttons targeting the one session, retaining rollback until parity is proven.
- [ ] Differentiate narrative *beats* from actual clip counts; enforce requested limit at model schema and commit.

### Phase 3 — Consolidation and housekeeping
- [ ] Field-by-field audit and **reviewed** migration of Guidelines / Scene entry/exit/notes into the smallest usable authoring surface. Do not lose legacy information or rewrite existing prompts/Takes.
- [ ] Editable Playbooks in Settings with clean read-only technical limit separation and user lessons; default per model.
- [ ] Chat storage count/size, clear individual/all by category in Settings and Storage Manager; optional retention controls with visible preview.
- [ ] Optional reusable formats/series only after repeated use proves need; do not force a hierarchy on standalone videos.

## Success criteria

A user can open Studio Director, receive a real question, discover why an idea is worth making, capture it as an editable reviewed creative brief, draft a tentative Scene wherever needed, progressively prepare a feasible prompt, review the real Take, and revise—all while keeping **one conversation**, without copying six fields, mysterious context changes, silent edits, or losing work on refresh. Old Stories and Takes remain usable throughout the rollout.
