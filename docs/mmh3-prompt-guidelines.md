# MiniMax H3 Prompt Guidelines for Storyboard

This is WebCap's working guide for converting a Storyboard Scene into a MiniMax H3 model-facing prompt.

It condenses the current official MiniMax H3 prompt-writing documentation into the rules Storyboard needs. It is not a replacement for the official source documents; when syntax changes upstream, verify and update this file.

Official sources:

- Base T2VA / I2VA / FL2VA / L2VA guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
- Full-reference guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md
- H3 model/recommended workflow: https://www.minimax.io/news/minimax-h3-open-source

## Current Storyboard runtime scope

Storyboard currently uses the **FL2VA task-family checkpoint** through ComfyUI's `MiniMaxH3ImageToVideo` node.

That one base-family path covers the modes Storyboard currently needs:

- no keyframe image -> T2VA-style generation;
- first frame only -> I2VA-style generation;
- first and last frames -> FL2VA generation;
- last frame only -> L2VA-style generation.

All four use the official **base** prompt contract built around:

```text
integrated_multimodal_description
overall_soundscape
non_diegetic_music
```

This is the only H3 prompt vocabulary that should be supplied to the current Storyboard prompt-writing runtime.

**Ref2VA is not part of the current Storyboard generation path.** It uses a separate task family/checkpoint and ComfyUI reference-to-video conditioning path. Keep its six-section vocabulary out of ordinary Storyboard LLM requests until Storyboard actually gains Ref2VA generation support.

## Storyboard rule: one Scene is one generation

Before formatting a prompt, decide whether the requested action reasonably fits in the Scene duration.

The current official H3 specification supports 4-15 second clips at 24 FPS. WebCap's configured workflow may impose a narrower local range and is authoritative at runtime.

Do not solve an overloaded Scene by packing every requested event into dense prose. Prefer a clean sequence of observable beats. If the intent cannot plausibly fit, recommend splitting it into multiple Storyboard Scenes.

## Select the base H3 mode from Storyboard references

Within the current FL2VA-family runtime, the prompt shape depends on which exact keyframe references are attached:

- **T2VA** — text only; no exact first/last frame.
- **I2VA** — one exact first-frame image.
- **FL2VA** — exact first and last frames.
- **L2VA** — one exact last-frame image.

Do not treat a generic visual reference as an exact first/last frame unless Storyboard marked it with that semantic role.

Ref2VA is a separate future runtime path, not another option inside the current `MiniMaxH3ImageToVideo` call.

## Base prompt output structure

For T2VA, begin directly with the three core fields.

For I2VA, FL2VA, and L2VA, first emit the appropriate reference-alignment instruction required by MiniMax's official guide, then one blank line, then the core fields.

The core field order is fixed:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

The existing concise skeleton lives in `docs/mmh3-prompt-template.txt`.

### integrated_multimodal_description

This is the main chronological audiovisual description.

It should establish:

- visual medium/style;
- initial framing and composition;
- subjects and persistent appearance details relevant to the shot;
- environment and key props;
- visible actions and state changes;
- camera behavior;
- dialogue/singing where requested;
- synchronized diegetic audio where it belongs on the timeline.

Write things the viewer can see or hear. Avoid abstract plot summaries such as "she realizes she is in danger" unless that realization is expressed through observable performance.

### Shots and timestamps

`[Shot 1]` has no timestamp.

Only later shots have cut times:

```text
[Shot 2] At 00:04.500, ...
```

Cut times must be strictly increasing and fall within the Scene duration.

A new shot should add meaningful new information: a different viewpoint, subject state, place, time, or narrative beat.

If only framing distance or angle changes slightly, prefer continuous camera motion over a cut.

Do not add cuts merely to make the prompt seem cinematic.

### Camera language

Describe camera movement naturally inside the shot.

Useful official H3 vocabulary includes:

- push in / pull out;
- zoom in / zoom out;
- pan left / right;
- truck left / right;
- tilt up / down;
- pedestal up / down;
- arc shot;
- tracking shot;
- static shot;
- slight / strong shake;
- POV;
- clockwise / counterclockwise roll.

Specify amplitude or speed only when it materially matters. Avoid stacking camera labels as a detached keyword list.

### Performance and physical motion

Describe intermediate physical states when they matter.

Prefer:

```text
She closes the door, keeps one hand on the handle for a beat, then slowly turns toward the wet footprints.
```

over:

```text
She enters, closes the door, notices footprints, becomes frightened, investigates, and runs upstairs.
```

The first gives the video model a temporal path. The second is a compressed plot summary.

Include useful secondary motion when it supports the shot: fabric, hair, rain, smoke, object inertia, breathing, reflections, or environmental response.

Do not invent secondary actions that compete with the Scene's main beat.

## First/last-frame grounding

### I2VA

Treat the supplied first image as the exact opening frame.

Begin from the established:

- identity;
- clothing;
- composition;
- colors;
- objects;
- spatial relationships.

Then describe how action develops forward.

Do not redescribe the first frame into a contradictory starting state.

### FL2VA

Treat the two images as exact opening and ending anchors.

Describe the physical/camera path that connects them rather than writing two unrelated static descriptions.

A single continuous shot is generally preferable unless the Storyboard Scene explicitly calls for cuts.

The final described state should converge on the last-frame composition at the end of the requested duration.

### L2VA

Treat the supplied image as the exact final frame.

Infer only a plausible compatible starting state, then describe a path that visibly converges on the final pose/composition.

Do not treat the last-frame image as though it were also the opening composition.

## Dialogue and vocals

Only add dialogue/lyrics when provided or explicitly requested.

Speakers who vocalize receive stable IDs such as `(S1)`, `(S2)` across shots.

