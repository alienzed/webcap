# Focused Annotation Wizard

Last updated: 2026-06-17

## Goal

Keep the focused annotation wizard fast for repeated tagging work without turning it into a separate, reduced-capability UI.

The wizard should preserve the strong parts of annotation guidance while making traversal and review faster.

## Phase 1 Decisions

1. `Group-first` is the default traversal mode.
   - Meaning: stay on one group and move across visible items before advancing to the next group.
2. `Item-first` remains available as a secondary mode.
3. The traversal switch is visible but low-noise.
   - Placement: preview toolbar near the item progress pill, not mixed into the main tagging controls.
4. The wizard keeps the full raw group term list.
5. Guidance is additive.
   - Use a separate `Quick Picks` rail rather than removing terms from the main list.
6. True blind batch tagging is not part of this wizard phase.
   - That belongs with the upcoming grid, where the user can see the full scope being affected.

## Layout

### Preview Pane

- Left: item axis controls with `Up` / `Down` buttons around the `Item X/Y` progress pill.
- Right: traversal mode switch (`Group-first`, `Item-first`) and close button.

### Group Pane

- Top row: group axis controls with `Left` / `Right` buttons around the `Group X/Y` progress pill.
- Second row: group title on the left, action buttons on the right.
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
2. `N`
   - Mark current group `Not Applicable`, then advance.
3. `S`
   - Skip current step without changing reviewed state.
4. `Up` / `Down`
   - Move by item.
5. `Left` / `Right`
   - Move by group.
6. The on-screen axis buttons should mirror those exact movements and advertise the matching keyboard shortcut in their tooltips.

## Wrapping Rules

The arrow keys move on a 2D item/group grid, but only the active traversal axis wraps into the other dimension.

### Group-first

- `Up` / `Down` is the primary traversal axis.
- Moving past the last item advances to the next group at the first item.
- Moving past the first item goes to the previous group at the last item.
- `Left` / `Right` changes group directly but does not wrap across items.

### Item-first

- `Left` / `Right` is the primary traversal axis.
- Moving past the last group advances to the next item at the first group.
- Moving past the first group goes to the previous item at the last group.
- `Up` / `Down` changes item directly but does not wrap across groups.

## Visual Emphasis

1. Selected terms should be much more obvious than the previous subtle wizard highlight.
2. The wizard should reuse the stronger annotation-style highlight language rather than inventing a softer variant.
3. Main list stays visually primary.
4. `Quick Picks` stays quieter so the modal does not become busier.
5. Navigation/review buttons should provide brief visual feedback when activated by mouse or keyboard.

## Phase 1 Non-Goals

- Dots or other extra-density indicators.
- Batch stamping / apply-to-all behavior inside the wizard.
- New suggestion systems that are not already grounded in existing annotation or QA signals.
