# Originals Folder: Safety Specification

## Requirement
- The `originals` folder stores immutable baseline originals for media files in a set folder.
- No valid existing canonical in `originals` is ever overwritten or deleted by the app.
- When a file is backed up from the set folder:
  - Establishing a required canonical original is mandatory.
  - If the canonical name does not exist in `originals`, copy as-is; a failed copy propagates and prevents a successful folder load.
  - A newly-created partial or zero-byte destination is removed after a failed copy or size validation.
  - If the canonical name already exists, a valid non-empty regular file remains immutable; zero-byte or non-file canonicals are invalid and are not automatically repaired.
- Automatic backup of edited/modified versions is intentionally out of scope.
- Reset/Restore brings back the canonical original by name only when it is a valid non-empty regular file.
- Deterministic mutation verification for images compares working file hash vs `originals/<fileName>` hash.

## Files/Functions/Variables
- **originals.py**: Implements all originals logic.
- **copy_media_to_originals(folder_path)**: Entry point for backing up all media files in a set folder.
- **safe_chmod(path, mode)**: Ensures safe file permissions.
- **MEDIA_ALL_EXTS**: Set of supported media extensions.
- **DETERMINISTIC_MUTATION_IMAGE_EXTS**: Supported deterministic verification formats (`.jpg`, `.jpeg`, `.png`, `.webp`).
- **originals_dir**: The `originals` subfolder of the set folder.

## Algorithm (baseline-only backup)
1. For each media file in the set folder:
    - If the canonical name does not exist in `originals`, copy as-is and require a non-empty, equal-size result.
    - If the canonical name exists, preserve it only when it is a valid non-empty regular file; otherwise fail without repairing it.
2. Never overwrite a valid existing canonical in `originals`; remove only a newly-created partial or zero-byte copy.
3. Keep originals immutable and deterministic for reset.

## Reset/Restore Semantics
- **Reset/Restore** always restores the file in `originals` with the canonical name (e.g., `dp5.mp4`) only when it is a non-empty regular file.
- The canonical original is never moved out of place by backup checks.

## Deterministic Image Mutation Verification
- Route: `/fs/mutation_status`
- Scope: still images only (`.jpg`, `.jpeg`, `.png`, `.webp`)
- Method:
  - Hash current image bytes (SHA256).
  - Hash canonical original bytes in `originals/`.
  - Mark mutated when hashes differ.
- Cache: `media_hashes.json` stores size + mtime_ns + sha256 to avoid rehashing unchanged files.
- Video files are intentionally excluded from deterministic hash verification and use best-effort UI state.

## Exceptions/Edge Cases
- A required canonical original that cannot be copied aborts folder load rather than being logged and skipped.
- Reset and Restore refuse zero-byte or non-file original media without changing the working media.
- If a file with the same name exists in `originals`, preserve it only when it is a valid non-empty regular file.
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
