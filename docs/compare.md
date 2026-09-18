# Compare

## Purpose

Compare should be a general WebCap media capability, not a Test Generations-specific feature.

The same comparison surface should eventually support two primary entry points:

1. **Regular WebCap media** — select a small number of images or videos and open Compare.
2. **Test Generations results** — open Compare with the current test session's generated outputs preselected.

Test Generations should provide context to Compare, not own a separate comparison implementation.

## Core Principle

> Compare is a general WebCap media capability. Test Generations may launch Compare with the current session's outputs preselected; it does not own a separate comparison implementation.

## Expected Compare Surface

A future Compare view should make differences between a small number of media items easy to inspect side by side.

Useful shared behavior may include:

- side-by-side image/video presentation
- clear filename or item identity
- existing rating and flag context
- synchronized playback for videos where practical
- normal WebCap navigation back to the source set/session

The comparison surface should operate on ordinary WebCap media items. It should not require epoch-specific parsing or a separate Test Generations data model.

## Test Generations Integration

Test Generations already writes generated media into ordinary WebCap folders under:

`<set>/test-generations/<session>/`

That layout should remain sufficient for future Compare integration.

A Test Generations session may later expose a **Compare Results** action that simply passes that session's generated media into the generic Compare surface.

Session-specific context such as model, prompt, generation date, and source LoRA filename may be displayed around the comparison, but comparison itself should remain media-centric.

## Non-Goals for Test Generations Phase 1

Compare is intentionally outside the initial Test Generations implementation.

Phase 1 should not add:

- a dedicated Epoch Compare implementation
- automated ranking or scoring
- winner selection state
- epoch parsing or ordering logic for Compare
- experiment-history dashboards
- prompt matrices or strength sweeps

The immediate Test Generations goal remains: generate deterministic H3 test outputs, persist them as ordinary WebCap media, and make them easy to inspect.

## Future Direction

When Compare is implemented, prefer one reusable capability rather than separate compare experiences for normal media and epoch testing.

This keeps Test Generations focused on generation/session context while Compare owns media-to-media inspection.

## Two-Item Comparison Interaction

The primary Compare experience should optimize for subtle differences between successive renders, especially epoch tests where adjacent results may differ only slightly.

Compare should show **at most two items at once** and use the full available canvas rather than living inside a narrow content pane.

### Default navigation

Compare receives an ordered list of existing media items. It should not create a separate comparison data model.

For an ordered sequence such as:

`E24, E26, E28, E30, ...`

the default interaction is a sliding two-item window:

`E24 | E26` → `E26 | E28` → `E28 | E30`

Navigation moves one item out and one item in. The user should not need to manually select each comparison pair.

A later **Pin reference** action may hold one side while navigating the other:

`E28 | E30` → `E28 | E32` → `E28 | E34`

Pinning is optional; adjacent-pair navigation remains the default.

### Full-canvas layout

Each item should consume as much of its half of the available canvas as possible.

Layout should be chosen from the intrinsic media dimensions and available viewport:

- portrait-oriented pair: prefer side-by-side
- landscape-oriented pair: prefer top/bottom
- square or mixed orientations: choose the split that yields the larger fitted display area

This is presentation logic only. The chosen split does not need persisted state.

Labels such as filename, epoch, or source LoRA should overlay the media unobtrusively rather than consume dedicated layout space.

### Image comparison modes

The default image view is two-up.

A high-value secondary mode is **Blink**: rapidly alternate item A and item B in the same viewport so small changes become visually obvious. Blink is preferred over opacity overlay as the first alternate comparison mode.

A later wipe/divider mode may also be useful. Opacity overlay is optional and should not be a first requirement.

### Video comparison

For videos, Compare should support synchronized:

- play/pause
- current time / scrubbing
- playback rate

The two videos remain ordinary media items; synchronization belongs to the Compare presentation surface.

### Keyboard interaction

A minimal interaction set:

- Left Arrow: previous adjacent pair
- Right Arrow: next adjacent pair
- Space: synchronized video play/pause
- B: temporary Blink for images
- P: pin/unpin the reference item
- Escape: leave Compare

### Entry points

Compare remains a general WebCap media capability.

Regular media groups may open Compare on an ordered subset of items. Test Generations may open Compare with the current session results already ordered by the result sequence/epoch context.

The comparison surface should receive existing media items plus transient navigation state such as current indices and pinned reference. It should not persist winners, rankings, or duplicate comparison records merely to support viewing.
