This file details bugs, enhancements and feature requests.

Review for safety, anticipate regressions, think of multiple ways of achieving these and suggest the most minimal less impactful option.
If complete and confirmed, move to Completed section


## Bugs


## Enhancements
 - Dataset infered number of samples, MegaFramePixels, if we want to get really crafty, try to estimate VRAM, step time...
 - Try to automate Training Run Start
 - Media Metadata is currently sorted by filename, which is fine, but... it'd be more interesting I think for these to be grouped by AR [optionally?] and/or to sort by headings. I'm also not sure the color column is ever really relevant.



## Backlog
- Many operations on files/folders will refresh the entire directory. For prune and rename, only the affected item is now updated (no full refresh). Other operations may still refresh the directory; consider further optimization if needed.
- [Future] Allow placing .txt files (e.g., expressions.txt, places.txt, lighting.txt) in a folder to auto-populate additional phrase tabs. Each file is a list of phrases (one per line). Not implemented yet.
 - Refactor app.py to split routes from heavy logic
 - set wide (only current folder though of course) search and replace. Use case: I'm changing the keyphrase, or correct a word I misspelled more than once.


## To think about more / Not clearly necessary
- Up / Down keys to browse while media list is focused (lost when editing of course...)
 - Dataset infered number of samples, MegaFramePixels, if we want to get really crafty, try to estimate VRAM, step time...


## Requires validation
- status bar and console toggle should be fixed to the bottom of the left side panel, always visible... the rest of that panel can scroll behind it, this is a definition of intent, the fix itself is open to discussion.
 - The caption requirements/phrases/set notes are great... I'm actually thinking that maybe when the screen is wide enough, these don't need to be tabs at all, but can take up 1/3 of that space each. Requirements and phrases actually work/look better vertically anyway.
- config files seem to be getting the wrong path, it's missing a directory in my one failed use case
- Config files do not seem to be autosaving
- upon save of a previous empty caption, it takes a directory refresh for the missing state to clear - still broken
 - Generate appropriate config files based on set metadata
- A way to crop images to preset AR.
- autoset may require some adjustments, especially for images.
- Set Notes. A third tab alongside Caption Requirements and Phrase Copy for free style notes about the set.
- Make it so that the primer caption alone doesn't get saved. (Currently only implemented for autosave; manual saves still save primer-only captions. Needs fix.)
- Reset Review state (contextual menu option on Current folder only)


## Complete
- After a rename, the item gets reselected after refresh (pendingSelectFileName logic implemented).
- Make colors in context menu bigger
- Prune now uses a pruned_ prefix in the originals folder (not a separate folder). All collision and backup logic is handled there. (Current design; see prune.md)
- Caption Requirements
- Status bar and console toggle fixed to bottom of left panel, always visible, scrollable content behind it.
- Media Metadata grouped by AR (optionally), color column hidden if not relevant.
- When a caption is missing, the item gets a yellowish background; after saving, the background updates correctly.
- Console appends and scrolls to bottom automatically.
- Open in Explorer works; also works in WSL with powershell.exe fallback.
- Review and Filter reflect edits immediately (state.items updated after every save).
- Prune removes only the affected item from state/items and DOM (no full refresh).
- F2 to rename media files.
- Captions save only when actually changed (no unnecessary saves).
- Prune clears caption/preview when the current item is pruned.