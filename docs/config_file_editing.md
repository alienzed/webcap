# Config File Editing (Safe, Minimal)

## Purpose
Enable editing of TOML config files (such as dataset configs) using the main text editor, with clear separation from caption/media editing.

## UI/UX
- The Review Report UI includes a dedicated config panel that lists all `.toml` files in the current folder.
- When a user selects a config file from this panel:
  - The file’s contents are loaded into the main text editor (the same editor used for captions).
  - Any current media/caption selection is cleared.
  - The editor is fully editable for config files.
- Edits to config files are autosaved (debounced, atomic, same timing as captions).

## Implementation
- The config panel is implemented in a dedicated JS file (e.g., `config_edit.js`).
- Selecting a config file triggers loading its content into the main editor and disables any media/caption selection.
- Autosave logic for config files is handled separately from captions/media.
- Backend helpers for listing, reading, and saving config files are in `config.py`, with routes in `app.py`.
- Only `.toml` files in the current folder are listed and editable.

## Safety & Maintainability
- Config and caption/media logic are completely separated in both frontend and backend.
- All config file operations are atomic and auditable.
- The UI and code structure make it clear which file type is being edited.
