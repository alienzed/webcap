This file tracks implemented work vs outstanding items.
Last reviewed: 2026-07-10.

## Active UX Work

### Phase 1: Console Architecture
- Establish one reliable console model across the app. It should be a resizable secondary activity pane, not a full-width bottom drawer and not the sole place important results appear.
- Make console visibility and toggling consistent across media workspaces, Review, and Training.
- Keep training command handoff visible in Training independently of console output.
- Preserve existing streamed output behavior so the console can support future managed training runs.
- Stabilize the right workbench rail width; it currently changes with workspace content and should use explicit sizing rules.
- Add a collapsible right workbench rail with session-persisted state for single-item work, without hiding Training's navigator or other purpose-built workspace surfaces. Grid keeps its dedicated batch Groups workspace and has no inspector rail.

## Bugs
- Modal z-index checkup, to make sure things like group terms modals always appear on top (of focus, grid...)
- Focus annotate, rating that removes from filtered list may break JS
- Grid: updating a term list does not add term, need to reload modal.
- Clipping videos appears broken... I set the playhead and 3 seconds and somehow I got a tiny loop at the very end of the video. not sure if I exceeded the duration of the clip or something, from src_videos a similar but shorter cut did seem to work
- Rename video clip requires manual folder refresh to show new name

## Enhancements
- Have the Train Icon, or something more... slowly change color to represent progress in the current run, so not only do we see it moving, but the color implies the percentage complete (current run only, entire queue would devalue this). I really love the idea of the app being a tiny bit more alive... it doesn't need to refresh every 10 seconds, this could be a once per minute or even more thing, but like, to come back into the app and see it adjust to it's own state... cool stuff.
- Badge says Needs attention, you go into the set... nothing apparent... you go into training also nothing apparent... What needs attention exactly? How do I act on... what? I'd have expect that badge to be coupled with some kind of suggested action I can take, right now this is quite obscure.
- Ability to open the output folder in Explorer directly from History (if said folder still exists...)
- Start naming models better, we may need a mapping or fuzzy matching, but we need to start putting WAN2.2 in our labels, soon we'll use other models, they need to be named.
- Training Quality isn't modifying quite as much as I remembered it was supposed to. I thought LR was supposed to change. The only thing that should remain stable is epochs and repeats (right?). less repeats just means more epochs so lowering those doesn't make training faster in a comparable way.
- Output folder names in Tensorboard are alphabetical, this is a problem. I can sort by date in Explorer, but in Tensorboard, but I do need that sorting. What's the shortest string we can use to have items sort in a sane order for a reasonable amount of time (i've even considered using a sequence if timestamps are problematic)
- I think this app should do a better job at suggesting the next run. High was trained? Give me ONE button to train Low. The last run was cancelled/finished early/interupted. ONE button to throw that back on the queue (resume where appropriate).
- It's not clear to me that resumable detection is working as intended.
- Training Items: clicking on an item should probably highlight it in the media-list and preview it back in captioning mode.. it's odd to show these but have them inert. Also, the Hide Items button is full width... this should probably just be a chevron, let's try to be consistent across the app.
- Queue has one too many vertical lines on the left.
- The ability to manually mark a set as Trained... especially for legacy purposes, or when a Finished Early or some other badge got assigned by accident. I mean, I can archive sets, but until I do badges should be accurate, and I know better than the app in some cases.
- I am wondering if the Originals folder should be in the media list, I know we use it for Restoring, but then maybe going there can be a context menu on the set folder. In regular workflows, originals just sits at the top and I click on it by accident 10x more than on purpose.


## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Explore Krea 2 Raw training. Before adding it, define a model-workflow contract so each supported model can declare its dataset requirements, configuration syntax and fields, launch/environment needs, stage support, checkpoint detection, and progress parsing. Keep shared set/run/history UI model-agnostic, and keep model-specific rules out of curation/annotation.


## Nice to Haves (Out of Scope for Now)
- Review longest duplicate phrase detection inside a single caption.
- Chaos / clutter scoring for scene complexity.
- Lighting tone / color cast detection for warm, cool, or tinted scenes.
- Explore better integration in Focus Annotate... we're really not THAT far from Focus Annotate mostly being a difference in terms of how we show the groups of terms.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.
