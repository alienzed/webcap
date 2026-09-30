# Storyboard LLM Guidance

## Core vision

WebCap Storyboard is a local-first creative tool for turning a concept into short generated video Scenes and organizing multiple Takes for each Scene.

The architectural rule is simple:

> **Director understands and authors. WebCap stores, orchestrates, and executes.**

WebCap has no creative intelligence. It should not silently reinterpret, expand, repair, or rewrite Director-authored creative text. The selected LLM is responsible for understanding the concept, deciding what kind of Scene set it implies, and authoring the prompts that should be sent to the video model.

The durable data model remains:

```text
Story -> ordered Scenes -> Takes -> selected Take per Scene
```

“Ordered” is a storage/editing fact. It does **not** imply that the Scenes form a narrative progression. A concept may call for a continuing story, montage, repeated format, parallel moments, variations on a setup, independent alternatives, fashion/reality coverage, or another structure entirely.

The Story object is WebCap's container. The **concept** is the creative source the Director should reason from.

## Prompt pipeline boundaries

Storyboard has three distinct boundaries. Keep them separate.

1. **Director request contract** — the task instructions, concept, atmosphere, invariants, relevant Scene context, references, and response shape sent to the selected LLM.
2. **Storyboard authoring contract** — durable human-editable Story and Scene state.
3. **Inference contract** — the effective generation input: prompt, references, LoRAs, duration, resolution, seed, and workflow settings sent to the video-generation runtime.

WebCap may:

- assemble relevant context for Director;
- request and parse structured JSON where the UI needs structured data;
- validate required storage shape and primitive types;
- store Story/Scene state;
- manage references, LoRAs, seeds, duration, dimensions, queues, Takes, and provenance;
- add exact first/last-frame alignment syntax when the declared H3 reference mode requires it.

WebCap must **not**:

- infer which prose should be added to a prompt;
- inject invariants or continuity prose after Director returns;
- rebuild Director output into H3 sections;
- invent missing creative Scenes;
- repair wrong Scene counts;
- force narrative progression;
- force continuity between adjacent independently generated Scenes;
- add hidden semantic audit/repair loops.

Malformed required structure should fail visibly. A creatively weak result should remain a visible model result rather than being silently “improved” by Python.

## Why the LLM is here

The LLM exists primarily because writing many useful video prompts manually is slow.

Director may:

- expand a rough concept without assuming that it is narrative;
- develop the complete concept into a useful set of Scenes;
- write a generation prompt for one Scene;
- refine one Scene prompt from a specific correction;
- revise selected Scene fields across an existing plan;
- insert one new Scene between two existing Scenes.

The human remains the editor/director. Every Scene and prompt remains directly editable.

## Concept-first planning

When developing Scenes, Director should consider the **complete concept before writing individual Scenes**.

First decide what relationship, if any, the Scenes should have. Examples include:

- progression;
- variations;
- repeated format;
- montage;
- parallel moments;
- independent alternatives;
- another structure suggested by the concept.

None is the default.

Director should then decide what each Scene contributes to the whole and author the Scenes accordingly.

Do not manufacture setup, conflict, escalation, resolution, or ending simply because the data object is called a Story. Do not manufacture continuity merely because one Scene appears before another.

For Auto Scene count, Director chooses however many Scenes best serve the concept and provide useful coverage. When the user selects an explicit count, Director is instructed to create that many Scenes; WebCap does not fabricate or delete Scenes to enforce the request afterward.

## Scene density and generation-unit discipline

A Storyboard Scene is one short generation unit, normally about 10–15 seconds and never longer than 15 seconds.

Use that window aggressively.

Unless uninterrupted time genuinely serves the material — for example a sustained conversation, a continuous physical action, or an intentionally held moment — a Scene should normally contain several meaningful shots, cuts, or distinct visual beats.

Favor productive visual progression over idle coverage.

This density expectation is independent of whether the overall concept is narrative. A variation-based or repeated-format concept should still make each generation unit useful.

## Continuity, invariants, and state

Continuity is context, not a default requirement.

Story invariants are supplied to Director as authoritative context where relevant. They are **not** blocks of prose that WebCap later pastes into every Scene prompt.

Director should preserve explicit facts that matter to the current Scene, but independently generated clips will naturally vary. Text repetition cannot guarantee pixel-level continuity.

When stronger continuity is genuinely needed, the human can make it explicit through:

- the concept;
- Scene refinement;
- invariants;
- LoRAs;
- first/last-frame references;
- other generation conditioning.

### Entry and exit state

Entry and exit state are optional planning notes.

Use them only when a specific handoff, visible object state, physical state, or reference-frame relationship materially helps the Scene.

Do not create state bookkeeping merely because Scenes are adjacent.

Generation does not depend on Entry/Exit being populated.

### Previous-Scene context during refinement

Local prompt refinement may receive the previous Scene as **relationship context**.

That context can help Director decide whether the current Scene should continue, contrast, vary, repeat, or remain independent.

The previous Scene is not automatically a continuity handoff.

## Current Director operations

### `expand_concept`

Enrich a rough concept without assuming a narrative structure.

Director may develop characters/subjects, settings, themes, recurring format, visual situations, variations, relationships, progression, or endings **only where the seed concept supports them**.

It does not create Scenes or H3 prompts.

