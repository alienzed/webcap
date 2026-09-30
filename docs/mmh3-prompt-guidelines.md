# MiniMax H3 Prompt Guidance Reference

This document is **reference material**, not WebCap's runtime Director contract.

The active Storyboard guidance sent to Director is:

- `docs/mmh3-prompt-runtime-context.txt`

That runtime guidance is intentionally concise. Director owns the complete creative prompt text. WebCap does not parse or rebuild Director output into a required H3 field structure.

## Why this document exists

MiniMax publishes useful prompt-writing conventions for H3, including:

- observable audiovisual description;
- chronological shot progression;
- camera language;
- dialogue/voice notation;
- sound/music guidance;
- first/last-frame grounding;
- an official base prompt structure using named fields.

Those conventions are useful reference material when diagnosing prompt quality or experimenting with H3 behavior.

They are **not all mandatory WebCap output requirements**.

A prompt that works well without the documented field labels is still a valid Storyboard prompt. WebCap should not introduce format enforcement merely because a convention appears in the upstream guide.

Official references:

- Base T2VA / I2VA / FL2VA / L2VA guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
- Full-reference guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md
- H3 model/recommended workflow: https://www.minimax.io/news/minimax-h3-open-source

## Current Storyboard runtime scope

Storyboard currently uses the FL2VA-family H3 workflow through ComfyUI's `MiniMaxH3ImageToVideo` path.

Current reference modes are:

- **T2VA-style** — text only;
- **I2VA-style** — exact first frame;
- **FL2VA** — exact first and last frames;
- **L2VA-style** — exact last frame.

Ref2VA remains a separate future task family and should not be mixed into ordinary Storyboard prompting until WebCap actually supports that workflow.

## What WebCap requires

For ordinary H3 prompt writing, WebCap requires only a complete usable prompt string.

Director should generally:

- describe observable visual and audible content;
- make action/camera progression clear;
- use the short 10–15 second window productively;
- favor several meaningful cuts/shots/beats unless uninterrupted time genuinely serves the material;
- keep chronology and timestamps sensible when used;
- preserve explicit facts and exact frame anchors;
- include dialogue, ambience, music, or other audio detail when relevant;
- avoid negative-constraint padding and ceremonial continuity repetition.

WebCap does **not** require:

- `integrated_multimodal_description:`;
- `overall_soundscape:`;
- `non_diegetic_music:`;
- a mandatory `[Shot 1]` label;
- timestamps for every cut;
- fixed Subject / Overview / Style sections;
- a Python-generated continuity block.

Those may be useful conventions, but Director decides whether they improve the prompt.

## Official three-field base structure

MiniMax's documented base format commonly uses:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

Treat this as an **official reference pattern**, not a WebCap schema.

If a Director model produces this structure naturally and it works well, WebCap should store and send it unchanged.

If Director produces an effective ordinary audiovisual prompt without those labels, WebCap should likewise store and send it unchanged.

Do not add a post-processing layer that converts one form into the other.

## Shots and timestamps

Useful upstream conventions include:

- Shot 1 may be untimestamped;
- later cuts may use increasing timestamps;
- cut times should stay inside the requested duration;
- a cut should normally add meaningful new information.

Storyboard's own creative guidance is stronger on density than the generic upstream advice: for a typical 10–15 second generation unit, multiple meaningful cuts, shots, or distinct visual beats are expected unless a sustained uninterrupted treatment genuinely serves the material.

Timestamps are tools, not mandatory ceremony.

## Camera and physical motion

Concrete camera language can help:

- push / pull;
- pan;
- track / truck;
- tilt;
- pedestal;
- arc;
- POV;
- static;
- controlled shake.

Describe movement naturally in the Scene rather than stacking detached camera keywords.

Intermediate physical states are often more useful than compressed plot summaries because they give H3 a visible temporal path.

## Dialogue and vocals

MiniMax documents structured dialogue notation. Use it when it helps and when exact dialogue matters.

Preserve user-supplied dialogue or lyrics unless the user explicitly asks for rewriting.

Do not invent dialogue merely because the prompt format allows it.

## Sound and music

Sound can be described either naturally in the audiovisual prompt or, when using MiniMax's official field structure, split into the documented sound/music fields.

Storyboard does not require those sections.

The useful distinction remains:

- diegetic sound belongs to the Scene;
- non-diegetic music is audience-only score.

Do not add music merely to fill a field.

## Exact frame grounding

Exact first/last-frame references are different from ordinary creative guidance because they are declared generation constraints.

### First frame

Treat it as the exact opening visual state.

### Last frame

Treat it as the exact ending visual state.

### First + last frame

Describe a plausible path between the two anchors. Depending on the material, a continuous shot may be preferable, but Storyboard's normal dense/multi-cut guidance can still apply when it does not conflict with the anchors.

### WebCap-owned alignment syntax

WebCap may prepend the exact MiniMax alignment statement for first/last-frame modes.

This is the narrow exception to the rule that WebCap does not rewrite model-authored prompt text. It is mechanical adapter syntax derived from declared reference roles, not a creative judgment.

## Continuity and invariants

H3 generations are independent unless generation conditioning ties them together.

Director receives Story invariants as context and should use the facts relevant to the Scene.

WebCap should **not** infer that missing LoRAs/references require it to paste descriptive continuity prose into the prompt. That judgment belongs to Director or the human.

If stronger continuity is needed, use the concept, prompt refinement, LoRAs, exact references, or other conditioning deliberately.

Do not assume that phrases such as “same woman” or “same room” guarantee visual continuity, but also do not solve that limitation by mechanically repeating a full visual bible in every Scene.

## Revision

When refining an existing prompt, make the requested change while preserving unrelated details.

Previous-Scene context may be supplied to judge whether the current Scene should continue, contrast, vary, repeat, or remain independent. Do not automatically treat adjacency as a continuity handoff.

## Ref2VA

Full-reference / Ref2VA remains outside the current Storyboard runtime.

Its separate upstream vocabulary is useful reference material, but must not be injected into ordinary Storyboard Director requests.

When WebCap gains a real Ref2VA workflow, give it a deliberate task-specific adapter rather than expanding the existing prompt contract speculatively.

## Practical rule

When deciding whether to promote something from this document into runtime guidance, ask:

> Does H3 actually need this for WebCap's current workflow, or is it merely one documented way to write a good prompt?

Prefer the smallest useful guidance. Do not turn a recommendation into a contract without evidence.