The spoken text uses H3's dialogue form:

```text
<d>[English] Exact dialogue here.</d>
```

Preserve user-provided dialogue/lyrics verbatim. Do not rewrite, translate, or improve it unless the user explicitly asks.

Speaker identity, delivery, action, and voice description belong outside the `<d>` block.

If voiceover is requested, clearly state that it is off-screen voiceover and that a visible character's lips remain closed where appropriate.

## On-screen text

If the Scene deliberately contains visible signage, labels, captions, or other text, preserve the requested visible text exactly and place it in double quotation marks in the description.

Do not invent visible text as set dressing.

## Sound fields

### overall_soundscape

Use this for the clip-wide summary of:

- ambience;
- environmental sound;
- Foley;
- impacts;
- non-verbal human sounds.

Do not repeat dialogue or singing here.

Use `N/A` for complete silence only when silence is explicitly intended.

### non_diegetic_music

This is music heard by the audience but not by characters.

Describe concrete musical properties such as instrumentation, tempo, rhythm, and dynamic development.

Use `N/A` when no non-diegetic score is wanted.

Music or radio audible inside the scene is diegetic and belongs in the chronological multimodal description instead.

## Scene handoff and conditioning coverage

When the current Scene continues directly from a previous Storyboard Scene, use the supplied previous exit state as context for the new opening state. If a selected Take/frame reference is supplied, treat its declared role according to the selected H3 mode.

Do not carry previous-Scene context across an intentional continuity reset, location change, or time jump unless the Story explicitly preserves those facts.

Conditioning is not all-or-nothing. An identity LoRA may anchor identity without anchoring wardrobe or environment; an exact first frame anchors what is visible at time zero but not unseen details. Repeat the concrete visual descriptors that remain unanchored.

If a requested change conflicts with an exact first/last/keyframe anchor, do not describe an impossible contradiction. The anchor must change, or the requested change must occur at a compatible point in the Scene.

Prefer positive visual specification over negative constraint lists in the final H3 prompt.

## Continuity anchoring without LoRAs or references

H3 does not inherit the appearance of a previous independently generated Scene unless the workflow explicitly conditions it.

If Storyboard indicates that a recurring character, location, furnishing set, vehicle, or other persistent visual element has **no** active LoRA or usable visual reference, the H3 prompt should repeat the stable visual anchors needed to recreate it.

For characters, this may include:

- age range and build;
- hair color/style/length;
- skin tone where relevant;
- face-defining traits when useful;
- wardrobe colors, garment types, accessories;
- distinctive props or carried objects.

For locations, this may include:

- architecture and room proportions;
- wall/floor materials and color;
- major furniture and placement;
- windows, doors, stairs, counters, lighting fixtures;
- persistent props and spatial relationships;
- recurring lighting/weather/time-of-day cues.

Do not assume phrases such as "the same woman," "the same room," or "the hotel lobby" are sufficient across independent generations.

If a LoRA or exact visual reference already anchors the subject or environment, reduce redundant description and spend prompt budget on action, camera behavior, performance, and the details that actually change in this Scene.

## Continuity

Unless the current instruction explicitly changes them, preserve Storyboard-provided continuity facts.

Pay particular attention to:

- character identity;
- wardrobe and hair;
- number of people;
- object possession/state;
- location layout;
- time/weather;
- lighting direction;
- first/last/reference-frame facts.

A model-facing prompt should be self-contained enough to establish important visual facts that are not supplied by an exact reference image, but should not bloat every Scene by repeating irrelevant Story history.

## Future-only: Full-reference / Ref2VA

Ref2VA is intentionally **out of scope for the current Storyboard runtime**.

It uses a separate task family and a different official six-section rewrite structure:

```text
subject_definitions
summary
retention_analysis
detailed_description
overall_soundscape
non_diegetic_music
```

Those labels are useful when Storyboard eventually gains true reference-to-video support, but they should **not** be included in current Director-model prompt context. Mixing the Ref2VA vocabulary into FL2VA-family authoring adds irrelevant instructions and increases drift risk for smaller local LLMs.

When Ref2VA support is implemented, give it a deliberate adapter and task-specific prompt contract rather than expanding the current base-family prompt.

## What the prompt writer should not do

Do not:

- write a screenplay synopsis instead of an audiovisual timeline;
- silently change continuity;
- add characters, dialogue, props, text, music, or plot events for flavor;
- cram a long narrative arc into a short Scene;
- create a cut for every sentence;
- treat an exact frame reference as a loose inspiration;
- treat a loose character/style reference as an exact keyframe;
- describe impossible simultaneous camera moves;
- explain the prompt after writing it when the caller requested prompt-only output.

## Revision rule

When revising an existing H3 prompt from a correction, preserve everything unrelated to that correction.

Example request:

```text
Make her notice the footprints only after the door closes. Keep the camera behind her.
```

A good revision changes the action timing while retaining the established camera position, setting, wardrobe, sound, and other scene details.

Do not perform an unsolicited rewrite just to vary wording.

## Quality check before returning a prompt

Before returning the final prompt, verify:

1. Does the requested action fit the duration?
2. Is the workflow mode/reference role correct?
3. Are Story continuity facts preserved?
4. Is Shot 1 untimestamped?
5. Are later cut times increasing and inside the duration?
6. Do camera actions make physical sense?
7. Is dialogue exact and correctly tagged?
8. Are ambience and non-diegetic music separated correctly?
9. Did the prompt invent anything important that was not requested or needed?
10. If first/last frames are supplied, does the described motion genuinely connect the anchors?

For prompt-writing operations, return only the final model-facing prompt unless the caller explicitly requests analysis.
