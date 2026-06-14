# UI Revamp Concept

Status: Planning only. Do not implement yet.

## Core Question

If WebCap started today with the current feature set and no existing UI, would it still use the current layout?

Probably not exactly.

The three-pane foundation is still strong, but the panes should be based on workflow roles instead of historical feature placement.

The app's real unit of work is not only a caption. It is a **training sample**.

The UI should therefore be **sample-first** and **mode-adaptive**.

## Core Direction

Keep the three-pane foundation, but redefine it:

1. **Left: Queue**
   - What am I working through?
   - Folder, filters, focus sets, current subset, ratings, flags, reviewed state.

2. **Center: Sample Canvas**
   - What am I looking at or editing?
   - Preview first, with caption editor attached when captioning matters.

3. **Right: Inspector / Tools**
   - What can I apply, check, or understand about this sample?
   - Annotation groups, tags, metadata, QA, mode-specific controls.

This is closer to tools like Lightroom, Photo Mechanic, Resolve, labeling tools, and curation/review apps:

- queue on one side
- selected item in the center
- tools/metadata/labels on the other side
- mode-specific emphasis
- hotkeys and batch operations for repeated work

## What Changes Conceptually

The current UI is mostly always-on:

- left navigation
- center caption editor
- right preview/report
- helper panel floating over caption text

The revamp would become mode-adaptive:

- culling gives preview more prominence
- annotation gives labels/tools more prominence
- captioning gives text composition more prominence
- review becomes report/focus-set oriented
- selection review becomes compare/cluster oriented
- training becomes a set-operation/preflight surface

The features mostly remain, but their homes and visibility change.

## Does The Feature Set Change?

Conceptually, no.

The revamp does not remove major capabilities. It reorganizes them around the job being done.

Practically, yes: features become mode-specific instead of always competing for attention.

### Same Features, Better Homes

#### Queue / Browse

- folder navigation
- filters
- focus sets
- stars
- flags
- reviewed state
- current subset counts
- selection/filter summary

#### Sample Canvas

- media preview
- crop
- deface
- clip
- reset
- caption editor when captioning is active
- report/card canvas when reviewing

#### Inspector / Tools

- requirement groups
- annotation chips
- tags
- metadata
- QA
- affixes
- item state

#### Review Captions

- caption report
- missing required phrase
- validation failures
- similar captions
- caption length issues
- focus-set links

#### Review Selections / Compare

- near-duplicate clusters
- face/framing/expression similarity
- ratings and flags
- compare weaker/stronger alternatives
- prune decisions
- focus-set/cluster traversal

#### Train

- Prepare Dataset
- Generate
- Train command preview
- config files
- training settings
- preflight checks

## Proposed Modes

### 1. Browse Mode

Purpose:

- Move through folders and media.
- Filter, rate, flag, and select.

Layout:

- Left: queue dominates.
- Center: selected sample preview.
- Right: compact inspector.

Best for:

- orienting in a set
- quick ratings/flags
- finding items
- jumping into a focused workflow

### 2. Annotate / Caption Mode

Purpose:

- Add annotations/tags.
- Write or refine captions.

Layout:

- Left: queue remains visible.
- Center: preview plus caption composer.
- Right: annotation and tag tools.

Important shift:

- The annotation panel should stop being a floating overlay over the caption text.
- It should become a proper tool palette or dock.

Best for:

- fast tagging
- same-as-previous/nearby annotations
- caption composition
- requirement completion

### 3. Review Captions Mode

Purpose:

- Check text quality.
- Find missing required phrases, validation failures, similar captions, and length outliers.

Layout:

- Left: issue groups / focused result queue.
- Center: report cards or selected issue detail.
- Right: selected sample preview/inspector, if needed.

Important shift:

- Review should not turn the caption editor into a report transcript by default.
- Reports should feel like their own mode.

Best for:

- caption QA
- focus-set loops
- targeted caption fixes

### 4. Review Selections / Compare Mode

Purpose:

- Decide which samples are worth keeping.
- Compare near-duplicates.
- Prune weaker alternatives.

Layout:

- Left: clusters or candidate groups.
- Center: 2-4 item compare grid or large selected preview.
- Right: cluster evidence, rating/flag/prune state, metadata summary.

Important shift:

- Review Selections should probably not be just another report.
- It should become a **compare/cluster surface**.

Best for:

- realistic pruning
- choosing between very similar samples
- spotting overrepresented face/framing/expression clusters
- curating a stronger set from limited material

### 5. Train Mode

Purpose:

- Prepare artifacts.
- Generate configs.
- Preview commands.

Layout:

- Left: set/config file list.
- Center: generated artifacts, logs, command previews.
- Right: settings and preflight checks.

Best for:

- dataset preparation
- config inspection
- command handoff

## Feature Visibility By Mode

| Feature | Browse | Annotate/Caption | Review Captions | Review Selections/Compare | Train |
| --- | --- | --- | --- | --- | --- |
| Folder/media queue | Primary | Primary | Focused | Cluster/focused | Secondary |
| Text filters | Primary | Primary | Useful | Useful | Secondary |
| Stars/flags | Primary | Useful | Useful | Primary | Secondary |
| Reviewed state | Primary | Useful | Useful | Useful | Secondary |
| Preview | Primary | Primary | Secondary | Primary | Secondary |
| Caption editor | Secondary | Primary | Targeted | Secondary | Hidden/secondary |
| Annotation groups | Secondary | Primary | Secondary | Secondary | Hidden |
| Tags | Secondary | Primary | Secondary | Secondary | Hidden |
| Metadata | Inspector | Inspector | Supporting | Supporting | Supporting |
| QA | Inspector | Supporting | Supporting | Primary if cluster-based | Hidden |
| Crop/deface/clip/reset | Primary actions | Primary actions | Contextual | Contextual | Hidden |
| Review Captions report | Hidden | Hidden | Primary | Hidden | Hidden |
| Review Selections report | Hidden | Hidden | Hidden | Primary | Hidden |
| Prepare/Generate/Train | Hidden | Hidden | Hidden | Hidden | Primary |

## What Becomes Less Prominent

- Raw `Analysis` tab.
- Metadata inside the caption helper overlay.
- Set-level training controls under the media list.
- Reports taking over the caption editor as a plain text dump.
- Always-visible tools that do not match the current task.

## What Becomes More Prominent

- Preview as the center of sample judgment.
- Annotation as a real tool palette.
- Review Selections as compare/cluster workflow.
- Batch tagging from reliable analysis.
- Same-as-previous or same-as-nearby annotation.
- Focus-set and cluster traversal.
- Keyboard-first repeated actions.

## Speed-First Implications

The revamp should not just make the app prettier. It should reduce work.

High-value speed directions:

1. **Batch Tagging From Reliable Analysis**
   - Only conservative, high-confidence signals.
   - Preview before apply.
   - Strong undo.

2. **Same-As-Previous / Nearby Annotation**
   - Copy common tags/groups from adjacent or visually similar items.
   - Useful for sequential clips and scene variants.

3. **Cluster-Based Review**
   - Group similar samples.
   - Help choose the best one or two instead of pruning blindly.

4. **Keyboard-First Annotation**
   - Reduce pointer travel.
   - Make repeated tagging possible without hunting the UI.

5. **Filtered Batch Operations**
   - Apply tags, flags, ratings, or reviewed state to visible/focused subsets.
   - Requires confirmation and undo.

## Design Principle

Do not ask:

> Where can this feature fit?

Ask:

> During which workflow does this feature save time or prevent mistakes?

If a feature does not help the active workflow, it should be available but not prominent.

## Recommendation

Do not immediately rebuild the UI.

First, create a wireframe/design pass for the mode-adaptive three-pane model:

- Queue
- Sample Canvas
- Inspector / Tools
- Explicit modes

Then choose one speed feature to prototype inside that model.

Best first candidates:

1. same-as-previous / nearby annotation
2. reliable batch tagging
3. cluster-based Review Selections

The most important conceptual change is:

> WebCap should become sample-first, not caption-editor-first.

That preserves the working feature set while making the app more deliberate, more intuitive, and more speed-oriented.
