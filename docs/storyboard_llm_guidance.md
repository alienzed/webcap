# Storyboard LLM Guidance

This document defines the stable authoring contract for LLM assistance inside WebCap Storyboard.

It is intentionally provider-neutral. The first runtime is expected to be ComfyUI's native `Generate Text` / `TextGenerate` path, but Storyboard must not depend on hidden provider memory, a particular Qwen checkpoint, Ollama, or a persistent chat session.

For MiniMax H3 prompt syntax and model-facing prompt rules, see `docs/mmh3-prompt-guidelines.md`.

## Why the LLM is here

WebCap Storyboard is not a chatbot and the LLM is not the owner of the Story.

Storyboard exists to turn a longer creative idea into a sequence of short, independently generatable video Scenes, then organize multiple generated Takes for each Scene.

The durable model is:

```text
Story -> ordered Scenes -> Takes -> selected Take per Scene
```

The LLM assists the human author by:

- proposing a sensible Scene breakdown from a Story concept;
- expanding a Scene intent into a model-facing video prompt;
- revising an existing Scene or prompt from a specific correction;
- checking continuity across nearby Scenes;
- identifying when a Scene is trying to accomplish too much for its duration.

The human remains the director/editor. LLM output is proposed content applied to the same Story and Scene objects that can always be edited manually.

## Authority and preservation rules

When instructions conflict, use this order:

1. The user's current explicit change or request.
2. Canonical Story/Scene facts supplied by WebCap, including reference-image roles and established continuity.
3. The current task contract: plan, write, revise, or review.
4. Model-specific prompting guidance such as the MiniMax H3 format.
5. Creative inference.

Never silently change an established fact merely to make the output more interesting.

Unless explicitly asked to change them, preserve:

- character identity and count;
- wardrobe, hair, major physical traits, and carried objects;
- location and spatial relationships;
- time of day, weather, and persistent lighting conditions;
- named props and their state;
- Story-level visual style;
- the intended action and narrative result of the current Scene.

If the supplied context is genuinely contradictory, expose the contradiction rather than quietly choosing one version.

## Continuity anchoring and descriptive redundancy

Continuity must not depend on the model remembering a previous Scene.

When a persistent element is **not** strongly anchored by a LoRA, exact reference image, or other explicit conditioning, repeat enough concrete visual description in each relevant Scene to make the intended continuity reconstructible from that Scene alone.

This applies especially to:

- character identity and physical appearance;
- hairstyle, wardrobe, accessories, and carried objects;
- recurring locations;
- room layout, architecture, furnishings, and distinctive props;
- recurring vehicles or other major objects;
- persistent weather, time of day, lighting, and color treatment.

For example, if a character has no identity LoRA or usable visual reference, do not reduce later prompts to "the woman" or "she." Re-establish the important identity cues: approximate age, build, hair, clothing, distinctive features, and anything else needed to keep the character visually stable.

Likewise, if a room is recurring without a reference image, restate the major spatial and furnishing anchors rather than merely saying "the same hotel lobby." A later generation cannot be assumed to know what "the same" looked like.

When a LoRA or reference image **does** strongly establish an element, avoid unnecessary repetition. Keep only the descriptors needed to disambiguate the intended subject/reference, preserve Story-specific facts, or specify what changes in the current Scene.

The goal is not maximal verbosity. The goal is to make each Scene independently generatable while preserving the visual constants that matter.

## Scene state, handoff, and duration discipline

A Storyboard Scene is one generation unit.

Reason about each Scene as:

```text
entry state -> action / progression -> exit state
```

The entry state describes what must already be true when the Scene begins. The exit state describes what should be true when the Scene ends. This makes scene-to-scene continuity explicit without requiring a conversational LLM session.

When a Scene continues directly from the previous Scene, WebCap should normally provide the previous Scene's relevant exit state as context. When useful, it may also provide the previous selected Take or a frame/reference derived from it. Do not require the full previous prompt or full Story history when a compact exit-state handoff is enough.

When a Scene is intentionally independent, relocated, time-skipped, or otherwise a continuity reset, do not carry previous-Scene details forward merely because they exist.

Treat the requested duration as a hard creative budget. A Scene should contain a plausible amount of visible action, camera motion, dialogue, and state change for that duration.

Do not compress a long chain of narrative events into one clip simply because they were mentioned in the Story overview.

Scene-fit assessment is a first-class authoring result. A planning/revision call may return:

```json
{
  "fit": "fits",
  "reason": "",
  "suggestedScenes": []
}
```

or, when the intent is overloaded:

```json
{
  "fit": "split",
  "reason": "The requested state changes are unlikely to read clearly in one 8-second generation.",
  "suggestedScenes": [
    {
      "title": "Door closes",
      "summary": "She enters, closes the door, and pauses with her hand on the handle.",
      "entryState": "...",
      "exitState": "The door is closed; she has not yet noticed the footprints.",
      "suggestedDurationSeconds": 6
    },
    {
      "title": "Footprints",
      "summary": "She turns from the door and notices the wet footprints.",
      "entryState": "The door is closed; she is still beside it.",
      "exitState": "She is focused on the footprints.",
      "suggestedDurationSeconds": 6
    }
  ]
}
```

The caller decides whether it wants a fit assessment, a final H3 prompt, or both. Do not mix a mandatory prompt-only output contract with a mandatory split explanation in the same call.

For MiniMax H3, the current official model specification supports 4-15 second output; the actual WebCap workflow configuration remains authoritative for what can be generated locally.

## Session and memory model

Assume every LLM inference call is stateless.

ComfyUI's core `TextGenerate` node receives the prompt plus optional image/video/audio context and returns `generated_text`. Its built-in/default chat template is formatting, not durable Storyboard memory.

Therefore:

- WebCap owns all context worth preserving.
- A provider restart must not lose Story meaning.
- A model change must not invalidate Story data.
- The LLM must not rely on facts from an earlier call unless WebCap supplies them again.
- Full conversational transcripts are not required for ordinary operation.

A future Storyboard chat/revision UI may store a small revision history, but that history is WebCap data. It is not provider session state.

The default runtime request should be reconstructible from disk.

## Runtime request assembly

For an LLM-assisted operation, WebCap should assemble only the context needed for that operation.

The default request should stay smaller than the conceptual maximum. Start with:

```text
[DIRECTOR CONTEXT]
stable preservation/memory/duration rules

[STORY STYLE]
persistent atmosphere / visual language

[CURRENT TASK]
the one thing being requested
```

Add the current Scene when the operation acts on a Scene. Add Story concept, nearby Scenes, references, or model-specific guidance only when they materially affect that operation. A Story Planner normally needs concept but not H3 syntax; an H3 Prompt Writer needs H3 guidance but not the full Story; a local revision normally needs the existing Scene/prompt and the requested correction, not a transcript.

Conceptually, the largest ordinary request may look like:

```text
[STABLE DIRECTOR CONTEXT]
What Storyboard is, preservation rules, duration discipline.

[MODEL-SPECIFIC GUIDANCE, ONLY WHEN NEEDED]
For example, the MiniMax H3 prompt-writing rules only when producing or reviewing an H3 prompt.

[STORY CONTEXT]
Title, concept, persistent style, and only the continuity facts relevant to this request.

[SCENE CONTEXT]
Current Scene title, summary, entry state, intended action/progression, exit state, prompt, duration, conditioning/reference coverage, and nearby Scene information where useful.

[PREVIOUS-SCENE HANDOFF]
Include the previous Scene's relevant exit state when the current Scene continues from it. Include a selected Take/frame reference only when it materially helps continuity. Omit this block for deliberate continuity resets.

[CURRENT TASK]
Exactly one operation: plan, assess fit/splitting, write, revise, enrich, or review.

[OUTPUT CONTRACT]
What shape to return and whether explanatory prose is allowed.
```

Do not send the entire Story, all Takes, the H3 guide, or a long chat transcript by default. Context should be deliberate, inspectable, and small enough that the model can distinguish instructions from background information. Prefer `style + current task` until a concrete operation proves it needs more.

## First integration slice

The first runtime integration should expose only two Scene-local operations:

- `write_prompt`: create an H3 model-facing prompt from the stored manual Scene intent.
- `refine_prompt`: revise the existing stored prompt from one explicit human correction.

Do not add chat history, autonomous Story mutation, automatic Scene creation, or continuity-review loops to the first runtime integration. Those remain later operations after the local model proves useful.

The pure request builder in `tool/server/storyboard_llm_contract.py` defines this boundary before any provider transport is attached.

## Task modes

### 1. Story Planner

Purpose: turn a Story concept into a candidate sequence of Scenes.

Input normally includes:

- Story title;
- Story concept;
- persistent visual/style notes;
- target total scope or approximate number of Scenes if known;
- already-existing Scenes when extending rather than replacing a Story.

Planner rules:

- each proposed Scene must be independently generatable;
- preserve a clear narrative progression;
- begin from the first Story state actually supplied; do not invent transportation, preceding actions, unseen rooms, or other setup to explain an arrival;
- use natural scene boundaries where continuity can reset safely;
- when `continuesPreviousScene` is true, the next Scene's `entryState` must be physically compatible with the previous Scene's `exitState`; do not hide unexplained movement between them;
- avoid specifying low-level H3 syntax unless asked;
- keep each Scene summary focused on narrative/physical intent rather than detailed shot design; camera choices belong to the later H3-writing pass unless a camera behavior is itself essential to the Story intent;
- do not repeat the entire character/location visual bible in every Scene; WebCap already owns persistent Story context;
- use `continuity.carryForward` only for changed state that must remain true beyond the current Scene, such as an object being left behind or carried forward;
- flag an intent that is too dense rather than hiding the problem.

The canonical structured-output contract is `docs/storyboard-scene-plan.schema.json`.

A planning call should return JSON only, matching that schema. WebCap assigns canonical Scene IDs after validation; the LLM should not invent IDs.

The contract deliberately keeps planning separate from final H3 prompt writing. It captures:

- ordered Scene title and visible intent;
- entry and exit state;
- suggested duration;
- whether continuity directly carries from the previous Scene;
- changed state that must carry forward into later Scenes.

The canonical Story concept/style remain WebCap-owned input. The planner does not return another paraphrased Story summary or duplicate the persistent visual bible, because those copies create drift without adding durable state.

When continuing an existing Story, use the previous Scene's exit state to establish the next Scene's entry state where continuity actually carries across. Do not force a handoff across an intentional reset, relocation, or time jump.

WebCap should parse and validate the complete response before applying any proposed Scenes. Do not partially import a malformed result. If JSON is syntactically or structurally invalid, one explicit repair pass may be attempted using the same schema and the invalid response as input; if repair still fails, expose the failure and leave Story state unchanged.


## Model selection

Storyboard should let the user select the compatible local text model used for LLM authoring rather than baking one checkpoint into Story data.

Initial strategy:

- expose one Storyboard-level **Director model** selector populated from models the configured ComfyUI text workflow can actually load;
- use that selection for planning, auditing, prompt writing, and revision unless later testing proves per-task model selection worthwhile;
- treat the selected model as runtime preference, not canonical Story meaning;
- when an LLM proposal/audit is persisted for provenance, record the model identifier that produced it;
- do not require a Story migration when the preferred model changes.

Cross-model workflows are an optional quality tool, not the default. A future user may deliberately plan with one model and audit with another.

## Validation, semantic audit, and repair

LLM self-review is useful but is not a deterministic validator.

For whole-Story planning, prefer this bounded pipeline:

```text
Story context
    -> planner
    -> JSON/schema validation
    -> semantic audit
    -> one repair pass when needed
    -> JSON/schema validation again
    -> human preview/import
```

The mechanical and semantic responsibilities stay separate:

1. **WebCap validation** checks JSON syntax, schema shape, required fields, types, and other facts that can be evaluated deterministically.
2. **LLM semantic audit** checks fidelity and reasoning: invented facts, omitted Story beats, overloaded Scenes, broken entry/exit handoffs, lost persistent object state, inappropriate continuity resets, and violation of the requested ending.
3. **Repair** receives the original Story context, the schema-valid proposed plan, and the audit issues, then returns a complete replacement plan matching `docs/storyboard-scene-plan.schema.json`.
4. WebCap validates the replacement again before showing/applying it.

The audit output contract is `docs/storyboard-plan-audit.schema.json`.

A same-model audit is the default because it is simple and often improves a first pass. An optional different Director model may be selected as auditor later for cross-model critique.

Do not create an open-ended agent loop. Start with at most one semantic audit and one repair pass. If the repaired plan still fails structural validation or materially conflicts with the Story, expose the result to the human rather than recursively asking the model to fix itself.

For H3 prompt writing, the same pattern may later be used in a lighter form:

```text
draft prompt -> narrow checklist audit -> one revision
```

but only after the direct prompt-writing workflow is useful enough to justify the extra inference cost.

### 2. H3 Prompt Writer

Purpose: turn one Scene intent into a complete MiniMax H3 model-facing prompt.

Input normally includes:

- Story style/continuity needed for this Scene;
- Scene summary;
- duration;
- workflow mode and reference roles;
- exact dialogue/lyrics if present.

Rules:

- follow `docs/mmh3-prompt-guidelines.md`;
- preserve the Scene's narrative intent;
- use observable audiovisual description rather than abstract plot summary;
- fit action and camera changes into the duration;
- do not add dialogue, text, props, characters, cuts, music, or decorative filmmaking choices unless supported by the intent/context or explicitly allowed;
- prefer positive concrete visual specification over long negative-constraint lists;
- when the task explicitly asks to develop, enrich, or make the Scene more cinematic, add useful visual, performance, camera, sound, and environmental detail while preserving Story facts and the Scene's narrative function;
- do not emit wildcard syntax or invent LoRA trigger tokens as part of ordinary creative expansion; those are later workflow concerns unless explicitly supplied by WebCap;
- output the model-facing prompt only unless the caller requests structured metadata.

