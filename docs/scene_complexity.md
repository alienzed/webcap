# Scene Complexity Analysis

## Purpose
Add image-only scene complexity analysis to WebCap so dataset curation can estimate how visually busy an image is before captioning or training decisions.

This is not an object detection feature, caption generation feature, or tagging feature. It is lightweight image-analysis metadata, intended to help judge whether an image has a clear focal subject or a crowded, competing scene.

## Core Assumptions
- V1 must work fully offline.
- V1 must not require downloading any additional model weights.
- V1 must be CPU-first and should not reserve meaningful VRAM.
- V1 should use thumbnail-scale image analysis only; full-resolution processing is unnecessary.
- V1 should reuse the existing `media_metadata.json` cache instead of introducing a new state file.
- V1 should be easy to remove if the signal proves unhelpful.

If those assumptions stop being true, this likely stops being worth doing.

## Product Direction
- Analyze images only for the first version.
- Store scene complexity as metadata, not item tags.
- Do not write detected complexity labels into captions.
- Do not connect this to Tag Mismatch, Balance Phrases, primer mappings, or training config generation in v1.
- Surface results in review and metadata only if the implementation remains small and low-noise.
- Prefer a single compact score and bucket over a large set of derived fields.

## Why Metadata, Not Tags
Scene complexity is generated visual analysis, not a human semantic label. Keeping it in metadata avoids:

- caption pollution
- false Tag Mismatch failures
- special-case workflow tags
- accidental training-caption changes
- coupling image analysis to existing caption logic

## Detection Strategy
V1 should avoid neural detection entirely.

The recommended first pass is heuristic image analysis on a downscaled copy of each image, for example a thumbnail around `256px` to `384px` on the longest side. Candidate signals:

- edge density
- local contrast variation
- saliency spread or focal concentration
- count of visually distinct regions or blobs
- ratio of dominant region area to total image area

The goal is not to identify objects. The goal is to estimate whether visual attention is concentrated or scattered.

## What "Complexity" Means
For this feature, `scene_complexity` should mean:

- `simple`: one dominant focal subject or region, low visual competition
- `moderate`: a clear subject exists, but background or secondary elements compete somewhat
- `busy`: many competing regions, clutter, crowding, or no obvious focal dominance
- `unknown`: analysis failed or result is too ambiguous to trust

This score is intentionally about composition pressure, not semantic richness. A highly detailed image is not automatically `busy` if attention is still concentrated on one subject.

## Non-Goals
V1 should not attempt to:

- detect named objects
- segment people or backgrounds
- infer caption text automatically
- decide training inclusion automatically
- override human judgment
- load large ONNX, CLIP, YOLO, or segmentation models

## Data Shape
Store a nested block under each image's existing `media_metadata.json` entry:

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
      "version": 1
    }
  }
}
```

Suggested fields:
- `bucket`: `simple`, `moderate`, `busy`, or `unknown`
- `score`: normalized `0..1` complexity score
- `method`: optional short method name such as `heuristic_v1`
- `version`: cache invalidation version
- `error`: optional string if analysis fails for this image

V1 should keep this payload intentionally small.

## Bucket Defaults
Suggested initial thresholds:

| Bucket | Rule |
| --- | --- |
| `simple` | score < 0.33 |
| `moderate` | score >= 0.33 and < 0.66 |
| `busy` | score >= 0.66 |
| `unknown` | analysis failed or result is invalid |

These thresholds are placeholders and should be tuned only after looking at real examples from the user's workflow.

## Likely Workflow Value
This feature is only worth keeping if it changes curation behavior in a practical way.

Examples of possible value:
- quickly identifying images where the subject is visually lost in clutter
- separating clean training samples from crowded ones during review
- nudging caption effort toward simpler or richer descriptions depending on how much scene competition exists

If the score does not change human decisions, it should remain experimental or be removed.

## Performance Expectations
For V1, expected cost should be closer to image statistics than model inference:

- no network access
- no model download
- no persistent GPU allocation
- tiny RAM overhead beyond loading the image and a small thumbnail
- per-image runtime expected to be low enough for metadata generation during normal folder refresh

This should be materially lighter than loading even a "small" modern vision model.

## Cache Behavior
Reuse the existing metadata cache invalidation:

- if file `mtime` and `size` match cached metadata, keep existing scene complexity analysis
- if an image changes, rerun normal media probing and scene complexity analysis
- if a file is removed, remove its metadata entry
- if a media transform or crop runs, existing metadata refresh should also refresh scene complexity
- scene complexity should run automatically whenever media metadata is generated, if implemented

## Safety
This feature must be read-only with respect to media files.

Do:
- read image files for analysis
- write cached metadata into `media_metadata.json`
- show errors visibly in the app or report

Do not:
- mutate media
- add tags automatically
- edit captions automatically
- block review because analysis is missing
- introduce heavyweight runtime dependencies for v1

## Error Handling
Follow `docs/copilot_rules.md`:

- coded dependencies should fail loudly when missing
- errors should be visible and actionable
- analysis errors for one image should be recorded on that image's metadata entry rather than silently swallowed
- report-level failures should state that scene complexity metadata could not be generated

## Minimal Implementation Shape
If implemented, the smallest viable shape is:

1. Add `tool/server/scene_complexity.py` with one thumbnail-based analyzer.
2. Extend `tool/server/media.py` to populate `scene_complexity` into metadata.
3. Reuse the existing metadata response path.
4. Surface the result in one existing review or metadata area without adding new workflow coupling.

This keeps the feature easy to test, easy to remove, and low-risk to the current app.

## Open Questions
- Is a single score enough, or is one supporting sub-signal needed for trust?
- Should V1 surface only a review summary first, before adding per-item metadata rows?
- What real examples from the user's dataset would actually cause different captioning or curation choices?
- Does `scene_complexity` describe the concept better than `busyness` or `clutter` in the UI?
