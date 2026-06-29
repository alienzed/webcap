# WebCap Workspace Consolidation - Codex Prompt Pack

Use this file as the source prompt for the next Codex session on `UI-revamp`.

The goal is to make Codex execute a narrow, deterministic plan: establish the shared Group Workbench seam first, then use that seam in later phases to consolidate Item and Grid.

---

## Paste-ready Codex prompt: Phase 1

```text
You are working on WebCap, branch UI-revamp.

This task is Phase 1 of workspace consolidation.

Product goal:
WebCap already has the features we need. The work is to consolidate scattered group/term features into one canonical Group Workbench so later phases can make Item and Grid two zoom levels of the same workspace.

North Star for the app:
[ Scope Sidebar ] [ Visual Surface ] [ Shared Workbench ]

Phase 1 target:
Create the Shared Group Workbench seam and wire it into Item mode first.

Phase 1 success means:
- Item mode renders groups through one compact shared renderer.
- Terms scan vertically and alphabetically.
- Existing group functionality remains available: term apply/remove, edit group terms, term affixes, reviewed, N/A, and visual state.
- The app remains runnable.
- Grid, Focus, Review/Output, and Config remain available in their current form unless a small compatibility hook is required.

Relevant existing code ownership:

1. `tool/js/checklist.js` owns group state and item-side group behavior:
   - `checklistItems`
   - `checklistCheckedByMedia`
   - `checklistRequirementsNaByMedia`
   - `checklistTermWrappersByKey`
   - `checklistTermDescriptorDefaultsByKey`
   - `checklistTermDescriptorsByMedia`
   - `normalizeChecklistTerm`
   - `checklistSort`
   - `getChecklistKeywordTermsForRequirement`
   - `isChecklistRequirementCheckedForMediaKey`
   - `setChecklistRequirementCheckedForMediaKey`
   - `toggleChecklistRequirementCheckedForMediaKey`
   - `isChecklistRequirementNaForMediaKey`
   - `setChecklistRequirementNaForMediaKey`
   - `getChecklistTermAffixes`
   - `renderChecklistTermWithAffixes`
   - `openChecklistGroupTermsModal`
   - `renderChecklistPanel`

2. `tool/js/caption_helpers_annotate.js` already has proven item-side group/term interaction logic:
   - `toggleAnnotateTag(term)`
   - `toggleAnnotateGroupNa(requirementLabel, nextIsNa)`
   - `toggleAnnotateGroupReviewed(mediaKey, requirementLabel)`
   - `openChecklistTermAffixesModal(term)` via term context menu
   - `renderAnnotateStrip()`

3. `tool/js/media_grid.js` owns Grid batch state and should be used in later phases:
   - `mediaGridState.selectedKeys`
   - `mediaGridGetSelectedItems()`
   - `mediaGridApplyRating(rating)`
   - `mediaGridToggleTagForSelection(term, stateName)`
   - `mediaGridGetTagSelectionState(term)`
   - `mediaGridGetTagUsageState(term)`

Implementation contract:
- Keep existing function names and semantics stable.
- Add a shared renderer as a seam over existing functions; do not rewrite the feature model.
- Keep implementation procedural/classic JS, matching the current code style.
- Add only the DOM/CSS needed to establish the shared Group Workbench.
- Leave broad shell, Review/Output, Config, Focus, and Grid-as-visual-mode consolidation to later phases.

Files to touch in Phase 1:
- `docs/workspace-consolidation-spec.md`
- `tool/tool.html`
- `tool/js/checklist.js`
- `tool/css/styles.css`

Touch another file only when a named existing function above requires a small integration hook.

Step 1 - Create the repo spec
Create or replace `docs/workspace-consolidation-spec.md` with a concise implementation spec containing:
- North Star: `[ Scope Sidebar ] [ Visual Surface ] [ Shared Workbench ]`
- Phase 1 goal: shared Group Workbench seam in Item mode.
- Phase 2 goal: Grid uses the shared Group Workbench for selected thumbnails.
- Phase 3 goal: Grid becomes a visual zoom level in the Visual Surface.
- Phase 4 goal: stabilization smoke tests only.
- Phase 1 acceptance tests from the end of this prompt.

Keep the doc short and actionable. It is a coordination artifact for later Codex sessions, not a design essay.

Step 2 - Add the shared workbench target
In `tool/tool.html`, add a stable target for the canonical shared group UI.

Use this structure, adapted to the current UI-revamp shell:

```html
<section id="group-workbench" class="group-workbench" aria-label="Groups">
  <div class="group-workbench-header">
    <div class="group-workbench-title">Groups</div>
  </div>
  <div id="group-workbench-list" class="group-workbench-list"></div>
