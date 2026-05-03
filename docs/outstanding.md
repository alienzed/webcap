This file details bugs, enhancements and feature requests.

Review for safety, anticipate regressions, think of multiple ways of achieving these and suggest the most minimal less impactful option.
If complete and confirmed, move to Completed section

## Bugs
- Captions save even if not changed, seems suboptimal
- Open in Explorer works, but for files my intention was Open Containing folder (and ideally highlight the file), what I am seeing is that the file will be opened, like, in VLC or whatever.


## Enhancements
- Console appends, should scroll to bottom.
- Reviewed Review state (contextual menu option on Current folder only)


## Backlog
- Pruning a file works. The directory is refresh (I think) but in large directories this can take time, I wonder why we're not just removing this one element as opposed to refreshing the entire list.
- Reviews only seem to work on the initially loaded set of captions. I've found that after editing a caption and, for example, adding a unique word, that word will not show up in the Rare tokens until I refresh the directory. It feels like we're caching things but not updating the cache appropriately.
- Many operations on files/folders will refresh the entire directory. Seems like it would be more efficient to simply modify the element being modified. We should be consider how much complexity/code this adds per use case to make sure we're not making the code base more fragile, but some larger directories take many seconds to load, on something like rename/prune one might assume it's not efficient to reload all files.

## Completed
