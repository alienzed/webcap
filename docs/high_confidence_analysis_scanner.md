# High-Confidence Analysis Scanner

Status: future design. This is one analysis subsystem, not a collection of advisory warnings.

## Purpose

Surface only confirmed, actionable signals from completed training evidence and current dataset metadata. Silence is preferable to a weak or nagging guess.

The scanner should read normalized app data where it exists and TensorBoard event data for training curves. It must not introduce a second loss/event history or a database.

## Current boundaries

Do not duplicate shipped review surfaces:

- Caption Report already covers missing captions, required phrases, phrase balance, duplicate/similar captions, and caption-length outliers.
- Prune Candidates already reports unreadable metadata, unsupported aspect ratios, short videos, and conservative resolution outliers.
- Managed runs already retain logs, progress, and Recent Runs history.

The scanner may add an outlier only when it is stronger or materially different from those checks. A missing required trigger token, for example, belongs to the existing caption requirement/report flow.

## Signal families

### Training

- completed, stable LoRA valleys and their candidate artifacts;
- confirmed training anomalies or regime changes;
- diminishing returns only after a sustained interval without meaningful improvement.

These signals require enough later evidence to establish the pattern. They are retrospective, not live speculation.

### Dataset

- high-confidence technical outliers such as one 6 FPS clip in an otherwise 24–30 FPS cohort;
- clearly anomalous duration, resolution, frame count, or aspect data, with sufficient comparable cohort evidence;
- dataset coverage gaps only when an explicit expectation or a strong distributional absence makes the finding actionable.

Do not flag ordinary variety, stylistic choices, or merely unusual examples as defects.

## Decision rules

- Use explicit thresholds, cohort minimums, and normalized metadata.
- Require enough evidence to explain why the item is exceptional.
- State the exact observed fact and comparison population.
- Keep findings inspectable and linkable to the underlying media or run evidence.
- Never mutate, prune, retag, stage, or change a training plan automatically.

## LoRA-type policy

Future scanner expectations may vary by declared LoRA type, but only where a concrete type-specific expectation exists. The type setting is an input to narrow rules, not a reason to invent more warnings.
