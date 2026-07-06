# Duplicate Image Feature

Status: Current behavior. Verified against `tool/js/media_actions.js`, `tool/js/media_context_actions.js`, and `tool/server/file_ops.py`.

Last updated: 2026-07-04

## Definition
Duplicate a single image file in the current folder using the same UX and backend flow style as Duplicate Folder.

## Goal
- Keep behavior predictable and linear.
- Use the same interaction pattern users already know from Duplicate Folder.
- Never overwrite existing files.

## UI Flow (Match Duplicate Folder)
1. User right-clicks an image file row.
2. Context menu shows Duplicate Image.
3. Clicking Duplicate Image sends one POST request.
4. On success:
- Show success status.
- Refresh current directory and reselect the duplicated file by returned `dstName`.
5. On failure:
- Show backend error text.

## Backend Flow
- Request body includes source path for one file.
- Backend validates source exists and is a file.
- Backend rejects duplication from `originals/`.
- Backend only allows still image extensions.
- Backend finds a non-colliding destination name in the same folder.
- Backend copies file bytes to the new file.
- Backend duplicates the matching `.txt` sidecar when present.
- Backend returns success JSON with destination path and filename.

## Naming Rules (Mirror Folder Duplicate Style)
Given `photo.jpg`, create:
1. `photo copy.jpg`
2. `photo copy 2.jpg`
3. `photo copy 3.jpg`

Rules:
- Keep extension unchanged.
- Keep destination in same folder as source.
- Never overwrite; always increment until free name is found.

## Sidecar Caption Rule
If `photo.txt` exists, duplicate it to match new stem:
- `photo.txt` -> `photo copy.txt`
- `photo copy 2.txt`, etc.

If no sidecar caption exists, duplicate still succeeds.

## Constraints
- Only for image files.
- Same-folder duplication only (no move).
- Not allowed for folders.
- Not allowed when source is missing.

## API Contract
POST `/fs/duplicate_image`

Request:
```json
{
  "src": "relative/path/to/photo.jpg"
}
```

Success response:
```json
{
  "success": true,
  "dst": "C:/absolute/path/to/photo copy.jpg",
  "dstName": "photo copy.jpg"
}
```

Error response:
```json
{
  "error": "message"
}
```

Current validation points:

- Appears only for still-image media rows.
- Uses one backend POST call.
- Names follow `copy`, `copy 2`, `copy 3`, etc.
- Never overwrites an existing file.
- Duplicates the matching caption sidecar when present.
- Rejects use inside `originals/`.
