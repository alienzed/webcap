This file tracks implemented work vs outstanding items.
Last reviewed: 2026-07-10.

## Active UX Work
- Set a target epoch / save to Finish Early, so like, I feel like 35 epochs is going to be enough (for testing at least), and the run is at 25 now, original target was 60, but that's overkill and I won't be around to Finish Early manually.

## Bugs
- Rename video clip requires manual folder refresh to show new name

## Enhancements / Ideas


## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Training Items: clicking on an item should probably highlight it in the media-list and preview it back in captioning mode.. it's odd to show these but have them inert. Also, the Hide Items button is full width... this should probably just be a chevron, let's try to be consistent across the app.
- Training Quality isn't modifying quite as much as it is supposed to. LR is supposed to change. The only thing that should remain stable is epochs and repeats. The idea is to train on lower resolutions more aggressively.
- I think this app should do a better job at suggesting the next run. High was trained? Give me ONE button to train Low. The last run was cancelled/finished early/interupted. ONE button to throw that back on the queue (resume where appropriate).
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.

## Cleanup Candidates
- Seek out overengineered solutions and code portions that are too large and fragile compared to the value they offer.