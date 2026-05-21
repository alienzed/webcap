# Sets (Smart + Workspace)

Last updated: 2026-05-21

## Goal

Add durable, reusable cross-root set workflows without touching source sets directly.

- `Smart Set`: a named, saved query over `FS_ROOT`.
- `Workspace`: per-smart-set physical folder for copied items and downstream work.

This keeps discovery global while edits remain safe and local.

---

## Option A: Smart Set + Workspace

This is the original proposal: a Smart Set owns both the saved query and a dedicated workspace folder for materialized files.

---

## Core Decisions

1. Smart Sets are always root-scoped.
- Query scope is fixed to `FS_ROOT`.
- No "run from current folder" mode.
- If created from a subfolder context, `path_include` is pre-seeded with that subfolder path.

2. Default excludes are always applied.
- `originals`
- `auto_dataset`
- `src_videos`

3. Smart Set is a first-class object, not an unnamed filter session.
- Name is required.
- Default placeholder name: `Smart Set YYYY-MM-DD HHmm` (editable).

4. Results are explicit-run and paginated.
- User clicks `Run` to execute.
- Response includes `total_matches`.
- List shows page chunks (default `100` items/page) with `Load More`.

5. Query guardrails stay simple.
- At least one filter is required.
- If `text` is used, minimum trimmed length is `3`.
- No primary/secondary filter category logic.

---

## UX Workflow (v1)

1. Create Smart Set
- Open Smart Set panel.
- Enter name and filters.
- If opened from a subfolder, path filter is prefilled to that subfolder.
- Save.

2. Run Smart Set
- Click `Run`.
- Show summary (`N matches`, page size shown).
- Render first page only.

3. Browse / Continue Curation
- User can continue filtering/rerunning as needed.
- Smart Set remains reusable and persistent.

4. Prepare / Materialize Path
- Smart Set query remains the source of discovery.
- Physical workspace content is created/used for downstream set operations.

---

## Filter Model

Base fields (initial):

- `text`
- `path_include`
- `path_exclude`
- `tag_filter`
- `missing_captions_only`
- `reviewed_only`
- `unrated_only`
- `min_stars_gt`
- `exact_stars`
- `flag_filter`
- `invalid_ar_only`
- `media_type` (`image` / `video` / both)

Notes:

- `text` min length rule applies only when text is non-empty.
- Additional filters can be added without changing storage shape.

---

## Storage Layout (Portable, Per-Set Files)

Smart Sets are stored as one file per set:

- `<FS_ROOT>/_smart_sets/YYYY-MM/<set_slug>/smart_set.json`

Rationale:

- portable per set
- no shared giant metadata file
- easy backup/share/archive
- natural place for per-set workspace artifacts

Creation month (`YYYY-MM`) is fixed at set creation time.

---

## Smart Set Record (Proposed)

```json
{
  "version": 1,
  "id": "stable-id",
  "name": "Smart Set 2026-05-19 1530",
  "slug": "smart-set-2026-05-19-1530",
  "scope": {
    "root": "/",
    "exclude_dirs": ["originals", "auto_dataset", "src_videos"]
  },
  "filters": {
    "text": "",
    "path_include": "",
    "path_exclude": "",
    "tag_filter": "",
    "missing_captions_only": false,
    "reviewed_only": false,
    "unrated_only": false,
    "min_stars_gt": "",
    "exact_stars": [],
    "flag_filter": "",
    "invalid_ar_only": false,
    "media_type": ""
  },
  "workspace": {
    "folder_rel": "_smart_sets/2026-05/smart-set-2026-05-19-1530/workspace"
  },
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "last_run_at": "ISO-8601"
}
```

---

## Query Result Contract (Proposed)

```json
{
  "total_matches": 742,
  "page_size": 100,
  "items": [],
  "next_cursor": "opaque-or-null"
}
```

Rules:

- Never return all matches at once.
- `next_cursor = null` means no more pages.

---

## Workspace / Materialization Notes

Workspace is where physical copies live for safe mutation and training prep workflows.

High-level behavior:

1. Smart Set query is discovery.
2. Workspace holds copied artifacts.
3. Preparing/training operates on workspace-managed items, not source folders.

Detailed copy-on-first-write behavior is tracked separately and can evolve without changing Smart Set discovery rules.

---

## Option B: Search + Copy to Set

Alternative direction: split discovery from materialization.

Instead of giving every saved query its own special workspace, make search read-only and make copying into a physical set the materialization strategy.

- `Search`: root-wide or scoped query over media files.
- `Saved Search`: persisted filter definition only; no owned files.
- `Copy to Set`: explicit operation that copies selected source files into an existing or new physical set folder.
- `Set`: remains a normal folder that existing webcap workflows already understand.

This keeps Smart Set-style discovery, but avoids introducing a parallel workspace object for v1.

### Option B Workflow

1. Search
- User opens search panel.
- User enters filters.
- Results are explicit-run and paginated.
- Search results are virtual and read-only.

2. Select Results
- User selects one or more result items.
- Each result carries a full source-relative path.

3. Copy to Set
- User chooses an existing set folder or creates a new one.
- Selected media files are copied into that set.
- Matching `.txt` captions are copied with the media file when present.
- Filename collision behavior must be explicit and reversible.

4. Continue in Normal Set Workflow
- After copy, the destination folder is just a regular physical set.
- Captioning, review, ratings, autoset, prepare, config generation, and training operate on the copied files through existing folder-based behavior.

### Option B Data Model

Saved searches store only filter and scope information:

```json
{
  "version": 1,
  "id": "stable-id",
  "name": "Saved Search 2026-05-21 1530",
  "scope": {
    "root": "/",
    "exclude_dirs": ["originals", "auto_dataset", "src_videos", "_smart_sets"]
  },
  "filters": {
    "text": "",
    "path_include": "",
    "path_exclude": "",
    "tag_filter": "",
    "missing_captions_only": false,
    "reviewed_only": false,
    "unrated_only": false,
    "min_stars_gt": "",
    "exact_stars": [],
    "flag_filter": "",
    "invalid_ar_only": false,
    "media_type": ""
  },
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "last_run_at": "ISO-8601"
}
```

Copy operations should write a manifest into the destination set so source paths are auditable even if copied filenames are path-encoded:

```json
{
  "version": 1,
  "copied_at": "ISO-8601",
  "source": {
    "type": "saved_search",
    "id": "stable-id",
    "name": "Saved Search 2026-05-21 1530"
  },
  "items": [
    {
      "source_rel": "portraits/session-a/img001.png",
      "source_caption_rel": "portraits/session-a/img001.txt",
      "dest_media": "portraits__session-a__img001.png",
      "dest_caption": "portraits__session-a__img001.txt"
    }
  ]
}
```

### Option B API Surface (Proposed)

Search:

- `POST /search/run` (paged)
- `GET /search/saved/list`
- `POST /search/saved/create`
- `POST /search/saved/update`
- `POST /search/saved/delete`

Copy:

- `POST /sets/copy_items`
- `POST /sets/create_from_search`

### Option B Notes

- Search is read-only.
- Materialization is just copy-to-set.
- No special `_smart_sets/.../workspace` folder is required for v1.
- Result identity should be full relative path, not basename.
- Root-wide metadata filters can read each folder's `.webcap_state.json` during scan and discard it after that folder is evaluated.
- Pagination controls response size, but `total_matches` still requires evaluating the full scope unless an index is added later.
- A database/index can remain an optional acceleration layer, not the source of truth.

---

## API Surface (Proposed)

Smart Sets:

- `GET /sets/list`
- `POST /sets/create`
- `POST /sets/update`
- `POST /sets/delete`
- `POST /sets/run` (paged)

Workspace:

- `POST /sets/workspace/materialize`
- `POST /sets/workspace/copy_items`
- `GET /sets/workspace/status`

---

## Out of Scope (Current)

- nested boolean rule-builder UI
- cross-project/global sharing UX
- background materialization jobs
- implicit full-root auto-run on keystroke
