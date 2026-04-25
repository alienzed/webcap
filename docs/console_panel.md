# Expandable Console Panel (Streaming Output)

## Purpose
Show streaming output (e.g., autoset, deface) without cluttering the main UI.

## UI/UX
- Status area acts as a mini-console for quick feedback.
- Right-aligned arrow/button expands a resizable, scrollable console overlay.
- Console auto-opens on streaming output, can be manually opened/closed.
- Console is scrollable, supports many lines, and does not interfere with the text area or preview panel.

## Implementation Details
- **HTML:**
  - Add a hidden `<div id="console-panel">` at the bottom of the main container.
  - Add a button (arrow or icon) to the status area to toggle the console.
- **CSS:**
  - Style as a fixed or absolute overlay, resizable (CSS resize: vertical), scrollable, with a close/hide button.
- **JS:**
  - Add functions to show/hide the console, append streaming lines, and auto-scroll.
  - Auto-open on streaming output; allow manual open/close.
- **Regression Risk:** Low. Additive UI feature, no changes to backend or existing UI logic.

## Safety/Minimalism
- No permanent UI clutter.
- Power users can expand for detail; casual users aren’t distracted.
- Familiar pattern (like “Show more” in many apps).

---
