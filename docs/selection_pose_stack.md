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

## Face ROI Mode
Face ROI mode is a targeted optimization for face-specific signals only.

It should apply to:

- `face_direction`
- `facial expression`

It should not apply to:

- `body_orientation`
- `pose_class`
- `arm_position`

Those body-oriented signals should continue using the full image.

### Goal
Improve face-direction and expression accuracy for images where the face is present but underrepresented within a much larger frame.

This mode is not intended to create new information. It is intended to improve the effective face representation presented to the face analyzer in cases where the full-frame path is likely wasting too much of the analyzer input budget on background.

### Source of ROI
The preferred source is the existing CenterFace / `face_focus` detection path, since it already produces plausible face boxes and size metrics.

Implementation direction:

- detect face on the original image
- select the primary plausible face box
- derive a padded face ROI from that box
- run face-specific analysis on that ROI only
- keep pose/body analysis on the full image
- merge both results back into the normal `selection_pose` metadata block

### Decision Rule
Use face ROI mode only when both of the following are true:

- the padded face ROI would make the face materially larger relative to the analyzer input than the full image would
- the padded face ROI still contains enough real source pixels to justify analysis

Current recommended gate:

- ROI candidate if the padded crop short side is less than `50%` of the full-image short side
- ROI allowed only if the padded crop short side is at least `192 px`

If either condition fails, use the current full-image face analysis path.

### Disqualifiers
Do not use face ROI mode when any of the following are true:

- no plausible face was detected
- the selected face is edge-clipped
- face confidence is too weak
- the face is already large enough in-frame that ROI is unlikely to help
- the padded crop remains too small to offer meaningful detail

### Padding and Fallback
The ROI should be padded rather than tightly cropped to the raw face box.

Goals of padding:

- preserve some local context around the face
- avoid brittle overly-tight crops
- reduce the chance of harming expression or direction inference

If the ROI gate fails, or if ROI analysis itself fails, the system should fall back to the existing full-image face-analysis path rather than leaving face fields empty.

### Product Framing
This should be treated as a conservative rescue path for small-face-in-large-image cases, not as a universal replacement for full-image face analysis.

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
