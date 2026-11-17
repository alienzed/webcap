# Studio Director — behavioral contract and hostile guidance audit

**Status:** Proposed design guidance, 2026-11-16. Documentation only; no runtime or UX changes are authorized by this file. [The functional contract](studio-director-contract.md) and [user flows](studio-user-flows.md) remain authoritative where this proposal has not been adopted. This document distinguishes verified code behavior from hypotheses about model performance.

## Product outcome

Studio Director is an **eager, capable creative collaborator**. The author should be able to discuss a Project, request improvements, create Scenes, and revise existing material in ordinary language, without learning WebCap's internal field names or an exact incantation. When work is mature enough to perform, Director produces the *actual work* on the first pass, using reasonable creative judgment. When a consequential unanswered choice genuinely prevents part of it, Director asks one focused question **and still produces the independently useful parts**.

"90% of the time" means a **measured first-attempt usability target for clear, representative tasks with an appropriately capable selected model**, not a promise enforced by a JSON schema. We must measure each model and the application separately; current live failures and passing CI do not establish any percentage.

### Expected author-facing behavior

1. **Discussion.** Answer questions, develop ideas, compare options and give specific suggestions. Do not invent an edit or claim something was saved.
2. **Authoring.** When the author asks to create or revise creative content, deliver the usable material in that response. A plan or summary is helpful *alongside* the material, not instead of it.
3. **Proactive judgment.** Make routine choices about staging, light, framing and details while preserving supplied intent. Ask a single consequential question only when a defensible result cannot yet be produced; otherwise draft.
4. **Partial progress.** Deliver completed Project fields and Scene records even if other requested items need clarification or fail. The result is the material actually delivered, not the requested number or a completion claim.
5. **Revisions.** For a creative Scene revision, return a **complete revised H3 prompt** consistent with the supplied original and agreed changes; keep unaffected identity, atmosphere, constraints and timing. For a title-only change, do not regenerate a prompt.
6. **Grounded context.** Treat supplied saved material and approved references as facts. Distinguish these from conversation proposals or assumptions. Do not pretend to know unseen saved fields.
7. **Collaborative iteration.** Follow-up requests can refine previous drafts. Already authored material stays usable; another model call should be for new creative work, not merely to extract or certify an existing answer.

### Concrete examples

- Author selects Platform and invokes **Revise Scene**: "Make the watchman discover an antique silver whistle; keep the atmosphere and eight-second pacing." WebCap supplies the actual saved prompt and frozen Scene target; Director returns the complete replacement prompt. WebCap handles the precise save target and history. No intermediary prose-to-intent parser is needed.
- Author asks in conversation: "How might that reveal feel more suspenseful?" Director discusses specific alternatives; no write or fabricated draft required.
- Author asks: "Create a Project about a rainy-city bookseller, with the red scarf recurring." Director returns a usable Concept, Visual/atmosphere, title and scarf Invariant. A field omission is a **model adherence miss**, not a reason for WebCap to erase the other valid fields.
- Author requests four Scenes and receives three usable Scenes. WebCap shows all three and accurately reports the remaining unmet request. It does not manufacture the fourth or hide the three.

## The working application boundary

WebCap is deliberately "stupid" about creative prose and **strict only about its own state**. The author, not the model, authorizes saved-data access and changes to saved records. The model determines creative content; WebCap handles actual records, scopes, IDs, and outcomes.

| Area | Existing data/surface | Deterministic responsibility |
|---|---|---|
| Project | Title, Concept, Visual/atmosphere, Invariants | Preserve unrelated fields; apply only received, requested and author-selected changes |
| Scene | Title, full H3 Prompt, duration | Bind exact Scene from an explicit UI selection; preserve other Scenes and unchanged fields |
| Sources | Approved Context/Read selections from one or more Projects | Supply only explicitly approved saved values, refreshed as necessary |
| Unsaved material | Conversation responses and working drafts | Keep actual content independent of a future write destination; preserve alternatives |
| Write destination | Explicit contextual action or author selection | Resolve and freeze real record IDs; never infer IDs or intent by parsing author prose |
| Persistence | Existing Project/Scene save routes | Confirm actual write, show failure/partial completion, retain usable work |
| Review/history | WebCap UX, separate decision | Never enlist the model to decide review policy or simulate application saves |

A **contextual** Revise Scene action is an explicit instruction *and* authorization to supply that exact Scene's saved baseline. Merely viewing a Scene is not Read approval for freeform chat; if the ordinary composer lacks the baseline, it cannot reliably perform a faithful rewrite. The current Read approval and write-entry UX must make this distinction discoverable without requiring the author to think in permission machinery.

