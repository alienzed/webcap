# Studio Director expertise map

**Status:** Living audit and acceptance tracker. Initial codebase review: 2026-10-30, against \`main\` at \`decccb211e88374eaeb985b709be39ebb9984270\` (PR #816 included). **Evidence:** repository code and tests only; no running WebCap browser, live Director model, or GPU inference was exercised for this baseline.

**Purpose:** Answer a sharper question than "does the feature exist?": **Can Studio Director explain WebCap correctly, get the right context, make expert recommendations, and guide the author through a working, reviewed action?** It should know more about supported Studio workflows than the author needs to. This is an *audit*, **not** a second system prompt, runtime capability registry, or permission to automate edits.

## Operating contract

1. **Authority stays in code and existing source docs.** This file records evidence, gaps and acceptance results. It does not grant Director new API/UI capabilities. Reconcile it with \`AGENTS.md\`, \`tool/server/studio_director.py\`, \`tool/js/director_chat.js\`, \`tool/js/studio_director_workbench.js\`, and the current server routes before implementing anything.
2. **Separate five questions for each capability:** **K** = knows what the feature is and its actual constraints; **G** = can give useful domain-specific guidance; **C** = knows what context it has/needs without inventing saved data; **A** = can route to the real author-reviewed action; **V** = verified with a *real* model + browser flow. Static tests and API presence are not proof of K/G/V.
3. **Director authors; WebCap binds and applies; author approves.** The model may suggest material or a destination. WebCap selects stable IDs, fetches authoritative saved values, presents editable review, checks conflicts and writes only approved changes. Conversation alone never mutates a Project.
4. **Respect the scope boundary.** The shipped Director contract concerns Studio creative authoring. WebCap also has generation, Takes, LoRAs, training, QA, and other features; Director may explain them only to the extent of supplied guidance, and must not claim tools or private state it has not received.
5. **Prioritize observed user friction.** A gap is "confirmed" only when grounded in code, an actual response, or a reproducible user journey. Otherwise label it "needs live verification." Do not grow a generic action executor or duplicate the capability catalog.

### Status vocabulary

- **Wired** — implementation/path and focused tests identified; *not* a live-model pass.
- **Partial** — a meaningful part works, but the requested expert behavior or context/action bridge is limited.
- **Not exposed** — WebCap supports it elsewhere but Director has no reviewed control for it.
- **Unverified** — live model, UX, or result quality not exercised.
- **Proven** — linked reproducible live-model + browser evidence with correct saved outcome. **Nothing in this initial baseline is labeled Proven.**

## Where Director's knowledge actually comes from

| Source | What it contributes | Boundary and evidence |
|---|---|---|
| \`tool/server/studio_director.py\`: \`_WORKSHOP\`, \`_H3_STUDIO_CORE\` | Creative-director behavior, five-field ownership, H3 feasibility principles, read/write safety | Concise manually maintained expertise, **not a generated inventory of WebCap**. \`tests/test_studio_director.py\` |
| \`tool/server/studio_director.py\`: \`ACTIONS\` | Descriptions of **available UI-mediated** capabilities | Catalog descriptions are not direct model tools; they do not supply field contents, all UI controls, or verified judgment. \`/fs/studio/director/guidance\` |
| \`docs/mmh3-prompt-runtime-context.txt\` | Canonical H3 prompt shape: subjects, anchors, visual treatment, timed \`[Shot N]\`, dialogue and audio | Included in normal Studio conversation **and** explicit Prompt-field Write via \`studioDirectorRequestMessages\` (PR #816). Contract delivery tested; understanding/quality still unverified. |
| \`app_config.config.generation_model_guidance.minimax_h3\` | User-editable H3 Playbook | Distinct from the canonical template; not a replacement for field ownership or verified model capabilities. \`studio_director.py:guidance\` |
| Explicit Read / reviewed Apply receipt | Actual selected Project/Scene values and authoritative saved outcomes | No silent re-read of whole Project. \`studio_director_workbench.js:readSend\`, \`director_chat.js:studioDirectorBridge\`, \`tests/studio_director_workshop.test.cjs\` |
| Readiness response | Advisory \`checks\`, \`readHints\`, \`writeHint\`, optional \`writeFields\`, \`sceneId\`, optional single \`capture\` | Not an executor; stale assessments are marked outdated. \`studio_director_workbench.js:updateReadiness\`, \`tests/studio_director_readiness.test.cjs\` |
| Studio Blocks | User-authored Idea/Guidance text, explicitly inserted through \`/\` in the composer | **Not** automatically injected as Director expertise or accessible as a Director-managed library. \`docs/studio-blocks.md\`, \`tool/js/studio_blocks.js\` |

## Expertise / workflow matrix

**Initial K/G/C/A assessments below describe delivery and wired paths, not model competence.** Verification (V) stays unverified until a realistic conversation, review, and saved-state check are recorded.

| WebCap domain | Current delivery and actions | K / G / C / A assessment | Evidence / remaining acceptance |
|---|---|---|---|
| Five-field creative model | Project Concept (\`concept\`), Visual/atmosphere (\`style\`), Invariants; Scene Intent (\`summary\`) and H3 Prompt (\`prompt\`) | **K wired, G unverified, C explicit, A wired** | \`studio_director.py\` and \`docs/studio-director-materialization-contract.md\`. Test choosing the *right* field for an ambiguous instruction without gratuitous duplication. |
| Creative consultation / domain judgment | Expert persona, questions, feasibility guidance, concise replies | **K partial, G unverified, C conversation-bound, A advisory** | \`_WORKSHOP\`, \`_H3_STUDIO_CORE\`. Test recognition of weak character specification, overloaded action, unclear shot, intentional flexibility, and sensible defaults. |
| H3 template and prompting | Full canonical prompt reference available in regular conversation and Prompt-field Write; saved Prompt used for generation | **K wired, G unverified, C supplied, A reviewed Write** | \`docs/mmh3-prompt-runtime-context.txt\`, \`director_chat.js\`, \`tests/studio_director_workshop.test.cjs\`. Test a real 4–15 s prompt with timed shots, stable anchors, dialogue/audio and no inappropriate contamination of Intent. |
| H3 limitations, practical production | Concise feasibility heuristics; user H3 Playbook; existing runtime/generation contracts | **K partial, G unverified, C partial, A advisory** | \`studio_director.py\`, \`docs/mmh3-prompt-guidelines.md\`, \`tool/server/storyboard_generation.py\`. Distinguish established settings from hypotheses; test a correction based on actual model limitations. |
| Read Project/Scene context | Explicit checked Project fields, individual Scene fields, whole-Scene group, multi-Scene overviews; size guard | **K wired, G unverified, C explicit, A wired** | \`studio_director_workbench.js:renderReadStory/readSend\`. Test requesting only genuinely needed facts, accurate receipt, no claimed access to unread fields. |
| Readiness, next-step defaults | \`checks\`, hints, stale state, \`writeFields\` defaults and optional capture | **K wired, G unverified, C partial, A guided** | \`studio_director_workbench.js:updateReadiness/openRecommendedWrite\`. Verify that recommendations match the discussion; manual selection always wins. |
| Create Project | Reviewed title, Concept, Style, Invariants and optional tentative Scenes | **K wired, G unverified, C discussion, A reviewed** | \`director_chat.js:prepareStudioProject/applyStudioProject\`; \`tests/studio_director_scene_draft.test.cjs\`. Verify neither invented required Scenes nor premature H3 Prompt. |
| Update Project and Invariants | Reviewed scoped brief; add/edit/rename Invariant with identity matching; Project brief Undo | **K wired, G unverified, C selected Project, A reviewed** | \`prepareStudioBrief/applyStudioBrief/undoStudioBrief\`, \`reviewCreativeCapture\`. Verify recurring character identity, rename, linked Scene associations and no unintended deletion. |
| Add one or several Scenes | Draft one or up to 32 tentative Scene Intents with reviewed placement | **K wired, G unverified, C selected Project, A reviewed** | \`prepareStudioSceneDraft/prepareStudioScenes\`; \`tests/studio_director_scene_draft.test.cjs\`. Test correct event, independent Scene and insertion order. |
| Revise one/many Scenes | Reviewed Title/Intent/Prompt, batch selected fields, atomic saved changes | **K wired, G unverified, C selected saved fields, A reviewed** | \`studio_director_workbench.js:editScene/prepareBatchScenes\`; \`tests/test_studio_scene_batch.py\`. Verify unchanged fields, stable IDs and actual before/after diffs. |
| Move, duplicate, split Scenes | Deterministic move/duplicate; reviewed two-Intent split, current Prompt/Takes preserved where specified | **K wired, G unverified, C selected structure, A reviewed** | \`prepareStructure/prepareSplitScene\`, \`tests/test_studio_scene_structure.py\`, \`tests/test_studio_scene_split.py\`. Confirm Director chooses *structure* rather than rewriting every field. |
| Link Invariants to Scenes | Reviewed Character/Location association updates without rewriting prose/Prompts | **K wired, G unverified, C selected Project, A reviewed** | \`prepareInvariantLinks\`, \`tests/test_studio_scene_invariant_links.py\`. Test understanding of definition vs association. |
| Capture complete discussed material | One optional completed field/Invariant/Scene suggestion opens editable review without a redundant LLM draft | **K wired, G unverified, C explicit exact target, A reviewed** | \`director_chat.js:reviewCapture/reviewSceneCapture\`, \`tests/studio_director_readiness.test.cjs\`. One capture per reply is the current contract, not a generic multi-edit executor. |
| H3 Playbook | Director can propose an editable replacement to the saved Playbook | **K wired, G unverified, C current Playbook, A reviewed** | \`preparePlaybook/applyPlaybook\`, \`tests/test_studio_director.py\`. Test when to propose a reusable rule rather than changing Scene prose. |
| Studio Blocks and \`/\` autocomplete | Standalone CRUD/search/copy, explicit slash insertion of Idea/Guidance into composer | **K not established, G unverified, C user-inserted text only, A author UI** | \`docs/studio-blocks.md\`, \`tests/studio_blocks_slash.test.cjs\`. No hidden Blocks retrieval, automatic Project binding or Director library management. |
| Takes, generation, frames, technical settings | WebCap has Take generation and technical controls; **outside current Director Read/Write contract** | **K partial, G unverified, C not supplied automatically, A not exposed** | \`studio_director.py:_H3_STUDIO_CORE\`, \`tool/server/storyboard_generation.py\`. Director must explain the handoff truthfully, never claim it generated or inspected a Take. |
| LoRA planning, training, QA, Curate, other WebCap areas | Separate WebCap workflows with their own interfaces/contracts | **K not established, G unverified, C not exposed, A not exposed** | See relevant \`tool/server/\` modules; no corresponding direct Studio action in \`ACTIONS\`. Treat broader expertise as a deliberate future scope decision, not shipped control. |
| Session persistence, activity and failure | Conversation persistence, progress, structured job results, shared Console and stale-readiness signals | **K partially documented, G not applicable, C explicit, A app-managed** | \`director_chat.js\`, \`tool/server/director_chat_history.py\`, \`tests/director_chat_persistence.test.cjs\`. Verify failure never looks like successful fresh advice. |

**Note:** A model can know what a UI operation *means* without being able to operate it. Conversely, an available review API does not prove the model knows when to use it. Both must be tested separately.

## Priority gaps — ranked by value, not feature count

| Priority | Work / question | Current evidence | Completion criterion |
|---|---|---|---|
| **P0 — Verify** | Can the intended live Director model explain and correctly apply the canonical H3 prompt shape? | Template delivered by PR #816; contract test only | In a live Studio chat, model distinguishes Intent vs Prompt, names the H3 sections accurately and produces a usable reviewed Prompt for a saved Scene. |
| **P0 — Verify** | Does Director reliably choose the *right* field and next action, rather than just naming fields? | \`writeHint\` / \`writeFields\` / capture support exists; no live judgment evidence | Five everyday creative requests lead to correct scope, sensible default selections and approved saved changes without unrelated edits. |
| **P1 — Audit** | Is its knowledge deep enough for recurring characters, locations, action, staging, dialogue, shot timing and model limits? | Concise guidance exists; quality unmeasured | Test representative weak/strong inputs and document concrete wrong/missing guidance. Add knowledge only for observed failures. |
| **P1 — Verify** | Can it clearly distinguish known saved context from discussion and ask for Read only when necessary? | Explicit Read/Apply boundary enforced in code | Real conversation with partially Read Project accurately identifies missing context; restart and changed Project do not induce fabricated claims. |
| **P1 — Verify** | Can it guide through multi-Scene/multi-Invariant work without losing identities or over-editing? | Reviewed batch/structure/links paths and CI tests | Record multi-Scene author journey: suggestion, correct IDs/fields, review, commit and post-Apply continuation. |
| **P2 — Clarify scope** | How much of non-Studio WebCap should Director *know* vs *control*? | Catalog limited to creative operations | Decide the specific user journey first; track advisory knowledge separately from any new reviewed action. No speculative full-tool control layer. |
| **P2 — UX evidence** | Are Read, Write, readiness, \`/\` Blocks, progress and review intelligible in the actual browser? | Static/client checks; no end-to-end browser pass | Perform narrow/wide layout walkthrough; log only friction with observed steps and screenshots if needed. |

### Standard live acceptance pass

Use the **actual intended Director model**, a real Project with multiple Scenes and recurring Invariants, and the running WebCap UI. Record for each scenario:

- **Prompt and answer:** the user's actual words, Director's answer, and whether it demonstrated domain expertise rather than paraphrasing.
- **Context evidence:** exact fields supplied by Read/Write and any assumptions about unsupplied data.
- **Recommendation:** suggested operation, Scene IDs, field defaults, capture payload (if any), and whether these were appropriate.
- **Execution:** number of LLM calls; review shown; user-edited/selected fields; saved state and conflict/Undo behavior.
- **Outcome:** pass/fail, observed defect, linked test/issue/PR and follow-up result.

Start with these scenarios: (1) ask about the H3 template without writing; (2) develop an under-specified recurring character; (3) create one independently generatable Scene; (4) revise only H3 Prompt from a saved Intent; (5) move/duplicate/split a Scene; (6) make a coordinated change across two Scenes; (7) rename an Invariant and review associations; (8) try an unread-field question; (9) ask to create/inspect a Take that Director cannot currently operate. Do not conflate model answer quality with successful request-schema parsing.

## How to maintain this document

1. **For every Studio Director PR**, update the impacted matrix row and priority gap as part of the PR, linking exact implementation/tests; don't silently mark "Proven" from unit tests.
2. When a live test is done, add a dated, minimal evidence note: *scenario / model / Project fixture / prompt / actual result / pass-fail / linked trace*. Exclude sensitive Project contents or local paths. Re-test after guidance/contract changes.
3. When a feature is added to WebCap, compare it with \`ACTIONS\`, actual Studio Read/Write entry points and documentation. Decide separately whether Director needs awareness, advice, context, or control.
4. Every quarter or substantive Studio release, remove superseded gap wording and reconcile code against this map. Keep the *top priorities short*; append deep findings to focused issues/PRs or \`docs/studio-director-materialization-contract.md\`, not endlessly to this page.
5. Distinguish **confirmed missing wiring**, **observed model failure**, **not exposed by design**, and **not yet tested**. Document the evidence and owner before proposing more infrastructure.

## Related authoritative references

- \`AGENTS.md\` — architecture, minimal changes, review safety and honest failures.
- \`docs/studio-director-materialization-contract.md\` — detailed intention-to-reviewed-save contract, historical implementation checkpoints and multi-step acceptance flows. Older milestones are snapshots, not today's source of truth.
- \`docs/studio-director-ia-audit.md\`, \`docs/studio-director-design-audit.md\` — dated UI/IA reviews, not automatic backlog.
- \`docs/studio-blocks.md\` — intentionally independent Idea/Guidance library.
- \`docs/mmh3-prompt-runtime-context.txt\`, \`docs/mmh3-prompt-guidelines.md\` — canonical prompt structure and H3 authoring reference.
- \`tool/server/studio_director.py\`, \`tool/js/director_chat.js\`, \`tool/js/studio_director_workbench.js\`, \`tool/server/app.py\` — live contracts and routes.

**Next milestone:** Use this map to run the P0 live-model expertise/field-selection acceptance cases, then patch *only the first demonstrated gap*.