# Vision Schema Assist

Status: shared Structured Sight infrastructure with focused vocabulary discovery and separate tag materialization workflows.

## Product lanes

Vision Schema Assist provides shared visual evidence, but the user-facing workflows stay deliberately separate.

### Discover Vocabulary

Purpose: improve an immature or incomplete annotation vocabulary at the Set level.

1. The user opens **Discover Vocabulary** and clicks one primary action: **Discover Vocabulary**.
2. WebCap reuses current structured Sight where possible and scans only missing visible media.
3. WebCap deterministically aggregates recurring visual evidence.
4. The Director synthesizes recurring vocabulary proposals against the existing groups and terms.
5. The user reviews **one proposed group at a time**.
6. Each review shows only the information needed for the vocabulary decision: proposed group / merge target, proposed terms, and support counts.
7. The user can edit, select, skip, or **Add Selected to Vocabulary**.
8. Accepting or skipping advances to the next proposed group.

Discover Vocabulary does **not** tag media and does not act as an alternate captioning workflow. Structured Sight, thumbnails, evidence IDs, and synthesis rationale remain supporting machinery rather than the primary review surface.

### Guided / Assisted Tagging

Purpose: apply an already-useful vocabulary to media.

A text Director receives structured Sight, current groups/terms, and current assignments, then proposes confident missing tags per media item. Existing vocabulary is preferred. Guided Tag Pass and other assisted-caption/tagging surfaces own the user interaction for materializing those tags.

The shared backend may reuse the same Sight cache and suggestion routes, but Discover Vocabulary must not expose tag-materialization controls in its primary workflow.

## Shared Structured Sight

1. **Structured Sight** scans media with the selected Vision model.
2. One replaceable `vision_sight` analysis block per media item is cached in `media_metadata.json`.
3. Each block keeps a concise description plus a structured visual inventory: viewpoint, position, things + qualities, thing-bound colors, setting/background, lighting, surface/support, and distinctive details.
4. Changing the Vision model, changing the media, or bumping the analyzer version makes structured evidence stale.
5. Rescanning replaces stale evidence; no scan history accumulates.
6. LLM queue intent remains ephemeral. Batch orchestration resumes by skipping current structured evidence rather than persisting queued Vision jobs.
7. Deterministic aggregation is cheap and recomputed from current evidence.

## Grounding contract

Vision observes without seeing the existing annotation vocabulary.

WebCap owns evidence identity, filenames, support counts, existing group vocabulary, and current assignments. The Director owns semantic mapping and normalization.

Vocabulary discovery can propose a term only by citing supplied structured evidence IDs. During ingest, WebCap discards unknown evidence IDs and derives support media/counts itself.

Tag materialization can use only supplied media filenames and existing group names. Existing terms are canonicalized to the configured spelling. A new term may be proposed only within a supplied existing group. Candidates already assigned to that media item are discarded during ingest.

## Mutation contract

Nothing mutates during Sight, aggregation, synthesis, or suggestion generation.

Discover Vocabulary mutates only explicitly selected vocabulary for the current review group, through the existing schema mutation path.

Tag materialization mutates only explicitly accepted tag candidates through its owning workflow.

No Vision or Director result automatically marks a group reviewed.
