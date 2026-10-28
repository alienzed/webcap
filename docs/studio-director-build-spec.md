# Studio Director build specification

Date: 2026-10-28. Status: design direction for implementation; behavior below is not yet delivered or locally accepted.

Studio Director helps one creator develop ideas into worthwhile short video Scenes, with enough preparation to avoid expensive failed Takes. Conversation develops understanding and content. A small, explicit interface reads selected context and writes reviewed results. WebCap coordinates those operations; the model supplies creative judgment and words.

This specification supersedes conflicting direction in [the earlier Director revamp plan](studio-director-revamp.md). Follow [AGENTS.md](../AGENTS.md), the [filesystem state contract](filesystem_state_contract.md), and the [GPU coordination invariants](gpu_coordination_invariants.md). Existing Projects, prompts, references and Takes must survive implementation.

## 1. Product priorities

- Keep the path from discussion to saved work obvious and progressive. Use two primary workflow entries, provisionally **Read…** and **Write…**. More than three competing primary entries is a design warning, not a numeric validation rule. Send, cancel, navigation and contextual editing controls still exist.
- Spend time preparing with Director when it saves rendering attempts. There is no target conversation length or question limit. Ask briefly, one useful question at a time; elaborate when requested.
- Director understands WebCap's actual capabilities and current context. It identifies material uncertainty, proposes practical choices, and can invent details when the author delegates.
- Default to immediate substance and economical staging. A short Scene should deliver the premise rather than spend its duration approaching it.
- Readiness guides suggestions and selections. The author can proceed, change destination, change counts, omit fields or override advice. Creative uncertainty is not an application permission gate.
- Report operation failures clearly, including the underlying detail in the global Console. Do not conceal incomplete work or silently repair a proposal into a different operation.

The author's reported working constraint is about eight minutes to render a fifteen-second Scene at roughly one megapixel. A two-hour session may yield only two to four satisfactory clips after retries. This motivates the defaults; it is not a universal benchmark or hardcoded runtime estimate.

## 2. Director workspace

Retain the recognizable Studio layout while removing the competing preparation buttons and permanently exposed creative forms from Director's main conversation area.

The main surface contains the conversation, a comfortable composer, a compact view of supplied context and Director's understanding, and Read/Write. Secondary details expand in place. Existing editing and generation controls remain available in their appropriate Studio surfaces.

Opening Director immediately permits composing a message. Model discovery, loading and queue state have visible status but do not require an automatic greeting request before typing. Sending uses the existing queue. Preserve draft text through loading, failures, navigation and layout changes.

### Read

Read selects a Project, one or more Scenes, specific content, or an Idea. A Project opened in Studio is a convenient default, not an implicit attachment or a locked destination.

Reading a Project provides its Concept, relevant reference notes and an honest Scene overview. Further details are available on demand. Show what was supplied and what is merely available to read. A summary of titles and Intents must not be presented as inspection of every prompt or Take.

Conversation context and the eventual write destination are independent. The author can discuss Project A and apply a reviewed proposal to Project B. Show a concrete mismatch warning when useful and permit the choice.

### Write

One progressive workflow handles the destination and operation, the selected content, its editable proposal, and final Apply. Opening it performs no mutation. Model drafting, when needed, has explicit visible progress.

Supported destinations are a new or existing Project, new or existing Scenes, an Idea, and the editable Production Playbook. Context supplies defaults. Every applicable destination, Scene selection and field selection remains editable.

Examples:

- A discussion only about a recurring character preselects the relevant reference content.
- A developed new Project can include several proposed Scenes in the same review.
- Expansion preselects the current Project, a suggested editable Scene count and placement at the beginning, between Scenes, or at the end.
- Dialogue revision presents the discussed dialogue and the proposed change to its containing prompt, without forcing the entire Project into chat.

Changing a count or destination does not trigger a creative-coherence veto. Preserve editable proposed material and make the pending operation visible. If a proposal has ten rows and the author wants one, let them select or remove rows. Additional drafted material can be requested; it must not be invented during the final storage operation.

The server applies explicit IDs and selected changes, preserves unrelated content and reports the result. Protect against actual stale-write collisions and invalid operation arguments; do not add semantic approval rules about whether the author's choice is sensible. Compound creation should save the reviewed Project and its Scenes together rather than leave accidental partial work.

## 3. Minimal creative content and persistence

The authoring model is a readable **Concept**, optional named **reference notes**, and Scenes with their descriptions and saved generation prompts.

Concept may use optional prose headings for visual direction, pacing, structure or anything useful to that Project. These are writing aids, not required fields or a new structured outline. Director's checklist does not dictate the document's headings.

