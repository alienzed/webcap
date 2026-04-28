# Config File Editing (Safe, Minimal)

## Purpose
Allow editing of TOML config files (e.g., dataset configs) in a safe, minimal way, strictly separated from caption/media editing.

## UI/UX
- Config files are listed in a dedicated panel beside the Summary panel in the Review Report screen (not in the media list, not in a context menu).
- All `.toml` files in the current folder are shown.
- Selecting a config file loads it into the main text editor for editing. No preview is shown.
- Selecting a config file unsets any selected media/caption (using existing review logic; no new "mode" abstractions).
- Autosave: Edits to config files are saved automatically (debounced, atomic, same timing as captions). No explicit save/cancel buttons.

## Implementation Details
- **Frontend:**
  - Add a config panel to the Review Report UI, listing all `.toml` files in the current folder.
  - Selecting a config file loads its content into the editor and disables any caption/media selection.
  - Autosave edits to the backend with debounce (no in-flight/pending logic).
  - All config file logic is in a dedicated JS file (e.g., `config_edit.js`).
  - No shared state or logic with caption/media editing.
- **Backend:**
  - Helpers for config file listing, reading, and saving live in `config.py`.
  - Route in `app.py` delegates to `config.py`.
  - Only `.toml` files in the current folder are allowed; no directory traversal.
  - Writes posted content to disk.
- **Regression Risk:** None to captions/media. No changes to caption/media save logic or routes.

## Safety/Minimalism
- No risk of breaking or complicating caption/media save logic.
- No accidental overwrites—config and caption/media logic are isolated.
- Easy to audit and test.
- No new "mode" abstractions; rely on existing review/caption selection logic.

----
