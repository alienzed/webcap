# Media Grid

## Goal

Add a dedicated grid workspace for fast visual comparison, multi-selection, rating, and batch tagging.

This is not another file list. The normal media list remains the primary navigation and single-item annotation surface. Media Grid is a temporary batching workspace opened from the current working context.

## Entry

Open Media Grid from the current folder/work area.

Phase one should use the current visible media set:

- current folder
- current filters
- current focus set, if active

The user should not need to re-create the target set inside the grid. If the visible set is what they are looking at before opening Grid, that is the set Grid should show.

## Shape

Use a full-screen or near-full-screen modal workspace.

Avoid reusing or rearranging the main app DOM. Grid should be independent enough that it does not require hiding the editor, caption helpers, QA panel, metadata panel, or normal media list.

Target layout:

- main canvas: thumbnail grid
- lightweight header: count, active context, batch status
- optional context note: active focus set/report name when applicable
- right sidebar: grouped tag controls in configured order
- action area: rating, selection helpers, and status

Reports may remain useful as context, especially when Grid is opened from a focus set or selection analysis result. Grid should not depend on reports being active.

## Phase One Scope

Phase one should support:

- show the current visible media set as thumbnails
- multi-select items
- fast rating of selected items
- grouped tag sidebar with collapsible requirement/tag groups
- selection-aware tag highlighting
- batch apply/remove tags from selected items
- select all visible
- clear selection
- visible progress/status for batch operations

Rating is a primary use case. Example workflow:

1. Filter or focus to "face close-ups".
2. Open Grid.
3. Downrate items that should be excluded.

Batch tagging is the second primary use case. Example workflow:

1. Select a visual cluster in Grid.
2. Use the grouped sidebar to see which tags are already present.
3. Apply or remove one or more tags across the selection.

Tag chips in the sidebar should reflect the current selection:

- no selected items have the tag
- some selected items have the tag
- all selected items have the tag

Click behavior should stay simple:

- inactive tag: add to selected items
- mixed tag: add to selected items
- all-active tag: remove from selected items

## Out Of Scope For Phase One

Do not include:

- internal grid filtering
- alternate sorting modes
- folder navigation inside Grid
- caption editing
- caption helper panels
- requirement/group annotation UI
- QA panel
- metadata editing
- selection analysis/review workflows
- create set from selected
- prepare/generate/train actions
- batch crop
- batch reset
- batch deface
- batch remove background
- batch delete
- batch flag apply
- reviewed/unreviewed batch actions

## Later Ideas

Balance sort could reorder the grid by balance phrase adherence. This would help surface items that best or worst match the configured balance phrases, making the grid useful for visual QA beyond manual filtering.

## Safety Model

Grid may own its own temporary selection model.

Grid should read from existing folder/media state, but avoid becoming a second source of truth. Persisted changes should use existing app operations wherever practical.

For phase one:

- rating should reuse existing rating state behavior
- tags should reuse existing tag mutation behavior
- batch work should run in a simple file loop with visible progress

Prefer sequential loops for batch work. If an operation fails, stop and show the failure clearly rather than silently skipping items.

## Reviewed Flag Cleanup

Reviewed state should not automatically add a green flag.

Flags and reviewed status are separate concepts. If reviewed marking currently adds or implies a green flag, that should be removed as part of nearby cleanup or before Grid relies on reviewed state.
