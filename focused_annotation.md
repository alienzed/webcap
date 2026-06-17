# Focused Annotation Modal

## Goal

Add a purpose-built annotation mode that reduces cognitive load by showing:

- one media item
- one requirement group
- one focused set of actions

The main value is not new annotation logic. The value is a constrained flow that keeps the user on task.

## Why

The current UI is powerful, but annotation competes with too many adjacent controls:

- preview actions
- caption editing
- helper tabs
- grouped requirement/tag surfaces
- review and training affordances

Focused Annotation should feel like a deliberate work mode that says: "annotate this item, in this group, then move on."

## Entry Points

Initial launch surfaces:

1. Media item context menu action: `Focused Annotate...`
2. Preview action button near the top-right preview actions area

Both should enter the same flow.

## Scope

This mode is for annotation only.

It should reuse existing requirement, tag, review, and `n/a` behavior wherever possible rather than inventing parallel logic.

## Source Set

When launched, the wizard should operate over:

1. the current focus set, if one exists
2. otherwise the current visible filtered media items
3. otherwise just the current folder ordering

This keeps the mode compatible with existing filtering and review-driven targeting.

## Core Flow

For each item:

1. Open on the first incomplete requirement group.
2. Show only that group.
3. Let the user add/remove tags for that group.
4. Let the user mark the group `Done`, `N/A`, or `Skip`.
5. Advance automatically to the next group.
6. After the last group, advance automatically to the next item.

On reopen, the current item should resume at the first incomplete group.

## Full-Screen Modal

Use a dedicated full-screen modal instead of trying to repurpose the cramped helper panel.

Target layout:

- full-screen or near-full-screen overlay
- large media preview
- one requirement group panel with generous vertical space
- clear navigation and progress affordances

Desktop layout:

- preview on the left
- focused group panel on the right

Narrow layout:

- preview on top
- focused group panel below

## Group Panel Contents

The whole active group should be present, not just bare chips.

Include:

- group title
- completion state
- current-item selected tags for that group
- the existing keyword-match highlighting behavior
- group term management affordances
- group term pin/unpin state
- term edit management already available in the current UI

This mode should feel focused, not stripped-down to the point of losing power.

## Required Actions

Visible actions for the active group:

- `Back`
- `Skip`
- `N/A`
- `Done`
- `Exit`

Recommended behavior:

- clicking tags does not auto-advance
- `Done` advances
- `N/A` advances
- `Skip` advances without changing state

That keeps the flow fast without guessing when the user is finished selecting tags.

## Keyboard Behavior

Keyboard should be first-class.

Suggested bindings:

- `Enter` -> `Done`
- `N` -> `N/A`
- `S` -> `Skip`
- `Left` -> previous group or previous item step
- `Right` -> next group or next item step when appropriate
- `Esc` -> `Exit`

The modal should trap focus properly while open.

## Progress

Show progress clearly, for example:

- `Item 12/80`
- `Group 3/9`
- current group name

Optional but desirable:

- indicate whether the current item came from a focus set or filtered view

## State Reuse

Focused Annotation should reuse existing state and save paths where possible:

- current item selection
- checklist group ordering
- checklist checked state
- checklist `n/a` state
- requirement keyword term definitions
- pinned term behavior
- tag toggling on the current media item
- reviewed synchronization

The mode should be a presentation and flow layer over current annotation behavior, not a forked system.

## Important Existing Behavior To Preserve

1. Pinned terms should remain semantically strong.
   Pinned means part of the real shared baseline.

2. The current highlight behavior is good and should carry into this mode.

3. Group term pin/edit management should still be available from within the focused group.

4. The mode should benefit from current filter/focus targeting instead of replacing it.

## V1 Non-Goals

Do not make V1 do everything.

Out of scope for the first pass:

- full caption editing inside the wizard
- batch tagging across multiple items
- automatic intelligence beyond current suggestions/highlights
- replacing the normal helper panel
- redesigning requirement data structures

## MVP Definition

V1 is successful if:

1. the user can launch Focused Annotation from the current item
2. the modal shows a large preview and one requirement group
3. the user can tag, mark `Done`, mark `N/A`, or `Skip`
4. the flow advances group-by-group, then item-by-item
5. progress is visible
6. existing term highlighting and group term management still work

## Implementation Bias

Prefer a dedicated renderer for the focused group rather than trying to hide most of the existing checklist panel.

Reason:

- clearer layout control
- easier keyboard flow
- fewer accidental dependencies on cramped panel assumptions
- better long-term path toward a true "killer feature"

The modal container itself should be straightforward.
The important work is the wizard flow and the disciplined reduction of distractions.
