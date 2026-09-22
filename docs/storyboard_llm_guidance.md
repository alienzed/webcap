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

## Scene scope and duration discipline

A Storyboard Scene is one generation unit.

Treat the requested duration as a hard creative budget. A Scene should contain a plausible amount of visible action, camera motion, dialogue, and state change for that duration.

Do not compress a long chain of narrative events into one clip simply because they were mentioned in the Story overview.

If an intent clearly needs more than one generation:

- preserve the requested intent;
- recommend a split into two or more Scenes;
- identify a natural handoff point;
- do not invent extra plot events just to fill time.

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

Conceptually:

```text
[STABLE DIRECTOR CONTEXT]
What Storyboard is, preservation rules, duration discipline.

[MODEL-SPECIFIC GUIDANCE]
For example, the MiniMax H3 prompt-writing rules when producing an H3 prompt.

[STORY CONTEXT]
Title, concept, persistent style, and only the continuity facts relevant to this request.

[SCENE CONTEXT]
Current Scene title, summary, prompt, duration, references, and nearby Scene information where useful.

[CURRENT TASK]
Exactly one operation: plan, write, revise, or review.

[OUTPUT CONTRACT]
What shape to return and whether explanatory prose is allowed.
```

Do not send the entire Story, all Takes, or a long chat transcript by default. Context should be deliberate, inspectable, and small enough that the model can distinguish instructions from background information.

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
- use natural scene boundaries where continuity can reset safely;
- avoid specifying low-level H3 syntax unless asked;
- keep each Scene summary focused on what must happen, not prose decoration;
- flag an intent that is too dense rather than hiding the problem.

Preferred structured result:

```json
{
  "scenes": [
    {
      "title": "Short identifying title",
      "summary": "What visibly happens in this generation unit.",
      "suggestedDurationSeconds": 8
    }
  ]
}
```

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
- do not add dialogue, text, props, characters, cuts, or music unless supported by the intent/context or explicitly allowed;
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
