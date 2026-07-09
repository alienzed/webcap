This file tracks implemented work vs outstanding items.
Last reviewed: 2026-07-03.

## Enhancements
- What if flags, at least on set folders, became training status. Maybe it's time we consider internalizing training runs... maybe coupled with a real revamp of the features not directly related to captioning/annotation.
- Save Term Wrapper prefix to config/settings: these tend to remain valid across sets ('on sand' vs 'on a sand' vs 'in a sand'... it's always 'on sand'...). So, stays configurable, but survives new sets?
- Preview header is better but still feels a bit weird... the Item X/Y and Resolution and actions are great, but they still feel lopsided, unhealed. I'm going to assume that some other big software titles have better layouts for things like this without giving everything it's own row.
- Focus Annotate: bring over some of the common functions, affixes, actions like CROP, More...



## Requires Discussion
- The missing captions filter is great for identifying which captions are still missing, there's a UX issue though... as soon as I edit a caption, it immediately udpates and then disappears from the list. Normally this is desirable but in this specific use case it's like too fast, I'm wondering if we there's a sane way to delay update of the list under these specific circumstances, to let me finish editing the caption without it disapearing... The issue is that as I caption a set, it's nice to see the list get smaller and yes, auto advance, but most actions are supposed to update immediately to reflect the change, in this case, I wish it wouldn't, not so quickly anyway. Thoughts?


## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Avoid treating the current focused-annotation wizard as the primary home for blind "apply to all" tagging; at most, a sticky/stamping mode would be a temporary bridge, not the final UX.


## Nice to Haves (Out of Scope for Now)
- Review longest duplicate phrase detection inside a single caption.
- Chaos / clutter scoring for scene complexity.
- Lighting tone / color cast detection for warm, cool, or tinted scenes.
- Review the latest huge list of terms in Body: I've been adding items for plural, and am finding a lot of redundancy as well, wondering if there's a better way to manage slight differences so I can spot the desired term more easily. not against having to manually curate a bit more (versus having 200 terms!)
- Explore better integration in Focus Annotate... we're really not THAT far from Focus Annotate mostly being a difference in terms of how we show the groups of terms.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.