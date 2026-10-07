# Set Intelligence

Status: focused LLM/VL-driven annotation workflow.

## North-star sequence

Set Intelligence is one entry point for the annotation intelligence workflow:

1. **Understand the Set**
2. **Discover Vocabulary**
3. **Guided Tagging**
4. **Quality Assurance**

The steps are ordered because each one improves the next. They are not four peer tools in Set Tools.

The user may skip forward when the earlier decision is already settled. WebCap does not persist a separate wizard-state machine; current Set data remains the source of truth.

## Master of One

Each surface has one job:

- **Set Intelligence** builds reusable semantic understanding.
- **Discover Vocabulary** decides what concepts belong in the annotation schema.
- **Guided Tagging** applies mature existing vocabulary efficiently.
- **Quality Assurance** decides what still deserves human attention.

Supporting analyzers do not become peer workflows merely because WebCap can compute them.

## Set Intelligence

**Set Tools → Set Intelligence** is the primary entry point below the media list.

It is a full-Set operation. Filters and Focus Sets do not silently narrow it.

The intelligence path is fundamentally model-driven:

- the selected **Vision** model observes the media and produces structured Sight;
- the selected **Director** model is required for the semantic interpretation workflows that follow;
- WebCap's deterministic metadata, Face Focus, MediaPipe pose, Scene Complexity, Prune, Duplicate, and other signals remain supporting evidence and constraints.

Vision and Director availability are therefore required before Set Intelligence runs. The workflow must not present a successful deterministic-only scan as equivalent to semantic Set understanding.

Current versioned evidence is reused. No separate scan manifest or durable workflow-state file is created.

### Visibility

The default surface exposes only information the user can act on:

- one scan/progress state;
- completion;
- one prominent next decision: **Discover Vocabulary**;
- quieter skip-ahead actions for **Guided Tagging** and **Quality Assurance**.

Analyzer names and internal stages are not primary UI.

Raw Vision responses remain available only under collapsed **Scan details** when new model output exists. They are diagnostic evidence, not a review task.

Stop is explicit. Completed cached Sight remains valid.

## Data ownership

Reusable per-media evidence stays in the Set's existing `media_metadata.json`.

Current blocks may include:

- base media metadata;
- `scene_complexity`;
- `face_focus`;
- `selection_pose`;
- `vision_sight`;
- other analyzer-owned blocks.

Each analyzer owns its own versioning/invalidation rules. Set Intelligence does not create a second cache.

Director proposals, Guided Tag steps, QA dispositions, and modal progress remain ephemeral.

## Discover Vocabulary

Purpose: decide **what the Set vocabulary should contain**.

It consumes current Set intelligence for the whole Set. It does not scan media and does not tag media.

The default review stays one proposed group at a time. Support counts are visible. Rationale/evidence/examples are buried behind an optional reveal so uncertain suggestions can be investigated without making every decision noisy.

## Guided Tagging

Purpose: apply **existing vocabulary** efficiently.

It consumes current Set intelligence plus current vocabulary and assignments. It does not scan media or invent new vocabulary in the primary flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition.

## Quality Assurance

Purpose: reduce the amount of material the user must personally inspect.

The new intelligence value comes from semantic interpretation and cross-signal synthesis. Deterministic systems remain useful evidence producers, but should not be promoted into strong semantic recommendations by themselves.

High-confidence findings should prefer corroborated evidence and exact known actions. Lower-confidence observations should remain available but buried rather than competing with the attention queue.

Optional raw reports remain reference utilities, not the main QA experience.

## Future model passes

A future Set Intelligence scan may add targeted follow-up Vision questions or a larger Set-level reasoning pass when a proven information gap justifies the extra GPU/context cost.

Do **not** add stochastic reruns merely to obtain different wording.

A follow-up pass belongs only when it asks a materially different question that improves Vocabulary, Guided Tagging, or QA.

## Mutation boundary

Set Intelligence is analysis only.

Discover Vocabulary changes vocabulary only after explicit selection.

Guided Tagging changes assignments only after explicit application in Grid.

QA does not silently repair captions, tags, media, or reviewed state.

The operating rule remains:

> **Models direct attention and propose meaning; WebCap performs explicit, deterministic user-authorized mutations.**
