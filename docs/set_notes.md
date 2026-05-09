# Set Notes Panel

## Purpose
A simple, persistent text editor for jotting down freeform notes about the current set/folder. Useful for reminders, TODOs, or any context you want to track while working on a set.

---

## UI/UX
- Tab 3 in the right panel: "Set Notes."
- Displays a plain multi-line `<textarea>` for editing notes.
- No formatting, just plain text.
- Auto-save on debounce timer (e.g., 500ms after typing stops), and on Ctrl+S (just like config and captions).
- No auto-save on blur, no explicit save button.
- No formatting, no rich text, no extra features.
- No import/export/reset.
- No async unless required for safety.
- No fallback logic; fail loudly if state or UI is out of sync.

---

## Data Model
- Notes are saved per-folder in folder state as a single string (e.g., `folderState.notes`).
- Loaded when the folder is loaded, saved on change (debounced or Ctrl+S).

---

## Implementation Notes
- Minimal, deterministic, and linear JS.
- UI and state must always be in sync.
- No guards or error swallowing—fail loudly if anything goes wrong.
