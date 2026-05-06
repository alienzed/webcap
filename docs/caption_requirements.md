
# Caption Requirements Checklist Feature

## Purpose/Overview

Provide a simple, persistent checklist of caption requirements for each folder, allowing users to add or remove requirements as needed. The checklist is shown in a vertical panel docked to the right of the caption editor, visible only when a media item is selected. It is customizable per folder, persists in the folder state JSON, and is designed to be minimal, regression-proof, and fully reversible, with all new logic isolated where possible.

---


# Caption Requirements Checklist

## Overview

The Caption Requirements Checklist helps users systematically validate the quality and completeness of captions for each media item. It provides a vertical checklist panel docked to the right of the caption editor, representing key criteria that should be addressed in every caption. This ensures important details are not overlooked and supports a more consistent review process.

## Goals
- Reduce the risk of missing essential caption elements (e.g., key phrase, lighting, setting, clothing, traits).
- Provide a clear, visual workflow for marking items as reviewed or complete.
- Allow users to customize requirements per set/folder in the future.
- Make the review process more reliable and less prone to distraction or oversight.

## User Experience
- A checklist of requirements is displayed near the caption editor for each media item.
- Default requirements include: key phrase, lighting, setting, clothing, traits.
- Users check off each requirement as they confirm it is addressed in the caption.
- When all boxes are checked, the item is automatically marked as reviewed/complete.
- Unchecking any box will unset the reviewed/complete status.
- The checklist is visible and actionable for every media item.
- (Future) Users may add or remove requirements per set/folder.

## User Stories
- As a captioner, I want to see a list of required elements so I don’t forget to include important details.
- As a reviewer, I want to know at a glance which captions are fully validated.
- As a user, I want the checklist to be simple, unobtrusive, and easy to use.
- As a power user, I want to customize the checklist for different projects or folders (future enhancement).

## Safety and Compatibility
- The checklist is an additive feature and does not interfere with existing review or filter workflows.
- If the checklist is not used, captions and review status can still be managed as before.
- The feature is designed to be non-destructive and easily reversible.

## Out of Scope
- Implementation details (UI layout, data storage, backend changes, etc.)
- Advanced customization or template management (future work)


## UI Placement & Behavior

- The checklist panel is a vertical column docked to the right of the caption editor, inside the `.editor-panel`.
- The checklist is only visible when a media item is selected and a caption is loaded.
- On wide screens, the checklist sits to the right of the editor; on small screens, it stacks below the editor (handled by CSS, not JS).
- No collapse/expand logic is needed; the panel is always visible when relevant.


## Checklist Customization & Interaction

- At the top of the checklist panel is a single-line textbox and a “+” button for adding new requirements.
- Each checklist item is displayed as a checkbox with a label and a small “×” (remove) button to the right.
- Clicking the “+” adds the textbox value as a new requirement (if non-empty, trimmed, and not a duplicate).
- Clicking the “×” removes the corresponding requirement immediately.
- All changes are saved instantly to the folder state JSON.
- The checklist is per-folder; switching folders loads the relevant checklist.
- If no requirements exist, the checklist area is hidden or shows a placeholder message.
- UI is minimal, with no overloading of controls.


## Implementation Details

### DOM
- Add a `<div id="caption-checklist-panel"></div>` as a sibling to the caption editor textarea inside `.editor-panel` in tool.html.
- The checklist panel is only rendered/visible when a media item is selected.

### CSS
- Use flex or grid to lay out the editor and checklist panel side by side on wide screens, stacking on small screens.
- Minimal new CSS; leverage existing panel styles.

### JS/Logic
- New file: `tool/js/checklist.js` for all checklist logic.
- On media item selection, render checklist panel with current requirements.
- Hide/remove checklist panel if no media item is selected.
- Load/save requirements from folder state JSON (no backend changes).
- Add/remove: Textbox and “+” for adding, “×” for removing requirements.
- Update folder state JSON on every change.

### Backend
- No backend changes required. Folder state JSON already supports arbitrary keys; just add `"caption_requirements": [...]`.


## Regression/Safety Analysis

- **Additive Only:** All new logic is in `checklist.js` and a new DOM container; existing code is only minimally touched to initialize and persist the checklist.
- **No Backend Changes:** No server or API changes; all persistence uses existing folder state logic.
- **No Data Loss:** Checklist is stored as a new key; existing folder state and metadata are untouched.
- **Reversible:** If the feature is removed, simply ignore/delete the `caption_requirements` key.
- **No Race Conditions:** All updates are synchronous and explicit; no async/await or race-prone code.
- **UI Isolation:** Checklist panel is visually and functionally isolated from other UI elements.
- **Default Safe:** If the checklist key is missing or corrupt, defaults to an empty list with no errors.

## Validation & Revision

- The feature is fully specified with clear UI, state, and function boundaries.
- All new logic is isolated in a dedicated file (`checklist.js`) and a new DOM container.
- Only minimal, additive changes are made to existing files (main.js, folder_state.js, tool.html, styles.css).
- No backend or API changes are required; all persistence uses existing folder state logic.
- The checklist is per-folder, reversible, and defaults to safe behavior if missing or corrupt.
- Regression risk is extremely low; existing features are not affected.
- The plan is simple, complete, and ready for implementation.

---

## Example Data and UI Mockup

### Example Folder State JSON
```json
{
  "flags": {"cat.jpg": "red"},
  "caption_requirements": [
    "Must mention subject",
    "No forbidden words",
    "At least 5 words"
  ]
}
```

### Example UI

[ Textbox ][ + ]

☐ Must mention subject        ×
☐ No forbidden words         ×
☐ At least 5 words           ×

---

## Workflow/Call Chain

1. **Folder Load**
   - `main.js` triggers folder load.
   - `folder_state.js` loads folder state JSON.
   - `checklist.js` calls `loadChecklistFromState(state)`.
   - `initChecklistPanel(containerEl)` renders the checklist panel.

2. **Add Requirement**
   - User enters text, clicks “+”.
   - `addRequirement(text)` validates and adds to checklist array.
   - `saveChecklistToState()` updates folder state JSON and saves via `folder_state.js`.
   - `renderChecklist(requirements)` updates the DOM.

3. **Remove Requirement**
   - User clicks “×” next to a requirement.
   - `removeRequirement(index)` removes from checklist array.
   - `saveChecklistToState()` updates folder state JSON and saves.
   - `renderChecklist(requirements)` updates the DOM.

4. **Folder Switch**
   - On folder change, steps 1–3 repeat for the new folder.

---