</section>
```

Place it in the current right/workbench area where groups are intended to live. In the current UI-revamp shell, prefer the existing `.groups-card` area if present.

Keep existing legacy targets such as `#caption-checklist-panel`, `#checklist-items`, and `#annotate-strip` available for compatibility. The new canonical group rendering target is `#group-workbench-list`.

Step 3 - Implement `renderGroupWorkbench(options)` in `tool/js/checklist.js`
Add this renderer near the existing checklist rendering code, before or close to `renderChecklistPanel()`.

Function shape:

```js
function renderGroupWorkbench(options) {
  // options.mode: 'item' | 'grid'
  // options.targetEl: DOM node, optional
  // options.mediaKeys: array of target media keys
  // options.currentMediaKey: current item key for item mode
}
```

Phase 1 wires only item mode. Still design the renderer so grid mode can later pass multiple media keys without changing the public function shape.

Resolution rules:
- If `options.targetEl` is missing, use `document.getElementById('group-workbench-list')`.
- If `options.mode` is missing, default to `'item'`.
- In item mode, target media keys resolve to `[state.currentItem.key]`.
- If there is no selected/current item, render a compact empty state in the target and keep existing item selection behavior intact.

Renderer structure:
For each requirement in `checklistItems` in existing order, render one compact group section:

```text
[group header: name | state | edit | affix-ready actions | reviewed | N/A]
  term A
  term B
  term C
```

Use these rules:
- Group order follows `checklistItems` exactly.
- Terms come from `getChecklistKeywordTermsForRequirement(requirementLabel)`.
- Terms must be normalized and sorted alphabetically using existing checklist normalization/sort helpers.
- Terms render as a vertical list.
- The group section height is determined by actual content. No empty card body.

Step 4 - Group header behavior
Each group header should provide these existing capabilities:

1. Group label
   - Text is the requirement label.

2. Edit terms
   - Button calls `openChecklistGroupTermsModal(requirementLabel)`.

3. Reviewed toggle
   - Item mode calls `toggleChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel)` if available.
   - Rerender the workbench after the change.

4. N/A toggle
   - Item mode uses `isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)` and `setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, nextValue)`.
   - Rerender the workbench after the change.

5. Visual state
   - Add CSS state classes for reviewed, N/A, incomplete, and complete where determinable from existing state.
   - Complete can mean N/A, reviewed, or at least one selected term in the group for the current item.
   - Keep this logic simple and based on existing state.

Step 5 - Term behavior
Each term row/button should provide these behaviors in item mode:

1. Active state
   - Active when the current media key already has the term tag.
   - Use `hasTagForMediaKey(mediaKey, term)` when available.

2. Caption/mismatch indicator
   - If `tagAppearsInCurrentCaption(term)` exists, add a subtle class when an active term is missing from the caption.
   - Use existing indicator classes if appropriate, or add compact new classes.

3. Click
   - Prefer `toggleAnnotateTag(term)` when available because it already preserves item-side tagging side effects.
   - If `toggleAnnotateTag` is not available, use existing tag add/remove helpers (`addTagToMediaKey` / `removeTagFromMediaKey`) with the current media key.
   - If the group is N/A and a term is selected, unmute the group first with `setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, false)`.
   - Rerender the workbench after the change.

4. Right-click / affixes
   - Term context menu calls `openChecklistTermAffixesModal(term)` when available.
   - This keeps existing affix behavior instead of inventing a new affix UI.

5. Display text
   - Display the base term text in the vertical list.
   - Tooltip may include `renderChecklistTermWithAffixes(term, mediaKey)` or existing affix info if useful.

Step 6 - Wire Item mode through `renderChecklistPanel()`
Keep the name and broad semantics of `renderChecklistPanel()` intact.

Update `renderChecklistPanel()` so that, when `state.currentItem` exists, it renders the canonical workbench:

