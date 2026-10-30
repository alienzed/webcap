# MiniMax H3 Prompt Guidance Reference

This document is reference material for WebCap's Director.

The active runtime guidance is:

- `docs/mmh3-prompt-runtime-context.txt`

Director authors the complete creative prompt text. WebCap stores and sends that prompt as authored, with mechanical first/last-frame reference alignment as the narrow adapter exception.

## Recommended authoring shape

The runtime guidance contains the canonical illustrative prompt shape built around one principle:

> Establish stable and current facts at scene level. Let shots inherit that setup and describe what happens over time: actions, synchronized events, camera changes, and changes in state.

The shape covers:

- subject identity, appearance, wardrobe, and voice;
- Scene setting, action, mood, and intent;
- spatial state, location anchors, props and prop state;
- lighting, time of day, weather, and other visible continuity conditions;
- scene-wide visual and camera treatment;
- timed shots, action, performance, framing, dialogue, synchronized sound, and physical state;
- persistent diegetic soundscape;
- non-diegetic music.

This is a recommended authoring shape, not an enforced serialization schema.

## MiniMax H3 base vocabulary

MiniMax's documented base vocabulary includes:

```text
integrated_multimodal_description: ...

overall_soundscape: ...

non_diegetic_music: ...
```

This vocabulary gives H3 clear audiovisual organization while leaving Director free to adapt section detail, ordering, and shot count to the Scene.

## Scene-level setup and shots

Scene-level sections establish defaults for the generation.

Shots inherit those defaults and focus on what occurs at particular times: action, performance, framing, perspective, camera movement, synchronized events, dialogue, and changes in physical state.

Current H3 Storyboard clips use the saved 4–15-second duration. For active Studio authoring, supplied Project Concept, Visual / atmosphere, relevant Invariants, and Scene Intent guide shot count, timing, and treatment. Older Storyboard requests may additionally supply legacy Story Directing Guidelines.

## Camera and motion

Scene-level visual treatment establishes consistent visual character, while timed shots own framing, camera movements, and their changes.

Individual shots specify camera moves, framing changes, and deviations from that overall treatment.

Intermediate physical states give H3 a clear visual path through actions and transitions.

## Dialogue and voice

Subject-level guidance can establish stable voice characteristics such as timbre, cadence, accent, or delivery.

Timed dialogue belongs in the shot where it occurs. Stable speaker IDs help recurring speakers remain clear. MiniMax H3 dialogue notation may be written as:

```text
<d>[English] Spoken line.</d>
```

## Sound and music

`overall_soundscape` carries persistent diegetic ambience, environmental sound, Foley, and spatial character.

Shot-level audio carries synchronized sound tied to a particular moment.

`non_diegetic_music` carries audience-only score and its character or development.

## Continuity and evolving state

Existing-Scene Studio Write requests supply selected Project/Scene context and Invariant references; ordinary Studio conversation sees saved values only when explicitly Read or included in a reviewed Apply receipt.

Scene-level Environment / Continuity Anchors are useful for current spatial state, location identity, props and prop state, lighting, time, weather, and other visible conditions that carry through the generation.

Shots describe coherent changes to those conditions over time.

When Scenes are connected, relevant shared facts and evolving state can carry across them. Independent or variation-based Scenes carry only the shared elements the concept calls for.

Legacy stored Entry/Exit state may still inform older Storyboard workflows. These fields are **retired from active Studio Director authoring**; use Concept, Scene Intent, and relevant Invariants for current relationship and continuity decisions.

## Exact frame grounding

Exact first and last frames are declared visual anchors.

- **First frame:** opening visual state.
- **Last frame:** ending visual state.
- **First + last frame:** the visual path between both anchors.

WebCap may add the exact MiniMax alignment statement derived from the selected reference roles. This is mechanical adapter syntax rather than creative prompt reconstruction.

## Revision

Prompt refinement applies the requested change while preserving unrelated authored details.

Previous-Scene facts may be used for a user-requested continuity review. Current Studio Concept and explicitly supplied Scene Intent establish that relationship; legacy Story Directing Guidelines apply only when present in an older request.

## Runtime scope

Storyboard currently uses the H3 base T2VA/I2VA/L2VA/FL2VA family through ComfyUI's `MiniMaxH3ImageToVideo` path.

Current reference modes are:

- **T2VA-style** — text only;
- **I2VA-style** — exact first frame;
- **L2VA-style** — exact last frame;
- **FL2VA** — exact first and last frames.

Ref2VA remains a separate task family for a future dedicated adapter.

Official references:

- Base T2VA / I2VA / FL2VA / L2VA guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
- Full-reference guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md
- H3 model/recommended workflow: https://www.minimax.io/news/minimax-h3-open-source
