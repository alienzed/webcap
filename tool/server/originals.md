# Originals Folder: Safety Specification

## Requirement
- The `originals` folder stores immutable baseline originals for media files in a set folder.
- No file in `originals` is ever overwritten or deleted by the app.
- When a file is backed up from the set folder:
  - If the canonical name does not exist in `originals`, copy as-is.
  - If the canonical name already exists in `originals`, do nothing.
- Automatic backup of edited/modified versions is intentionally out of scope.
- Reset/Restore always brings back the canonical original by name.

## Files/Functions/Variables
- **originals.py**: Implements all originals logic.
- **copy_media_to_originals(folder_path)**: Entry point for backing up all media files in a set folder.
- **safe_chmod(path, mode)**: Ensures safe file permissions.
- **MEDIA_ALL_EXTS**: Set of supported media extensions.
- **originals_dir**: The `originals` subfolder of the set folder.

## Algorithm (baseline-only backup)
1. For each media file in the set folder:
    - If the canonical name does not exist in `originals`, copy as-is.
    - If the canonical name exists in `originals`, do nothing.
2. Never delete or overwrite any file in `originals`.
3. Keep originals immutable and deterministic for reset.

## Reset/Restore Semantics
- **Reset/Restore** always restores the file in `originals` with the canonical name (e.g., `dp5.mp4`).
- The canonical original is never moved out of place by backup checks.

## Exceptions/Edge Cases
- If a file cannot be read or written, log and skip (never abort the whole operation).
  - If a file with the same name exists in `originals`, do nothing.
- If the originals folder does not exist, create it.
- Never process blacklisted folders (`originals`, `auto_dataset`).

## Example
Suppose `dp5.mp4` exists in both the set folder and `originals`, but with different content:
- The existing `originals/dp5.mp4` remains unchanged.
- The set-folder file is not copied into `originals` automatically.
- Reset/Restore still restores the baseline `originals/dp5.mp4`.

## Rationale
- Ensures Reset/Restore always brings back the true baseline original by name.
- Keeps `originals` semantically clean: originals only, no edited variants.
- Minimizes logic complexity and avoids accidental reset drift.
- Preserves explicit, predictable behavior across directory loads and mutations.
