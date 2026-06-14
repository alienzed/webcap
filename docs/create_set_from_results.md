# Create Set From Results

Last updated: 2026-06-01

## Purpose

Create a brand-new set folder from visible search results.

This feature is intentionally independent of any single list implementation. It can be called from normal media-list results or dedicated SuperSet results.

## Product Position

This is an atomic materialization component.

- Input: visible media references
- Output: copied destination set with sidecars and carried item metadata
- Source folders remain unchanged

## Scope

In scope:

- Create new destination set folder under `FS_ROOT`
- Copy media files
- Copy caption sidecars (`.txt`) when present
- Copy matching `originals/<media>` when present
- Carry per-item folder-state metadata into destination `.webcap_state.json`:
  - `reviewedKeys`
  - `flags`
  - `caption_tags_by_media`
  - `ratings_by_media`
- Carry structural annotation state, but not local term baselines:
  - carry `caption_requirements`
  - do not carry `caption_requirement_keywords`
- Carry source `primer` block into destination `.webcap_state.json`:
  - `primer.template`
  - structured primer rows/fields (for example mappings/defaults when present)
- Carry available `media_metadata.json` entries for copied items into destination cache
- Deterministic filename collision handling (`_2`, `_3`, ...)

Out of scope:

- SuperSet UI/search mechanics
- Rule-builder/filter UX
- Per-item merge UIs
- Background jobs/progress orchestration
- Hash-level duplicate-content deduplication

## Non-Negotiable Safety

- Source sets are read-only.
- No mutation is performed on source media/captions/state.
- Destination creation is explicit and validated before copy starts.

## Inputs

Required:

- `destination_parent` (relative path under `FS_ROOT`)
- `set_name` (single folder name)
- `items` (array of result item references)

Item reference contract:

- Each item reference must include full source-relative media path (not basename-only).
- Example: `"sports/baseball/set_a/img_001.png"`

Rationale: basename-only references are ambiguous across sets.

## Destination Validation

- `set_name` required and non-empty
- `set_name` cannot contain path separators or traversal tokens
- Destination folder must not already exist
- On collision: block with validation error (no auto-folder rename)

## Copy Contract

For each selected item:

1. Copy media file to destination set.
2. Copy caption sidecar (`.txt`) if present.
3. Copy `originals/<media>` if present.
4. Carry matching item metadata from source folder state into destination folder state maps.

## Duplicate / Collision Rules

### Same filename (regardless of content)

- Keep first filename unchanged.
- Subsequent collisions use suffixes: `_2`, `_3`, etc.
- Extensions are preserved.

Example:

- `ball.png`
- `ball_2.png`
- `ball_3.png`

## Ordering Rule

Processing order must be deterministic for stable outputs and predictable collision naming.

Default rule:

- sort input items by normalized source-relative path ascending before copy

## Destination Folder State

Write destination `.webcap_state.json` with baseline expected shape plus carried item-level metadata.

- Include baseline top-level fields already used by app (`version`, `stats`, `primer`, etc.).
- Destination `primer` is cloned from the first encountered source folder in deterministic input order.
- Carry item-level values for successfully copied destination media keys.
- Destination does not inherit source `caption_requirement_keywords`; fresh sets should resolve current global requirement-term defaults on load.

Also write destination `media_metadata.json` when source entries are available for copied media.

## API Shape (Proposed)

Route name can vary, but contract should match:

- `POST /fs/create_set_from_results`

Request:

```json
{
  "destination_parent": "characters/baseball",
  "set_name": "baseball-mix-01",
  "items": [
    { "source_media_rel": "sets/a/img_001.png" },
    { "source_media_rel": "sets/b/img_002.png" }
  ]
}
```

Success response:

```json
{
  "ok": true,
  "folder": "characters/baseball/baseball-mix-01",
  "copied_count": 2,
  "originals_copied_count": 2,
  "created_items": [
    {
      "source_media_rel": "sets/a/img_001.png",
      "dest_media_name": "img_001.png"
    }
  ]
}
```

Error response examples:

- missing/invalid inputs
- destination exists
- source item not found

## UX Contract

This component requires explicit user confirmation action before execution.

When invoked from SuperSet results, input should include the full matched result set, not only currently rendered/visible rows.

After successful creation:

- auto-navigate to destination folder
- return to normal set workflow

## Test Matrix (Minimum)

1. Happy path: multi-source items copied with captions + originals + item metadata carryover
2. Destination already exists -> blocked
3. Same filename different content -> `_2` suffix applied
4. Same content across sources -> copied as separate files unless filename collision requires suffixing
5. Missing caption/original on some files -> media still copied; optional sidecars copied when present
6. Destination state file carries `reviewedKeys`/flags/tags/ratings for copied items
7. Destination metadata cache carries available `media_metadata.json` entries for copied items
8. Stable deterministic output across repeated runs with same inputs
