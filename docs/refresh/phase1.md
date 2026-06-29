You are working on WebCap branch UI-revamp.

Read this whole prompt before editing.

We are not continuing a broad UI revamp. We are starting the workspace consolidation by creating the canonical Shared Group Workbench seam.

The app already has the features. The problem is that group/term features are scattered across Item, Grid, Focus, helper panels, and modals. Phase 1 must not redesign the whole app. It must create a reusable compact Group Workbench renderer and wire it into Item mode first.

North Star:
[ Scope Sidebar ] [ Visual Surface ] [ Shared Workbench ]

But for Phase 1, do not try to finish the whole shell. Focus only on the Shared Group Workbench seam.

Core requirement:
Create a shared compact Group Workbench renderer that uses existing checklist/tag state and existing group functions. Use it for Item mode first. Later phases will make Grid use it too.

Relevant existing code:
- tool/js/checklist.js owns group state and item-side checklist behavior:
  - checklistItems
  - checklistCheckedByMedia
  - checklistRequirementsNaByMedia
  - checklistTermWrappersByKey
  - checklistTermDescriptorDefaultsByKey
  - checklistTermDescriptorsByMedia
  - normalizeChecklistTerm
  - checklistSort
  - getChecklistKeywordTermsForRequirement
  - isChecklistRequirementCheckedForMediaKey
  - setChecklistRequirementCheckedForMediaKey
  - isChecklistRequirementNaForMediaKey
  - setChecklistRequirementNaForMediaKey
  - getChecklistTermAffixes
  - renderChecklistTermWithAffixes
  - openChecklistGroupTermsModal
  - renderChecklistPanel

- tool/js/media_grid.js owns Grid selection and batch behavior:
  - mediaGridState.selectedKeys
  - mediaGridGetSelectedItems
  - mediaGridApplyRating
  - mediaGridToggleTagForSelection
  - renderMediaGridSidebar
  - mediaGridBuildTagChip
  - mediaGridGetTagSelectionState
  - mediaGridGetTagUsageState

Do not rename existing functions or change their semantics for style reasons.

Do not convert code to OO.

Do not change backend routes.

Do not redesign Focus Annotate.

Do not redesign Review/Output.

Do not redesign Config Editor.

Do not convert Grid into a visual surface in this phase.

Do not clean unrelated CSS or DOM.

Phase 1 tasks:

1. Create or update docs/workspace-consolidation-spec.md.
   - Include the product goal, phase plan, and Phase 1 scope from this prompt.
   - Keep it concise enough to be useful to later Codex sessions.

2. Add a stable DOM target for the shared group workbench if one does not already exist.
   - Prefer a simple container such as:
     - #group-workbench
     - #group-workbench-list
   - Place it where the current item group/checklist UI is shown in UI-revamp.
   - Do not rebuild the whole shell.

3. Implement a shared renderer, preferably in tool/js/checklist.js, because checklist.js already owns group state.
   Suggested public-ish function:
   
   function renderGroupWorkbench(options) { ... }

   Suggested options:
   - mode: 'item' | 'grid'
   - targetEl
   - mediaKeys
   - currentMediaKey

   For Phase 1, only item mode must be wired.
   Grid mode can be scaffolded but does not need to be fully used yet.

4. The shared Group Workbench must render checklistItems in existing semantic order.

5. Terms inside each group must be vertical and alphabetical.
   - Use getChecklistKeywordTermsForRequirement(requirementLabel).
   - Do not use masonry.
   - Do not use paragraph/chip cloud layout.
   - Avoid empty card bodies.
   - Avoid excessive nested boxes/borders.

6. Each group section must expose the existing core controls:
   - group label
   - edit terms via existing openChecklistGroupTermsModal(requirementLabel)
   - reviewed toggle using existing checked functions
   - N/A toggle using existing N/A functions
   - affix controls using existing affix/modal logic where available
   - useful active/matched/selected visual indicators from existing logic where safe

7. Term click behavior in Phase 1:
   - Item mode applies/removes the term for state.currentItem.key.
   - Reuse existing tag helpers such as addTagToMediaKey/removeTagFromMediaKey if already used by current code.
   - Preserve existing caption/tag side effects as much as possible.
   - After changes, rerender the workbench and dependent item tag/caption helper UI as current code does.

8. Wire Item mode to use renderGroupWorkbench.
   - Existing renderChecklistPanel() may call renderGroupWorkbench internally, or the new target may be rendered alongside/replacing the old checklist list.
   - Keep renderChecklistPanel() name and semantics intact for callers.
   - Do not remove the old code until the new renderer is stable; bypass old markup only if safe.
   - The app must remain runnable.

9. Keep caption editor behavior working.
   - Do not move/redesign caption editor in this phase.
   - Do not hide it in Item mode.

10. Add minimal CSS for compact layout.
   - Dense group sections.
   - Vertical term list.
   - Minimal borders.
   - No boxes-inside-boxes aesthetic.
   - Multiple columns are acceptable only if width allows and group order remains readable.
   - Narrow width should collapse to one ordered column.

Phase 1 pass condition:
- App loads.
- Selecting an item still shows the item and caption editor.
- Item mode shows compact groups through the shared renderer.
- Terms scan vertically and alphabetically.
- Group edit still opens.
- Affix controls remain available if they were available before.
- Reviewed toggle works.
- N/A toggle works.
- Term click applies/removes a term on the current item.
- Caption editor still works.
- No Review/Output, Config, Focus, or backend behavior is intentionally changed.

Important:
If a required control, especially affix editing, is too coupled to safely migrate in Phase 1, keep the existing old control reachable and report exactly what remains to migrate in your final notes. Do not invent a new incomplete affix UI.

Before editing, briefly list the files you intend to touch and why. Then implement Phase 1 only.