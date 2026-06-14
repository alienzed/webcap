# UI Gold-Master Audit

Status: Live/code UX audit. Planning only; do not implement from this document without a separate implementation pass.

## Audit Method

This audit combines:

- Static review of `tool/tool.html`, `tool/css/styles.css`, and the main UI modules.
- Live pass through the running local app at `http://127.0.0.1:5000/`.
- Workflow review against `docs/north_star_workflow.md`, `docs/selection_report.md`, and `docs/qa_panel.md`.

The live pass used a real set folder with media, opened a media item, inspected helper tabs, opened the annotation strip, and ran both `Review Captions` and `Review Selections`.

## Current UI Model

WebCap currently presents as a three-pane app:

1. **Left pane**
   - Utility bar
   - Filter controls
   - Folder/media list
   - Review action buttons
   - Config / Review / Train set-level tabs
   - Status bar

2. **Center pane**
   - Caption/config editor
   - Floating primer buttons
   - Floating Requirements / Tags / Analysis / Metadata helper panel
   - Floating annotation strip
   - Console panel

3. **Right pane**
   - Media preview iframe
   - Review/report iframe output
   - Preview quick actions
   - Balance wheel overlay

This model works because the user has grown with it, but much of it is organic rather than deliberate.

## What Works Well

### Three-Pane Foundation

The broad three-pane shape is still good:

- Left: choose and filter items.
- Center: edit captions/config.
- Right: inspect media and reports.

This is a strong foundation and does not need to be thrown away.

### Preview-Centric Media Work

The right preview is valuable and correctly prominent. Media operations like crop, deface, clip, reset, and preview navigation feel naturally attached to this pane.

### Annotation Strip

The annotation strip is one of the strongest speed features in the app.

Strengths:

- Groups are visually meaningful.
- Chips are fast.
- Neighbor/gap hints are useful.
- `n/a`, group review, and affixes are all in the right conceptual neighborhood.

The feature is good; its placement is the questionable part.

### Explicit Training Flow

The current `Prepare Dataset` / `Generate` / `Train` split is clearer than legacy one-shot autoset behavior.

### Review / Selection Reports

The report infrastructure is powerful:

- It can summarize the set.
- It can create focus subsets.
- It supports a fast inspect-and-return loop.

The intent of `Review Captions` versus `Review Selections` is becoming clearer, even if the presentation still feels mixed.

## Main UX Frictions

### 1. The Left Pane Is Overloaded

The left pane currently contains navigation, filters, review entry points, config editing, review options, training controls, and status.

Observed effect:

- On a media set, the media list and set-level tabs compete vertically.
- `Review Selections` / `Review Captions` sit between navigation and set settings.
- Config/Review/Train tabs are set-level controls, but their placement makes them feel like part of the media list.
- The status bar is important but visually low-priority and easy to miss.

This is workable, but not intuitive.

### 2. The Center Pane Has Too Many Jobs

The center pane is currently:

- Caption editor
- Config editor
- Report text dump
- Helper panel host
- Annotation workspace
- Console host

Observed live behavior:

- Running `Review Captions` or `Review Selections` clears the current item and writes report text into the center editor while the right pane shows report cards.
- This is useful for text output, but visually surprising because the caption editor becomes a report transcript.
- Preview actions can remain visually present after report mode, which blurs whether the user is looking at media or a report.

The center pane needs a clearer mode boundary.

### 3. The Helper Panel Is Powerful But Spatially Improvised

The helper panel floats over the bottom of the caption editor.

Observed live behavior:

- Requirements panel overlays the lower caption area.
- The annotation strip expands above it and can occupy most of the center pane.
- CSS compensates with editor bottom padding, which is practical but fragile.

This evolved from the original caption helper idea. It still works, but the app has outgrown the "floating over caption" placement.

### 4. Item Inspector Concerns Are Split

Tags, Analysis, and Metadata are item-inspector concerns, but they currently live inside the caption helper panel in the center pane.

That creates a mismatch:

- Tags relate to the caption editor, so center placement is partially defensible.
- Metadata and analysis relate more to the preview, so center placement feels less natural.
- QA would also relate to set/item quality, which likely belongs near preview/report context, not over the caption text.

### 5. Analysis Is Not Earning Its Tab

The live Analysis tab mostly showed:

- Face focus unavailable
- Selection pose unavailable
- No analysis metadata

Even when metadata exists, raw analysis facts are often obvious from the preview.

The better direction is not "Analysis" but **QA**, and only if it surfaces non-obvious, actionable curation concerns.

### 6. Review Captions and Review Selections Need Stronger Mode Identity

Both actions currently render into the right preview/report pane and put text output into the center editor.

The split is conceptually right:

- `Review Captions` = text/caption quality.
- `Review Selections` = sample curation.

But visually they still share too much of the same report/transcript treatment.

### 7. Some Current Documentation Is Behind The UI

The README still mentions a `Phrases` helper tab, while the live UI has `Requirements`, `Tags`, `Analysis`, and `Metadata`.

This is a small signal that the UI has changed faster than the product model documentation.

## Better UX Direction

Do not start with a complete redesign. The right move is a deliberate **layout clarification**.

The app should make these roles explicit:

1. **Navigator**
   - Folder/media list
   - Filters
   - Focus-set state

2. **Workbench**
   - Caption editing
   - Annotation editing
   - Primer/config editing when in config mode

3. **Preview + Inspector**
   - Media preview
   - Item facts
   - Item tags
   - QA hints
   - Reports

4. **Set Operations**
   - Review Captions
   - Review Selections
   - Prepare / Generate / Train
   - Config and review settings

The current panes roughly match the first three roles, but set operations are folded into the navigator and item inspector is folded into the workbench.

## Proposed Layout V2

### Left Pane: Navigator

Keep the left pane focused on:

- Current path
- Filters
- Media/folder list
- Focus-set state
- Status

Move or visually separate:

- Config / Review / Train set controls
- Review report buttons

The left pane should answer: "What item or subset am I working on?"

### Center Pane: Workbench

The center pane should primarily be:

- Caption editor
- Annotation workspace
- Config editor when explicitly in Config mode

Recommended changes:

- Stop treating the helper panel as a floating overlay long-term.
- Make annotation a proper docked workbench region:
  - collapsible bottom dock, or
  - split editor/annotation vertical layout, or
  - side-by-side within the center pane if width allows.
- Keep Requirements and annotation chips here because they directly drive caption creation.
- Keep the ability to collapse aggressively when caption writing needs full height.

The center pane should answer: "What text or annotations am I editing?"

### Right Pane: Preview + Inspector

The right pane should own:

- Media preview
- Preview actions
- Item metadata
- Item tags
- QA
- Report cards

Recommended changes:

- Move Metadata out of the floating center helper panel.
- Consider moving Tags to the right inspector too, unless tag insertion at cursor proves much faster from center.
- Rename Analysis to QA only when the first real QA signal exists.
- Keep preview actions here and do not duplicate them in QA.

The right pane should answer: "What am I looking at, and what should I check about this item?"

### Set Operations: Separate Strip Or Drawer

Set-level actions currently live in the left pane under the media list.

Consider a clearer set-operations strip:

- `Review Captions`
- `Review Selections`
- `Prepare`
- `Generate`
- `Train`

This could be:

- a compact strip under the left filter/list,
- a top-level mode bar,
- or a dedicated collapsible "Set" drawer.

The goal is to stop burying set-level workflow behind the same scroll region as the media list.

## Mode Model

The app currently has implicit modes. Making them explicit would reduce confusion.

Recommended modes:

1. **Browse/Edit**
   - Select media.
   - Edit captions.
   - Annotate.

2. **Review Captions**
   - Report mode.
   - Caption quality and text concerns.
   - Focus-set links.

3. **Review Selections**
   - Report mode.
   - Sample curation and set composition.
   - Focus-set links.

4. **Train Prep**
   - Prepare / Generate / Train command preview.
   - Config files.

The current UI has these modes, but they are not visually distinct enough.

## QA Direction

The QA panel should not be a raw analysis dump.

The best current QA concept is:

> Help identify items that may be redundant or worth pruning because they belong to an overrepresented visual cluster.

Useful first QA signal:

- Current item belongs to a repeated face/framing/expression cluster, such as `front + close-up + smiling`.

Lower-value QA signals:

- missing annotation groups
- generic balance gaps
- duplicate captions by themselves

These are often less actionable because the user cannot invent missing material, and duplicate-ish captions are often intentional.

## Speed-Drill Opportunities

### High-Leverage

1. **Batch tagging from reliable analysis**
   - Only for very reliable signals.
   - Should be conservative and previewable before applying.
   - Every click saved matters.

2. **Same-as-previous / nearby annotation**
   - Fast way to copy common tags/groups from adjacent items.
   - Useful for sequential media or similar clips.

3. **Review by cluster**
   - Group visually similar items so the user can prune the weaker near-duplicate.
   - More actionable than generic "missing category" warnings.

4. **Keyboard-first annotation**
   - Make the fastest repeated path require minimal pointer travel.

### Medium-Leverage

5. **Filtered batch operations**
   - Apply tag, flag, reviewed state, or rating to visible/focused items.
   - Needs strong confirmation and undo.

6. **Reviewed-state rules**
   - Mutating media may need to clear reviewed state automatically or mark "needs re-review."
   - This is probably more useful than merely warning forever.

## Recommended Next Step

Before implementing a visual revamp, do one of these focused design passes:

### Option A: Layout Wireframe Pass

Produce a proposed v2 layout doc with:

- pane roles
- mode transitions
- what moves where
- what disappears
- what stays unchanged

This is best if the goal is UI clarity.

### Option B: Speed Drill Pass

Prototype one high-leverage speed feature without changing the whole UI:

- reliable batch tagging,
- same-as-previous annotation,
- or cluster-based review.

This is best if the goal is immediate throughput.

## Recommendation

Do **Option A first, briefly**, then choose one speed feature.

Reason:

The current app is functional, but several features are now in places that reflect their history rather than their role. A small design pass will prevent the next speed feature from being bolted onto the wrong surface.

The likely target layout is:

- Left: navigation and filters.
- Center: caption + annotation workbench.
- Right: preview + item inspector + QA/report cards.
- Set operations: clearly separated from media navigation.
