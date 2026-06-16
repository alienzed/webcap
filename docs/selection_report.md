# Selection Report

## Purpose
Add a dedicated `Selection` flow to WebCap for dataset triage and curation.

This flow is separate from caption authoring and separate from caption QA. Its job is to help answer:

- which items are strong training candidates
- which items need manual inspection
- which items are weak, noisy, or crowded
- which items still need captioning or cleanup before final inclusion

## Why Split It
The current `Review Captions` entry point no longer matches the user intent of the surface.

What the report currently mixes together are two different jobs:

- caption QA
- sample selection and curation

That worked when the report was smaller, but it becomes confusing as more metadata-driven selection signals are added. Clicking `Review Captions` should not be the path to sample curation.

## Product Direction
- Keep `Review Captions` as a caption/text QA flow.
- Add `Selection` as a separate flow with its own entry point.
- Reuse the existing preview/report infrastructure where practical.
- Avoid rewriting working review logic until the split is proven useful.
- Migrate selection-oriented panels gradually instead of moving everything at once.
- Keep the first version self-contained so selection signals do not sprawl into captioning, training, or config logic.

## Flow Boundary
`Selection` should answer:

- should this item stay in the working set
- should this item be inspected more closely
- is this item a strong or weak training sample
- is this item missing work before it can be considered ready

`Review Captions` should answer:

- does the caption contain what it needs
- are captions duplicated, overly similar, too short, or too long
- do configured review rules pass
- what token and phrase patterns appear across captions

## What Belongs In Selection
Candidate panels for `Selection`:

- `Face Focus`
- `Scene Complexity`
- future lightweight body orientation or pose buckets
- missing captions as a curation readiness signal
- rating and flag summaries
- duplicate files if binary duplicates matter to dataset cleanup
- filtered-subset counts and focus sets that support keep/skip decisions

These are selection signals, not caption-authoring tools.

## Coverage Planner Direction
The current `Suggested Candidates` panel is useful, but too flat.

The better long-term direction is a lightweight coverage planner that helps answer:

- where the current kept subset is already strong
- where the set may be narrow or repetitive
- which redundant clusters are easiest to prune
- which missing sample types might be worth looking for, if they exist

This should be framed as guidance, not as a hard prescription.

## Sequencing Note
The richer version of this planner probably fits best once `Review Selections` has a stronger compare workflow.

In other words:

- do not overbuild the current one-item report surface
- let `Review Selections` evolve toward launching small focus sets first
- let multi-item compare become the natural place for rerating, pruning, and choosing between near-duplicates

This reduces the risk of stuffing too much selection logic into a UI that is still fundamentally report-like.

## Friendly Warning Tone
Selection warnings should assume limited source material.

That means:

- avoid scolding language like "you need" or "you are missing"
- prefer softer language like "coverage is thin here" or "if alternates exist, these may be worth checking"
- treat prune suggestions as more actionable than missing-coverage suggestions
- assume some gaps simply cannot be filled from the current set

In practice, a message like:

- "These five close-ups look very similar; pruning to the cleanest one or two may make the set easier to manage"

is usually more actionable than:

- "Need more rear body shots"

The second kind of message is still allowed, but should read more like:

- "Rear clear-pose coverage looks thin. If any alternates exist in lower-rated items, they may be worth a quick pass."

## Rating-Aware Interpretation
The selection planner should use ratings as soft intent signals when they exist.

Current working interpretation:

- `5` stars often means identity-anchor keepers, especially face close-ups
- `4` stars often means strong wider shots or strong body shots
- `3` stars often means plausible alternates, useful fillers, or "nice but not standout" material
- `1` and `2` stars usually lean toward discard, redundancy, or weaker quality

These are heuristics, not rules. The planner should use them to prioritize inspection, not to override the user's judgment.

More importantly, ratings should be treated as the primary curation intent signal rather than just a generic quality marker. The user is already using rerating as the main act of choosing between similar items, so future selection tooling should reinforce that behavior instead of introducing a separate selection mechanism.

## Current / Target / Need Model
The panel should evolve away from a single shortlist and toward simple coverage guidance.

A good shape is:

- `Current`: what the kept subset already contains
- `Target`: what a balanced character LoRA set would ideally include
- `Need`: what looks thin, repetitive, or overrepresented

This does not mean every target must be satisfiable.

The point is:

- show where variety already exists
- highlight obvious redundancy
- suggest where a quick pass through `3`-star material might help

## Preferred Buckets
The exact buckets can evolve, but the current intended direction is:

- close face anchors
- medium shots
- body shots
- rear or no-face-but-clear-pose shots
- expression variety
- repetition / near-duplicate pressure inside each bucket

Tag information can help when available, but should act as supporting evidence rather than replacing analysis metadata.

## Action Priority
The planner should favor the most actionable guidance first.

Recommended priority:

1. obvious redundancy to prune
2. overrepresented buckets to thin
3. useful alternates that may exist in `3`-star material
4. missing coverage that may or may not exist at all

This ordering better matches the user's real workflow and the reality of limited source material.

It also fits the current rating workflow:

- keep or reaffirm `4`/`5` star material
- demote redundant or weaker near-duplicates
- inspect `3`-star material only when it may help coverage
- avoid inventing extra state when rerating already expresses the decision cleanly

## Proposed Panel Shape
The current `Suggested Candidates` block should evolve into a small set of clearer, more purposeful sections.

Recommended shape:

### 1. Keepers
A compact overview of the currently strongest kept material, biased toward higher-rated items.

Examples:

- close face keepers
- wider/body keepers
- clear-pose keepers

This is not meant to be exhaustive. It is meant to create small, enjoyable rating groups.

### 2. Prune First
The most actionable section.

Purpose:

- surface obvious repetition
- point to clusters where several items are probably doing the same job
- encourage pruning or thinning before chasing ideal coverage

Typical language:

- "These close-ups look very similar; pruning to the cleanest one or two may be worth a quick pass."

### 3. Coverage Hints
A softer section for gaps or thin coverage.

Purpose:

- show where the set may be narrow
- suggest where alternates in `3`-star material might help
- avoid implying that every target must be satisfied

Typical language:

- "Rear clear-pose coverage looks thin. If any alternates exist in lower-rated items, they may be worth checking."

### 4. Alternates Worth Checking
A bridge between current keepers and lower-confidence material.

Purpose:

- point to `3`-star items that may fill a useful role
- keep the user from feeling forced into a full balance pass
- frame these as optional upgrades, not obligations

## Focus Set Behavior
Each section should open a clearly named focus set with obvious purpose.

Good examples:

- `Close Face Keepers`
- `Redundant Close-Ups`
- `Possible Rear Alternates`
- `Strong Body Keepers`

The title should explain why the user is there without requiring them to remember the originating panel logic.

## Initial Heuristic Inputs
The first version of this upgraded panel should stay grounded in signals that already exist.

Primary inputs:

- star ratings
- face focus buckets
- selection pose buckets
- scene complexity
- tag overlap for redundancy pressure

Supporting inputs:

- tags, when present
- caption presence / readiness state

The planner should prefer existing metadata over inventing new required detectors immediately.

## QA Deferral
The lower `Quality Assurance` panel should not be expanded right now.

Current decision:

- do not move coverage-planner logic into QA
- do not force a new purpose for that panel yet
- revisit QA only when its role is clearer and more trustworthy

For now:

- `Selection` owns broader curation guidance
- `QA` remains unresolved rather than being overfilled

## What Stays In Review Captions
Candidate panels for `Review Captions`:

- missing required phrase
- validation failures
- duplicate captions
- similar captions
- shortest and longest captions
- length outliers
- token frequency and phrase distribution

These are text-review signals and should remain grouped together.

## Reuse Strategy
The split should reuse as much of the current report machinery as possible:

- the existing preview iframe report surface
- the existing `postMessage` selection bridge
- the existing focus-set behavior
- the existing metadata cache and metadata fetch route

This should be a flow split, not an infrastructure rewrite.

## Workflow Shape
The most valuable interaction pattern to preserve is the existing focus-set loop:

- click a compact bucket or group in the report
- activate a focused subset of media
- rate or inspect through that subset quickly
- use the focus-set header back control to rerun `Review Selections`
- use the focus-set header `x` control to leave the subset and return to browsing

