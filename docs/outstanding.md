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

### Phase 2: Selection And Filters
- Restore and retain Selection Analysis as a legacy report until each useful panel has an explicit replacement. The all-file metadata view, especially Aspect Ratio groups, must remain available.
- Audit stale status and flag filters before removing or demoting them. `Invalid AR` remains valuable; `Incomplete`, `Reviewed`, `Unreviewed`, and flags require workflow confirmation.
- Reduce SuperSet Search vertical chrome by moving the include-subfolders explanation to its existing info affordance.
- Revisit the promoted focus-set presentation if a clearer compact control emerges. Do not force full filter controls into Grid in this phase.

### Phase 3: Review Captions
- Keep the existing report intact as low-priority legacy analysis.
- Later, surface actionable findings such as likely typos or repeated full phrases above raw token and list panels, while retaining the detailed views.

## Enhancements
- Eventually I'd like for us to work on the post captioning UX... the Review / Output, maybe even like detect cache in the auto_dataset folder... maybe try to internalize training and set flags based on the outcome of training. The output folder actually does happen to be inside the training folder so there's probably a lot we can do with this. Alas, I think the app's UX needs to be at least technically split, between captioning and then running training. We kind of dumped all of the Review / Output into a single pane... forgot about the caption collation screen, broke the console visibility once there, etc... it's a bit of a mess.


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
