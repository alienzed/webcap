# Duplicate Image Feature

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
- Refresh current directory.
5. On failure:
- Show backend error text.

## Backend Flow (Match Duplicate Folder)
- Endpoint style should mirror `/fs/duplicate_folder`.
- Request body includes source path for one file.
- Backend validates source exists and is a file.
- Backend finds a non-colliding destination name in the same folder.
- Backend copies file bytes to the new file.
- Backend returns success JSON and destination path/name.

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

## Suggested API Contract
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
  "dst": "relative/path/to/photo copy.jpg"
}
```

Error response:
```json
{
  "error": "message"
}
```

## Validation Checklist
- [ ] Duplicate Image appears in file context menu for image files.
- [ ] Duplicate Image sends one backend POST call.
- [ ] New name uses copy/copy 2/copy 3 pattern.
- [ ] Source image remains unchanged.
- [ ] Destination image is created in same folder.
- [ ] Existing files are never overwritten.
- [ ] Sidecar caption duplicates when present.
- [ ] UI refreshes after success.
- [ ] Clear error shown on failure.
