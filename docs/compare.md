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