```js
renderGroupWorkbench({
  mode: 'item',
  targetEl: document.getElementById('group-workbench-list') || document.getElementById('checklist-items'),
  mediaKeys: [state.currentItem.key],
  currentMediaKey: state.currentItem.key
});
```

Keep existing responsibilities of `renderChecklistPanel()`:
- hide/show the panel when no item is selected
- render primer placeholder buttons when needed
- call dependent renderers that current code expects, such as `renderItemTagsPanel()`, `renderItemMetadataPanel()`, and/or `renderAnnotateStrip()` if still needed

The old `#checklist-items` target may remain as a fallback. The new canonical target is `#group-workbench-list`.

Step 7 - Add compact CSS
In `tool/css/styles.css`, add minimal CSS for the new workbench classes.

Required class names:
- `.group-workbench`
- `.group-workbench-header`
- `.group-workbench-title`
- `.group-workbench-list`
- `.group-workbench-group`
- `.group-workbench-group-header`
- `.group-workbench-group-title`
- `.group-workbench-group-actions`
- `.group-workbench-term-list`
- `.group-workbench-term-row`
- `.group-workbench-term-btn`

Layout requirements:
- Groups are compact.
- Terms scan vertically.
- Terms are full-width or row-like buttons, not paragraph chips.
- Group sections have minimal border treatment.
- Avoid nested boxed/card appearance.
- The workbench can use CSS columns or grid for groups when width allows, but each group's terms stay vertical.
- Narrow widths show one ordered column.

Step 8 - Expose renderer for later phases
At the end of `checklist.js`, expose:

```js
window.renderGroupWorkbench = renderGroupWorkbench;
```

Also expose any small helper only if later Grid wiring needs it.

Phase 1 acceptance tests:
1. App loads on UI-revamp.
2. Folder/media list still loads.
3. Selecting a media item still shows preview and caption editor.
4. The new shared Group Workbench renders in Item mode.
5. Requirement/group order matches `checklistItems`.
6. Terms inside each group are vertical and alphabetical.
7. Clicking a term toggles that tag on the current item.
8. Right-clicking a term opens existing affix editing when available.
9. Edit group terms opens existing group terms modal.
10. Reviewed toggle works for the current item/group.
11. N/A toggle works for the current item/group.
12. Caption editor still works.
13. Grid still opens in its current form.
14. Focus Annotate still opens in its current form.

Final response format:
- List files changed.
- Summarize how `renderGroupWorkbench` is wired.
- State which acceptance tests were run.
- State any controls kept in legacy fallback because they were too coupled for Phase 1.
```

---

## Later phase roadmap

### Phase 2 - Grid uses the Shared Group Workbench

Use the existing Grid selection engine, but make Grid target the same workbench renderer.

Targets:
- Grid selected thumbnails become the workbench target media keys.
- Term clicks apply to selected Grid items.
- Select All, Clear, selected count, and rating selected items stay intact.
- Grid's old right tag sidebar is bypassed for the normal path once the shared workbench handles batch tagging.

Likely files:
- `tool/js/media_grid.js`
- `tool/js/checklist.js`
- `tool/css/media_grid.css`
- `tool/css/styles.css`

### Phase 3 - Grid and Item become Visual Surface modes

Move Grid out of the separate-workspace/modal normal path and into the same visual surface as Item preview.

Targets:
- Item = preview visual mode.
- Grid = thumbnail visual mode.
- Sidebar remains active in both.
- Sidebar media click works in Grid.
- Sidebar collapse works in Grid.
- Double-click thumbnail switches to Item.
- Double-click Item switches back to Grid.
- Sidebar filters remain the only filter authority.
- Grid duplicate filters and Grid focus rail are hidden/bypassed for the normal path.

Likely files:
- `tool/tool.html`
- `tool/js/media_grid.js`
- `tool/js/main.js`
- `tool/js/ui.js`
- `tool/js/ui_event_wiring.js`
- `tool/css/styles.css`
- `tool/css/media_grid.css`

### Phase 4 - Stabilization only

Run smoke tests and fix only integration failures.

Smoke tests:
- App loads.
- Folder loads.
- Media list loads.
- Filters work.
- Selecting sidebar item updates Item preview.
- Shared Group Workbench works in Item.
- Grid opens.
- Grid selection works.
- Grid selected-item rating works.
- Focus Annotate opens.
- Review/Output remains reachable.
- Config editing remains reachable.