This feels faster than scanning the full set and should remain the core interaction model for `Selection`.

## Scale Assumption
This flow is not being designed for massive dataset triage.

Typical working sets are assumed to be around `100` items, not `10,000+`. That means:

- the value comes from better grouping and prioritization, not from full automation
- weak signals may not earn their complexity cost
- experimental selection metadata should stay loosely coupled and easy to remove

`Selection` should help the user make faster progress through a modest set, not justify a large autonomous ranking system.

## Migration Strategy
Recommended low-risk migration:

1. Add a new `Selection` entry point without removing `Review Captions`.
2. Reuse the current preview/report rendering path for the new flow.
3. Move clearly selection-oriented panels first, starting with `Face Focus`.
4. Leave caption-specific panels in `Review Captions`.
5. Reassess whether any mixed-purpose panels should appear in both places.

This keeps the current app stable while clarifying intent.

## Initial Scope
The first `Selection` flow does not need to solve every curation problem.

A useful first version could be small:

- filtered subset summary
- missing captions count
- `Face Focus`
- clickable focus sets for inspection

This is intentionally enough to prove whether a dedicated `Selection` flow is useful before adding more visual analysis.

If that is helpful, additional lightweight metadata signals can be added later.

## Relationship to Metadata Features
Selection is the natural home for lightweight visual-analysis metadata.

Examples:

- `face_focus`
- `scene_complexity`
- future image-only curation signals that help identify weak or noisy samples

This is a better fit than expanding `Review Captions` indefinitely.

## Independence Requirement
Selection-oriented analysis should remain as independent as possible:

- metadata analysis stays metadata analysis
- selection reports consume those results, but do not own caption logic
- captioning remains manual and separate
- training config remains separate
- experimental signals should not become hidden prerequisites for other workflows

This reduces risk and makes it easier to discard low-value analyses later.

## Non-Goals
The `Selection` flow should not:

- replace the caption editor
- auto-prune files
- auto-generate captions
- silently decide training inclusion
- become a dumping ground for every experimental analysis panel

The point is to support human curation decisions, not automate them away.

## UI Naming Direction
The current name `Review Captions` is still correct for caption QA.

The new curation flow should use naming that reflects its actual job, such as:

- `Selection`
- `Selection Report`
- `Review Selection`

`Selection` is the clearest default.

## Dependency and Plugin Direction
Today, WebCap uses a mix of direct dependencies and repurposed packaged tools:

- direct Python package dependencies such as `Pillow`
- bundled frontend vendor assets such as `cropperjs`
- repurposed packaged model functionality via `deface` and its bundled `CenterFace`

That is workable, but if selection analysis grows beyond one reused detector, the dependency story should become more consistent.

The recommended direction is:

- keep the `Selection` flow self-contained at the UI level
- keep each analysis feature in its own small backend helper
- define a narrow internal contract for analysis outputs written into `media_metadata.json`
- avoid coupling UI behavior to any one library's raw output shape

This does not require a full plugin system immediately. But if WebCap adds a second or third image-analysis backend, a small internal analyzer interface would likely be worth it.

For now, a light internal convention is probably enough:

- each analyzer owns its own helper file
- each analyzer writes one nested metadata block
- each analyzer carries its own version field for cache invalidation
- the selection report reads normalized metadata only

That gets most of the consistency benefits without introducing a new plugin framework too early.

## Pose and Expression Direction
The product direction has now shifted beyond exploratory body-position notes.

The intended longer-term `Selection` analysis layer is documented in:

- `docs/selection_pose_stack.md`

That document defines:

- the actual signals that matter
- the current recommended stack
- the expected repo footprint
- the execution-location tradeoff

`Selection` should remain the primary home for those signals once they exist.

## Open Questions
- Should `Selection` open in the same preview pane report format as `Review Captions`, or eventually get a more specialized layout?
- Should missing captions appear in both flows, or only in `Selection`?
- Should `Face Focus` move entirely to `Selection`, or stay duplicated temporarily during migration?
- Is `Selection` the final user-facing name, or should the button label include `Report`?
