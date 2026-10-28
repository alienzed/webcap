# Studio Director — conversational production contract and incremental delivery

Status: agreed product vision; implementation phases tracked below. This is a **design contract**, not an assertion that unimplemented actions already work. Follow `AGENTS.md` and `docs/filesystem_state_contract.md`.

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

## Logical data contract (v2 target; v1 disk stays compatible)

```json
{
  "project": {
    "id": "story-existing-uuid",
    "title": "Optional working title",
    "creative": {
      "concept": "Short premise and what makes it interesting.",
      "coreAppeal": "Explicit subsection of concept, NOT a second duplicate source",
      "style": "Optional overall visual/tonal identity",
      "invariants": [{"id": "stable-id", "kind": "character", "name": "…", "description": "…"}]
    },
    "sceneOrder": ["scene-a"],
    "scenes": {
      "scene-a": {
        "title": "Optional working title",
        "intent": "What happens and why this moment exists",
        "generationPrompt": "Derived and editable when production-ready",
        "production": {"durationSeconds": 6, "aspectRatio": null},
        "takes": "Unchanged existing take manifest"
      }
    }
  }
}
```

This is a **logical view**, not the current wire/storage schema. Until a reviewed migration, map `creative.concept→story.concept`, `creative.style→story.style`, `creative.invariants→story.invariants`, `scene.intent→scene.summary`, `generationPrompt→scene.prompt`, duration/aspect ratio/takes unchanged. Existing entryState/exitState/notes/guidelines remain readable and editable in legacy UI; Director's default new-authoring path doesn't force them. **Core Appeal lives *within* Concept**, as an identifiable section or sentence, rather than persisted twice.

### Playbook (Settings, future phase)

```json
{
  "version": 1,
  "modelId": "current-model-id",
  "technicalContractSource": "bundled runtime context, read-only",
  "workingMethods": ["Keep one reliably renderable physical action per short clip"],
  "knownRisks": ["Multiple coordinated characters/fast multi-step causality"],
  "promptConventions": "Model-specific, editable production guidance",
  "userLessons": ["Observations from actual Takes, marked as experience not universal fact"],
  "updatedAt": "ISO-8601"
}
```

Store user customizations in app-data state through one owner/helper. Settings exposes inspect/edit/reset. Do not silently alter model guidance elsewhere. The existing `generation_model_guidance` config must be reconciled, not doubled.

### Conversation metadata

Retain `{id,mode,title,revision,messages,draft,attachments,workshop}` in the existing app-data session store. Extend later with a compact array of **action receipts** `{actionId,type,targetIds,expectedVersion,outcome,timestamp,summary}` and recoverable proposal state. No transcript duplication inside a Story. No automatic Story binding. Settings + Storage Manager offer size/count, explicit clear, and an optional retention policy. A conversation can remain valid when its associated Story is deleted.

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

### Phase 0 — This branch: documentation, model-aware Writer's Workshop, legible Studio Director foundation
- [ ] Save this decision contract.
- [ ] Studio nav label; Studio Director identity and generous workspace typography.
- [ ] New Studio Director conversation automatically begins an actual model exchange on explicit open, using concise implicit creative guidance, without fabricating a persisted user message; ask one question at a time.
- [ ] Reopening sessions does not restart; general Chat does not inherit Studio instructions. Model unavailable => conspicuous retry/failure, no fabricated reply.
- [ ] Add tests and inspect CI; no Story mutations.

### Phase 1 — Structured action proposal, extraction and review
- [ ] Add versioned action catalog and schema; prototype representative small local models with `conversation.ask` and `project.brief.propose`; enforce no silent mutation.
- [ ] 'Capture creative brief' extraction against explicit Story, with Concept/Style/Invariants review and atomic change receipt.
- [ ] 'Draft one tentative Scene' including placement before/after/first/last (zero Scenes valid); one reviewed commit; never infer destination solely from navigation.
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
