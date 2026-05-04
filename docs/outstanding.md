This file details bugs, enhancements and feature requests.

Review for safety, anticipate regressions, think of multiple ways of achieving these and suggest the most minimal less impactful option.
If complete and confirmed, move to Completed section

## Bugs
- Captions save even if not changed, seems suboptimal.
- Caption edited, ran autoset, found that caption was not updated... I think our approach of only saving captions on change is risky... I wonder if something like losefocus could help prevent lost edits like this. I could try to use ctrl s but it feels like that shouldn't be necessary in a complete system.
- Open in Explorer works, but for files my intention was Open Containing folder (and ideally highlight the file), what I am seeing is that the file will be opened, like, in VLC or whatever.
- When a caption is missing, the item gets a yellowish background to reflect this, howevew, after saving a proper caption, the background does not change.
- Reviews only seem to work on the initially loaded set of captions. I've found that after editing a caption and, for example, adding a unique word, that word will not show up in the Rare tokens until I refresh the directory. It feels like we're caching things but not updating the cache appropriately.
- After a rename, the item gets deselected. ideally the new name could be reselect after refresh...

## Enhancements
- Contents checkboxes or something above the caption text editor, to allow me to set conditions for reviewed status, maybe reviewed is couple with another status "complete" where I have things like "hair color?, lighting? etc..." checkboxes or a nifty list I can use to validate things. This is useful because sometimes half way through captioning I notice I may have forgotten to add tokens for something meaningful, but it's easy to get distracted as moving through files.
- Console appends, should scroll to bottom.
- Prune probably requires it's own folder... same logic (not overwrite, rotate on collision, etc...) as originals minus the initial back up.

## Backlog
- Pruning a file works. The directory is refreshed (I think) but in large directories this can take time, I wonder why we're not just removing this one element as opposed to refreshing the entire list.
- Many operations on files/folders will refresh the entire directory. Seems like it would be more efficient to simply modify the element being modified. We should consider how much complexity/code this adds per use case to make sure we're not making the code base more fragile, but some larger directories take many seconds to load, on something like rename/prune one might assume it's not efficient to reload all files.

## To think about more / Not clearly necessary
- Up / Down keys to browse while media list is focused (lost when editing of course...)

## Completed

- Reset Review state (contextual menu option on Current folder only)
- F2 to rename