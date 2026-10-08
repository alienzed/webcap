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

- the selected **Vision** model performs an **Open Sight** read with no vocabulary guidance;
- the same Vision model performs a fresh **Context Sight** read using the current group names, exact terms, and caption template as preferred annotation language and structural guidance;
- the selected **Director** model is required for the semantic interpretation workflows that follow;
- WebCap's deterministic metadata, Face Focus, MediaPipe pose, Scene Complexity, Prune, Duplicate, and other signals remain supporting evidence and constraints.

Context Sight stays image-first: it produces a compact visual caption plus exact supplied terms that clearly match the image. The groups, terms, and template guide attention and wording; they are not a requirement to force a value into every dimension.

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

Per-media Vision quality is allowed to degrade without failing the Set-level workflow. A model response that cannot be normalized into reusable structured Sight is kept visible diagnostically, skipped as evidence, and does not abort the remaining scan. Vocabulary discovery may proceed from partial usable coverage; complete Set coverage is not a success requirement.

Stop is explicit. Completed cached Sight remains valid.

## Data ownership

Reusable per-media evidence stays in the Set's existing `media_metadata.json`.

Current blocks may include:

- base media metadata;
- `scene_complexity`;
- `face_focus`;
- `selection_pose`;
- `vision_sight`;
- `vision_vocabulary_sight` (Context Sight);
- other analyzer-owned blocks.

Each analyzer owns its own versioning/invalidation rules. Set Intelligence does not create a second cache.

Director proposals, Guided Tag steps, QA dispositions, and modal progress remain ephemeral.

## Discover Vocabulary

Purpose: decide **what the Set vocabulary should contain**.

Vocabulary discovery deliberately reuses the visual work already completed by Set Intelligence:

1. Reuse **Open Sight**: structured, vocabulary-agnostic visual evidence.
2. Reuse **Context Sight**: the fresh second pixel read containing a template-guided caption plus exact current-vocabulary matches.
3. Combine both evidence sources and let the Director synthesize canonical terms, extend existing groups, and propose genuinely missing groups.
4. Run a separate Director **challenge pass** against that draft to recover missed distinctions, merge synonyms, and remove weak or ungrounded proposals.
5. Only then begin human curation, one group at a time. Existing groups are reviewed before proposed new groups.

Context Sight is cached separately from Open Sight in `media_metadata.json`. Its current-context signature includes the Vision model, media identity, group names, exact terms, and caption template. Re-running Set Intelligence refreshes it when that context changes. The latest valid Context Sight remains reusable as visual evidence after vocabulary review changes the term list, so Guided Tagging does not need another pixel scan.

Discovery does not assign tags to media and does not perform its own Vision scan.

Support counts are visible. Representative thumbnails plus rationale/evidence are available behind an optional reveal. Review only surfaces groups with an actionable vocabulary change; groups whose proposals are already fully present are skipped. Slightly overcomplete vocabulary is acceptable: proposed terms are available language, not requirements to use every term. Missing a meaningful recurring distinction is more costly than retaining an extra plausible term.

## Guided Tagging

Purpose: apply **existing vocabulary** efficiently.

After vocabulary review, the Director prepares per-item candidate assignments from both cached visual reads against the **final vocabulary** and current assignments. This preparation does not inspect pixels again and does not invent vocabulary in the Guided flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition. Guided Tagging consumes the prepared candidates; it does not reinterpret the image itself. Completing Vocabulary review presents **Continue to Guided Tagging** as the primary next action and launches this Grid flow directly.

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
