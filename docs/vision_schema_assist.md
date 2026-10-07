# Vision Schema Assist

Status: V1 architecture.

## Product flow

Vision Schema Assist turns schema-blind visual descriptions into a curated annotation vocabulary:

1. **Batch Sight** — run the selected Vision model once per supported Set media item.
2. **Cache evidence** — store one replaceable `vision_sight` analysis block per media item in `media_metadata.json`.
3. **Mine corpus** — WebCap counts recurring normalized one-to-three-token visual patterns across distinct media items.
4. **Synthesize schema** — a text Director receives the mined pattern corpus plus the current effective group vocabulary.
5. **Curate** — the user reviews proposed groups and terms against supporting media examples.
6. **Merge explicitly** — accepted groups and terms enter the existing annotation schema through normal WebCap mutation paths.

Tag assignment from the frozen vocabulary is intentionally the next phase. V1 establishes a quality checkpoint at vocabulary curation before any bulk annotation mutation.

## Ownership and lifecycle

- `vision_sight` is analysis evidence, not user-authored Set state.
- It lives inside the owning Set's `media_metadata.json`.
- Each block records analyzer version, Vision model, source mtime/size, description, and update time.
- Changing the Vision model, changing the media, or bumping the analyzer version makes the block stale.
- Rescanning replaces stale evidence; no scan history accumulates.
- LLM queue intent remains ephemeral. Batch orchestration resumes by skipping current cached evidence rather than persisting queued Vision jobs.
- Deterministic mining is cheap and recomputed from current evidence.

## Grounding contract

The Director owns semantic organization; WebCap owns evidence and counting.

WebCap assigns IDs to mined patterns. The Director can propose a term only by citing those IDs. During ingest, WebCap discards unknown IDs and derives the term's supporting media, count, examples, and evidence labels from the cited patterns. A model-authored count is never accepted.

Schema synthesis uses its own `schema` LLM client and a frozen structured contract, parallel to Deep QA rather than coupled to Caption Assist.

## Mutation contract

Schema Assist never writes tags or reviewed state automatically.

Accepted vocabulary changes reuse the existing group and term mutation paths. Assignment-back uses the frozen vocabulary and cached Sight evidence in a later phase.