Reference notes retain reusable established details about a character, place, object, visual approach or world rule. They can be developed through conversation and reviewed Write. They are not uniformly immutable: a character's normal work clothes and recognizable facial features have different meanings. “Invariants” is an existing storage concept, not the required user-facing label.

Remove dedicated continuity entry/exit editing and new entry/exit generation from the normal workflow. Consolidate the authoring UX without silently deleting old style, guidelines, invariants or continuity data. Existing authored values remain readable and available as context until explicitly consolidated. Use existing storage where its meaning fits; choose any additive persistence change only after tracing all consumers. Do not concatenate competing versions silently or create duplicate authoritative copies.

Scene Intent remains a useful description of what happens. It is distinct from the saved H3 Prompt used for generation. Neither distinction requires the author to repeatedly copy or maintain the same information in multiple places. Director should materially help with dialogue, detailed prompts and practical translation into generation instructions.

### Persistent facts and provisional understanding

Saved Project and Scene content is authoritative. A conversation may retain a compact working summary of decisions, delegated choices, tentative suggestions and open questions. This is working state, not a second hidden Project database.

Accepted creative knowledge is captured through Write into durable Project content. Reopening a Project must work without the original conversation. Reopening the conversation restores its provisional work. Fresh Project reads take precedence over stale working summaries; a suggestion is not treated as accepted simply because Director proposed it.

Imported Ideas retain their exact supplied text in the conversation. Long-discussion management must preserve material decisions and original history, expose summarization, and avoid silent arbitrary truncation. Keep source associations simple enough to distinguish authored facts from model suggestions and historical context.

## 4. Contextual consistency

Every T2V Scene is generated independently. Its prompt needs the relevant identity, appearance, setting and action explicitly, even when the conversation already established them.

Before prompt drafting, supply the Project Concept, relevant reference notes, the target Scene, relevant established changes, and the current request. Director resolves what applies to this Scene. It should not require the author to explain ordinary situational changes.

For example, a janitor normally wearing overalls can wear swimwear at a pool while retaining recognizable features. The proposed Scene prompt makes the selected appearance explicit. It does not need a changing-room Scene unless that action matters creatively.

Identity can also evolve: aging, injury, disguises and intentional transformations are legitimate. Sequence position alone does not establish chronological time. Independent variations and flashbacks must not inherit every state from the previous row. Director uses the Scene's meaning and asks about consequential ambiguity.

Python owns retrieval, stable identity, persistence and the exact write scope. The LLM interprets relevant facts and drafts the resolved description. Avoid a speculative simulation engine or a growing taxonomy of clothing and character-state fields.

## 5. Director expertise and understanding checklist

Director is a WebCap Studio assistant with practical expertise in the supported T2V workflow, not a generic writing assistant. Each operation receives the capabilities it can actually use, relevant technical constraints, the creative guidance, and the selected context. Available actions and planned features must remain distinguishable.

Director maintains a task-aware assessment of whether the discussion supports useful drafting. This is richer than “a field contains text.” Checks activate only where relevant; the following are assessment dimensions, not mandatory authoring fields.

| Dimension | What Director should assess |
| --- | --- |
| Central event | The proposed clip contains a specific worthwhile interaction or visible event. |
| Character appearance | Relevant characters have concrete distinguishing visual details adequate for a self-contained T2V prompt. |
| Multiple subjects | Subjects can be distinguished and their actions and dialogue attributed. |
| Location | Important layout, spatial relationships and environmental details are understood. |
| Actions | Physical actions and their visible results are sufficiently concrete. |
| Objects and interaction | Important props, ownership, contact and movement are understandable. |
| Dialogue | Wording, speaker, delivery and plausible time allocation are developed. |
| Powers and unusual behavior | Appearance, effects and relevant limitations can be depicted. |
| Consistency and change | Relevant identity facts persist while contextual or intentional changes are incorporated. |
| Visual treatment | There is enough direction to choose an appropriate clear presentation; unexplained film terminology is unnecessary. |
| Timing and density | The central event starts promptly and fits the available clip without excessive staging or overloaded action. |
| Generation approach | Supported references and settings are understood; practical limitations are explained where relevant. |

For material gaps, Director asks a focused question, offers a concrete proposal, or supplies a developed choice when the author delegates. “Invent a unique character” authorizes invention sufficient for drafting; it is not an invitation to ask the author for every physical feature. When a detail is consequential or conflicts with established content, explain that briefly.

Visible status should summarize understanding, such as “Character established,” “Three Scenes developed,” or “Location still open.” An expanded view shows a short factual explanation and remaining questions, not private reasoning. The author can correct it. Status can change as the conversation changes, and it never disables Read, Write or ordinary editing.

“Sufficiently described” means ready to attempt drafting, not proven visual consistency. Actual Takes establish render behavior. Director must not claim to have inspected media when only text or Take IDs were supplied.

### Model protocol

