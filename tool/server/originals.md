# Originals Folder: Safety and Versioning Specification

## Requirement
- The `originals` folder is an append-only, versioned backup for all media files in a set folder.
- No file in `originals` is ever overwritten or deleted by the app.
- When a file is backed up from the set folder:
  - If the name is available in `originals`, copy as-is.
  - If the name exists in `originals` and the content is identical (hash matches), do nothing. (Only the file with the same name is checked; other files with the same hash are ignored.)
  - If the name exists in `originals` and the content is different (hash differs):
    - Move (rename) the existing file in `originals` with that name to a new unique name (e.g., `name-1.ext`, `name-2.ext`, etc.).
    - Copy the new file from the set folder into `originals` under the original name.
- This ensures that the latest version is always mapped to the canonical name, and all previous versions are preserved under incremented names.
- Reset/Restore always brings back the latest version by name, but all history is preserved.

## Files/Functions/Variables
- **originals.py**: Implements all originals logic.
- **copy_media_to_originals(folder_path)**: Entry point for backing up all media files in a set folder.
- **rotate_on_collision(src_path, originals_dir)**: Core logic for rotating originals on name collision.
- **file_hash(path)**: Computes SHA256 hash for file content comparison.
- **safe_chmod(path, mode)**: Ensures safe file permissions.
- **MEDIA_ALL_EXTS**: Set of supported media extensions.
- **originals_dir**: The `originals` subfolder of the set folder.

## Algorithm (rotate_on_collision)
1. For each media file in the set folder:
    - Compute its hash.
    - If the name does not exist in `originals`, copy as-is.
    - If the name exists in `originals`:
      - If the hash matches (for that file), do nothing (already backed up).
      - If the hash differs (for that file):
        - Find the next available unique name (e.g., `name-1.ext`, `name-2.ext`, ...).
        - Move the existing file in `originals` with that name to that unique name.
        - Copy the new file from the set folder into `originals` under the original name.
2. Never delete or overwrite any file in `originals`.
3. Always preserve all versions.

## Reset/Restore Semantics
- **Reset/Restore** always restores the file in `originals` with the canonical name (e.g., `dp5.mp4`).
- Older versions (e.g., `dp5-1.mp4`, `dp5-2.mp4`) are preserved for manual recovery or audit, but are not restored by default.

## Exceptions/Edge Cases
- If a file cannot be read or written, log and skip (never abort the whole operation).
  - If a file with the same name and hash exists, do nothing.
  - If a file with the same name but different hash exists, rotate as above.
  - Ignore other files with the same hash but different names.
- If the originals folder does not exist, create it.
- Never process blacklisted folders (`originals`, `auto_dataset`).

## Example
Suppose `dp5.mp4` exists in both the set and originals, but with different content:
- The existing `originals/dp5.mp4` is renamed to `originals/dp5-1.mp4` (or next available).
- The new `dp5.mp4` from the set folder is copied to `originals/dp5.mp4`.
- Now, Reset/Restore will restore the new version, but the old version is still available as `dp5-1.mp4`.

## Rationale
- Guarantees no data loss: all versions are preserved.
- Ensures Reset/Restore always brings back the latest version by name.
- Keeps originals append-only and auditable.
- Simple, robust, and user-friendly.
