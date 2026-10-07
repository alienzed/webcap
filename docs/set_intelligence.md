# Set Intelligence

Status: implemented shared analysis workflow and product contract.

## North-star sequence

For annotation-oriented Set work, the intended order is:

1. **Scan Set**
2. **Discover Vocabulary**
3. **Guided Tag Pass**
4. **Quality Assurance**

The order matters. Scan Set creates reusable evidence. Vocabulary discovery turns recurring evidence into a usable schema. Guided Tagging applies mature vocabulary efficiently. QA checks the resulting Set using both deterministic and optional model-assisted evidence.

## Scan Set

**Set Tools → Scan Set** is the primary intelligence entry point below the media list.

Scan Set is a full-Set operation. Filters and Focus Sets do not silently narrow it.

The operation is incremental:

1. refresh normal media metadata;
2. request current Scene Complexity, Face Focus, and MediaPipe Selection Pose analysis;
3. when a Vision model is available, fill missing/stale Structured Sight for that model;
4. refresh the browser's media metadata once so all consumers see the completed evidence;
5. publish the existing metadata-updated event once, allowing normal downstream deterministic consumers to refresh.

Current cached/versioned evidence is reused. No separate scan manifest or durable queue is created.

### Optional model rule

LLM/Vision capability is optional infrastructure.

- WebCap metadata, Face Focus, Selection Pose, Scene Complexity, Prune/Duplicate, and ordinary QA remain useful without a Vision or Director model.
- If no Vision model is selected/available, Scan Set succeeds and explicitly marks Vision Sight as skipped.
- A Director model is **not** required to scan a Set.
- Vocabulary discovery and Guided Tagging require model intelligence because semantic mapping is their job; failure to configure a model must not make deterministic QA unavailable.

### Visibility and failure

Scan Set shows its three meaningful stages:

- WebCap analysis
- Vision Sight
- Reusable intelligence

When Vision actually runs, raw model responses are shown as they complete. This is diagnostic transparency, not a separate review workflow.

Stop is explicit. Completed cache entries remain valid. Required failures reach the global Console.

## Data ownership

Per-media reusable analysis stays in the Set's existing media_metadata.json.

Current reusable blocks include:

- base media metadata;
- scene_complexity;
- face_focus;
- selection_pose;
- vision_sight;
- other existing analyzer-owned blocks.

Each analyzer owns its own versioning/invalidation rules. Scan Set does not create a second cache.

Temporary Director proposals, Guided Tag steps, QA dispositions, and scan UI state remain ephemeral.

## Consumer boundaries

### Discover Vocabulary

Purpose: decide **what the Set vocabulary should contain**.

It consumes current Structured Sight for the whole Set. It does not scan media and does not tag media.

The default review remains one proposed group at a time. Support counts stay visible; rationale/evidence/example filenames are available behind an optional reveal for ambiguous proposals.

### Guided Tag Pass

Purpose: apply **existing vocabulary** efficiently.

It consumes current Structured Sight plus the current vocabulary and assignments. It does not scan media or invent new vocabulary in the primary flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition.

### Quality Assurance

Purpose: reduce the amount of material a human must inspect before considering the Set finished.

QA remains useful without an LLM. Deterministic findings remain authoritative for exact facts.

Set intelligence adds two forms of value:

- high-confidence cross-signal findings can combine independent normalized sources, e.g. MediaPipe plus Vision Sight agreeing that an existing known tag is probably missing;
- optional Deep QA receives compact Face Focus, Selection Pose, Scene Complexity, and Vision Sight evidence alongside captions/tags and deterministic findings.

The model interprets evidence; WebCap owns counts, validation, filenames, known vocabulary, and mutations.

## Follow-up Vision and larger Set reasoning

A future Scan Set may add targeted follow-up Vision questions or a larger Set-level reasoning pass when a proven information gap justifies the GPU/context cost.

Do **not** add stochastic reruns merely to get different wording.

A follow-up pass should exist only when it asks a materially different question that downstream consumers cannot answer from current normalized evidence. Until then, the current generic Structured Sight plus deterministic analyzers is the stable foundation.

## Mutation boundary

Scan Set is analysis only.

Discover Vocabulary changes vocabulary only after explicit selection.

Guided Tagging changes assignments only after explicit application in Grid.

QA does not silently repair captions, tags, media, or reviewed state.

This preserves WebCap's normal rule: intelligence controls attention; WebCap performs deterministic user-authorized mutations.
