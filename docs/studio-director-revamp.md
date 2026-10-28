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
5. **No field explosion**: Concept (including *Core Appeal*), Style and Invariants are Director's preferred creative Story view, mapped to existing fields. Existing Guidelines and Scene subfields remain accessible; do not force migration or silently contradict established content.
6. Director knows **hard generation contracts** and existing user-editable model guidance in Settings, including *soft* empirical strengths and weaknesses. Hard generation limits are code-validated; specific limits on newly proposed Scenes are schema/parser/Apply validated. Soft guidance is advisory; do not silently change legacy scene-generation behavior.
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

## Logical data contract (existing v1 storage, no migration)

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

### Production Playbook (Settings, already partially implemented)

**Partially implemented already:** Settings owns editable generation_model_guidance[minimax_h3] and studio_director.py reads it. Keep **that as the only user-editable source**; no parallel playbooks.json, duplicated concept fields, or per-Story Playbook copies. Additional headings (successes, observed risks, user lessons) can be sections of the existing text, not required new schema. Immutable H3 technical/runtime constraints stay in code / docs/mmh3-prompt-runtime-context.txt.

**Ownership and injection order:** (1) validated technical/runtime constraints; (2) explicitly approved Story/Scene facts and current user's direction; (3) optional model-specific practical tips; (4) task-scoped response schema. Studio Writer's Workshop voice lives in studio_director.py. H3 full prompt shape is owned by mmh3-prompt-runtime-context.txt and used for production prompts, **not repeatedly for ordinary brainstorming**. Legacy operation-specific prompts stay in storyboard_llm_contract.py during transition. Audit duplicate language in STORYBOARD_WORKSHOP_PRIMER, storyboard-director-context.txt and storyboard_llm_guidance.md; remove only confirmed redundant model-facing instructions after parity checks.

### Conversation metadata

Retain current app-data state/director_chats/<timestamp-id>/conversation.json and its existing fields (director_chat_history.py:24-35,136-177). Preserve **original** transcript indefinitely until the user explicitly deletes it; compaction must not rewrite earlier turns. Future attachments are immutable, inspectable **historical events**, each recording the supplied snapshot, source label/ID and time; reattaching makes a new event, not a live link. No copy of the whole transcript in story.json. Store action receipts as small target/field/outcome/time summaries and optional bounded inverse patches, not duplicated prompt/response logs.

**Context budgeting:** ordinary replies stay freeform. For each actual request, assemble workshop voice, relevant explicitly chosen historical context, recent turns and (after review) an editable concise creative-decision summary. Determine advertised/configured model context size when possible, reserve room for output and overhead, show token **estimates** as estimates. If too large, explain and offer **Compact / Select less** before sending; no hidden history truncation or automatic summary replacement. Preserve Core Appeal and committed creative decisions in the reviewed compaction. Conversation remains readable if its referenced Story is deleted. Session count/bytes and explicit clear by category belong in Settings and Storage Manager; defer auto-retention until demonstrated need.

## Text-based Director API: proposal operations, not universal chat JSON

**Ordinary brainstorming remains freeform conversation.** New Writer's Workshop exchanges must not require a tool-call schema or classify intent on every turn. A clear **user instruction** or an explicit large action button starts a separate structured **extraction/proposal** request. WebCap displays an editable proposal before a reviewed Apply. One model response never has permission to run arbitrary HTTP, write files, execute code, or replace a whole Story. The existing ACTIONS array in studio_director.py is informational, not a working tool dispatcher.

**Small, bounded versioned extraction shapes:** include schemaVersion=1, operation enum, explicit optional target IDs, changed-field object, concise rationale. Example for existing Scene revision:

    {
      "schemaVersion": 1,
      "operation": "scene.revise",
      "target": {"storyId": "story-id", "sceneId": "scene-id"},
      "changes": {"summary": "A simpler single physical action."},
      "rationale": "Preserves the gag without multiple simultaneous beats."
    }

For unbound project.create, see the reviewed creation schema above. Actual stored IDs and before-values are read by WebCap; **model-supplied IDs are never mutation authority**. Each operation gets an exact allowlist, required/optional types, bounded cardinality and strict parse. If the selected small local LLM cannot produce valid structure, preserve the chat and show the raw error/manual-edit option; never claim an action succeeded. A real-model probe is required before new structured features, not a general LLM benchmark.

