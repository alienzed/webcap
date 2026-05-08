This file details bugs, enhancements and feature requests.

Review for safety, anticipate regressions, think of multiple ways of achieving these and suggest the most minimal less impactful option.
If complete and confirmed, move to Completed section


## Bugs
- Prune works well, BUT the caption and preview remain, we should either select the next/adjacent item or clear.
- Config files do not seem to be autosaving

## Enhancements


## Backlog
- Many operations on files/folders will refresh the entire directory. For prune and rename, only the affected item is now updated (no full refresh). Other operations may still refresh the directory; consider further optimization if needed.

## To think about more / Not clearly necessary
- Up / Down keys to browse while media list is focused (lost when editing of course...)


## Requires validation
- Prune now removes only the item from state/items and DOM, not a full refresh.
- Prune uses pruned_ prefix in originals, not a separate folder (see prune.md for details).
- Reset Review state (contextual menu option on Current folder only)
- F2 to rename
- When a caption is missing, the item gets a yellowish background to reflect this, however, after saving a proper caption, the background does not change. (Fixed: background now updates correctly after saving a caption)
- Console appends, should scroll to bottom. (Already implemented: appendToConsolePanel always scrolls to bottom)
- Open in Explorer works, but for files my intention was Open Containing folder (and ideally highlight the file), what I am seeing is that the file will be opened, like, in VLC or whatever. (Now also works in WSL: powershell.exe fallback implemented)
- Captions save even if not changed, seems suboptimal.
- Review and Filter only seem to work on the initially loaded set of captions. (Fixed: state.items is updated after every save, so review/filter/rare-token features now reflect edits immediately)
- Make it so that the primer caption alone doesn't get saved. (Currently only implemented for autosave; manual saves still save primer-only captions. Needs fix.)
- Caption Requirements
- Prune now uses a pruned_ prefix in the originals folder (not a separate folder). All collision and backup logic is handled there. (Current design; see prune.md)
- Prune works well, BUT the caption and preview remain, we should either select the next/adjacent item or clear.


## Complete
- After a rename, the item gets reselected after refresh (pendingSelectFileName logic implemented).
- Make colors in context menu bigger