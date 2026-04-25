# Config File Editing (Safe, Minimal)

## Purpose
Allow editing of TOML config files (e.g., dataset configs) in a safe, minimal way.

## UI/UX
- Access via contextual menu on “Current Folder” or from Review Captions report.
- Lists all `.toml` files in the current folder (not just templates).
- Selecting a file loads it into the existing text editor/preview panel for editing.
- Save/cancel actions as with captions.

## Implementation Details
- **Frontend:**
  - Add UI to select config files (context menu or review report section).
  - Load config file content into the text area/editor.
  - POST edits to a dedicated backend endpoint (e.g., `/fs/save_config`).
- **Backend:**
  - New endpoint only accepts `.toml` files in the current folder.
  - Strict validation: no directory traversal, only `.toml` files.
  - Writes posted content to disk.
- **Regression Risk:** None to captions/media. No changes to caption/media save logic or routes.

## Safety/Minimalism
- No risk of breaking or complicating caption/media save logic.
- No accidental overwrites—config and caption/media logic are isolated.
- Easy to audit and test.

---
