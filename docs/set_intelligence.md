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
- the selected **Director** model is used by the semantic interpretation workflows that follow;
- WebCap's deterministic metadata, Face Focus, MediaPipe pose, Scene Complexity, Prune, Duplicate, and other signals remain supporting evidence and constraints.

Context Sight stays image-first: it produces a compact visual caption plus exact supplied terms that clearly match the image. The groups, terms, and template guide attention and wording; they are not a requirement to force a value into every dimension.

Set Intelligence itself requires the selected **Vision** model because that explicit run performs the pixel reads. Director availability is checked only when a downstream semantic interpretation workflow actually needs it. The workflow must not present a successful deterministic-only scan as equivalent to semantic Set understanding.

Current versioned evidence is reused. No separate scan manifest or durable workflow-state file is created.

### Visibility

The Set Intelligence surface must expose the state that changes the user's next decision, at readable sizes:

- **Open Sight** coverage: current saved results versus media still missing reusable open evidence;
- **Context Sight** coverage: current results, saved-but-stale results, and genuinely missing results;
- current scan/progress state and failures;
- one prominent next decision: **Discover Vocabulary** once the intelligence pass is complete;
- quieter skip-ahead actions for **Guided Tagging** and **Quality Assurance**.

Open Sight and Context Sight are visible because their coverage determines whether the workflow should continue, resume, or refresh. Lower-level analyzer internals remain supporting implementation detail.

The collapsed **Vision report** stays directly visible as a readable reference surface and shows how many saved responses are available. It can expose raw responses from the current browser run and reconstruct normalized Open Sight and Context Sight from cached Set metadata after reopening or restarting the app. Opening the report never starts a scan.

Per-media Vision quality is allowed to degrade without failing the Set-level workflow. A model response that cannot be normalized into reusable structured Sight is kept visible diagnostically, skipped as evidence, and does not abort the remaining scan. Vocabulary discovery may proceed from partial usable coverage; complete Set coverage is not a success requirement.

Opening Set Intelligence is passive: it inspects saved coverage and never starts Vision or claims the GPU. The header action is explicit: **Run Set Intelligence** when no reusable evidence exists, **Resume** for missing work, and **Refresh** when the user wants to refresh stale or current intelligence.

Stop is explicit. Closing the Set Intelligence surface does not stop an active scan; completed work continues to be saved unless the user presses **Stop**. Each successful Open Sight or Context Sight write is published immediately into the matching live media metadata as well as `media_metadata.json`, so downstream QA can use completed items before the full Set scan finishes.

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

Unfinished Caption Assist caption candidates may be retained in existing Set folder state for inexpensive re-entry; applying a candidate removes that saved proposal. Guided Tag steps and modal progress remain ephemeral. Completed Deep QA findings and QA review dispositions are saved as Set-owned review state in `.webcap_qa_review.json`; reusable per-image Sight remains in `media_metadata.json`. The review stores compact input fingerprints, not a duplicate of the underlying captions or image metadata.

## Item-level checks and refresh

- Caption Assist has one purpose: produce an editable final caption from this item's evidence, whether or not a caption already exists. The preview header opens progressive navigation; the editor entry stays on the current item.
- Caption Assist first restores an existing unfinished candidate when available; this requires no inference. Otherwise it reuses saved valid Open Sight and Context Sight, refreshes only missing/invalid Sight, and asks the Director to synthesize a candidate from that evidence, the existing caption, and current tags. Closing and reopening the focus flow is not a reason to repeat the work. Other items' captions and historical QA findings are not synthesis inputs.
- New annotations can change how a candidate should be worded without invalidating the underlying image observation. A vocabulary/template change can make Context Sight guidance older, but that alone does not automatically launch a pixel rescan; explicit Refresh Sight remains available. Current cache validity is based on the existing per-media evidence rules; do not claim a new comprehensive stale-state system in this phase.
- **Recheck Vision** separately reruns a targeted caption-to-image discrepancy check when explicitly requested. **Refresh Sight** explicitly replaces the item's Open Sight, Context Sight, or both. Neither action scans the Set.
- Item Sight refresh uses the existing `scan_sight`, `scan_vocabulary_sight`, `save_sight`, and `save_vocabulary_sight` operations. A valid observation is saved immediately. Failed normalization or inference must not overwrite the previously saved observation.
- QA-provided correction findings remain separate from fresh Vision findings while both are presented within the same caption correction UI. The user explicitly chooses edits.
- Full-Set Vision scanning remains an explicit Set Intelligence operation; normal QA consumes cached evidence and uses bounded Director batches, not a mandatory full-media rescan.

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

Support counts are visible. Representative thumbnails plus rationale/evidence are available behind an optional reveal. Review only surfaces groups with an actionable vocabulary change; groups whose proposals are already fully present are skipped. Closing and reopening Discover Vocabulary preserves the current browser-session review. A failed challenge can be retried from the saved synthesis draft; **Restart Discovery** is the explicit full Director rerun. Slightly overcomplete vocabulary is acceptable: proposed terms are available language, not requirements to use every term. Missing a meaningful recurring distinction is more costly than retaining an extra plausible term.

## Guided Tagging

Purpose: apply **existing vocabulary** efficiently.

After vocabulary review, the Director prepares per-item candidate assignments from both cached visual reads against the **final vocabulary** and current assignments. Large Sets are prepared in bounded batches so the per-response item limit cannot silently truncate the Guided pass. This preparation does not inspect pixels again and does not invent vocabulary in the Guided flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition. Guided Tagging consumes the prepared candidates; it does not reinterpret the image itself. Completing Vocabulary review presents **Continue to Guided Tagging** as the primary next action and launches this Grid flow directly.

## Quality Assurance

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
