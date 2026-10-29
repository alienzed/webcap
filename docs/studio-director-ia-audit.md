# Studio Director — Information Architecture Audit → Design Audit Handoff

**Audit date:** 2026-10-28  
**Code baseline:** `main` after merged PR #783  
**Status:** IA/content/navigation audit only; no runtime UI changes.  
**Verification:** Source-level code and contract inspection. No browser or real-LLM acceptance is claimed.

## 1. Executive judgment

The product boundary is right: **Conversation develops creative direction; Read deliberately supplies authoritative saved material; Write prepares editable, reviewed mutations.** Do not replace that with automatic Project attachment, a new field hierarchy or a parallel project store.

The remaining IA problem is **scope and provenance**. A user can have an open Studio Project, a conversation's selected Write Project, a separately selected Read source, and saved historical context. These are legitimately distinct, but the UI primarily says “Working with …” and does not make those distinctions legible. Readiness and operation feedback introduce additional competing notions of context.

The Design Audit should make the current workflow *understandable* before it makes it more visually attractive. The smallest plausible solution is one visible context summary, two clear intentional actions, a trustworthy review/outcome trail, and subordinate advisory material.

## 2. Current information ownership (do not duplicate)

| Concept | Authoritative owner | IA rule |
| --- | --- | --- |
| Studio open Project | Studio/Storyboard navigation + live editor in `tool/js/storyboard.js` | Navigation is location, **not** permission to feed the conversation or mutate a Project. |
| Conversation, draft, history | `tool/server/director_chat_history.py`; `tool/js/director_chat.js` | Conversation may begin unbound and discuss multiple Projects. Preserve the user's words and continuity. |
| Saved Project | `tool/server/storyboard_store.py`, existing Story identity | Present as **Project** in UI; keep `story` IDs/schema/API paths. |
| Saved Scene / Take | Same existing Project store; Studio's generation/editor owns Takes | **Scene Intent** = `scene.summary`; **H3 Prompt** = `scene.prompt`; Take is an outcome, not a draft. |
| Read source | The Project chosen in Read at the moment of explicit Send | Distinct from Studio navigation and Write destination; selected saved fields are the actual supplied context. |
| Write destination | Explicit Project/Scene chosen in Write; existing reviewed API | May legitimately differ from latest Read source. Apply only against current authoritative Project/Scene state. |
| Historical snapshots | Legacy conversation attachments | Historical evidence; neither current saved facts nor an automatic active context feed. |
| Creative readiness | LLM-proposed, bounded **conversation** metadata | Advisory about discussed content, not saved Project completion or generation readiness. |
| Production status | Studio's actual Scene/Take progress | Reflects real generated/selected Takes; not comparable to LLM creative checkmarks. |
| H3 Playbook | Existing `generation_model_guidance.minimax_h3` settings | App/model-level preference, not a Project or Scene field. |

Sources: [Director history](../tool/server/director_chat_history.py), [Director chat](../tool/js/director_chat.js), [workbench](../tool/js/studio_director_workbench.js), [Studio editor](../tool/js/storyboard.js), [existing production contract](studio-director-revamp.md).

## 3. Current surface map

```text
Studio
  Library → open Project → Project fields → Scenes → Takes / generation
                    └→ Chat (opens Studio Director)
                        Header: Studio Director · "Working with" · model / History / New chat
                        Conversation: messages / explicitly delivered content / composer
                        Right rail: Director desk
                          Read… → Project → selected Project + Scene fields → Send
                          Write… → Destination → Operation → optional Scene/fields → Review → Apply
                          Creative readiness → model-produced checks and expanded draft text
                        Review dialogs: Project, brief, one Scene, Scenes, Scene revision, Playbook
                        Legacy structures: hidden Studio flow, access inspector,
                          operation history and brief Undo; optional historical attachments
  Other Studio entry: Director Tools (separate production/development actions)
```

This inventory describes DOM/code ownership, not a claim that every surface was exercised in a browser.

## 4. Prioritized IA findings

### IA-01 · P0 · Brief Undo is orphaned by the new navigation

**Evidence:** [CSS hides `#director-studio-flow`](../tool/css/workspace_shell.css) while [`director-studio-undo-brief` remains inside that old flow](../tool/tool.html); [`undoStudioBrief()` remains wired](../tool/js/director_chat.js). No equivalent Undo is in the new Read/Write rail. This is a **new-workbench discoverability loss**, even though the backend operation still exists.

**Design requirement:** After a reversible reviewed Project brief Apply, put **Undo** at the visible result/receipt, with its actual availability and safe expiry. Do not resurrect the entire old flow or imply every structural mutation is reversible.

