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
- Rename video clip requires manual folder refresh to show new name

## Enhancements
- The ability to manually mark a set as Trained... especially for legacy purposes, or when a Finished Early or some other badge got assigned by accident. I mean, I can archive sets, but until I do badges should be accurate, and I know better than the app in some cases.

## Documentation Sync Notes
- `dataset_workflow.md` updated to reflect current in-app clip/crop/deface and `auto_dataset` behavior.
- `src_videos_semantics.md` updated from proposed to implemented status.
- `spec.md` refreshed to match current route and workflow behavior.

## Backlog (Do Not Implement Yet)
- Training Items: clicking on an item should probably highlight it in the media-list and preview it back in captioning mode.. it's odd to show these but have them inert. Also, the Hide Items button is full width... this should probably just be a chevron, let's try to be consistent across the app.
- Training Quality isn't modifying quite as much as I remembered it was supposed to. I thought LR was supposed to change. The only thing that should remain stable is epochs and repeats (right?). less repeats just means more epochs so lowering those doesn't make training faster in a comparable way.
- I think this app should do a better job at suggesting the next run. High was trained? Give me ONE button to train Low. The last run was cancelled/finished early/interupted. ONE button to throw that back on the queue (resume where appropriate).
- Explore Krea 2 Raw training. Before adding it, define a model-workflow contract so each supported model can declare its dataset requirements, configuration syntax and fields, launch/environment needs, stage support, checkpoint detection, and progress parsing. Keep shared set/run/history UI model-agnostic, and keep model-specific rules out of curation/annotation.


## Nice to Haves (Out of Scope for Now)
- Review longest duplicate phrase detection inside a single caption.
- Chaos / clutter scoring for scene complexity.
- Lighting tone / color cast detection for warm, cool, or tinted scenes.
- Explore better integration in Focus Annotate... we're really not THAT far from Focus Annotate mostly being a difference in terms of how we show the groups of terms.

## Cleanup Candidates
- Consolidate set-context gating around shared helper usage and remove stale checks.
