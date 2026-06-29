# WebCap North Star: Workspace Consolidation

## Purpose

WebCap already has the core features needed for the user's workflow. The revamp goal is not to invent a new app or apply a new skin. The goal is to stop feature sprawl by making Item and Grid two coherent presentations of the same filtered media scope, while keeping Focus Annotate as the specialized deep-focus flow.

## Current Branch Status

`UI-revamp` has made meaningful state-wiring progress, but it has not yet delivered the desired product shape. The branch now has a partially shared Group/Term Workbench and an inline Grid surface, but Grid still feels visually wrong because it uses the old card-style group layout and does not yet reclaim the workspace in a way that feels like a real batch workspace.

The current branch should be treated as a partially successful plumbing pass, not as a finished UX pass.

## North Star in Two Sentences

WebCap should be one coherent media-prep workspace where Item and Grid are two presentations of the same filtered media scope, not separate feature worlds. The shared Group/Term Picker is the canonical tag/group interaction surface: Item uses it for one active item plus caption tools; Grid uses it for selected thumbnails plus batch rating/term actions; Focus Annotate remains the special deep-focus flow.

## Core User Workflow

1. Use filters/folders/focus sets to establish the active media scope.
2. Use Grid for broad visual comparison, batch tagging, and rating-based pruning.
3. Use Focus Annotate for fast, focused one-group-at-a-time annotation.
4. Use Item mode for detailed caption editing, selected-tag edits, affixes, and individual cleanup.
5. Use Review/Prepare/Generate/Train at the end; these are important but not central to the daily annotation surface.

## Surface Definitions

### Item Mode

Item mode is the detailed single-media workspace.

It should show:

- Left sidebar with filters, folders, focus set state, and media list.
- One active media item in the visual surface.
- Shared responsive Group/Term Picker for the active item.
- Caption editor.
- Selected tags panel, because clicking selected tags into the caption is part of the workflow.
- Caption template when useful.
- Item-specific controls such as N/A, Mark Reviewed, affixes, group edit, and selected tag order.

Item mode target:

- `state.currentItem`

### Grid Mode

Grid mode is a batch preparation workspace.

It should show:

- The same filtered/focus-set scope as the media list, shown as thumbnails.
- Batch selection of thumbnails.
- Batch rating controls for selected thumbnails.
- Shared responsive Group/Term Picker for selected thumbnails.
- A clear Item/Back control to leave Grid.

Near-term stabilizing decision:

- Hide the whole left sidebar/media list while Grid is open.
- Grid uses the current filtered scope when opened and refreshes that same scope after mutations.
- Long-term, Grid and media list should become true alternate views of the same filterable collection, like Details vs Large Icons in an OS file manager.

Grid mode should hide:

- Caption editor.
- Caption template.
- Selected tags panel.
- Metadata/QA panels.
- Item-only tag panels.
- Empty Set Actions area.

Grid mode target:

- `mediaGridState.selectedKeys`

Grid mode should not batch:

- Flags.
- Reset/crop/flip/rename/duplicate/deface/copy tags.
- Caption/template edits.

Grid mode should batch:

- Terms.
- Ratings.

Future but not urgent:

- Batch N/A.
- Batch Mark Reviewed.

### Focus Annotate

Focus Annotate is already a standout feature. It should remain a specialized single-group, deep-focus flow for now.

Do not redesign Focus Annotate as part of the Grid/Item consolidation unless fixing an integration bug.

## Shared Group/Term Picker North Star

The Group/Term Picker is the canonical interaction model for groups and terms.

It must support:

- Ordered groups.
- Alphabetical terms within each group.
- Active/inactive/mixed/mismatch visual states.
- Affixes.
- N/A.
- Mark Reviewed.
- Group editing.
- Selected/applied tag order within a group where relevant.
- Applying terms to one item in Item mode.
- Applying terms to selected thumbnails in Grid mode.

Terms are not manually ordered within the group configuration; they remain alphabetical. The useful ordering feature is ordering selected/applied tags within a group and ordering the groups themselves.

### Picker Layout

The canonical picker should not be the old card wall.

It should be a responsive, vertically scrollable stack of group sections:

```text
[Group header: status / group name / edit / review controls]
  term pill  term pill  term pill
  term pill  term pill  term pill

[Next group header]
  term pill  term pill  term pill
```

Rules:

- Groups stack vertically.
- Terms are readable pills/chips.
- Terms wrap according to available width.
- The whole picker scrolls vertically.
- In wider space, term rows use more horizontal width.
- In narrower space, terms wrap more and require more vertical scroll.
- Focus Annotate remains the single-group full-real-estate variant.

### No-Target States

Groups are set/folder-level configuration and should not disappear just because no item or Grid selection exists.

If no Item target exists:

- Show a short notice: `Select an item to review groups.`
- Still render all configured groups and terms.
- Disable item-specific actions.

If no Grid selection exists:

- Show a short notice: `Select Grid thumbnails to tag them.`
- Still render all configured groups and terms.
- Disable term mutation actions.

Only show `No groups configured.` if there are truly no configured groups.

## Selection Model

Do not force media list selection and Grid selection to be the same implementation.

The product model is:

