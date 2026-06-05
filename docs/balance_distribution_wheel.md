# Balance Distribution Wheel

## Goal

Expose item-level balance context without adding judgment labels, targets, or heavy configuration.

The Review Captions report already gives the balance story. The missing bridge is showing how the currently selected media item participates in that same story while the user reviews the item.

## Core Idea

Render a small distribution wheel for configured Balance Phrases.

- The universe is the manually configured Balance Phrases list.
- Each phrase gets one slice.
- Slice size is based on that phrase's count in the current filtered media list.
- The current item's matching phrase slice is visually raised, outlined, or otherwise emphasized.
- If the item matches multiple balance phrases, all matching slices are emphasized.
- If overlap needs visual blending, use a subtle gradient or shared emphasis style, but do not combine slices into a synthetic bigger slice.

This avoids labels like "high", "low", or "overrepresented". The visual only says: this item belongs to this slice of the current balance distribution.

In short: Review Report Balance Counts, projected onto the current item.

## Data Source

Use existing Balance Phrases.

- Balance Phrases are manually maintained by the user.
- No preload requirement.
- Usually only a few phrases are expected.
- Use the same terminology shown in Review Captions.

For the first implementation, phrase membership should mirror Review Report Balance Counts:

- caption phrase match or tag match
- if both caption and tag match the same phrase on one item, count that item once for the wheel slice
- same normalization and count semantics as the existing report path
- whole-word/phrase matching is required; avoid substring partials

## Count Semantics

Keep the first version simple:

- Count across the current filtered media list.
- If no filters are active, this naturally means the current folder list.
- Use the same phrase/count terminology as Review Report Balance Counts.
- Do not introduce custom targets.
- Do not classify terms as good/bad/high/low.
- Tooltip contains concise matched-phrase stats.

Tooltip should stay concise and include only the interesting numbers:

- matched phrase(s)
- count and percent for matched phrase(s)
- filtered item denominator

## UI Placement

Start as a floating preview overlay.

Reasons:

- The balance signal is most useful while judging the current image.
- It keeps item-level balance context connected to the media item.
- It avoids forcing the user to switch to Metadata while reviewing.

Placement:

- top-left of the preview window
- opposite the existing preview actions on the right
- mostly transparent at rest
- fully opaque on hover/focus
- noninteractive except for tooltip/focus affordance in the first pass

Suggested tooltip:

```text
front: 18/60 (30%)
close-up: 11/60 (18%)
```

## Visual Behavior

Minimal visual requirements:

- start around 100px diameter
- small enough to sit over the preview without covering meaningful image content
- readable in light and dark mode
- no animation required
- no dependency on chart libraries
- plain HTML/CSS/SVG is enough
- use a deterministic color assignment per phrase
- highlight matched slices with outline, lift, opacity, or stroke
- rest opacity should be low enough to stay quiet, but not invisible
- hover/focus opacity should be 1.0

If multiple terms match:

- keep slices separate
- emphasize every matched slice
- do not add counts together

If no balance phrases exist:

- do not render the overlay

If no phrase matches current item:

- show the wheel unhighlighted
- tooltip says current item matches no balance phrases

If a configured phrase has zero hits in the filtered list:

- render no slice for that phrase
- if all phrases are zero, show a quiet all-zero/empty wheel state
- tooltip should make zero counts clear when relevant

If many phrases are configured:

- keep the first implementation simple
- render them all and revisit only if it becomes visually noisy

Out of scope:

- recursive/cross-folder search modes
- materialization flows
- background balance reports outside the current filtered media list
- handling selected media outside the filtered list; selection normally comes from the filtered list

## Non-Goals

Do not implement these in the first pass:

- targets or desired distributions
- high/low/ok labels
- automatic recommendations
- export weighting
- deletion/pruning suggestions
- grouping changes for dataset prep
- new backend storage
- new chart dependency

## Future Ideas

Possible later extensions:

- preview-corner mini wheel if metadata proves too hidden
- "rare coverage" indicator based only on explicit user-selected terms
- optional export weighting or repeat hints
- balance-focused review campaign mode
- item list focus from a wheel slice, similar to current balance phrase links

## Minimal Implementation Plan

1. Reuse `statsBalancePhrases` as the phrase universe.
2. Add a small helper that computes phrase counts from the current filtered media list, captions, and tags.
3. Add a helper that computes which balance phrases match `state.currentItem`.
4. Render one floating preview overlay with a small SVG wheel.
5. Put concise matched phrase stats in the row title/tooltip.
6. Keep all behavior read-only.

## Guardrails

Follow the existing project rules:

- keep the first pass small and explicit
- wire existing data before adding new infrastructure
- avoid optional dependency guards
- avoid clutter
- make the feature informative, not prescriptive