Prototype a small structured response carrying a concise reply and bounded understanding updates in the same normal model turn. Use the existing schema-capable runtime and explicit validation. Read requests are a finite supported operation, with fresh results supplied to the model before answering. Allow the concrete reads a question needs rather than forcing an answer after one inadequate read; expose failures or exhausted operation limits.

Avoid background polling or extra inference on every keystroke. Working-state updates must relate to the conversation revision that produced them. A failed or malformed response must not fabricate completion or overwrite approved Project content.

Schema compliance establishes shape, not semantic quality. Test the chosen local model's assessments, read selection, latency and conversational quality before depending on this protocol for the UI. A second model call per reply is not the assumed design.

## 6. Guidance for worthwhile footage

Use one concise production baseline across conversation and relevant planning, drafting and revision operations. Audit the actual composed requests, including legacy Develop paths and user Playbook text, for conflicting or duplicated instructions.

Desired default behavior:

- Start with the central action or interaction underway. Begin dialogue promptly when dialogue carries the Scene.
- Weave context and characterization into the event being depicted.
- Compress conventional setup into purposeful audiovisual detail. Each Scene should deliver something worth the rendering attempt.
- Use economical staging and feasible dialogue. Density means useful content, not an impossible number of events.
- Follow the developed Project's organizing idea when drafting; adapt proposals through the author's editable selections without adding creative enforcement gates.
- Offer specific practical advice when visual consistency, crowded action, long dialogue or repeated independent generations create risks. Describe uncertainty honestly rather than inventing thresholds or guarantees.
- Use slower openings and atmosphere-led Scenes when the author wants that treatment.

Write affirmative, concrete model instructions in accordance with AGENTS.md. Do not hardcode the author's hardware timing as a generation fact. Any runtime estimates should use available measured history and be identified appropriately.

## 7. Ideas

Ideas are independently saved reusable text with a title and stable identity. They can describe a character, place, power, visual device, formula or any developed concept. Keep type categories optional or omit them initially.

Provide a searchable Studio Ideas home for creating, editing and removing entries. Director can read an Idea, help develop it, and Write a reviewed new or updated version.

Slash autocomplete inserts the selected Idea into a conversation as an inspectable one-time text snapshot. Subsequent Idea edits do not change existing conversations or Projects. Extend insertion to relevant text editors where it has demonstrated value, while preserving ordinary slash typing, keyboard navigation and cancellation.

Project-specific adaptations belong to the Project. No live reference propagation or automatic synchronization is needed. Store Ideas as durable user work using the repository's centralized filesystem ownership; chat cleanup must never remove them.

## 8. Reviewed Playbook improvement

The author can discuss recurring unwanted behavior with Director and request a guidance improvement. Director must be able to inspect the instructions actually supplied to the affected operation, including editable Playbook content and the relevant built-in guidance.

First distinguish a missing instruction from conflicting instructions, missing context, a routing defect or model failure. Director's account of why it behaved a certain way is a hypothesis, not authoritative introspection.

Write offers a reviewed Playbook amendment or replacement with before/after text. Reuse the existing editable model-guidance store. Prefer revising conflicting wording over accumulating prohibitions. Keep technical runtime facts and executable application behavior outside this editable surface; Playbook writing cannot modify Python, tools or backend limits.

Saved guidance reaches conversation and all applicable drafting operations. Explain when a desired correction instead needs a code change. Re-run the relevant behavioral example after a guidance update; saving the text alone does not establish improvement.

## 9. Verified implementation starting points