For **ordinary conversation**, allow natural prose plus separate machine-readable authored material when the model elects to produce it. WebCap notices the actual returned structured material; it does not classify the user's message or mine the assistant's explanation for commands. A contextual Write action already knows the task and target **from the UI event** and can supply a correspondingly bounded task. Use the same creative competence, not a parallel brain.

The response schema specifies how application-consumable material is represented. It cannot make creative intent correct or guarantee every requested field. The current backend uses chat completions with a JSON response format; it does **not** provide a general tool-call channel today ([runtime](../tool/server/storyboard_llm_runtime.py)). A separate deliverable/tool channel is worth a small provider-compatibility experiment, **not** a prerequisite for improving guidance or a pretext for a new framework.

## Why the working Storyboard flows are instructive

The code paths for [First Cut](../tool/server/storyboard_first_cut.py), [Develop Scenes and prompt refinement](../tool/server/storyboard_llm_contract.py), and [Revise Scenes](../tool/js/storyboard.js) generally give the model **one concrete job**, relevant saved context, and an immediate deliverable. First Cut sequences bounded stages (expand Concept, define Invariants, develop Scenes, refine each Scene) with WebCap owning the ordering. Prompt refinement supplies the original prompt and says exactly what to preserve and return.

This is an architectural *pattern to reuse*, not evidence that every one of these model responses is correct. The user's positive experience with these workflows is useful qualitative evidence. We should not force their multi-stage structure onto ordinary conversation, but we should reuse their **task clarity, context economy and deliverable-first instructions**.

## Hostile audit of the actual Director instructions

Read **all three layers**, not just one Python string: [built-in role and H3 guidance](../tool/server/studio_director.py), [request assembly](../tool/js/director_chat.js), and operation-specific writing requests from the same JavaScript module. Also check the optional user H3 Playbook and [H3 runtime instructions](mmh3-prompt-runtime-context.txt).

**F1 — Contradictory choices about when to work.** Built-in guidance says both "suggest a scoped Write" / "offer a scoped Write when further drafting is needed" and "author [Scenes] NOW" / "return the COMPLETE replacement prompt NOW." It also says "Conversation never edits Project records," which is true about **saving**, but can sound like a restriction on **authoring**. *Consequence:* a model can reasonably choose the safer conversational promise when the user actually asked for material. **Change direction:** positive distinction: "You author now; WebCap decides whether and where it is saved."

**F2 — Creative brief diluted by WebCap machinery.** Every Studio request receives capability catalog statuses, navigation/record identifiers, UI/workbench state and explanations of review, destinations and permissions. Much of this belongs to WebCap. *Consequence:* a strong creative request competes with mechanical directions and irrelevant status. **Change direction:** keep the role prompt focused on creative goals; provide relevant actual creative facts and one compact delivery convention. Never present navigation as if it were approved creative context.

**F3 — Repetition across layers.** "Return fields NOW," "WebCap owns save," "complete prompt," source restrictions and negative cautions repeat in the built-in workshop, H3 core, generic assembler, and conversation-specific assembler. The H3 production example is included in ordinary Studio conversation even when no H3 prompt is being drafted. The optional Playbook can expand every request. *Consequence:* diluted task salience and greater chance that one instruction pulls against another. **Change direction:** one concise base behavior, task-relevant context, one clear final task, output convention only where needed. Use H3 reference material when actually writing or reasoning about H3 prompts.

**F4 — Too many roles at once.** "Expert creative producer," "H3 production expert" and "WebCap Studio workflow guide" coexist with detailed application status and prohibitions. *Consequence:* the response can become a guided explanation of WebCap or a promise to use a tool rather than authored creative work. **Change direction:** the model's job is creative collaboration; UI/help knowledge is a bounded supplementary context when expressly relevant.

**F5 — Format masquerading as task success.** Generic chat accepts reply-only results and optional Project/Scene fields. That is appropriate for genuine discussion, but does not establish fulfillment of a clear Scene-rewrite request. Conversely, simply making every field required would break legitimate partial revisions. **Change direction:** evaluate *actual delivered content* against the user's task. Preserve all returned content. Use focused operation-specific delivery formats for contextual Write actions. Do not pretend either schema shape alone determines creative behavior.

**F6 — User-prose interpretation still exists in WebCap.** The present code uses regular expressions to detect "save that" draft reuse ([studioRequestAppliesPreparedMaterial](../tool/js/director_chat.js)), infer durations ([studioRequestedDuration and related helpers](../tool/js/director_chat.js)), recognize rename/title changes ([writeSelectedScene](../tool/js/director_chat.js)), and infer requested Scene fields from author wording ([presentAction](../tool/js/studio_director_workbench.js)). This directly conflicts with **NO PROSE PARSING** for control flow. **Change direction:** explicit UI actions and typed parameters choose operation/target; structured model material supplies requested creative values. Do not replace these regexes with a more elaborate classifier.

