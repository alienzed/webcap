# Studio Director — intention-to-materialization contract and feature-completeness audit

**Status:** Current implementation contract and next-work handoff, audited against `main` commit `9b3a49657ef3ae7664b63ee96a4b93dee94d4df6` on 2026-10-29, after PR #792. **Documentation-only audit:** no application code changed and no real local-model or browser test was run in preparing this document.

**Authority:** Follow `AGENTS.md` and `docs/filesystem_state_contract.md`. This document is the *current* Studio Director creative collaboration and implementation plan. `docs/studio-director-revamp.md` records architectural context and earlier phase history; `docs/studio-director-ia-audit.md`, `docs/studio-director-design-audit.md` and `docs/studio-director-side-panel-implementation.md` are dated snapshots, not current outstanding-task lists. `docs/storyboard_llm_guidance.md` owns the existing lower-level Storyboard LLM/generation contracts, not the Studio Director user-experience roadmap. Current code wins over all docs when a statement describes what has shipped.

## Implementation checkpoint — current main after PRs #796–803 (2026-10-29)

**This section supersedes the original baseline statuses and phased to-do wording below.** The capability matrix and phases in Sections 3–10 remain the historical rationale and full acceptance specification; do not reimplement actions recorded here. Recheck current code and tests before additional changes. Current merged baseline: `47dd1bc8f64274b39dcab2e36844ce7cce00e551`.

| Previously missing journey | Delivered implementation | Verification level |
|---|---|---|
| Complete conversational material → focused editable reviewed field | PR #796: optional bounded capture in existing readiness response; direct Project Title/Concept/Style and existing Scene Title/Intent/Prompt reviews; no duplicate LLM extraction | Studio client/history checks; real-model initiative and browser UX **unverified** |
| Literal Scene move and duplicate | PR #797: reviewed deterministic move/duplicate, expected Scene order, duplicate source freshness, no Take deletion | Focused store and client CI |
| Coordinated edits to several existing Scenes | PR #798: one structured proposal and editable per-field review, one atomic Story JSON write with selected field CAS; preserves all unselected Scenes/Prompts/Takes | Focused store and client CI |
| Named Invariant add/edit/rename from conversation | PR #799: explicit Invariant identity in capture and matching reviewed original row, linked active Scene reference rename via existing scoped `invariantOps` | Focused history/client and Invariant-store CI |
| Direct new Scene from developed conversation | PR #800: use existing tentative Scene placement review without a second draft; selected Project, stable Scene order and current state remain authoritative | Focused history/client and existing Scene-store CI |
| Split Scene | PR #801: one model proposal for two Intents, reviewed replacement of original Intent + new tentative Scene inserted immediately after; atomic Story metadata commit; old Prompt/Takes remain | Focused split-store and client CI |
| Knowledge and Read scope coherence | PR #803: current action catalog, no retired Guidelines in active Write drafts, 48k-character explicit Read size guard, full H3 prompt guidance only for selected H3 Prompt drafting | Focused Studio CI |

All seven PRs were merged on 2026-10-29. These are **functional completion increments**, not a new architecture or UI revamp. They reuse `storyboard_store.py`, current Studio workbench, the existing local LLM request path, file-backed state, and reviewed Apply.

### What's deliberately not claimed complete

- **No actual local Director-model behavioral test or browser walkthrough was executed** using this repository connector. In particular, the model's optional capture metadata may be absent, vague, mismatched, or too frequent. Successful parser/schema/unit tests do not establish reliable creative initiative. The explicit Write/Prepare fallback remains valid.
- **One offered conversational capture per assistant response**, not a simultaneous direct capture of arbitrary cross-Project/Scene fields. Broad reviewed Project changes and reviewed multi-Scene changes already work through explicit Write. Before adding a multi-capture protocol, demonstrate a real conversation where breaking one intent into several reviews is materially painful.
- **Scene Undo is not yet a unified durable feature.** The latest Project brief has guarded Undo; Scene batch/move/split/duplicate edits are saved with conflict checks but not a persistent compound Undo receipt. For a split or duplicate, deleting a Scene as “Undo” would be unsafe once Takes exist. A future narrowly scoped pre-Take revert needs a demonstrated user journey, explicit conflict checks and truthful limitations.
- **Scene removal remains intentionally outside Director.** The existing manual delete path purges generated Take metadata/artifacts; do not expose it as a casual creative operation. A “merge Scenes” journey is currently accomplished through reviewed revision of the retained Scene, leaving the other Scene intact.
- **Long conversation compaction and full auto-assessment of an entire 15+ Scene Project are not proven.** Read supports Project briefs, Scene overview selections and exact full fields with a visible size cap. Do not auto-inject unread Project content, deduplicate repeated creative prose speculatively, or claim more context than was sent.
- **The live experience still needs visual polish verification:** target clarity; useful one-click Review placement; modal readability; model activity feedback; after-Apply return to the same conversation; focus and narrow layouts. Avoid “feature complete” wording until those journeys have actually been exercised.

### Next required acceptance pass, not a new architectural phase

Run WebCap locally with the intended Director model and a real Project containing several recurring Invariants and at least 15 Scenes. Walk these cases in order: natural Concept capture; Character Invariant definition and explicit rename with linked Scenes; direct Scene insertion; targeted Scene Intent/Prompt; move and duplicate; batch move of dialogue between two Scenes; split one overloaded Scene; Read Project+overviews; stale/concurrent edit conflict; reopen conversation; and no model connected. Record **the model's actual reply**, exact Read/capture payload, number of LLM requests, number of author clicks to Apply, saved values/IDs/order, error and Undo behavior, and whether each next action was obvious. Test full and narrow Studio layouts.

Only then fix **observed** friction in small slices. Most likely follow-ups are more reliable capture suggestions and clear multi-target review/Undo, but do not build those speculatively. Live local-model and graphical browser verification are concrete dependencies unavailable from GitHub-only implementation.

