# Phrase Copy Panel

## Purpose
A vertical panel for quickly copying preset or user-added words/phrases (e.g., adjectives, short phrases) to the clipboard for use in captions. Designed for speed and minimal distraction during captioning.

---


## UI/UX

- **Placement:**
  - For now, the panel is always at the bottom of the editor (like the caption requirements panel), regardless of screen width.
  - The panel HTML is static and present in the DOM from the start—not injected or created by JavaScript.
  - (If a side-by-side layout is ever used, the panel must never shrink the textarea below a comfortable minimum width.)
- **Integration:**
  - The panel is part of a tabbed interface with the caption requirements panel (Tab 1: Requirements, Tab 2: Phrases).
  - A floating toggle button (top right of the editor) collapses/expands the panel (optional).
- **Interaction:**
  - Each phrase is a single-line button or text element.
  - Clicking a phrase copies it to the clipboard (no checkboxes, no drag/drop).
  - Add/remove phrases on the fly (mirroring caption requirements UI, but simpler).
- **Persistence:**
  - Phrase list is saved per-folder in folder state (just an array of strings).
  - No import/export/reset; list is always short and managed in-place.
- **No keyboard shortcuts, search, or advanced features.**

---

## Data Model

- Stored in folder state (e.g., `folderState.phrases`), as an array of strings.
- No additional metadata or state per phrase.

---

## Implementation Notes

- No fallback logic or error guards—fail loudly if state or UI is out of sync.
- Minimal, deterministic, and linear JS.
- Use async where it is the natural fit (for example clipboard or network calls), but keep implementation direct and minimal.
- UI and state must always be in sync.
