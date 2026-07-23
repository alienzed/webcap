# Focused Annotation Wizard

Status: Current behavior with a few forward-looking notes removed. Verified against `tool/js/focused_annotation.js` and `tool/tool.html`.

Last updated: 2026-07-23

## Goal

Keep the focused annotation wizard fast for repeated tagging work without turning it into a separate, reduced-capability UI.

The wizard should preserve the strong parts of annotation guidance while making traversal and review faster.

Current shipped shape:

- Scope comes from the current filtered view or active focus set.
- The wizard starts on the selected visible item's first incomplete group.
- If that item is complete, startup checks subsequent visible items and wraps once.
- The item queue is replaced from the current filtered view after filter-sensitive mutations, so items that stop matching leave immediately.
- Completion is currently `Reviewed` only.
- Group-local `Copy Tags` / `Paste Tags` is available in the group header.

## Phase 1 Decisions

1. Traversal is `Group-first`.
   - Meaning: stay on one group and move across visible items before advancing to the next group.
2. The wizard keeps the full raw group term list.
3. Guidance is additive.
   - Use a separate `Quick Picks` rail rather than removing terms from the main list.
4. True blind batch tagging is not part of this wizard phase.
   - That belongs with the upcoming grid, where the user can see the full scope being affected.

## Layout

### Preview Pane

- Toolbar: item axis controls, rating, and contextual media actions.
- Main area: the current media preview.

### Group Pane

- Top row: group axis controls with `Left` / `Right` buttons around the `Group X/Y` progress pill, plus the close button.
- Second row: group title on the left, action buttons on the right.
- Action buttons include `Edit Terms`, `Delete Group`, `Copy Tags`, and `Paste Tags`.
- Main content:
  - Left: full group term list
  - Right: quieter `Quick Picks` rail

### Quick Picks Rail

- This is intentionally secondary to the main term list.
- It should surface only the strongest candidates for the current group.
- Initial signal sources:
  - current caption matches
  - selection-pose tag suggestions constrained to the current group
  - similar-item tag suggestions constrained to the current group
  - already-selected terms in the current group

## Keyboard Behavior

1. `Enter`
   - Mark the current group reviewed for the current item, then advance in traversal order.
2. `S`
   - Skip current step without changing reviewed state.
3. `Up` / `Down`
   - Move by item.
4. `Left` / `Right`
   - Move by group.
5. The on-screen axis buttons mirror those exact movements and advertise the matching keyboard shortcut in their tooltips.

## Wrapping Rules

The arrow keys move on a Group-first 2D item/group grid. The item axis wraps into the group axis.

### Group-first

- `Up` / `Down` is the primary traversal axis.
- Moving past the last item advances to the next group at the first item.
- Moving past the first item goes to the previous group at the last item.
- `Left` / `Right` changes group directly but does not wrap across items.

## Visual Emphasis

1. Selected terms should be much more obvious than the previous subtle wizard highlight.
2. The wizard should reuse the stronger annotation-style highlight language rather than inventing a softer variant.
3. Main list stays visually primary.
4. `Quick Picks` stays quieter so the modal does not become busier.
5. Navigation/review buttons should provide brief visual feedback when activated by mouse or keyboard.

## Phase 1 Non-Goals

- Dots or other extra-density indicators.
- `Not Applicable` completion state in this modal.
- Batch stamping / apply-to-all behavior inside the wizard.
- New suggestion systems that are not already grounded in existing annotation or QA signals.
