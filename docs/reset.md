# Reset Feature

## Definition (from spec)
- Only available for files in set folders with an equivalent original.
- Overwrites the main file with the original, regardless of current content.
- Always overwrites, but only if the original exists.

## UI/UX
- Reset is shown in the context menu for files in set folders (not in originals).
- User is prompted for confirmation before reset.
- If the original does not exist in originals, display an error and do nothing.
- After reset, the UI refreshes the current directory and notifies the user.

## Logic Map
- **Frontend:**
  - Calls backend /media/reset with { folder, fileName }.
  - Waits for response; on success, refreshes file list and notifies user.
  - On error, displays error message.
- **Backend:**
  - Receives POST /media/reset with folder and fileName.
  - Looks for the file in <folder>/originals/<fileName>.
  - If not found, returns 404.
  - If found, copies original to <folder>/<fileName> (overwriting).
  - Does not alter originals.
  - Returns success or error.

## Validation Checklist
- [ ] Reset only available for files in set folders (not originals).
- [ ] Always overwrites the file in set folder with the original.
- [ ] Does nothing if original is missing.
- [ ] Does not alter or remove from originals.
- [ ] UI and backend error messages are clear and actionable.
