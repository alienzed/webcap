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

By default, Set Intelligence uses the **current visible training selection**, respecting text filters, advanced filters, and Focus Sets. **Scan entire Set (ignore filters)** is an explicit override. The selected scope is snapshotted for the Vision scan, so changing filters does not expand an in-progress scan. Discover Vocabulary and Set-level Guided Tagging remain Set-wide and can reuse any cached Sight evidence, including from prior broader scans.

The intelligence path is fundamentally model-driven:

- the selected **Vision** model performs one broad **Sight** discovery pass per image, optionally guided by group names and aliases without assuming assigned terms or narrowing discovery;
- each valid observation is saved in `vision_sight`, reused until the media changes, and replaced only by an explicit refresh;
- the selected **Director** model interprets compact, workflow-specific evidence for Vocabulary Discovery, Guided Tagging, Caption Assist, and QA;
- WebCap's deterministic metadata, Face Focus, MediaPipe pose, Scene Complexity, Prune, Duplicate, and other signals remain supporting evidence and constraints.

Legacy `vision_vocabulary_sight` records remain readable by the compatibility code but are not generated or automatically forwarded. Sight is fallible visual observation, not a final training caption or an authority over user annotations.

Set Intelligence itself requires the selected **Vision** model because that explicit run performs the pixel reads. Director availability is checked only when a downstream semantic interpretation workflow actually needs it. The workflow must not present a successful deterministic-only scan as equivalent to semantic Set understanding.

Current versioned evidence is reused. No separate scan manifest or durable workflow-state file is created.

### Visibility

The Set Intelligence surface shows one Sight coverage count for the selected scope, progress, failures, and an optional cached Vision report. Opening it never starts a scan. **Run/Resume** reads only missing Sight; **Force Refresh Sight** explicitly replaces successful observations. Failed responses preserve older evidence, and partial coverage can still inform downstream work.

Closing the modal does not stop an active scan. The explicit Stop action cancels the current job, and completed per-item writes remain usable. No second cache or scan manifest is created.

## Data ownership

Reusable per-media evidence stays in the Set's existing `media_metadata.json`.

Current blocks may include:

- base media metadata;
- `scene_complexity`;
- `face_focus`;
- `selection_pose`;
- `vision_sight`;
- `vision_vocabulary_sight` (legacy, temporarily readable only);
- other analyzer-owned blocks.

Each analyzer owns its own versioning/invalidation rules. Set Intelligence does not create a second cache.

Unfinished Caption Assist caption candidates may be retained in existing Set folder state for inexpensive re-entry; applying a candidate removes that saved proposal. Guided Tag steps and modal progress remain ephemeral. Completed Deep QA findings and QA review dispositions are saved as Set-owned review state in `.webcap_qa_review.json`; reusable per-image Sight remains in `media_metadata.json`. The review stores compact input fingerprints, not a duplicate of the underlying captions or image metadata.

## Item-level checks and refresh

Caption Assist reuses saved Sight if valid, fetches missing Sight when explicitly invoked, and lets the Director propose editable caption text using the current annotation inputs. Unfinished candidates remain in existing Set state. **Refresh Sight** explicitly reruns one image observation; **Recheck Caption (Vision)** is a distinct image-to-caption inspection. Neither triggers a Set scan or writes user annotations automatically. New models can be selected for an explicit fresh observation; changing the selected model alone does not invalidate saved visual evidence.

## Discover Vocabulary

Purpose: decide **what the Set vocabulary should contain**.

Vocabulary discovery deliberately reuses normalized Sight inventory. The Director proposes terms, extensions to existing groups and novel dimensions, followed by a separate challenge pass. This is not an additional pixel scan. Evidence is bounded to keep Director inputs focused; the underlying item observations remain cached.

Discovery does not assign tags to media and does not perform its own Vision scan.

Support counts are visible. Representative thumbnails plus rationale/evidence are available behind an optional reveal. Review only surfaces groups with an actionable vocabulary change; groups whose proposals are already fully present are skipped. Closing and reopening Discover Vocabulary preserves the current browser-session review. A failed challenge can be retried from the saved synthesis draft; **Restart Discovery** is the explicit full Director rerun. Slightly overcomplete vocabulary is acceptable: proposed terms are available language, not requirements to use every term. Missing a meaningful recurring distinction is more costly than retaining an extra plausible term.

## Guided Tagging

Purpose: apply **existing vocabulary** efficiently.

After vocabulary review, the Director prepares per-item candidate assignments from cached Sight, the **final vocabulary**, and current assignments. Large Sets are prepared in bounded batches so the per-response item limit cannot silently truncate the Guided pass. This preparation does not inspect pixels again and does not invent vocabulary in the Guided flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition. Guided Tagging consumes the prepared candidates; it does not reinterpret the image itself. Completing Vocabulary review presents **Continue to Guided Tagging** as the primary next action and launches this Grid flow directly.

## Quality Assurance

**Primary navigation:** Set Tools → **Prepare Set** collects Sight and guides vocabulary/tagging. **Quality Assurance** is the single Set-level QA entry point. Opening QA only shows saved checks; it never starts inference. **Start QA & Review** explicitly starts or resumes Deep QA and opens the existing QA Focus Review queue, where confirmed actionable results arrive progressively. **Run scan only** preserves the standalone Deep QA action, and **Review & Fix saved findings** opens the existing correction flow without starting a scan. Targeted concept checks and full reports remain available as secondary QA tools; per-item Vision rechecks remain explicit.

Purpose: reduce the amount of material the user must personally inspect.

The new intelligence value comes from semantic interpretation and cross-signal synthesis. Deterministic systems remain useful evidence producers, but should not be promoted into strong semantic recommendations by themselves.

High-confidence findings should prefer corroborated evidence and exact known actions. Lower-confidence observations should remain available but buried rather than competing with the attention queue.

Deep QA is user-initiated and progressive. It interprets current inputs in bounded Director batches, publishes completed batch findings immediately, and keeps exact per-item input fingerprints so later caption, assignment, or Sight changes make only affected items eligible for reevaluation. If Set Intelligence is still running, an active Deep QA session may wait for newly saved evidence and continue as it arrives.

Captioning findings may carry exact `add`, `replace`, or `remove` patches derived from cached evidence. Replace/remove source text and optional add anchors must match the submitted caption exactly. These patches are proposals only; they are handed to the shared Focus Review / Caption Assist correction UI for explicit preview and acceptance.

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