### IA-02 · P1 · There is no stable visible vocabulary for Project scope

**Evidence:** [`syncModeUi()` labels the header “Working with” the conversation's `studioStoryAccess`](../tool/js/director_chat.js); [Read and Write have independent Project selectors](../tool/js/studio_director_workbench.js). `refreshProjects()` even uses the most recently Read Project as a default when initializing the Write selector. This is not a demonstrated wrong-target write: `prepareWrite()` sets the explicit destination correctly. It is a **scope/provenance ambiguity**.

**Design requirement:** Distinguish (a) Studio location, (b) conversation/Write destination, (c) last Read source, and (d) historical references. Only show distinctions relevant to the current action. Users must always know *what Director is using* and *where Apply will write*. A conversation remains independent of Project navigation.

### IA-03 · P1 · Context disclosure is partial, not an exact preflight

**Evidence:** [Read checkboxes](../tool/js/studio_director_workbench.js) select actual stored values, but the detailed payload is mainly inspectable **after Send** as a collapsed conversation event. [Write's “Context Director will use” preview](../tool/js/studio_director_workbench.js) is separately reconstructed. Actual Write operations assemble project fields and differently bounded conversation history (e.g., [brief](../tool/js/director_chat.js), [single Scene](../tool/js/director_chat.js)); that preview is not the authoritative serialized outbound message.

**Design requirement:** Before a request, summarize **selected fields and their source** and provide an on-demand inspector of the exact payload. After Send, preserve a compact durable delivery record and its model-authored acknowledgment. Avoid permanently displaying large JSON or duplicating the underlying data.

### IA-04 · P1 · Creative readiness is not identified per Project/Scene assessment

**Evidence:** [`updateReadiness()` stores check items as `name`, `scope`, `ready`, `content`](../tool/js/studio_director_workbench.js), plus **one shared `sceneId`**. Individual checks have no Project ID or Scene ID. [`renderReadiness()`](../tool/js/studio_director_workbench.js) labels every Scene check with that one shared ID. Mixed-Project conversations or multi-Scene reasoning therefore lack reliable provenance in the displayed assessments.

**Design requirement:** Treat readiness as a *scoped opinion at a particular conversational moment*. Show the relevant subject where known; otherwise use “Current discussion / unspecified Scene,” not a misleading Scene label. Distinguish “not assessed” from “not ready” and avoid fabricating a second source of truth in Project storage.

### IA-05 · P2 · Playbook is at the wrong level of the Write taxonomy

**Evidence:** [Write operations](../tool/tool.html) place “Improve H3 Playbook” between Project and Scene mutations; [the Project selector is disabled for that operation](../tool/js/studio_director_workbench.js). H3 guidance actually lives in **global model settings**, not in the selected Project.

**Design requirement:** Keep reviewed Playbook improvement available, but identify it as *model guidance/settings*. A contextual secondary action or link is preferable to a Project-destination operation. Do not create a second guidance store.

### IA-06 · P2 · In-progress form selections have weak continuity

**Evidence:** Opening Read calls [`refreshRead() → renderReadStory()`](../tool/js/studio_director_workbench.js), which rebuilds its checkboxes using model hints/defaults. Switching to Write and reopening Read can lose deliberate unchecked/checked choices. Opening Write likewise can reset the operation to the current model hint.

**Design requirement:** Treat user-edited selections as working state while the same conversation/action is in progress. Recommended defaults should initialize once, then yield to explicit user choices. Reset only on an understood change (e.g., a different Project or new conversation), not ordinary panel navigation.

### IA-07 · P2 · Retired and active terminology/flows still overlap

**Evidence:** Visible or retained markup includes “Storyboard,” “Story fields,” “Project,” “Chat,” “Studio Director,” “Writer's Workshop,” “Director Tools,” “Prepare Scene,” and “Creative readiness” ([markup](../tool/tool.html), [conversation history labels](../tool/js/director_chat.js)). The old Studio flow and operation list are hidden but still wired; [several distinct review dialogs](../tool/tool.html) survive.

**Design requirement:** Use one consistent user-facing hierarchy: **Studio → Project → Scene → Take**; **Studio Director → Conversation / Read / Write / Creative assessment**. Keep existing backend names. Audit the discoverability of any remaining unique function *before* deleting controls; share one review pattern visually, not necessarily one new generic backend abstraction.

### IA-08 · P2 · Two notions of “readiness” have different owners

**Evidence:** [`renderStoryReadiness()`](../tool/js/storyboard.js) summarizes actual Takes/selected sequence readiness, while [the Director rail's creative readiness](../tool/js/studio_director_workbench.js) is a model proposal. Their checkbox/progress treatments can suggest equivalent factual completion.

**Design requirement:** Label distinctly, for example **Creative assessment** (Director opinion) versus **Production status** (actual Scenes/Takes). Never convert advisory model checkmarks into prerequisites or gating.

### IA-09 · P2 · Parallel operations are more visible than the user's actual goal

**Evidence:** [Write's operations](../tool/tool.html) split “Create a Scene” and “Create several Scenes,” and mix Create/Revise with Playbook. The new UI can feel like a command dispatcher rather than a way to move the current creative work into saved material.

**Design requirement:** Prefer goal-first grouping: **Create Project**, **Add Scenes** (editable one or many), **Update Project**, **Revise Scene**. Preserve existing reviewed implementations and operations where they are safer; this is an IA consolidation, not authorization for a broad refactor. Place the reviewable outcome, target and next action above operation plumbing.

## 5. Target IA for the Design Audit

Keep three major zones, not more nested tools:

1. **Conversation (primary canvas):** current conversation and model status; readable historical Read/Apply events; composer. It can start unbound. The conversation is **not** a Project.
2. **Action rail (secondary, contextual):** a compact subject/context strip; one of **Read** or **Write** when opened; bounded **Creative assessment** below. Keep actual pending/error/complete feedback close to the originating action.
3. **Review (temporary focused step):** specific destination, exact fields, before/after, editable draft, Apply/Cancel, and **Undo when genuinely supported**. Return to the same conversation with an inspectable result.

Place global H3 Playbook under a clearly marked *model guidance* secondary route. Keep Studio's real production progress in its Project/Scenes UI. Avoid introducing a new story outline level, new required creative field, persistent readiness flag, auto-read attachment, or competing Project cache.

## 6. Design Audit test journeys (must be demonstrated)

| Journey | What design must make unambiguous |
| --- | --- |
| **Unbound idea → Project + Scenes** | Chat without a bound Project; explicit reviewed Create; optional multiple Scene intents; saved result visible. |
| **Open Project A → Read Project B** | Distinguish Studio location A, Read source B, and existing Write destination without silently switching or loading material. |
| **Read several selected fields → reply** | Exact selections known before Send; model's own `RECEIVED:` acknowledgment and any mismatch visible afterwards. |
| **Read → Write → back to Read** | User selections retained unless explicitly reset; generated suggestions do not silently overrule them. |
| **Update Project Concept → Apply → Undo** | Editable before/after and narrow target; actionable Undo for the reversible operation. |
| **Assess two Scenes in one conversation** | Assessment labels refer to the right Scene (or acknowledge unclear scope); creative opinion not confused with Take readiness. |
| **Improve H3 Playbook** | Clearly global guidance, no misleading Project destination; reviewed replacement of existing settings. |
| **Reopen saved Director conversation** | History and approved edits remain distinct and inspectable; no automatic re-read, mutation or hidden prompt injection. |

Audit both the **normal desktop** experience and narrower layouts; inspect hierarchy, keyboard navigation, scroll independence, state transitions (empty / composing / queued / failed / reviewed / applied), and copy sizes at actual browser zoom. Do not treat static markup as proof of visual quality.

## 7. Non-negotiable design constraints

- Follow [AGENTS.md](../AGENTS.md): KISS, clear feature ownership, 16px normal controls/body, visible failures in the Console, no speculative gates or framework-like architecture.
- Preserve the [five-field creative contract](studio-director-revamp.md): Project Concept, Visual / atmosphere, Invariants; Scene Intent and separately reviewed H3 Prompt. No new Story/Scene fields just for checkboxes.
- Preserve existing Project/Scene IDs, Takes, queues, authoritative filesystem state and reviewed CAS mutation safety.
- Navigation must not inject saved content into Director automatically. Read is deliberate; Write is reviewed and target-specific.
- Keep LLM assessment advisory; user-edited review text is authoritative after Apply.
- Do not redesign production controls or change GPU scheduler semantics under this audit.

## 8. Deliverable expected from the Design Audit

**A compact surface-by-surface critique**: screenshot-backed hierarchy and layout defects, a minimal before/after interaction map, the few proposed component/layout changes that resolve IA-01–IA-06, desktop/narrow-state mocks if useful, and an ordered small-change plan. Cite affected DOM/CSS and shared-state owners. Distinguish *functional/IA defects* from styling preferences. Do not implement until that audit is understood.

**Audit conclusion:** The remaining work is principally clarification and consolidation of *context → action → review → outcome*, not a larger feature system. Start the Design Audit with **IA-01 (Undo), IA-02 (scope/provenance), IA-03 (exact context visibility), IA-04 (readiness identity)**.
