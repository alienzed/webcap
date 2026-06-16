# Scene Complexity Analysis

## Purpose
Add image-only scene complexity analysis to WebCap so curation can estimate how visually busy an image is.

This is not caption generation, object detection, or auto-tagging. It is lightweight visual metadata intended to help:

- inspect cluttered vs cleaner scenes
- break ties inside selection heuristics
- prefer less messy near-duplicates when everything else is similar

## Implementation Scope

### V1
- analyze images during normal metadata generation
- store one compact `scene_complexity` block in `media_metadata.json`
- surface the value in metadata views

### V2
- use scene complexity as a light tie-breaker in `Review Selections` suggested candidates
- lower-complexity scenes are preferred only when the rest of the candidate scoring is already similar

### Deferred
- no standalone scene-complexity filter yet
- no auto-prune logic
- no broad workflow coupling beyond metadata display and suggested-candidate ranking

## Core Assumptions
- must work fully offline
- must not require downloading model weights
- should stay CPU-first
- should use thumbnail-scale analysis only
- should reuse the existing metadata cache
- should remain easy to remove if it proves low-value

## Dependency Position
- V1/V2 do not require a new model
- V1/V2 do not require `numpy`
- V1/V2 use `Pillow`, which is already a project dependency

If later tuning proves this too weak, `numpy` would be a reasonable optional next step, but it is not required for the first shipped version.

## What the Metric Means
`scene_complexity` estimates composition pressure, not semantic richness.

Buckets:
- `simple`: one dominant focal subject or region, low visual competition
- `moderate`: a clear subject exists, but other regions compete somewhat
- `busy`: many competing regions, clutter, crowding, or weak focal dominance
- `unknown`: analysis failed or result is too ambiguous to trust

This is intentionally not a quality score.

Examples:
- a detailed lace close-up may still read `busy`
- a clean portrait may read `simple`
- a semantically rich image is not automatically `busy`

## Detection Strategy
V1/V2 avoid neural inference entirely.

The shipped heuristic uses a small grayscale thumbnail and combines a few cheap signals:
- edge density
- overall local contrast
- spread of edge energy across the frame
- dominance of the strongest visual region

The result is reduced to a normalized `0..1` score, then bucketed.

## Data Shape
Store this under each image entry in `media_metadata.json`:

```json
{
  "example.png": {
    "size": 123456,
    "mtime": 1710000000,
    "resolution": "1024x1024",
    "aspect_ratio": "1:1",
    "scene_complexity": {
      "bucket": "busy",
      "score": 0.74,
      "method": "heuristic_v1",
      "version": 1
    }
  }
}
```

Fields:
- `bucket`: `simple`, `moderate`, `busy`, or `unknown`
- `score`: normalized `0..1`
- `method`: short analyzer name
- `version`: cache invalidation version
- `error`: optional string when analysis fails

## Thresholds
Initial defaults:

| Bucket | Rule |
| --- | --- |
| `simple` | score < 0.33 |
| `moderate` | score >= 0.33 and < 0.66 |
| `busy` | score >= 0.66 |
| `unknown` | analysis failed or result is invalid |

These are intentionally easy to retune later.

## Workflow Role
This metric is useful primarily as a secondary signal.

Good uses:
- comparing multiple visually similar candidates
- spotting cluttered scenes during review
- gently preferring cleaner compositions in suggested-candidate lists

Bad uses:
- automatic prune decisions
- hard inclusion/exclusion rules
- caption/tag generation

## Cache Behavior
Reuse normal metadata invalidation:
- keep cached values when `mtime` and `size` still match and `version` is current
- recompute when the image changes
- remove metadata when the file disappears
- refresh after crop/transform flows that already refresh metadata

## Safety
Do:
- read image files
- write cached metadata into `media_metadata.json`
- show per-image analysis failures as metadata

Do not:
- mutate media
- add tags automatically
- edit captions automatically
- block review when the metric is missing

## Minimal Code Shape
Shipped shape:
1. `tool/server/scene_complexity.py` analyzes thumbnails.
2. `tool/server/media.py` stores `scene_complexity` into metadata responses and cache.
3. Metadata views surface the value quietly.
4. Suggested-candidate scoring uses complexity only as a light tie-breaker.

## Exit Criteria
If this metric does not change real curation decisions, it should stay lightweight or be removed.