| Operation | Current main status | Proposed behavior |
| --- | --- | --- |
| conversation.discuss | **complete** | Freeform chat and one-at-a-time questions, no action JSON. |
| context.attach / inspect | **partial** | Explicit, historical, exact labeled snapshots; no navigation binding or silent refresh. |
| **project.create** | **missing Director path**; regular create_story exists | Explicit Prepare Project from an unbound conversation; editable Concept/Style/Invariants and optional first Scene; one reviewed new Story commit; Open is optional. |
| project.brief.propose | **missing unified extraction**; individual Story fields and guideline review exist | Concept/Style/Invariants only, Core Appeal inside Concept; target selected explicitly, before/after, reviewed field-scoped Apply. |
| scene.draft | **complete for one Scene in existing attached Story** | Reuse current schema, start/end/before/after, editable review and stable Scene ID; no ghost Scenes. |
| scene.revise | **partial**; existing update_scene/refine/Workshop routes | Only requested field changes, current authoritative before-values and coordinated review; do not rewrite prompts or Takes as collateral. |
| scene.move | **partial integration**; reorder_scenes exists | Reviewed order difference using stable IDs and stale-order conflict validation. |
| scene.prompt.propose | **partial**; write_prompt/refine_prompt and Workshop exist | Production-only H3 prompt construction, explicit prompt diff, user Apply, then unchanged Take generation. |
| takes.review | **read-only reuse** of Take controls | Display selected Take metadata only when requested; no promise of image/video understanding from a text-only model. |
| history.restore / Undo | **partial** for previousPrompt, previousRevision, Workshop | Bounded inverse patch for new reviewed mutations, conflict-checked against current values; explicit clear history. |

**New reviewed Apply contract:** (1) explicit Story/Scene IDs or new unbound creation, never infer target from navigation; (2) flush any pending editor saves **only for the actual open target Story**, then fetch current authoritative data; (3) compare expected original values on the **affected** fields and relevant Scene order, not an unrelated whole-Story timestamp; (4) under the existing storyboard_store serialized mutation lock, merge only approved fields into a copy and write Story JSON **once**, or fail with no partial update; (5) preserve all other Scenes, prompt text, references, Takes and generation configuration; (6) report exact fields/IDs in a small conversation receipt. Overlapping edits must produce a visible conflict and a fresh review; unrelated edits should not be rejected. For multi-Scene edits, never commit one Scene and then silently fail on the next.

**Undo contract:** one reviewed coordinated action is one inverse change set. Revert only if fields still match that action's resulting values. Undo of new Scene insertion must stop if the Scene has subsequently been edited or has Takes. No unbounded Story snapshots and no generic rollback framework for unrelated historical operations. Keep revision history small and explicitly clearable, with counts.

**Existing button contract:** click Revise, Develop, Scene Workshop or Prepare Prompt => open Studio Director and prefill a large **editable** instruction, with precise optional context preview, **not** automatic send/Apply. Reuse existing direct editor controls when they are better than conversation; remove redundant Director-specific paths only after tested parity. Do not build a second mutation engine or a generic dispatcher until concrete duplication justifies it.

## Extracting fields from conversation

1. **Brainstorm:** natural dialogue with an implicit Writer's Workshop start; ask one useful question, allow divergence, avoid writing Story fields.
2. **Recognize readiness:** Director can say “The core appeal seems clear; draft a Scene?” This is a recommendation, not authority to mutate data.
3. **Explicit 'Capture idea / Prepare Project / Draft Scene / Propose Story brief' action:** extract agreed creative decisions from the conversation. **New Project creation needs no attached Story.** Existing-Story mutation requires an explicit target, a fresh authoritative read and narrowly selected fields. Return only affected Concept/Style/Invariants or a bounded number of candidate Scenes.
4. **Grounding/consistency:** show the key decision(s) extracted, compare to authoritative fields, flag conflicting legacy guidance and the Scenes likely affected. Ask before expanding requested scope.
5. **Review + commit:** show editable before/after per changed field; Apply checks expected original values at commit, not model memory. A multi-field action is one atomic change and one guarded Undo unit. History is bounded, counted and explicitly clearable.
6. **Producing:** after Scene intent is approved, propose the H3 prompt using the existing template. Mark readiness only when actual required prompt/settings are present. Test Takes, learn, revise locally.

