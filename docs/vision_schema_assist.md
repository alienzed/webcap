# Vision Schema Assist

Status: consumer workflows built on the shared Set Scan / Structured Sight infrastructure.

## Product lanes

Vision Schema Assist provides shared visual evidence, but the user-facing workflows stay deliberately separate.

### Discover Vocabulary

Purpose: improve an immature or incomplete annotation vocabulary at the Set level.

1. The user runs **Set Tools → Set Intelligence** to build reusable open visual Sight.
2. The user opens **Discover Vocabulary**.
3. WebCap verifies that current open Structured Sight exists for the whole Set.
4. Vision performs a **fresh second inspection** using existing group names only. Current terms are intentionally withheld so the model is not anchored to an incomplete vocabulary. The pass reports compact observations within known groups plus important concepts that do not fit them.
5. WebCap aggregates open and group-aware visual atoms. Exact recurring observations are retained, while a bounded sample of one-off wording is also kept so the Director can consolidate synonyms that deterministic string matching would otherwise discard.
6. The Director synthesizes candidate vocabulary against the existing groups and current terms.
7. A second Director call challenges the draft for missed distinctions, over-merging, weak suggestions, and genuinely missing groups.
8. The user reviews **one proposed group at a time**, existing groups first and new groups last.
9. Each review shows proposed terms and support counts. Grounded evidence and representative thumbnails are available behind an optional reveal.
10. The user can edit, select, skip, or **Add Selected to Vocabulary**. Accepting or skipping advances to the next proposed group.

Discover Vocabulary does **not** tag media. The second Vision pass is vocabulary discovery evidence, not tag assignment. Its cache is keyed to the media, Vision model, and group structure; changing terms alone does not rerun it.

Slight overcoverage is acceptable because vocabulary terms are options, not obligations. The discovery goal is high useful coverage with low nonsense, not the mathematically smallest schema.

### Guided / Assisted Tagging

Purpose: apply an already-useful vocabulary to media.

A text Director receives current structured Sight, current groups/terms, and current assignments, then proposes confident missing tags per media item. Existing vocabulary is preferred. Guided Tag Pass owns the user interaction for materializing those tags in Grid and does not launch its own Vision scan.

The shared backend may reuse the same Sight cache and suggestion routes, but Discover Vocabulary must not expose tag-materialization controls in its primary workflow.

## Shared Structured Sight

1. **Set Scan** owns Structured Sight generation with the selected Vision model; Discover Vocabulary and Guided Tagging only consume it.
2. One replaceable `vision_sight` analysis block per media item is cached in `media_metadata.json`.
3. Each block keeps a concise description plus a structured visual inventory: viewpoint, position, things + qualities, thing-bound colors, setting/background, lighting, surface/support, and distinctive details.
4. Changing the Vision model, changing the media, or bumping the analyzer version makes structured evidence stale.
5. Rescanning replaces stale evidence; no scan history accumulates.
6. LLM queue intent remains ephemeral. Batch orchestration resumes by skipping current structured evidence rather than persisting queued Vision jobs.
7. Deterministic aggregation is cheap and recomputed from current evidence.

## Grounding contract

Open Sight observes without seeing the existing annotation vocabulary. The fresh vocabulary-discovery Vision pass sees existing group names but not current terms.

WebCap owns evidence identity, filenames, support counts, existing group vocabulary, and current assignments. The Director owns semantic mapping and normalization.

Vocabulary discovery can propose a term only by citing supplied structured evidence IDs. During ingest, WebCap discards unknown evidence IDs and derives support media/counts itself.

Tag materialization can use only supplied media filenames and existing group names. Existing terms are canonicalized to the configured spelling. A new term may be proposed only within a supplied existing group. Candidates already assigned to that media item are discarded during ingest.

## Mutation contract

Nothing mutates during Sight, aggregation, synthesis, or suggestion generation.

Discover Vocabulary mutates only explicitly selected vocabulary for the current review group, through the existing schema mutation path.

Tag materialization mutates only explicitly accepted tag candidates through its owning workflow.

No Vision or Director result automatically marks a group reviewed.