### `define_invariants`

Suggest concise recurring Story facts that are useful enough to preserve across relevant Scenes.

Invariants remain Story context. They are not prompt fragments for WebCap to inject later.

### `develop_story`

Develop the complete concept into a set of canonical Scenes in one Director call.

Each Scene contains:

- title;
- short summary/intent;
- complete Director-authored generation prompt;
- suggested duration;
- optional Entry State;
- optional Exit State.

Director owns the creative prompt text. WebCap stores it as returned.

The operation intentionally does **not** return continuity graphs, carry-forward lists, invariant references, shared-context references, or other semantic bookkeeping.

### `write_prompt`

Write the complete generation prompt for one existing Scene.

Director receives relevant Story context, Scene intent, H3 runtime guidance, references, and invariants.

The returned prompt is stored as authored.

### `refine_prompt`

Apply one explicit correction to an existing Scene prompt.

Preserve unrelated prompt details. Previous-Scene context may be supplied to help judge appropriate relationship/distinctness, not to force continuity.

Director may optionally update Scene summary, Entry/Exit state, or duration when the requested correction genuinely requires it.

### `repair_scenes` / Revise Scenes

Apply sparse targeted changes to an existing Scene plan.

This is not an autonomous semantic-validator loop. Director returns only fields that actually need changing.

WebCap does not run hidden recursive review/repair passes.

### `insert_scene`

Create exactly one new Scene between two existing Scenes.

Director receives the complete concept plus the Scene before and Scene after as relationship/contrast context.

The inserted Scene is **not required to bridge them narratively**. It may continue, contrast, vary, repeat a format, jump, or remain relatively independent as the concept warrants.

WebCap inserts the returned Scene at that exact gap.

## Runtime request assembly

Requests should contain the context genuinely useful to the task, not every piece of Storyboard state.

Typical ingredients are:

```text
[DIRECTOR CONTEXT]
Stable creative/directing guidance.

[STORY CONCEPT]
The creative source.

[STORY VISUAL / ATMOSPHERE]
Persistent visual language when supplied.

[STORY INVARIANTS]
Relevant recurring facts.

[SCENE / NEARBY SCENE CONTEXT]
Only for tasks that act on existing Scenes.

[H3 GUIDANCE]
Only when the task authors or revises a generation prompt.

[CURRENT TASK]
One explicit operation.

[OUTPUT CONTRACT]
Structured JSON shape where needed.
```

Assume every LLM call is stateless. Context worth preserving must live in WebCap and be supplied again when relevant.

## H3 prompt ownership

The active model-facing guidance is:

- `docs/mmh3-prompt-runtime-context.txt`

That file is intentionally concise and is what Director should use for ordinary H3 prompt writing.

Director should write clear observable audiovisual instructions, use dense cuts/beats where useful, keep chronology/timestamps sensible when used, preserve exact reference anchors, and include sound/dialogue/music when they actually help.

WebCap does **not** require Director to emit MiniMax's documented three-field base syntax.

The longer file:

- `docs/mmh3-prompt-guidelines.md`

is reference material describing official MiniMax conventions and useful prompting ideas. It is **not** the runtime Storyboard contract and should not be treated as a list of mandatory output sections.

Likewise:

- `docs/mmh3-prompt-template.txt`

is an example/reference skeleton only.

The exception is exact first/last-frame reference alignment syntax. WebCap owns that narrow mechanical adapter because it follows declared reference roles rather than creative interpretation.

## Structural failure versus creative failure

WebCap should validate only what it genuinely needs to store or execute.

Examples of valid loud failures:

- response is not valid JSON when JSON is required;
- required Scene object/list is missing;
- required title/summary/prompt is empty or the wrong primitive type;
- duration is not a valid supported value;
- a Director result is stale because the Story/Scene inputs changed while the job was running;
- an exact referenced file is missing.

Examples that are **not** Python validation responsibilities:

- the model chose a boring camera;
- the Scene is creatively repetitive;
- a requested count was missed;
- continuity is imperfect;
- the model made a weak narrative choice;
- the prompt could have been written more elegantly.

Those are model/user-editing issues, not reasons for WebCap to add hidden semantic machinery.

## Generation ownership

WebCap owns generation controls:

- seed / seed mode;
- LoRAs and strengths;
- duration;
- aspect ratio / megapixels;
- first/last-frame references;
- queueing and cancellation;
- Take storage and provenance.

For ordinary text-to-video generation, the stored Director/human-authored prompt is sent to H3 without creative rewriting.

When first/last-frame references are attached, WebCap may prepend the exact mechanical alignment statement required for that reference mode.

## Review standard

When changing Storyboard Director behavior, prefer the smallest normal solution.

Before adding machinery, ask:

1. Can Director understand this from better context or clearer instructions?
2. Is WebCap about to make a creative judgment it has no intelligence to make?
3. Is the new field actually durable user-facing state, or just model reasoning that should remain internal?
4. Is this protecting a real invariant, or hiding a model mistake?
5. Can a failure remain visible instead of being silently repaired?

The desired system is intentionally simple:

```text
concept + atmosphere + invariants + relevant Scene context
    -> Director
    -> model-authored Scene records and prompts
    -> WebCap storage/settings/queueing
    -> H3
```

Keep it that way.
