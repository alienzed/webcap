# Vision Schema Assist

Status: structured Sight + tag materialization V1.

## Product flow

Vision Schema Assist bridges schema-blind visual observation into WebCap's mature concept vocabulary and annotation state:

1. **Structured Sight** — scan the current visible media with the selected Vision model.
2. **Cache evidence** — store one replaceable `vision_sight` analysis block per media item in `media_metadata.json`.
3. **Observe two ways** — each Sight block keeps a concise description plus a structured visual inventory: viewpoint, position, things + qualities, thing-bound colors, setting/background, lighting, surface/support, and distinctive details.
4. **Materialize tags** — a text Director receives structured Sight, current groups/terms, and current assignments, then proposes confident missing tags per media item. Existing vocabulary is preferred; clearly useful new terms may be proposed only inside existing groups.
5. **Curate explicitly** — high-confidence tag candidates start selected, medium-confidence candidates start unselected. The user can toggle any candidate before applying.
6. **Apply** — accepted new terms merge through the existing vocabulary mutation path, then accepted tags use the existing annotation assignment path. Groups are not automatically marked reviewed.
7. **Discover vocabulary** — across the Set, WebCap deterministically aggregates structured visual evidence and the Director can synthesize recurring vocabulary proposals grounded in that evidence.
8. **Merge explicitly** — accepted vocabulary changes enter the existing annotation schema through normal WebCap mutation paths.

The first practical target is a mature-vocabulary workflow: filter to new media, scan visible items, build tag candidates, toggle, apply, then caption from the resulting concept-guided annotations.

## Ownership and lifecycle

- `vision_sight` is analysis evidence, not user-authored Set state.
- It lives inside the owning Set's `media_metadata.json`.
- V2 blocks record analyzer version, Vision model, source mtime/size, description, structured inventory, and update time.
- Legacy V1 prose Sight remains readable as cache evidence but is not considered structured Phase-1 evidence; visible items are rescanned as needed.
- Changing the Vision model, changing the media, or bumping the analyzer version makes structured evidence stale.
- Rescanning replaces stale evidence; no scan history accumulates.
- LLM queue intent remains ephemeral. Batch orchestration resumes by skipping current structured evidence rather than persisting queued Vision jobs.
- Deterministic aggregation is cheap and recomputed from current evidence.

## Grounding contract

Vision observes without seeing the existing annotation vocabulary.

WebCap owns evidence identity, filenames, support counts, existing group vocabulary, and current assignments. The Director owns semantic mapping and normalization.

Vocabulary discovery can propose a term only by citing supplied structured evidence IDs. During ingest, WebCap discards unknown evidence IDs and derives support media/counts itself.

Tag materialization can use only supplied media filenames and existing group names. Existing terms are canonicalized to the configured spelling. A new term may be proposed only within a supplied existing group. Candidates already assigned to that media item are discarded during ingest.

## Mutation contract

Nothing mutates during Sight, analysis, or suggestion generation.

Tag materialization mutates only candidates explicitly selected by the user. New selected terms are merged into their existing groups first, then selected tags are assigned through the normal annotation mutation path.

Vocabulary discovery remains separately curated and explicit. No Vision or Director result automatically marks a group reviewed.
