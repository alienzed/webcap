# Rename Feature — WebCap

## Overview
The rename feature allows users to rename files and folders within a dataset using the context menu. All rename operations are safe, explicit, and reversible, following the project’s safety and mutation rules.

## User Workflow
- **Initiation:**
  - User right-clicks a file or folder and selects "Rename" from the context menu.
  - Protected folders (e.g., `originals`) do not show the Rename option.
- **Prompt:**
  - For files: User is prompted for a new name. The extension is preserved if omitted.
  - For folders: User is prompted for a new folder name. Reserved names are disallowed.
- **Validation:**
  - Names must not be empty, ".", "..", contain slashes, or match reserved names.
  - For files, the extension must be valid for the media type.
- **Execution:**
  - The frontend sends a POST request to `/fs/rename` with the folder, old name, and new name.
  - The backend validates parameters, checks for existence, and performs the rename.
  - For files, if a sidecar caption exists, it is renamed as well.
  - For folders, the rename is performed unless the folder is protected.
  - If the file is listed in `reviewedKeys` in `.webcap_state.json`, the entry is updated to the new name.
- **Reversibility:**
  - All destructive actions are recoverable via the `originals` folder. No permanent deletion occurs.

## Backend API
- **Endpoint:** `/fs/rename` (POST)
- **Payload:** `{ folder, old_name, new_name }`
- **Behavior:**
  - Validates input and checks for protected names.
  - Renames file or folder.
  - Renames sidecar caption if present.
  - Updates `reviewedKeys` in `.webcap_state.json` if needed.
  - Returns error if source does not exist or target already exists.

## Frontend Logic
- **File:** `tool/js/media.js`
- **Functions:**
  - `promptRenameMedia(mediaItem)`: Prompts user and validates input.
  - `renameMedia(mediaItem, oldFile, newFile)`: Sends request to backend and handles response.
- **UX:**
  - Status messages are shown for success or failure.
  - Directory is refreshed after rename.

## Safety & Guardrails
- No destructive operation is performed without explicit user action.
- All mutations are explicit and recoverable.
- No rename is allowed for protected folders or reserved names.
- All state changes are reflected in `.webcap_state.json`.

## Alignment with Spec
- Context menu supports Rename for files/folders except protected ones.
- All destructive actions are recoverable via `originals`.
- No trash or state file is used for undo; only originals.
- All state is managed in `.webcap_state.json`.
- UI and backend both enforce validation and safety rules.

## Open Issues / TODO
- [ ] Add tests for edge cases (e.g., renaming to existing name, reserved names).
- [ ] Ensure all UI entry points use the same validation logic.
- [ ] Document error messages for user reference.