- Media list is navigation/single-item selection in Item mode.
- Grid is batch selection in Grid mode.
- Both use the same filtered scope.
- Grid can hide the media list for now to avoid split-brain selection.

### Opening Grid

When Grid opens:

- It uses the same filtered scope as the media list.
- If `state.currentItem` exists and is visible in that scope, select that thumbnail.
- Otherwise start with no selected thumbnails.

### Leaving Grid

When Grid exits normally:

- Return to Item/default mode.
- Restore the previous `state.currentItem`.
- Do not change active item based on selected thumbnails.

When double-clicking a Grid thumbnail:

- Close Grid.
- Open that thumbnail as the active Item.

Future desired behavior:

- Double-clicking Item preview opens Grid with the current item selected.

## Term Semantics in Grid

For selected Grid thumbnails:

- Active: all selected items have the term.
- Mixed: some selected items have the term.
- Inactive: none selected items have the term.

Click behavior:

- Inactive -> add term to all selected items.
- Mixed -> add term to all selected items.
- Active -> remove term from all selected items.

No selection:

- Terms are visible but disabled/no-op.

## Rating Semantics in Grid

Ratings apply to selected thumbnails only.

No selection:

- Rating buttons disabled or no-op with a clear status message.

After rating:

- Grid refreshes against the active filter engine.
- If a thumbnail no longer matches the current filter, it disappears.
- Selection is pruned to visible items.
- Group/Term Picker refreshes.

## Current UI-Revamp Observations from Code Inspection

The latest `UI-revamp` branch appears to have corrected important functional wiring:

- `renderGroupWorkbench()` now renders groups in neutral/no-target states instead of blanking the panel.
- Grid open seeds selection from `state.currentItem` if visible.
- Grid calls `setWorkspaceSurface('grid', { sidebarHidden: true })`.
- Grid term actions use fresh selected keys via `getMediaKeys`.
- Grid uses `getFilteredMediaItems(false)` for the same filtered media scope.
- Grid rating refreshes after mutation, so filter-pruning should be possible.

Remaining likely issues:

- The visual layout is still not the North Star.
- Grid may still be too narrow or not reclaim hidden sidebar space correctly.
- The Group/Term Picker still resembles old card-style groups rather than the desired responsive vertical picker.
- Item-only DOM scaffolding can still appear in Grid unless CSS hides it correctly.
- The renderer exists, but the rendered shape is not yet the desired shape.

## Implementation Strategy Going Forward

The next useful implementation phase should not add new state systems. It should convert the current partial plumbing into the intended product shape.

### Phase A: Layout Ownership

Goal: Grid must become a wide batch workspace.

Tasks:

- Verify that `.workspace-surface-grid.sidebar-hidden` actually hides the left sidebar and reassigns width to the Grid visual surface.
- If needed, update CSS grid columns in Grid mode so the Grid surface reclaims the hidden sidebar space.
- Ensure the Grid surface is not trapped inside the old preview column width.
- Keep the Item/exit control visible and consistent.

Expected result:

- Grid appears wide and intentional, not squeezed.

### Phase B: Canonical Responsive Group/Term Picker

Goal: Replace the old card-style group presentation with the responsive vertical picker.

Tasks:

- Keep `renderGroupWorkbench()` as the single renderer.
- Change its markup or mode-specific classes so the visual result is:
  - compact group header
  - wrapping term pills/chips
  - vertical group stack
  - scrollable container
- Preserve active/mixed/inactive/mismatch states.
- Preserve affix/right-click behavior.
- Preserve Edit group action.
- Preserve Item mode Done/N/A controls.
- Do not revive old Grid tag sidebar as primary UI.

Expected result:

- Item and Grid share a recognizable Group/Term Picker model.
- Grid is no longer showing the old card wall.

### Phase C: Grid Mode Panel Hygiene

Goal: Grid should show only Grid-relevant panels.

Tasks:

- In Grid mode, show:
  - Grid visual surface
  - batch controls
  - shared Group/Term Picker
- In Grid mode, hide:
  - caption editor
  - caption template
  - selected tags panel
  - metadata/QA
  - item-only tag panel
  - empty Set Actions
- Prefer CSS using `.workspace-surface-grid`.
- Do not move DOM unless unavoidable.

Expected result:

- No duplicate group/tag UI.
- No old helper shell visible below the picker.

### Phase D: Functional Validation

Test:

1. Fresh reload with no selected item: groups visible, neutral.
2. Select item: Item mode groups reflect item tags.
3. Open Grid: sidebar hidden, Grid widens.
4. Grid opens with current item selected if visible.
5. Clear selection: groups remain visible and neutral.
6. Select one/many thumbnails: terms show active/mixed/inactive.
7. Apply term: selected items mutate and picker refreshes.
8. Rate selected item out of filter: item disappears if excluded.
9. Exit Grid: original Item state returns unless thumbnail was double-clicked.
10. Focus Annotate still opens and works.

## Codex Prompting Principle

Do not ask Codex to continue broad UI revamp.

Use prompts that say:

- Implement the North Star layout ownership.
- Convert `renderGroupWorkbench()` visual output to the responsive Group/Term Picker.
- Hide Grid-irrelevant panels through CSS.
- Preserve existing feature semantics.
- Do not introduce a second renderer or new surface system.

