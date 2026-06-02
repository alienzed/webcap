# Filtered Selection Prepare (Current Behavior)

## Goal

Allow non-destructive multi-pass curation by preparing from the currently visible media subset, while preserving a durable audit snapshot of what was prepared.

## Shipped Behavior

1. `Prepare Dataset` uses visible media rows from the current list (`data-type="media"`).
2. If visible count is `0`, prepare is blocked.
3. If visible count is less than total media count, a confirmation prompt is shown every time.
4. `Prepare` fully rebuilds `auto_dataset` each run.
5. `Generate Dataset Config` writes `dataset.hi.toml` and `dataset.lo.toml`. Structured snapshot comments are available in code and controlled by `training.write_selection_snapshot_comments`.

## Selection Snapshot

Snapshot metadata is still collected from `prep_manifest.json` and can be rendered by the backend helper when `training.write_selection_snapshot_comments` is enabled.

- `snapshot.generated_at`
- `snapshot.source_folder`
- `snapshot.prepared_mode` (`all` or `visible_subset`)
- `snapshot.selected_count`
- `snapshot.total_count`
- `snapshot.prepared_count`
- `snapshot.selection_hash` (`sha256` of prepared filenames)
- `criteria.*` key/value lines
- bucket-grouped `file | caption` rows

## Caption Provenance (Strict)

Snapshot caption rows are read from prepared caption files in `auto_dataset` (next to prepared media).  
This is intentional so audit text reflects what training consumed.

There is no fallback to source captions for snapshot generation.

## Failure Policy

The pipeline fails loudly on invalid or incomplete state:

- missing `prep_manifest.json`
- invalid/missing `selection` metadata
- malformed prepared entries
- missing prepared caption files
- empty prepared caption text

## Notes

- This flow replaces the need to duplicate folders for most curation passes.
- Full-directory prepare is also treated as a valid snapshot case (`prepared_mode = all`).