The following observations are from main at `42dd6669` (PR #776), inspected on 2026-10-28. They define starting points, not proof of local browser or model acceptance.

| Area | Existing implementation and consequence |
| --- | --- |
| Persona and expertise | `tool/server/studio_director.py` supplies Studio/H3 context and optional configured Playbook. Strengthen and reconcile this with operation-specific guidance rather than adding a competing persona. |
| Legacy development | `tool/server/storyboard_llm_contract.py` and `docs/storyboard-director-context.txt` separately guide Develop/outline/Scene authoring. Inspected guidance lacks the strong immediate-substance baseline. Audit every composed path. |
| Opening conversation | `startStudioWorkshop()` in `tool/js/director_chat.js` queues an introductory model question. Remove this dependency from opening and composing. |
| Reads | `resumeStudioAfterRead()` supports one model-requested scoped read and instructs the continuation to request no more. Broaden the finite read protocol to support relevant multi-part context. |
| Reviewed writes | Project, brief and Scene review flows already exist but are separate. Project creation accepts zero or one initial Scene; sequence drafting is separate and capped at eight. Consolidate the UX and support reviewed multi-Scene creation without preserving accidental limits as product policy. |
| Structured output | `tool/server/app.py` defines operation schemas and `storyboard_llm_runtime.py` forwards JSON-schema response formats. This is a starting point for understanding signals, not evidence of their quality. |
| Persistence | `director_chat_history.py` stores messages, attachments and revisioned session state; `storyboard_store.py` owns saved Project/Scene data and reviewed mutations. Keep ownership explicit. |
| Continuity | Entry/exit values are present in the editor, context assembly, schemas and generation provenance. Trace consumers before retiring authoring paths; preserving stored records is separate from continuing to generate these fields. |
| Regression gap | The focused reviewed Project continuation test excludes the initial Scene. Add the combined creation and persistent-continuation case alongside the new multi-Scene path. |

## 10. Delivery sequence

1. **Audit and capability proof.** Trace complete outbound requests for conversation, Develop, extraction, reads and prompt revision. Exercise the structured reply/understanding/read protocol with a representative configured local model. Record actual quality and latency before expanding orchestration.
2. **Read/Write vertical slice.** Simplify the Director surface, permit immediate composing, provide explicit context selection, and consolidate reviewed new-Project creation with multiple Scenes and persistent continuation. Demonstrate subsequent scoped reads and a reviewed Scene revision in the same conversation.
3. **Content and prompt preparation.** Introduce the Concept/reference presentation, retire continuity authoring, and prepare/revise selected Scene prompts with resolved relevant context. Preserve legacy authored data and generation/Takes behavior.
4. **Ideas.** Add durable storage, the management surface, slash insertion, and reviewed Director creation/update through Read/Write.
5. **Playbook review and completion.** Add guidance inspection and reviewed Playbook writes; complete request parity, behavioral checks, error feedback and browser acceptance across the full journey.

Introduce the shared substance-first guidance early, then verify it at every affected drafting stage. These are reviewable increments, not permission to leave duplicate primary entry points or incompatible prompt paths indefinitely. Follow existing plain JavaScript, Python and file-based patterns; no agent framework, vector database, event bus or generic workflow engine is needed for this scope.

## 11. Acceptance cases

| Case | Expected behavior |
| --- | --- |
| Piano teacher | With one student per Scene across years, Scene one already depicts the first lesson. Aging and influence emerge through successive lessons; preparatory Scenes are not the default. |
| Interview | The opening Scene delivers a meaningful question, answer or revealing interaction. Seating and staring alone are not the default fulfillment of an interview premise. |
| Pool | A defined character retains recognizable identity while clothing adapts plausibly to swimming, without requiring the author to specify a general clothing-change rule. |
| Delegated invention | “Make a unique character” produces sufficiently concrete visual details and a useful proposal without an exhaustive questionnaire. |
| Ambiguous action | Director identifies a material uncertainty and briefly asks or proposes rather than marking the item understood because the subject was mentioned. |
| Multi-Scene creation | Write creates a reviewed Project and selected initial Scenes together; the same conversation continues with the created Project available after reload. |
| Existing Project expansion | Read supplies useful current context; Write adds reviewed Scenes at the selected position and destination, including a different Project when chosen. |
| Narrow revision | Dialogue discussion stays focused; Write targets only selected content and preserves unrelated prompts, reference settings and Takes. |
| Manual override | Changing count, destination or selections remains possible despite a warning or incomplete understanding. Operation failures remain explicit. |
| Idea reuse | Inserted text survives conversation reload and remains unchanged after editing the original Idea. Director can save a reviewed adaptation separately. |
| Playbook correction | A reviewed change is persisted once and appears in the relevant conversation and drafting payloads. Its behavioral effect is evaluated separately. |
| Reopening and long discussion | Saved Project knowledge is usable in a fresh conversation; provisional understanding and decisions survive reopening without stale summaries overriding fresh facts. |

### Verification boundaries

Automated regression tests establish schema handling, context selection, selected IDs and fields, revision behavior, compound saves, persistence, error reporting, and preservation of existing records and Takes. Include the originally identified with/without-initial-Scene continuation gap and subsequent reads/modifications.

Browser acceptance establishes discoverability, readable hierarchy, keyboard use, immediate composing, preserved drafts and selections, editable review scope, and clear loading/failure states. Follow AGENTS.md typography requirements for revised surfaces.

Repeated local-model runs establish whether Director asks useful questions, invents adequate details, reports understanding honestly, resolves context, and drafts substantive Scenes. Evaluate saved outputs against the examples, including changes of direction and reopening. Passing string assertions on prompt instructions is not behavioral acceptance.

Actual H3 Takes establish whether appearance, timing, dialogue and action render usefully on the author's runtime. Keep authoring acceptance separate from rendering acceptance. No prose checklist or structured response can guarantee consistent video output.

Before each implementation merge, audit the diff against current main, run applicable tests, identify the browser/model/render checks actually performed, and report remaining gaps plainly.