## Studio UI / interaction design

- **Already implemented:** rename the visible Storyboard workspace to **Studio**; keep the existing disk/API keys and the current Scene editor/generation/Takes unchanged. This revamp targets Writer's Workshop and Director integrations, **not** a Studio-wide redesign.
- **Partially implemented:** Studio Director has a wide overlay and pinned side-by-side drawer, General Chat remains independent, and Studio exit closes the panel without deleting history. Add **user-adjustable** dock width / expanded writing view only where viewport testing justifies it, using the current drawer rather than another UI framework.
- Generous canvas: 16–18px body, 18–20px actions, clear 26px primary heading, large multi-line composer; wide model/activity controls, no micro-buttons. Dock for side-by-side Scene comparison, expand for writing.
- Empty Studio Director: strong “Let's make something” welcome + Writer's Workshop **starts on explicit opening**, loads model, asks its own first question. Reopen existing conversation => simply resume.
- **One continuous conversation**, with optional collapsible context/decisions and proposal/diff areas; not three chat modes or an always-visible control dashboard. Build the latter areas as concrete actions require them.
- Context controls show exact source, captured scope, fields and historical timestamp. Copy/inspect/remove from future inclusion must be deliberate. Opening Director via an existing button prepares editable text and a context preview; **nothing enters the request before user approval**. Only technical/model-specific production guidance is automatically supplied.
- Suggested next moves (“Explore the hook”, “Capture the idea”, “Draft one Scene”, “Prepare for H3”) are **truthful affordances**. They may populate an editable message or open a reviewed action. Avoid arbitrary scoring and fake achievements.
- Large proposal card includes *What would change*, risk, highlighted before/after, Approve/Apply, Edit, Discard; show conflicts as concrete.
- Show model loading, token activity, draft/proposal state, persistence errors. Preserve input focus and drafts across workbench switches.

## Codebase-grounded implementation phases and acceptance criteria

**Sequence:** address practical user workflow first, prove each new capability, avoid speculative architecture and minimize changes outside Writer's Workshop. Preserve old routes and UI until new versions pass parity.

### Phase 0 — Already shipped: conversation and Studio foundation (**complete**; PRs #751 and #752)

- [x] Independent app-data Chat and Studio Director conversations, drafts, persistence and reopen; initial Studio Director Workshop question on explicit new conversation.
- [x] Studio-facing name, legible and larger Director drawer/composer, pinned view, model loading/progress; general Chat independent.
- [x] Existing Storyboard scenes, prompts, Takes and editor remain functional.
- **Gate:** opening new Director starts real one-question brainstorming (not a fake user-history message); reopening old chat only resumes it; navigating Stories never rebinds or erases conversation; Studio exit closes only panel.

### Phase 1 — Unbound reviewed Project creation (**P0 missing**); existing Scene draft (**complete**; PR #754)

- [x] Prepare one tentative Scene into an **already attached Story**: editable title/summary, start/end/before/after, stable ID, prompt-free; guarded single-write Apply and chat receipt (director_chat.js:1200-1358; storyboard_store.py:905-939).
- [ ] **Prepare Project** from an unbound Director discussion: use a focused schema-constrained extraction for agreed Concept/Core Appeal, optional Style/Invariants and an optional single first Scene. Propose, allow edits, then explicit Create; no requirement for Story attachment, title, ending or Scene count.
- [ ] Reuse create_story, _normalize_scene and the Story store's lock/write helper for **one authoritative creation**; targetSceneCount null unless explicitly requested. New IDs returned as informational receipt, with optional Open Project, never automatic navigation or chat binding.
- **Accept:** new Workshop conversation => project with 0 or 1 initial Scene, no ghost Scenes and no default 12-Scene mandate; changing proposal before Create works; cancellation/invalid JSON creates nothing; refresh retains chat and created Story. Test Python store/route atomic failure and JS draft/edit; probe one representative **real small local LLM** for extraction reliability.

### Phase 2 — Creative brief and scoped mutation (**P0/P1 missing**)