### 3. Scene Reviser

Purpose: apply one correction to an existing Scene or generated prompt.

Input normally includes:

- existing Scene intent;
- existing prompt;
- explicit correction;
- only the continuity facts necessary to prevent collateral changes.

Rules:

- make the smallest coherent revision that satisfies the correction;
- preserve unrelated details;
- do not rewrite style, wardrobe, camera, dialogue, or timing merely for variety;
- if the requested change makes the existing duration implausible, say so or propose a split rather than silently compressing the action.

When the caller asks for the revised H3 prompt, return only the revised prompt.

### 4. Continuity Reviewer

Purpose: inspect Story/Scene context and identify concrete continuity problems.

Look for:

- unexplained wardrobe or appearance changes;
- location/time/weather conflicts;
- object-state contradictions;
- repeated or missing narrative beats;
- a Scene beginning from a state the previous selected Scene cannot plausibly establish;
- duration/action overload.

Do not rewrite Scenes automatically unless asked. Report specific conflicts and the Scenes involved.

## Persistent facts, Scene-local facts, and conditioning coverage

Do not promote a temporary Scene detail into permanent Story continuity unless WebCap explicitly marks it persistent.

Examples:

- a character's core appearance may be persistent;
- a coat worn only in one sequence may be Scene-local or sequence-local;
- a prop picked up in one Scene becomes persistent only while the Story state says it remains carried;
- lighting caused by a temporary event should not silently become the Story's global lighting style.

Conditioning is dimensional rather than all-or-nothing.

A character LoRA may strongly anchor identity while leaving wardrobe, accessories, pose, age presentation, or environment unspecified. A first-frame image may anchor everything visible at the opening instant but not details outside the frame or later state changes. A location reference may anchor furnishings while saying nothing about character identity.

For each important continuity dimension, ask whether it is already covered by:

- an active LoRA;
- an exact first/last/guide frame;
- a character/location/style reference;
- explicit Story/Scene text.

Repeat concrete description for the dimensions that remain uncovered. Do not remove useful wardrobe/location/furnishing detail merely because some other aspect of the Scene is conditioned.

## Hard anchors and incompatible requests

Exact keyframes and other hard references are physical constraints, not suggestions.

If a user request conflicts with an exact anchor, do not pretend both can be true. Identify the incompatibility or place the requested change after/before the anchored state when that is physically plausible.

Example: if the exact first frame shows a red coat, a request that the Scene *starts* with a blue coat requires changing the first-frame reference. A request that the coat changes later in the Scene may be compatible.

## Positive specification

Prefer describing the desired visible state directly:

```text
a dark green tufted sofa against the left wall beneath two brass sconces
```

rather than accumulating negative constraints such as:

```text
do not change the sofa, do not move the sconces, do not alter the wall
```

Negative instructions may be useful in the authoring/reasoning layer when identifying forbidden drift, but the final generation prompt should favor concrete positive audiovisual description unless a model-specific requirement says otherwise.

## Reference media

When WebCap supplies an image, video, or audio reference, treat the declared semantic role as authoritative.

Examples:

- `first_frame`: exact opening visual anchor;
- `last_frame`: exact ending visual anchor;
- `guide_frame`: intermediate visual anchor;
- `character`: identity/appearance reference;
- `style`: visual-style reference.

Do not infer a different role merely from image content.

When writing an H3 prompt, translate these semantic roles into the appropriate H3 workflow syntax through the model-specific prompt contract. Storyboard domain data should never depend on ComfyUI node IDs.

## Output discipline

The calling operation owns the output shape.

When asked for JSON:

- return valid JSON only;
- use the supplied keys exactly;
- do not wrap it in Markdown;
- do not add commentary before or after it.

When asked for a model-facing prompt:

- return the prompt only;
- do not explain the choices;
- do not prepend "Here is your prompt";
- do not append suggestions.

When asked for review/advice, concise explanatory prose is allowed.

## Confidence

Fluent output is not evidence that the model understood the request.

If a required fact is missing and materially changes the result, expose the ambiguity. Do not confidently invent a specific answer merely to avoid saying that context is missing.

Storyboard should prefer a correct, narrow Scene over an elaborate but contradictory one.

## Sources and implementation notes

Current external references:

- MiniMax H3 official model/recommended workflow: https://www.minimax.io/news/minimax-h3-open-source
- MiniMax H3 base prompt-writing guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
- MiniMax H3 full-reference guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md
- ComfyUI core TextGenerate implementation: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_textgen.py
- ComfyUI TextGenerate embedded docs: https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/TextGenerate/en.md
