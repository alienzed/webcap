# Configuration File System Overview (Current Behavior)

## Config File Handling in UI

- Config files are **not** mixed into the main media list.
- The Train panel has a dedicated config list (`training-config-list`) populated via:
  - `GET /fs/list_config?folder=<current-folder>`
- Config files are displayed in High Noise / Low Noise columns and can be opened in the editor.

## Source of Truth for Config Discovery

- Backend route: `tool/server/app.py` -> `/fs/list_config`
- Backend helper: `tool/server/config.py` -> `list_toml_files(folder_path)`

This returns `.toml` filenames in the selected folder only.

## Automatic Config File Creation

- Config templates are **not** created on ordinary folder load (`/fs/describe`).
- Missing template files are created during dataset-generation/training flows:
  - `/fs/generate_dataset_config`
  - `/fs/train_run`
- Canonical training config templates live in `tool/templates/config.hi.toml` and `tool/templates/config.lo.toml`.
- A shared backend helper materializes those templates into set folders, with placeholder substitution via `fill_template_placeholders(...)`.
- Dataset TOML examples are documentation-only and live under `docs/examples/`; generated `dataset.hi.toml` / `dataset.lo.toml` come from code, not templates.

## Editing Flow

- Open config file: frontend requests `/fs/read_config`.
- Save config file: frontend posts `/fs/save_config`.
- Saving writes the selected TOML file in place.

## Summary

Config editing is intentionally separated from media browsing:
- media list for media items only
- train panel for config files
- config file scaffolding created during generate/train workflows, not directory browsing