---

## Additional completion checkpoint — October 29, 2026

The following work followed the initial PRs #796–803. It **completes existing workflows** rather than replacing the five-field Studio model.

| Shipped phase | Effect | Verification |
|---|---|---|
| [#806](https://github.com/alienzed/webcap/pull/806) — Studio Blocks slash | The existing global Idea/Guidance library is available through typed `/` autocomplete in the Director composer. Inserting a Block is an explicit, editable text insertion; it does not send hidden context, run an LLM, or mutate Projects. The picker loads only on demand while using Studio. | Focused Studio syntax/client checks; visual browser verification still needed |
| [#808](https://github.com/alienzed/webcap/pull/808) — Guided Write | Readiness `writeHint` now covers reviewed move, duplicate, split, and multi-Scene revision; one contextual next-step affordance opens the correct Write selection. Deterministic Scene move/duplicate review and the review of completed authored text no longer require a loaded LLM. | Focused Studio and history checks; real-model suggestion quality unverified |
| [#809](https://github.com/alienzed/webcap/pull/809) — Scene Invariant associations | Select an existing Character/Location Invariant and the Scenes that use it; WebCap reviews only changed links and saves them atomically with per-Scene CAS. Prompts, creative prose, Takes and technical settings remain untouched. No new creative field or LLM request for literal links. | Focused store and UI contract checks; real browser UX unverified |
| Current polish slice | Show true Project positions in multi-Scene review; distinguish backend-saved Scene edits from chat-receipt/refresh failures. | Focused Studio regression coverage |

**What still needs evidence or completion:** The user-facing Director is not yet proven to route a *specific fully expressed natural-language Scene move* all the way into an exact prefilled preview: `writeHint` chooses the right operation, but target resolution remains author-reviewed. One model-authored capture per response remains the existing limit, so arbitrary mixed Project+Scene edits are not a single atomic chat-driven proposal. The effect of changed Invariants on already-saved H3 Prompts is *not* automatically repaired; Director should offer a targeted review when useful. Compound Scene Undo/draft continuity, large-Project context recall, visual focus/keyboard polish, and real local-model/browser acceptance remain explicit gaps. Reuse existing WebCap surfaces; do not implement a generic action executor or auto-inject Studio Blocks.

---

## 1. North star and definition of done

**An author expresses an ordinary creative intention naturally; Studio Director helps develop the material and identifies the right creative home for it; WebCap shows a clear, editable, minimal review and deterministically materializes exactly the approved changes in the saved Project/Scenes.** The author should *not* have to learn field names or decompose an ordinary intention into several independent Write operations.

The cooperation is **Director authors; WebCap targets, validates, materializes; author decides**:

- **Director (LLM):** Interpret author intent, critique feasibility, propose imaginative alternatives, ask one consequential question when needed, supply concrete final or tentative *creative material* and concise reasoning. It may identify a field or Scene as a suggested destination, but cannot silently control the application.
- **WebCap (deterministic):** Enumerate actually supported targets and fields, load authoritative state after explicit selection, bind stable IDs, prepare proposed edits, compute precise diffs, preserve omitted/unrelated fields, detect conflicts, coordinate pending saves, commit review-approved changes atomically at the correct scope, record actual saved results, and provide appropriate Undo/restore where safe.
- **Author:** Establish source/destination and scope, redirect the Director, revise any proposed material, accept or discard individual changes, and keep creative control.

**Completeness is a journey criterion, not a button count.** For each representative author intention below, the journey must complete from natural conversation to visible saved effect without detouring through manual field copying, invisible background control, invented context, or unnecessary re-prompting. A workflow is not complete because the API can technically make the edit.

**Pleasant to use:** one contextually relevant next step; human labels rather than JSON; generous usable editing space; show *changed fields*, not everything the Project stores; no repeated selection of the same destination; no nagging for deliberately optional fields; return to the same conversation after Apply. Creative energy must survive materialization.

## 2. Explicit scope

### Creative model — five independently authored fields

| Level / saved path | Human name | Owns | Material worth prompting for | Does *not* own |
|---|---|---|---|---|
| Project `story.concept` | Concept / overview | Premise, core appeal, intent of the whole work, shared structural decisions, relationship/variation among Scenes | What makes this interesting? What is the recurring format or sequence logic? | Scene-specific shot-by-shot event; generic copy of every Scene |
| Project `story.style` | Visual / atmosphere | Shared look, mood, lighting/camera language when globally meaningful | What visual treatment anchors several clips? | One-off Scene lighting or props |
| Project `story.invariants[]` | Invariants | Fixed, reusable characters, locations, sound, visual/world facts needed across relevant Scenes; existing `{kind,title,text}` records | Defining visual traits, recognizable locations, identity/continuity constraints | One-off details; duplicate prose in every Scene |
| Scene `scene.summary` | Intent | A single independently generatable clip's purpose, observable event, actions/beats, local prerequisites if actually relevant | Who does what, where, when, and why is it worthwhile? | Full syntax/technical instructions for generation |
| Scene `scene.prompt` | H3 Prompt | Complete, editable H3 generation instruction derived from approved Intent/Project facts | Time-feasible staged action, shot timing, sound/dialogue where useful | New creative premises the author has not approved |

**Supporting authoring metadata:** Project and Scene `title`, stable Scene IDs and `sceneOrder`, and **practical awareness** of `durationSeconds` (generation uses 4–15s). Titles and order are supported authoring actions, not a sixth creative source. Duration is a practical constraint and may be user-adjustable through the existing Scene editor; adding Director-controlled duration is *not* a prerequisite to first-pass completeness.

**Deliberate exclusions from Director:** media/image/video inspection and reference-frame attachment; generated Take operations and generation execution; LoRA choices, seeds, sampling, resolution, workflow files; Project archival/deletion/other administrative controls; legacy Directing Guidelines as new authoring destinations. Studio Blocks remains a separate copyable text library, not an automatically injected Director memory or slash-command system.

**Retired from active authoring:** `entryState` and `exitState`. PR #792 removed their Scene editor controls, and Director guidance excludes them. Preserve existing data and older backend consumers; never manufacture new entry/exit fields as part of a Director proposal. Scene relations should not turn movable Scenes into an implicit dependency chain. Keep any genuinely required start/end condition in the Scene Intent.

**Legacy boundary:** Populated `story.guidelines` remains stored and honored by existing legacy Storyboard operations unless explicitly reviewed; do not delete it or resurrect it as a current Studio Director field. Existing `storyboard_llm_contract.py` still handles legacy scene entry/exit fields; its behavior is not proof that the current Director should use them.

## 3. What `main` actually does today

### Verified architecture (static code inspection)

- `tool/server/storyboard_store.py` owns file-backed Story/Scene persistence (`sceneOrder`, `scenes[id]`), `create_studio_project` (0–32 tentative initial Scenes), `apply_studio_brief` / `undo_studio_brief`, `apply_studio_scene_fields`, `add_tentative_scenes_at`, `duplicate_scene`, `reorder_scenes`, `delete_scene`, `restore_scene`.
- `tool/server/app.py` exposes distinct reviewed Studio routes `/fs/studio/director/project-create`, `brief`, `brief/undo`, `scene-draft`, `scenes-draft`, `scene-fields`; classic `/fs/storyboard` exposes manual structural operations. `/fs/director/chat` has distinct response schemas for Project, brief, Scene(s), revision and Playbook. These are *proposal jobs*, not LLM tools to execute.
- `tool/server/studio_director.py` teaches the five fields, practical H3 constraints and proactive field development. Its `ACTIONS` catalog is advisory and not executable by the LLM. Its optional legacy `read_story_scope` includes historical fields; normal Studio Read uses the newer workbench.
- `tool/js/studio_director_workbench.js` provides explicit selected saved-field Read (Project brief, whole Scene, Scene overviews, individual fields), basic advisory Read/Write hints, manual operation selection, and a separate editable Scene-field review.
- `tool/js/director_chat.js` owns conversation persistence and extra reviewed draft/review flows. It supplies selected Read payloads to chat, emits model-authored readiness metadata, runs separate *structured LLM extraction* when preparing most Write operations, and records actual applied saved values back into the conversation.
- `tool/server/director_chat_history.py` persists conversation messages/attachments/assessment and selected story access; it is not an alternative creative data store. `tool/js/storyboard.js` owns manual Project/Scene controls and the pending-save flush bridge.
- `tests/test_studio_invariant_ops.py` and `tests/test_studio_scene_draft.py` cover key server operations; `tests/studio_director_workshop.test.cjs`, `tests/studio_director_readiness.test.cjs` and `tests/studio_director_scene_draft.test.cjs` cover subsets of client contracts. Static tests are not proof of a local LLM understanding a conversation.

### Functional capability matrix (as of audited `main`)

Legend: **Complete** = deterministic underlying operation and current reviewed Studio path exist; **Partial** = some path exists but ordinary conversational handoff or combined workflow is incomplete; **Missing** = no current Director review/action path; **Excluded** = deliberately not in the North star. The statuses are **code-based**, not live-model/browser acceptance.

| Intended author operation | Actual UI/store capability | Director Read | Director Write / status | Gap and smallest correction |
|---|---|---|---|---|
| Brainstorm, challenge, refine an idea | Studio chat + H3 expertise | Chat history; explicit saved fields only | **Partial** | Proactivity quality and next-action selection need actual LLM tests; cannot assume field expertise from prose alone |
| Create Project from discussion, empty or with Scenes | `create_studio_project`, initial 0–32 tentative Scenes | New Project needs no saved Read | **Complete code path** | Test a real author journey and editable review, especially zero/one/many Scenes and idempotent failure feedback |
| Rename Project | `story.title` via reviewed brief | `project.title` | **Complete code path** | Still hidden inside generic “Update Project” preparation |
| Update Concept | `apply_studio_brief` field CAS | `project.concept` | **Complete code path** | No contextual one-click capture from the actual conversation |
| Update Visual / atmosphere | Same | `project.style` | **Complete code path** | Same discoverability/handoff issue |
| Add multiple Invariants | `invariantOps` (PR #792), atomic | Full `project.invariants` | **Complete code path** | “Define this character” should land on specific Invariant rows rather than entire-brief ceremony |
| Revise/rename Invariant | `invariantOps` + active Scene ref update and Undo | Full array, not targeted selector | **Partial journey** | Reviewer sees rows; no conversational per-record targeting or cross-Scene relevance insight. Explicitly review affected Scene references on rename |
| Remove Invariant | Backend supports, prevents removing actively referenced identity | Full array | **Supported, lower priority** | Explicit intentional Remove; don't auto-delete from LLM omission; avoid overbuilding for deletion |
| Create one/multiple Scenes | Tentative `add_tentative_scene(s)_at`, reviewed placement | Project + Scene overviews | **Complete code path** | Need seamless “add this moment after Scene 2” handoff, no repeated selection |
| Rename/revise one Scene Title/Intent/Prompt | `apply_studio_scene_fields` CAS | Whole Scene or selected fields | **Complete code path** | Reviewer must choose Scene and check fields; chat proposal cannot flow directly to scoped edit |
| Revise several existing Scenes together | Manual per-Scene edits, legacy `repair_scenes` separate | Multiple selected Scene fields | **Missing coherent Studio batch review** | Review one changeset across existing stable Scene IDs; preserve unselected fields/prompts/Takes |
| Move/reorder Scenes | `reorder_scenes` manual API | Overview order implied by selected Scene data | **Missing Director Write** | Deterministic reordered list with expected order; no LLM needed for a literal move |
| Duplicate Scene | `duplicate_scene` manual API | Existing Scene fields | **Missing Director Write** | Deterministic clone with clear semantics; no need to have LLM rewrite every field |
| Move/copy a creative beat from one Scene to another | Two independent editable `summary` fields | Explicit Read of both | **Missing atomic cross-Scene workflow** | Director proposes new Intent(s), WebCap shows both old/new and applies selected edits together |
| Split a Scene | Existing Scene edit + tentative insert possible separately | Source Scene + neighbors | **Partial building blocks** | Director authors two Intents; WebCap applies revision + insertion as one reviewed operation, or states honestly when unsupported |
| Merge/consolidate Scenes | Existing Scene edit, reorder, delete manual | Selected Scenes | **Partial building blocks** | Avoid automatically deleting an existing Scene; preserve it or offer a separate explicit removal |
| Write/revise H3 Prompt from Intent | Scene prompt review + lower-level `write_prompt` / `refine_prompt` | Intent and Prompt | **Partial experience** | Ensure reviewed H3 authoring uses appropriate prompt-contract guidance, not freeform-only text |
| Check H3 feasibility, advise Scene duration | Built-in H3 guidance, `durationSeconds` stored and generation validated | Explicit duration Read | **Advisory only** | Judge realistic clip load, flag timing, propose splitting; no technical controls needed |
| Review a Project with 15+ Scenes | Whole Scene / overview checkboxes, sent payload character count | Explicit selection | **Partial** | No enforced payload budget, section chunking or size-aware default strategy; avoid silently overflowing context |
| Undo | Latest reviewed Project brief revision with field/ref CAS | After-Apply receipt | **Partial** | Undo receipt ephemeral in JS; no comparable compound Scene Undo; require scoped reversible operations when introducing structural changes |
| Studio Blocks | Standalone CRUD/copy | No automatic Director integration | **Excluded from first-pass parity** | Copy/paste is adequate; no slash commands or retrieval layer |
| Reference media, Takes, generation, LoRAs, seeds, sampling, dimensions, legacy fields | Separate Storyboard UI and APIs | Not included in current Studio Read panel | **Excluded** | Do not re-add merely to satisfy a theoretical parity checklist |

### Confirmed code/contract mismatches (not hypothetical defects)

- **Natural-language Invariant rename is not yet represented as rename in the review.** `showStudioBriefReview` (`tool/js/director_chat.js`) matches proposed rows to saved rows by `kind` + case-insensitive `title`. If the model proposes renaming “Alice” to “Alicia”, the review **keeps Alice and treats Alicia as a new row**; it does not know the model intended one entity rename. The backend `invariantOps:update` correctly supports a coordinated rename *when the author edits the original row*. Next-step acceptance must require an explicit “Alice → Alicia” review and affected Scene-reference preview; never silently decide a new identity is a rename because names are similar.
- **Capability catalog understates Project creation.** `tool/server/studio_director.py` currently advertises “zero to twelve initial tentative Scenes” but `create_studio_project` and `studio_project_draft` support up to **32**. Harmonize the catalog and prompts with actual limits in a small implementation phase; no schema expansion.
- **A Read acknowledgement validates identifiers, not comprehension.** `RECEIVED:` identifies selected fields, and mismatches are surfaced. It does not prove the model absorbed long Scene Prompts or has reliable context remaining. For 15+ Scenes, check actual outbound size and real-model recall.
- **A readiness item is not a saved authoring object.** `checks[].content` can contain good text, but `name` (e.g. Characters) + broad `scope` (project/scene) is insufficient to deterministically select one Invariant or Scene. Any capture affordance needs an exact or author-confirmed field/entity target before Apply.
- **Current Scene deletion is materially destructive.** It purges Take metadata and artifact directories, so it cannot be casually used as an “undoable remove Scene” primitive in a creative restructuring operation.

**Do not turn a “Complete code path” into a claim that the LLM independently chooses and executes the operation.** It does not, and it should not.

## 4. The real gap: conversation ↔ editable material ↔ saved state

Today the **LLM can discuss material**, and WebCap can **prepare a generic Write operation that invokes a fresh model draft/extraction**; the path between the very sentence the author approved and the exact destination is not yet first-class.

For example, “Make Alice distinctively recognizable and keep her consistent” may yield an excellent written character description, but the author must manually open Write → Update Project and request a new structured brief, then review multiple Invariant rows. That isn't a complete *collaborative* journey.

### Intended normal interaction

1. **Explore:** The author describes a wish. Director develops actual material, notices one consequential gap or offers useful alternatives. Do not introduce a form before the author has anything to capture.
2. **Recognize:** When material is sufficiently concrete, Director briefly proposes what can be captured: e.g. “Alice is defined well enough to keep consistent. Save as Character Invariant?” It need not expose internal operation names.
3. **Offer action:** WebCap presents one contextual **Review change** affordance with known target and field(s). An author may also deliberately open Read or Write and select alternatives; no hidden attach or silent save.
4. **Prepare:** WebCap uses the **actual authored material** and the selected authoritative destination. If a complete field value is already available in the accepted LLM response, **do not invoke another LLM just to restate/extract it**. If canonical material is genuinely absent (e.g. “split this into two different clips”), make one explicit, bounded authoring request using existing `/fs/director/chat` proposal operation and show its activity.
5. **Review:** Present current versus proposed *only the touched fields/entities*, editable prose, affected targets and ordered Scene changes. An empty/unmentioned field is **not** a deletion. Author can deselect any item or correct it.
6. **Apply:** WebCap loads/locks current authoritative Project/Scene IDs, flushes pending UI saves, validates target scope and expected old values/order, runs a deterministic atomic write, and returns actual saved state. Failures preserve the review draft and go to global Console.
7. **Continue:** Add a precise Apply receipt to the *same* persisted conversation; Director then knows what was saved (not merely suggested) without a fresh Read. Relevance/readiness statuses update or become transparently outdated.

**Never** submit model-generated Python/JS, unrestricted tool calls, a universal “do anything” command, or a second mutable field taxonomy to achieve this. Model text/structured creative suggestions are *data*, never authority.

### Minimal materialization contract (design target, not present in code)

Reuse the current Director conversation and review workbench, plus the existing Project/Scene persistence owner. An **ephemeral, reviewable proposal** should contain conceptually:

- **Provenance:** Conversation/session and message ID/index, optional exact quoted span, proposed rationale, and whether text was authored in chat or in an explicit structured draft.
- **Declared intent:** One of a *small explicit set* of creative edits: Project text/title; Invariant add/edit/rename; Scene(s) create; Scene field edit; Scene reorder/duplicate; multi-Scene text edit. No generic agent command.
- **Proposed field values:** Complete final value for each changed text field (not a vague “make it better”), or a bounded deterministic structural instruction (e.g. move Scene ID before another). Preserve no-op/undecided material as no change.
- **Proposed target hints:** Project/Scene/Invariant human labels may come from conversation; **WebCap must resolve them to exact user-approved IDs** or request a narrow choice when ambiguous. Never trust the LLM's invented ID.
- **Snapshot for Apply, owned by WebCap:** Exact saved “before” values for selected fields/entities and Scene order, taken from freshly fetched state when opening review; relevant dependent references; explicit after values. Do not let model-provided “expected” values authorize a mutation.
- **Lifecycle:** proposed → editable review → applied/cancelled/conflicted. Proposal ephemeral unless existing session persistence already provides a suitable owner; do not add a second durable Project truth.
- **Receipt:** Exact saved fields/IDs/order + revisions needed for supported Undo, stored separately from the model's claims. If Apply succeeded but receipt save failed, report **saved but conversation not updated**, never pretend no mutation occurred or blindly retry.

**Practical first slice:** Map *one currently authored field proposal* to one existing reviewed Write surface directly. Start with Project Concept / Visual or a single Invariant. Keep existing explicit “Prepare reviewed draft” as fallback. Before adding a universal structured-proposal JSON payload to every freeform LLM answer, probe a real selected local model on field choice, exact final value, multiple suggestions and no-op. Extend existing readiness metadata only if that probe demonstrates reliable value; do not add a second always-on LLM call or complicated repair layer.

**Important tradeoff:** WebCap can deterministically turn *explicitly provided material and approved edits* into state; it cannot deterministically invent a missing creative rewrite. A genuinely new creative composition still requires the LLM. The goal is to avoid unnecessary duplicate authoring calls, not ban useful model calls.

## 5. User-intention playbook (acceptance workflows, not new UI buttons)

Each is an independently testable “say this → receive help → review → saved result” contract. These are examples of ordinary intent, not special hardcoded phrase matching.

| User intent | Director's creative job | Deterministic WebCap materialization | Success check |
|---|---|---|---|
| “I have an idea…” | Find core appeal; ask at most one key question; offer first concept | New Project review with Concept, optional Style/Invariants, zero or more tentative Scenes | Concept can be saved without inventing Scene count |
| “That's the concept—keep it.” | Provide complete Concept text | Project `concept` CAS update | Other Project fields and Scene/Takes unchanged |
| “Let's make the whole thing grimy and neon.” | Propose shared atmosphere; distinguish one-off shot | Project `style` | No Scene prompts overwritten |
| “Who is our protagonist?” | Develop reproducible visible identity; offer variations when appropriate | One or multiple `invariantOps:add` | Existing Invariants remain untouched |
| “Alice should have a red scarf instead.” | Update only Alice's identity | `invariantOps:update` by approved composite identity | All unrelated Invariants preserved; relevant refs stable |
| “Call her Alicia now.” | Recommend rename; surface identity implications | `invariantOps:update` plus linked active Scene `invariantRefs` in same transaction | Review shows dependent Scene IDs; Undo restores both |
| “This location needs to remain recognizable.” | Describe architecture/materials/fixed details | Location Invariant add/edit | Future Scene development may reference it, not duplicate whole text |
| “Add a Scene between 2 and 3.” | Provide independently renderable Intent and optional Title | Insert tentative Scene relative to exact stable Scene ID | Existing order, prompt, Takes preserved |
| “The scene needs more actual action.” | Propose specific H3-feasible event | Selected `scene.summary` update | Existing `scene.prompt` remains unchanged unless explicitly selected; advise potential prompt staleness |
| “Let's change the camera move in Scene 4's prompt.” | Write complete scoped revised H3 Prompt | `scene.prompt` review/apply | No changes to Intent, unrelated fields, or Takes |
| “Split Scene 2—too much for eight seconds.” | Author two complete clip Intents and suggest order | Compound edit one existing summary + insert one tentative Scene | One coherent reviewed commit, preserving both on failure |
| “Put that dialogue in Scene 3 instead.” | Reauthor both affected Scene Intents without duplication | Atomic two-Scene `summary` update | Neither partially written; both visible in one review |
| “Rewrite the opening three Scenes as a montage.” | Propose a purposeful set of Intents; be clear about continuity | Multi-Scene field-level batch update (optional reorder) | No unmentioned Scenes or existing prompts changed |
| “Move Scene 7 before Scene 2.” | No creative invention needed | Deterministic `sceneOrder` permutation with expected order | No LLM call for literal move |
| “Try an alternate version of this Scene.” | Optional short new artistic direction | Duplicate using existing backend; optionally review revised clone Intent | Source Scene and its Takes unchanged; clone semantics explicit |
| “These two Scenes repeat themselves.” | Suggest whether to keep, merge, move, or replace | Author-reviewed updates; defer removal by default | No deletion solely because model judged redundancy |
| “Can H3 render this?” | Honest timing/staging/dialogue constraints; suggest smaller event | Advisory, or review proposed Intent/Prompt | No fabricated media tests or automatic generator settings |
| “We're ready to produce this.” | Explain missing essential creative details, not arbitrary checklist emptiness | Optional reviewed Prompt from Intent + saved facts | Author decides to use separate generation UI; Director doesn't generate |
| “Read the whole Project.” | Assess actual selected facts and where gaps matter | Explicit Project brief + Scene overview Read, optional selected full prompts | Payload shown, size disclosed; missing/unread context stated |

### Multi-target mutation rule

For *changes that conceptually belong together*, use one clear review and either one atomic backend transaction or **explicitly state that the current capability is not atomic and do not advertise it as supported**. Particularly important: Scene split; a beat moved between two Scene Intents; multi-Scene coherent revision; Invariant rename plus dependent references. Do not fake atomicity by chaining independently committed browser requests. Do not tie unrelated prompts or media into these edits.

For literal Scene reorder or clone, the creative LLM has no unique value: use existing deterministic semantics under a reviewed scope. The Director may give artistic advice about the order, but should not be needed to execute an exact order that the author specified.

### Removal boundary

**Scene removal is not first-pass parity:** `storyboard_store.delete_scene` clears Take metadata and removes Take/reference artifact directories. This is a substantial side effect, not simply deleting prose. Favor moving, merging, parking or replacing material. Any later Director remove operation needs its own truthful destructive-effects review and restore limitations; never implicitly delete a Scene when splitting/merging.

## 6. Audit risks and corrections by severity

### P0 — Breaks the collaboration promise

1. **Chat-to-review handoff is missing.** `director_chat.js` freeform response/readiness is not a per-field materialization proposal. Readiness checks have names/scopes/content but not authoritative target IDs or approved field values. Write generally invokes a *second* LLM extraction and operation selection. **Fix:** one clean vertical slice where a complete material proposal from conversation opens the matching editable review with correct existing state. Do not use vague readiness check text as an unchecked save payload.
2. **Creative edits across multiple existing Scenes have no coherent Studio review/Apply.** `apply_studio_scene_fields` is one Scene; `add_tentative_scenes_at` is only new Scenes. **Fix:** scoped batch with before/after by exact stable ID, all selected fields checked, atomic Story JSON write. Implement only when a tested workflow (move beat, revise several, split) needs it.
3. **Director material isn't consistently attached to a target.** It knows field purpose but “Write” still needs operation dropdown/checkboxes; Scene proposals in current conversation aren't offered as a focused review. **Fix:** precise contextual Review action + existing rail as fallback. Field naming should be an implementation detail.
4. **Failure/receipt continuity requires care.** Backend save and conversation receipt are separate; Undo Project brief is limited to latest revision and UI receipt can be lost on reload. **Fix:** exact save status and recoverable intended review/Undo as needed, not universal transactional chat storage.

### P1 — Expected feature completeness

5. **Scene structural parity:** reorder + duplicate not exposed to Director; existing `/fs/storyboard` handlers have no Studio-specific review/expected-order contract. **Fix:** reuse store functions behind a small reviewed, conflict-checked Studio path. Reordering is in scope, though below core field capture.
6. **Explicit Read is correct but can balloon.** Whole-Scene includes full H3 Prompt; a 15+ Scene Read can be large. UI reports character count but enforces no size bound, and the legacy server `read_story_scope` 32k limit does *not* govern this workbench path. **Fix:** overview-first defaults, exact preview/size, deliberate full-prompt selection, and a real request-size guard or clear prompt to narrow before Send. Do not auto-deduplicate Invariant prose unless measured payloads justify it.
7. **Readiness is advisory, not verified completeness.** `studioDirectorChatRequestMessages` asks for up to ten LLM-authored checks; `studio_director_workbench.js` accepts scoped Project/Scene labels but has no per-Scene saved-field coverage proof. **Fix:** grounded checks from explicitly read material and identified proposed fields, not a new persistent score or gating system.
8. **Prompt quality and context:** Need to verify the *actual selected* LLM knows H3 feasibility and returns usable complete text for Scene Prompt. Existing general Studio guidance is intentionally concise; `docs/mmh3-prompt-runtime-context.txt` is distinct from freeform chat. **Fix:** use focused prompt-authoring contract for full H3 prompt, not a blanket technical primer on every chat message; test real outputs.

### P2 — UX clarity and documentation debt

9. **Two vocabularies / historical UI overlap:** old `docs/studio-director-revamp.md` and `docs/studio-director-side-panel-implementation.md` describe already replaced flows; obsolete guideline/entry-exit wording persists in older Storyboard docs. **Fix:** assign one owner to current intention-to-materialization contract and label older status as historical.
10. **Potential field/intent duplication:** Project Concept, Style and Invariants must remain distinct; a model may propose repeating identity inside every Scene. **Fix:** review changed fields only, preserve verbatim author's intent, and suggest moving reusable facts to existing Invariant records. No new creative field types.
11. **Cosmetic overbuilt readiness:** many checkbox dimensions can compete with one useful creative next step. **Fix:** prioritize one actionable recommendation and let richer diagnostics open on demand; no colored completeness dashboard or mandatory questionnaire.

## 7. Execution plan — safe, small vertical slices

**Do not implement all operations in a single generic framework.** Each phase should leave a demonstrably better real workflow. Do not change generation, GPU scheduling, technical controls or unrelated Studio UI. Follow `AGENTS.md`: test concrete capabilities before adding indirection; no new app-private roots, event buses, parallel schema, speculative permission gates or hidden failures.

### Phase 0 — Freeze baseline and prove the critical model capability

- Write a small *fixed* suite of author utterances and relevant saved source fields covering one clear Concept, one new Invariant, one edit to existing Invariant, one Scene Intent revision, one no-op, and one ambiguous destination.
- Exercise the **actual chosen local Director LLM**. Observe whether it (a) produces a specific useful complete field value, (b) names the correct creative home, (c) distinguishes proposed from already saved, (d) abstains when undecided, and (e) retains the author's creative direction.
- Inspect current conversation + readiness payloads, review prep requests and elapsed/model cost. Determine whether the current response contains reliable reusable creative material, or whether a structured draft call is necessary in ambiguous cases.
- Establish tests for unsent composer, explicit Read, missing/stale context, saved Apply receipts. Do *not* build new transport before this evidence.

**Gate:** Evidence supports one field-specific normal flow, with one acceptable bounded fallback when the model cannot produce an exact field value. If unreliable, use explicit Prepare (existing model extraction) rather than pretending materialization is deterministic from ambiguous prose.

### Phase 1 — One end-to-end “Review this material” slice (highest priority)

- Begin with **Concept** or one **Invariant**; select the one that Phase 0's LLM actually handles reliably. The author sees a natural next-step invitation in the chat (not a pile of action buttons).
- Use an existing workbench review and `/fs/studio/director/brief` endpoint. Bind selected Project, current original field/entity and proposed complete value. Never overwrite untouched data or infer removals from omissions.
- If a target is ambiguous, require one simple user choice rather than guessing. If author declines a suggestion, leave conversation intact.
- Show meaningful before/after; editor open at proper size; Apply/Discard; return authoritative saved receipt and keep the author in the same conversation.
- Keep explicit Read/Write fully functional as fallback. No extra persistent creative state.

**Gate:** Starting from “That's our concept—save it” or “Define Alice”, a normal user reaches saved state without selecting a generic operation or copying prose. No hidden Apply, and manual edits remain intact. One negative conflict test and one successful Undo test.

### Phase 2 — Cover every core single-field/entity journey

- Extend handoff to Project Title, Concept, Visual; Invariant add/update/rename/remove explicitly; Scene Title/Intent/Prompt; single Scene insert. Add and rename multiple Invariants in the same review where the author asked for them.
- Reuse `invariantOps`, CAS, coordinated active Scene references. In review, explicitly show Scenes whose links will change on an Invariant rename. Do not silently rewrite prose prompts.
- For Scene Prompt, use the existing focused H3 prompt authoring instructions and review the complete saved prompt. When Intent changes without Prompt changing, show a subtle **“Prompt may need review”** note, not an auto-update or “incomplete” badge.
- Keep default outcome *one* small action when discussion is still exploratory; don't force saving every field.
- Verify new-Project creation works with 0, 1, several initial Scenes, and continuation from the saved Project in the same conversation.

**Gate:** Every five-field single-target workflow in Section 5 works; each preserves other fields, old/Takes data, manual save coordination, and exact IDs.

### Phase 3 — Multi-Scene creative restructuring

Implement only the small additions needed for the user journeys, in this order:

1. **Batch review/apply of selected fields for existing Scenes**; reuse `_normalize_scene` and store ownership. Expected originals scoped by Scene ID + field; snapshot/commit once. This unlocks “move dialogue from A to B” and “revise Scenes 1–3”.
2. **Scene reorder** with exact `sceneOrder` before/after and expected order, no LLM request for literal moves.
3. **Split Scene** as a compound change: replace one Scene Intent plus insert a new tentative Scene, with the entire before/after reviewed and committed atomically; no automatic edits to existing Prompt/Takes.
4. **Duplicate Scene** using existing `duplicate_scene` behavior with visible clone semantics. Ensure duplicated references/settings are declared; no Take copies; any optional new creative rewrite is separately reviewed.
5. **Merge Scene text** via multi-Scene update; leave redundant original Scene untouched until the author separately elects to remove it.

**Gate:** Stable IDs and order survive; conflict or save failure yields zero partial edits; retries do not create duplicate Scenes; a split leaves original Take provenance untouched and the new Scene has no Takes; after Apply the chat receipt accurately includes all touched IDs/values.

### Phase 4 — Read and production-readiness coherence

- Default “inspect Project” to brief + concise Scene titles/Intents/order, then allow full Prompt inclusion only when useful; show measured size before send. Do not silently strip selected fields.
- Offer precise, grounded next steps: e.g. “We know the premise but haven't defined recurring Alice's appearance” or “Scene 4 has two substantial events and may exceed eight seconds.” Tie advice to *actually supplied* Read or conversation material.
- Preserve model-authored assessment as **advisory**, with stale/unknown labels where saved facts are not known. No hard gates or required characters/dialogue/settings for every Project.
- Test 15+ Scenes, an empty Project, one-clip Project, montage, nonnarrative Project, intentionally ambiguous character, and Scene moved to a different position.

**Gate:** No invented knowledge or hidden context; no excessive context request; observed local-model judgments meaningfully distinguish essential omissions from creative flexibility.

### Phase 5 — Interaction audit and feature-complete signoff

- Walk the Section 5 journeys in a real WebCap browser, with actual selected local LLM and durable session reopen, at regular and narrow widths. Include keyboard, undo, interrupted/failed LLM, stale original, pending save, no model connected, deleted target, and restored/reloaded chat.
- Count actual author interactions and duplicate model calls; remove redundant UI steps only after preservation tests pass.
- Audit overlapping old Studio entry points in `director_chat.js`, manual Storyboard `storyboard.js` and the workbench. Remove obsolete *surfaces* after parity; preserve historical records and unrelated users' workflows.
- Mark feature-complete only when all included ordinary intentions work with materialization and feedback. Keep excluded controls excluded; Scene destructive delete stays deferred unless a real authoring journey proves it necessary.

**Gate:** Tests cover BOTH determinism and the real creative conversation. Report separately: code tests / browser tests / actual model tests / unverified behavior.

## 8. Deterministic Apply/Undo and concurrency acceptance rules

- **Only explicitly approved** fields, entities and structural operations are committed. On model omission no delete. No blind whole-array replacement for a selective Invariant edit.
- **Target by stable saved ID** (`story.id`, `scene.id`), not Scene number in chat; Scene number must be resolved against reviewed current order. Human labels may disambiguate but never authorize the wrong target.
- **Fetch authoritative state just before review**, flush pending UI saves before Apply, and check precisely the expected original fields/order. A concurrent unrelated Concept change must not block a Scene Intent edit; a concurrent edit of the selected field must block rather than overwrite.
- **Atomic at the meaningful review scope:** if multiple selected Scenes must change together, stage all selected changes and write one Story JSON transaction. Filesystem side effects (new Scene folders, media) need explicit staging/cleanup when relevant; do not claim atomicity of a series of requests.
- **Prompt/Takes preserved:** editing an Intent, Style, Invariant or order never rewrites H3 Prompt, Take metadata or generated media unless separately and visibly approved. Prompt becoming potentially stale should be noted, not silently fixed.
- **Scoped Undo:** existing latest Project brief Undo retains field/ref CAS; new compound Scene mutations should have an appropriate guarded before/after receipt. Avoid false “Undo” promises for physical media deletion or when a later edit conflicts.
- **Receipt reflects saved response, not candidate:** record precise resulting fields/IDs/order after Apply; separately report a failed conversation save, missing receipt, or failed workspace refresh. Preserve edit draft on a failed Apply.
- **No latent background work:** new Studio logic runs only when Studio/Director is actually used; opening Read/Write panels may load small metadata, not auto-run expensive analysis.
- **Unsupported/ambiguous operations fail visibly with a useful next action;** do not silently approximate them as a different saved change.

## 9. Verification matrix to implement alongside each slice

| Test class | Minimum representative cases | Where |
|---|---|---|
| Proposal interpretation | Explicit “save that” after developed Concept; two plausible target Scenes; suggestion declined; one-line no-op; multiple discrete decisions | Real local LLM transcript fixtures plus a live probe; do not label prompt-only tests as proven |
| Project review | Create 0/1/multiple Scenes; update title/concept/style; stale and unrelated field change; before/after and Undo | `tests/test_studio_scene_draft.py`, `tests/test_storyboard_store.py`, client review tests |
| Invariants | Add 2, edit 1, rename referenced character, refuse referenced deletion, no model-omission deletion, concurrent unrelated edits, Undo refs | `tests/test_studio_invariant_ops.py` + focused UI test |
| Scene text | Edit Title/Intent/Prompt singly; batch across two Scenes; preserve prior prompt, Takes, refs and optional legacy data; conflict/no partial | Existing `test_studio_scene_draft.py` + new atomic batch tests |
| Scene structure | Move before/after; duplicate; split with exact placement; merge without auto-remove; stale order; retry after unknown response | New reviewed structural route/backend/client tests |
| Read | Project overview, entire single Scene, 15+ Scene overviews, full prompt size warning, exact sent-data serialization, wrong Scene ID, acknowledged receipt mismatch | `tests/studio_director_workshop.test.cjs` plus live request inspection |
| Lifecycle | Save receipt failure after successful backend commit, reopen chat, changed destination, discarded proposal, pending editor save and job activity | `tests/test_director_chat_history.py` + browser |
| UX | One obvious next action; no redundant model call for complete material; edit proposal in review; narrow panel and keyboard navigation; errors in global Console | Real browser walkthrough |
| H3 judgment | 6s single action, 15s multiphase motion, dialogue pressure, nonnarrative montage, no reference frames, no claimed visual Take inspection | Real selected model (and optional actual generation) |

### Mandatory reporting before merge

For each phase, record: base commit/branch, exact changed files, existing contracts reused, scenarios executed, source-based guarantees, local-model/browser cases actually performed, failures/limitations, and whether the result truly shortened the author journey. A green schema/unit test is not evidence that an LLM made a good creative judgment.

## 10. Very next implementation handoff

**Start with Phase 0 and the smallest Phase 1 vertical slice; do not jump straight to a generalized action router.**

1. Open this document alongside `AGENTS.md` and inspect current `tool/server/studio_director.py`, `tool/js/director_chat.js`, `tool/js/studio_director_workbench.js`, `tool/server/storyboard_store.py` and `tool/server/app.py`. Recheck `main` after any intervening merge.
2. Trace “We have the Concept; save it to this Project” end to end: conversation material → proposed final Concept text → explicit selected Project → editable review → existing scoped backend Apply → saved authoritative receipt → continue discussing. Mark each redundant manual step.
3. **Probe selected local LLM** with one complete Concept and one Character Invariant. Confirm whether the authored text is retrievable without a second model request. If not reliable, use *one explicit existing structured Prepare request* as a fallback, not a speculative freeform JSON parser.
4. Implement only the one proven conversation-to-review action, preserving explicit Read/Write routes, current session state and Undo. Avoid another modal if the current reviewed form suffices.
5. Add regression cases for exact target, untouched fields, stale original, rejected draft, successful Apply receipt, and no duplicate model call when already authored material exists. Run the focused Studio test suite and a real browser/LLM check before merge.
6. Proceed to other workflows from Section 5 **incrementally**, never treating bare API parity as the acceptance condition.

**Feature-complete means** an author can freely develop, capture, refine, rearrange and coherently revise the creative material for an entire Project using natural collaboration, with exact deterministic reviewed changes, honest grounding and no forced management of legacy/technical fields. It does **not** mean Studio Director becomes a media analyzer or a universal WebCap operator.