**F7 — Missing baseline can be more consequential than a schema omission.** A plain chat request to revise "the selected Scene" is not guaranteed to include that Scene's saved prompt: approved Read sources are intentionally independent of navigation. A contextual Revise action does fetch its target and provide the baseline. **Change direction:** make the contextual path easy and obvious; freeform conversation should accurately say when the baseline is absent and still offer useful ideas.

**F8 — Provider behavior has not been separated from prompt defects.** In the reported live failure, the model omitted \`changes.scene.prompt\`. That proves an actual authoring miss, but without inspecting the raw response and the full outbound prompt we cannot determine whether it answered in prose, chose another field or misunderstood the source. **Change direction:** record outbound request, actual reply, usable fields and saved effect independently. Do not invent a root cause, add auto-retries, or modify unrelated persistence logic to make an assertion pass.

**F9 — Excessively negative guidance.** The live instructions include numerous "never", "do not", "only", and "without" restrictions, even where a short positive goal would be clearer. The existing [AGENTS.md](../AGENTS.md) explicitly favors positive, actionable model instructions. **Change direction:** keep a few truly necessary safety/ownership boundaries, express the rest as the task to accomplish.

### Three checks before adopting replacement guidance

1. **Read the exact assembled request** for ordinary Read, conversational Project authoring, conversational Scene revision, contextual Scene revision, and multi-Scene creation. Include actual saved baseline and selected model. The Python prompt alone is not the effective model prompt.
2. **Compare the instructions against adversarial everyday requests**: ambiguous creativity, explicit Scene revision, missing approved baseline, partial multi-Scene work, Project pivot, one-field revision, follow-up refinement and no-op change. Resolve contradictory or irrelevant sentences before adding new ones.
3. **Run the selected real model**, preserve its unedited results, and judge useful creative completion separately from WebCap data routing and persistence. Compare the revised wording with the present baseline; record regressions as well as improvements.

## Proposed minimal guidance core (design, not deployed)

> You are the author's proactive creative partner for short generative-video Projects and Scenes. Help them make their intended work compelling, coherent and producible while preserving their creative decisions.
>
> **Do the useful work now.** When asked to create or revise material, produce the most complete useful result the available context supports. Use sensible creative judgment for ordinary unspecified details. Preserve unaffected content when editing an existing draft.
>
> **Clarify only real blockers.** If one consequential decision prevents part of a useful result, ask one focused question and still provide every independently ready part. Questions and creative suggestions support progress; they do not replace work that can already be completed.
>
> **Ground your work.** Treat provided saved references as authoritative context and earlier conversation drafts as proposals. Make the best useful response from what is actually provided and acknowledge truly missing essential source material.
>
> **Deliver the artifact.** For a Scene creation or creative rewrite, return a complete, usable H3 prompt; for Project work, return the actual authored fields; for discussion, answer directly. The application handles selection, saving and the result's presentation.

The short core is intentionally **not** a complete deployed prompt: each bounded task adds the relevant source, author request, optional H3 production reference and concise output-field convention. It does not enumerate buttons, actions, queue states or model call plans.

## Minimal, measurable next steps

1. **Baseline and classify.** Capture the complete effective prompts and raw outputs for a small representative set on the configured model. Distinguish "delivered usable content", "asked a justified question", "omitted requested material", and "application lost content." This is a measurement step, not a quality gate.
2. **Guidance-only candidate.** Consolidate the three instruction layers into a smaller positive base plus concrete contextual task, preserving actual application Read boundaries. Compare against the same prompts **without changing schemas or persistence simultaneously**.
3. **Bounded plumbing correction.** Replace only demonstrated prose-parsing decisions with explicit UI/operation parameters or already-structured material; retain the existing Project/Scene fields, save routes, conversations and independent destinations. Avoid a generic routing engine.
4. **Small UX alignment.** Make "Revise selected Scene" an obvious one-action scoped entry that automatically supplies that selected Scene's baseline. Keep conversational drafts destination-independent. Leave the separate Review/History decision to its own discussion.
5. **Acceptance.** Deterministic tests prove that actual returned content reaches the correct fields and saved target; real-model evaluations prove useful first-pass writing behavior. Use repeated representative tasks and more than one run before quoting a reliability percentage. Do not silently repair, retry or discard partial creative results.

**Non-goals:** No new general agent framework, no prose classifier, no blanket schema tightening, no automatic model repair/verification call, no speculative access gate, no persistence rewrite, no compulsory Review redesign.

**Status of findings:** The instruction-layer problems and regex call sites are confirmed by source inspection. Their causal impact on the particular real-model omission is a testable hypothesis until that run's raw receipt and a controlled guidance comparison are examined.
