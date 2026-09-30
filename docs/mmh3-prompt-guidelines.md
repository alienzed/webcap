# MiniMax H3 Prompt Guidance Reference

This document is reference material for WebCap's Storyboard Director.

The active runtime guidance is:

- `docs/mmh3-prompt-runtime-context.txt`

Director authors the complete creative prompt text. WebCap stores and sends that prompt as authored, with mechanical first/last-frame reference alignment as the narrow adapter exception.

## Recommended authoring shape

WebCap recommends a scene-level H3 authoring shape built around one principle:

> Establish stable and current facts at scene level. Let shots inherit that setup and describe temporal progression, timing, synchronized events, camera changes, and meaningful changes in state.

The runtime guidance contains the canonical illustrative prompt shape. It covers:

- subject identity, appearance, wardrobe, and voice;
- Scene overview and progression;
- spatial state, location anchors, props and prop state;
- lighting, time of day, weather, and other visible continuity conditions;
- scene-wide visual and camera treatment;
- timed shots, action, performance, framing, dialogue, synchronized sound, and evolving physical state;
- persistent diegetic soundscape;
- non-diegetic music.

This is a recommended authoring shape, not an enforced serialization schema.

## MiniMax H3 base structure

MiniMax's documented base vocabulary includes:

```text
integrated_multimodal_description: ...

overall_soundscape: ...

non_diegetic_music: ...
```

WebCap recommends using this vocabulary because it gives H3 clear audiovisual organization while leaving Director free to adapt section detail, ordering, and shot count to the Scene.

## Scene-level setup and shots

Scene-level sections establish defaults for the generation.

Shots inherit those defaults and focus on what changes over time: action, performance, framing, perspective, camera movement, synchronized events, dialogue, and physical state.

A Storyboard Scene is normally 10–15 seconds. Choose the shot count that best serves the material. Sustained treatment fits material that benefits from uninterrupted time.

## Camera and motion

Scene-level visual treatment establishes the overall framing, lens/depth character, camera energy, and movement language.

Individual shots specify camera moves, framing changes, and deviations from that overall treatment.

Intermediate physical states give H3 a visible path through actions and transitions.

## Dialogue and voice

Subject-level guidance can establish stable voice characteristics such as timbre, cadence, accent, or delivery.

Timed dialogue belongs in the shot where it occurs. Stable speaker IDs help recurring speakers remain clear. MiniMax H3 dialogue notation may be written as:

```text
<d>[English] Spoken line.</d>
```

## Sound and music

`overall_soundscape` carries scene-wide ambience, spatial audio, Foley, physical sounds, environmental texture, and other persistent diegetic sound.

Shot-level audio carries synchronized sound tied to a particular moment.

`non_diegetic_music` carries audience-only score and its musical development.

## Continuity and evolving state

Director receives Story invariants and Story/Scene context as working context.

Scene-level Environment / Continuity Anchors are useful for current spatial state, location identity, props and prop state, lighting, time, weather, and other visible conditions that should carry through the generation.

Shots describe coherent changes to those conditions over time.

Story invariants remain the durable source for recurring Story facts. Entry/Exit state remains optional planning context for meaningful handoffs.

## Exact frame grounding

Exact first and last frames are declared visual anchors.

- **First frame:** opening visual state.
- **Last frame:** ending visual state.
- **First + last frame:** a visible path between both anchors.

WebCap may prepend the exact MiniMax alignment statement derived from the selected reference roles. This is mechanical adapter syntax rather than creative prompt reconstruction.

## Revision

Prompt refinement applies the requested change while preserving unrelated authored details.

Previous-Scene context can help Director choose continuation, contrast, variation, repetition, or independence according to the concept.

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
