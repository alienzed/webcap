# Repeat Targeting for Generate (Planned)

## Purpose

Set safer default `num_repeats` values during `Generate` by targeting rough step budgets from dataset size.

This is intended to reduce obvious overkill runs while still biasing toward overtraining instead of undertraining.

## Scope

Only `num_repeats` generation changes.

Out of scope for this change:
- epoch changes
- learning rate changes
- hard max clamp on repeats

## Current Problem

Current defaults use fixed repeats and can overshoot badly on small sets (for example, small image-only LoRAs running far longer than needed).

## Guiding Principles

1. Miss high, not low.
2. Keep logic simple and deterministic.
3. Use sample counts as the primary signal.
4. Keep manual override workflow intact (users can still edit TOML directly).

## Default Targets

Initial defaults discussed for this app:

1. High-noise: target about `5000` steps
2. Low-noise: target about `20000` steps

These step budgets are intentionally independent of `POC` / `Normal` / `Quality`.
Mode should primarily affect bucket selection and effective training cost, not own the duration model.

These are practical defaults, not hard quality guarantees.

## Minimal Algorithm

For each generated dataset file (`dataset.hi.toml`, `dataset.lo.toml`):

1. Count prepared samples in each generated directory stanza.
2. Compute effective samples per epoch from those counts.
3. Solve one repeat scalar from target steps.
4. Round up (`ceil`) to preserve overdo bias.

Conceptually:

- `steps ~= epochs * effective_samples_per_epoch`
- `repeat ~= ceil(target_steps / (epochs * effective_samples_base))`

Apply repeats to stanzas from that solved value.

## Video and Image Handling

1. Video should always be emitted as separate stanzas for motion and detail buckets.
2. This keeps weighting explicit and easy to tune.
3. Image stanzas continue as image stanzas, with repeat set by the same targeting logic.

## HI and LO Separation

`dataset.hi.toml` and `dataset.lo.toml` should be generated independently so each can target its own step budget.

This is required to make HI and LO repeat targets meaningful.

## Diversity Signal (Optional Follow-up)

Diversity can be added later as a light boost, not a replacement for sample count:

1. Start with count-based targeting only.
2. Optionally add a small upward target boost (for example `+10%` to `+20%`) when captions are very diverse.
3. Do not reduce targets based on diversity in the first pass.

## Mode-Based Learning Rates (Documented Defaults)

Separate from the flat `hi` / `lo` repeat targets, fixed learning rates can still be tied to Training Mode.

Agreed table:

1. POC
- HI: `9e-5`
- LO: `6e-5`
2. Normal
- HI: `7e-5`
- LO: `4e-5`
3. Quality
- HI: `5e-5`
- LO: `2e-5`

Notes:
- These are documented defaults for future implementation.
- This document does not imply that LR patching is already active in code.

## Expected Outcome

1. Small datasets stop defaulting into accidental extreme step counts.
2. Defaults remain conservative (slightly over target).
3. Behavior stays predictable and easy to reason about.