- [ ] Extract existing Story Concept, Style and Invariants only when explicitly requested; Core Appeal remains within Concept, no duplicate field. Mark when legacy Guidelines or Scenes might contradict a change; **ask before expanding scope**.
- [ ] Create a **small field-scoped reviewed Apply** for only selected Story/Scene fields; flush target Story's pending saves, compare affected originals + relevant order, atomic write and visible conflict. Existing general editor autosaves do not need a broad refactor.
- [ ] Add user-editable, per-field diffs and bounded inverse changes for approved multi-field actions; count/clear revision history. Keep existing previousPrompt/Workshop restore as-is during rollout.
- **Accept:** unrelated edits during review survive; colliding edit fails without loss; linked Invariant kind/title references survive reviewed rename or are explicitly blocked; Concept changes preserve all Scene prompts and Takes; Undo fails safely when later edits exist; multi-Scene Apply is all-or-nothing. Test editor-open, pending-save and closed-Story cases.

### Phase 3 — Precise attachments and conversation longevity (**P1 partial/missing**)

- [ ] Turn new explicit attachments into inspectable **historical events**. Label a Story outline honestly (titles/summaries only); offer selected full Scene details separately. Do not rewrite prior messages, silently refresh, or switch context because Studio navigation changed. Safely read older map-based sessions without destructive migration.
- [ ] Show actual composed request text for copy/inspection, including chosen references and system guidance. Stop repeated duplicate attachment injection when not needed.
- [ ] Reserve context headroom for output, show approximate token budget, and offer **manual editable compaction** preserving decisions/Core Appeal and original archival transcript. No vector store, implicit truncation, background memories or duplicate giant results.
- **Accept:** attach Story A, switch Studio to B, conversation and historical A unchanged; reattach creates another explicit event; long chat can be compacted without losing original history; unknown/exceeded budget reports an actionable warning, never silently drops content. Add roundtrip/refreshed-history and exact-request tests.

### Phase 4 — Production contracts and entry-point parity (**P1 partial**)

- [ ] De-duplicate **actual** Director model-facing payload: single short Studio Workshop voice; H3 prompt skeleton only for prompt production; existing editable Settings guidance once; legacy Storyboard contracts remain intact until parity is proven. Compare instruction/token size before/after and test existing operations.
- [ ] Expose existing prompt-writing/refinement/Workshop functions as prepared Director instructions and reviewed prompt proposals. Do **not** rebuild existing Take generation, queue/provenance, reference-frame settings or Scene editor.
- [ ] Respect explicit Scene count maximum when *new* structured proposals are requested; beats != Scene count. Keep legacy bulk Develop/Revise operations unchanged until a reviewed replacement is verified.
- [ ] Retire only genuinely redundant conversational entry points after tests show equivalent or improved behavior. Direct controls that are faster remain.
- **Accept:** no full H3 template token overhead on normal brainstorming; H3 output contract available on prompt draft; requested 2 new Scenes cannot result in 4; existing Scenes, prompts, Takes and generation tests pass; buttons only prefill, no surprise model call or mutation.

### Phase 5 — Director UX finish and scoped housekeeping (**P1/P2**)

- [ ] Within Studio Director only, validate/implement resizable pinned split and expand/collapse; large composer, legible 16px+ working text, contextual Edit/Apply/Discard and actual conflict/progress states. Do not restructure or restyle unrelated Storyboard screens.
- [ ] Use existing Settings generation_model_guidance as model-specific user Playbook. Present hard limits separately as read-only; no parallel persistent guidance schema.
- [ ] Add Director chat inventory (count and measured bytes) and explicit single/category clear to Settings and Storage Manager, using central app_state_root helper. No accidental deletion of Stories, Takes or unrelated app state. Defer auto-retention.
- **Accept:** desktop Studio can display Scene editor and Director legibly side by side; expand without losing focused input; save/reopen persists draft; clear Studio Director chats leaves General Chat and Story/Takes intact; no broad Storyboard layout changes.

### Deferred pending evidence

Reusable Series/Format hierarchy, semantic search through old transcripts, automatic Take evaluation, unattended multi-action LLM dispatch, background compaction, automatic retention, and sweeping migration of legacy Story/Scene fields. These are explicitly **not** launch dependencies.

## Success criteria

A user can open Studio Director **without a Story**, receive a real question, discover the Core Appeal, explicitly create an editable reviewed Project (with zero or one initial Scene), add tentative Scenes anywhere, progressively propose feasible prompts, review Takes and revise through scoped, reversible actions. They keep a single conversation without copying six competing fields or encountering hidden context changes. **The existing Studio Scene editor, generation, Takes, Library and other WebCap workspaces remain intact** throughout.
