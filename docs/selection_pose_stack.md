# Selection Pose Stack

## Purpose
Define the smallest practical visual-analysis stack for `Review Selections` that can support:

- suggested training-candidate subsets
- suggested coarse tags
- selection-oriented grouping and balance review

This is not intended to produce captions, rich semantic descriptions, or high-accuracy VLM-style judgments.

## Required Signals
The current required signal set is:

- `face direction`
- `facial expression`
- `body orientation`
- `coarse pose class`
- `limb / arm placement`

Explicitly not required:

- face size / framing (`face_focus` already covers this well enough)
- exact crop completeness
- high-confidence scene understanding
- dense coordinates or raw angles in the UI

## Quality Bar
This feature family is intended to provide `hints`, not authoritative labels.

Useful examples:

- a candidate subset of `15-35` likely strong training items from a visible set of roughly `100`
- rough body-orientation balance buckets that are right often enough to guide review
- conservative suggested tags that are visually obvious and easy to accept manually

Unacceptable behavior:

- backfilling missing balance buckets from weak evidence
- turning low-confidence guesses into hard labels
- surfacing large numbers of noisy or overly specific suggestions

## Constraints
The stack should satisfy all of the following unless there is a strong reason to deviate:

- fully local / offline
- no runtime model downloads
- pinned versions
- vendored assets where practical
- no hidden cloud calls, telemetry, or update checks
- moderate footprint
- moderate CPU/GPU use
- easy to isolate from the rest of the repo

The goal is a small, portable, low-maintenance app. This analysis must not grow into a second training/inference subsystem.

## Recommended Stack
The current best-fit balanced stack is:

- `MediaPipe Face Landmarker`
- `MediaPipe Pose Landmarker Lite`

Why this stack currently wins:

- it covers all required signals from one ecosystem
- facial expression is available cleanly through face-landmark outputs
- pose landmarks are rich enough for coarse body orientation and limb placement
- local asset paths can be used so the app stays offline
- the dependency surface is broader than a one-trick pony, but narrower than stitching together multiple partial systems

## Why Not The Smaller Split Stack
The leading minimalist alternative was:

- `MoveNet Lightning`
- a separate lightweight face-expression stack

That path remains attractive for raw minimalism, but expressions are now part of scope. Once expressions are required, the smaller path stops being especially small because:

- body and face become separate model/problem stacks
- the runtime story becomes more fragmented
- the face-expression half tends to be older, weaker, or less coherent than the body half

This makes the "minimalist" route less convincing as a complete solution.

## Execution Location
The stack choice and the execution location are separate decisions.

Possible execution locations:

- browser-side, likely in a worker
- backend-side, if local execution proves faster and simpler

This decision should be performance-driven.

Guidance:

- if browser execution is materially slower, backend execution is acceptable
- small GPU usage is acceptable
- heavy GPU dependency is not
- if the feature starts competing with training or general app responsiveness, it is likely not worth it

## Expected Repo Footprint
If vendored locally, the rough expected footprint is:

- about `30 MB` total added assets
- about `13` vendored runtime/model files
- about `2-4` app integration files

This is not tiny, but it is still a bounded, reviewable addition.

## Repo Layout Direction
Keep the concerns concentrated rather than scattered.

Suggested shape:

- `tool/vendor/mediapipe/`
- `tool/vendor/mediapipe/models/face_landmarker.task`
- `tool/vendor/mediapipe/models/pose_landmarker_lite.task`
- `tool/js/selection_pose.js`
- optional `tool/js/selection_pose_worker.js`

If backend execution wins:

- keep vendored assets still grouped under `tool/vendor/mediapipe/`
- keep backend analyzer logic in one helper module
- keep UI consumption limited to normalized metadata and report payloads

## Output Philosophy
The analyzer should not expose raw library outputs directly to the rest of the app.

Instead, normalize into coarse app-owned buckets such as:

- `face_direction`
- `expression`
- `body_orientation`
- `pose_class`
- `arm_position`

The UI should consume those normalized values only.

## Intended Product Uses
This stack is meant to feed two specific features:

### 1. Suggested Candidates
From the currently visible items, produce a conservative "likely strong training candidates" subset.

This should:

- prefer positive evidence
- avoid inferring missing buckets from absence of evidence
- help the user rate through strong candidates faster

### 2. Suggested Tags
For currently untagged or partially tagged items, propose visually obvious coarse tags such as:

- `front view`
- `side view`
- `three-quarter`
- `rear view`
- `smile`
- `arms raised`
- `seated`

These should remain manual accept/reject suggestions, not auto-applied tags.

## Non-Goals
This stack is not meant to:

- generate captions
- replace manual review
- solve fine-grained semantics
- provide perfect orientation classification
- justify rich VLM inference

## Open Assumptions
The following assumptions still need confirmation before implementation goes far:

- whether the first implementation should run in the browser or on the backend
- what exact `facial expression` bucket set is useful enough to expose
- what exact `coarse pose class` bucket set is useful enough to expose
- whether `three-quarter rear` should be its own first-class bucket or derived from a broader rear-facing family
- whether analysis should be cached in `media_metadata.json` or generated only for `Review Selections`

## Current Recommendation
Proceed with implementation planning around:

- `MediaPipe Face Landmarker`
- `MediaPipe Pose Landmarker Lite`
- strict offline vendoring
- strict version pinning
- normalized outputs
- `Review Selections` as the first consumer

The actual execution location should remain open until we test performance.
