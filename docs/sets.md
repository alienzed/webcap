# Sets (Smart + Frozen)

## Goal

Add durable, reusable set workflows without brittle manual folder cloning:

- `Smart Set`: saved query definition (`location + filters`), re-runnable.
- `Frozen Set`: materialized, self-contained set folder for stable training workflows.

This feature should support:

- multi-character LoRA subset creation
- style/media extraction by keyword
- reusable curation passes over evolving source folders

---

## Definitions

### Smart Set

A Smart Set stores *how to find* items, not copied files.

Core properties:

- start location
- recursive toggle
- exclusion rules
- filter criteria

Loading a Smart Set re-applies these rules to current filesystem contents.

### Frozen Set

A Frozen Set stores *actual prepared files* in a dedicated folder.

Core properties:

- source items copied into the Frozen Set folder
- caption files copied with media
- `originals/` populated so reset/restore workflows remain available
- manifest file with provenance and source Smart Set details

Frozen Sets should remain usable even if source folders/filters later change.

---

## Scope

### In Scope (v1.1)

- Save, list, load, update, delete Smart Sets
- Recursive matching option for Smart Sets
- Default recursive excludes: `auto_dataset`, `originals`
- Materialize Frozen Set from current Smart Set (or current visible selection)
- Set Manager UI for lifecycle operations

### Out of Scope (initial)

- complex rule builder UI (nested boolean groups)
- cross-project/global sharing UI
- background job queue for huge materializations

---

## Data Model

## Smart Set Record

```json
{
  "id": "uuid-or-stable-id",
  "name": "string",
  "root_folder": "relative/path/from_fs_root",
  "recursive": true,
  "exclude_dirs": ["auto_dataset", "originals"],
  "filters": {
    "text": "",
    "missing_captions_only": false,
    "reviewed_only": false,
    "min_stars_gt": "",
    "flag_filter": "",
    "invalid_ar_only": false
  },
  "notes": "",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

## Frozen Set Manifest

Stored inside Frozen Set folder as `set_manifest.json`.

```json
{
  "version": 1,
  "kind": "frozen_set",
  "name": "string",
  "created_at": "ISO-8601",
  "source": {
    "smart_set_id": "id-or-null",
    "root_folder": "relative/path",
    "recursive": true,
    "exclude_dirs": ["auto_dataset", "originals"],
    "filters": {}
  },
  "items": [
    {
      "source_rel_path": "path/to/file.ext",
      "dest_rel_path": "file.ext",
      "caption_rel_path": "file.txt",
      "hash_sha256": "optional"
    }
  ]
}
```

---

## Storage Location

Smart Set definitions should be stored in one project-visible location under current FS root, not app install dir:

- `<FS_ROOT>/.webcap_sets.json`

Frozen Sets should live under working area, not app-global metadata paths:

- `<current_working_folder>/_sets/<frozen_set_name>/`

Rationale:

- portable with dataset workspace
- intuitive ownership
- easy backup/versioning

---

## Recursive Matching Rules

When `recursive=true`:

- include media from all descendant folders
- skip descendant folders named `auto_dataset` or `originals` by default
- allow future per-set override of excludes

Key requirement:

- item identity must be path-based (`relative/path/file.ext`), not filename-only, to avoid collisions across subfolders.

---

## Frozen Set Materialization Rules

When materializing:

1. create target folder under `_sets/`
2. copy selected media files to Frozen Set root (or deterministic structure)
3. copy caption `.txt` files
4. copy source media into `originals/` to preserve reset/restore feature parity
5. write `set_manifest.json`

Failure policy:

- fail loudly on missing caption/source
- no partial silent success
- report copied/skipped counts with reasons

---

## API (Proposed)

### Smart Set Lifecycle

- `GET /sets/list`
- `POST /sets/save`
- `POST /sets/update`
- `POST /sets/delete`
- `POST /sets/apply` (returns resolved selection and filter payload)

### Frozen Set

- `POST /sets/materialize_frozen`
- `GET /sets/frozen/list` (optional initial)
- `POST /sets/frozen/open` (optional initial)

---

## UI (Set Manager)

Add two quick actions in top-left utility area:

- `Save Set`
- `Load Set`

Also add dedicated Set Manager panel/modal:

- list Smart Sets
- load/apply
- edit/update
- delete
- materialize Frozen Set
- open Frozen Set folder
- show set details (source folder, recursive, filters, notes, last updated)

`Recursive` toggle should be visible near filters and persisted by Smart Set save.

---

## Compatibility Notes

- Existing Prepare/Generate workflows remain unchanged.
- Applying a Smart Set should feed current list selection/filter state, not bypass it.
- Frozen Sets should be immediately compatible with existing review/caption/prepare flows.

---

## Delivery Plan

### Phase 1: Smart Sets

- schema + file storage
- save/list/load/update/delete/apply
- recursive + excludes
- path-based selection identity

### Phase 2: Frozen Sets

- materialization endpoint
- `_sets/` folder output
- `originals/` parity + manifest

### Phase 3: UX Polish

- Set Manager details and sorting
- rename/clone set
- quick stats (item count, last materialized)

