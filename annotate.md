# Annotate UX Plan

## Goal
Improve speed and consistency for large-set annotation by adding a dedicated annotation UI that matches the real workflow and reduces bottom-panel clutter.

## Workflow Order
1. Rate
2. Annotate
3. Caption
4. Review
5. Prepare / Generate / Train

## Core Problem
- The current bottom panel is too busy for fast annotation.
- The phrases area is too small and unstructured for grouped annotation.
- Requirements are usually not used until Review.
- The caption editor area is often mostly empty during annotation, so that space can be shared.

## Proposed Solution
Add a new **Annotate Strip** that floats above the current bottom panel (over the editor area), optimized for fast click-to-tag annotation.

## Annotate Strip Behavior
- Shown primarily during annotation work.
- Can be manually shown/hidden at any time.
- Full-width horizontal zone with grouped chips.
- Supports roughly 4-8 groups (typically 4-5 visible comfortably).
- Group items are short labels (usually 1-3 words).
- Clicking a chip toggles the corresponding tag on the current media item.
- No single-select vs multi-select mode in UI; keep interaction simple: click to tag/untag.

## Data Source
Use existing Requirements config as the schema source for annotation groups and elements.
- Reuse current categories/items.
- No separate configuration system required.

## Toggle Placement
Use existing bottom panel chrome for the control (no new global header/area).

Preferred placement:
- Beside the **Phrases** heading: `Annotate ▲/▼`

Details:
- Tooltip: `Show/hide annotation strip`
- Persist open/closed state for convenience.

## Existing Bottom Panel Role After Change
- Keep the bottom panel.
- De-emphasize it for annotation (utility/support mode).
- Phrases remains useful after annotation for caption fill-in.
- Requirements remains useful later for review/checking.

## Notes
- Reclaim UI space from controls that are not currently useful (example: unused `X` affordance in panel chrome).
- This change should improve throughput on massive sets without removing existing power features.
