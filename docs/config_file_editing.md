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

## Safety & Maintainability
- Config and caption/media logic are completely separated in both frontend and backend.
- All config file operations are atomic and auditable.
- The UI and code structure make it clear which file type is being edited.
