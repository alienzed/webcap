# Face Counts and Focus Analysis

## Purpose
Add image-only face analysis to WebCap so dataset curation can see how much usable face signal each image contains.

This is not a captioning feature, tag feature, or Balance Phrases feature. It is image analysis metadata, used to support character LoRA sample selection and review.

## Product Direction
- Reuse the existing `media_metadata.json` cache instead of creating a separate state file.
- Analyze images only for the first version.
- Store face analysis as metadata, not item tags.
- Do not write detected focus labels into captions.
- Do not connect this to Tag Mismatch, Balance Phrases, or primer mappings in v1.
- Surface results in the item metadata panel and Review Captions report.
- Name the Review Captions report panel `Face Focus`.

## Why Metadata, Not Tags
Tags currently support caption workflows, search, mismatch checks, and mappings. Face focus is generated visual analysis, not a human semantic label. Keeping it in metadata avoids:

- caption pollution
- false Tag Mismatch failures
- special-case workflow tags
- accidental training-caption changes
- coupling image analysis to Balance Phrases

## Detection Source
WebCap already has `deface` installed for face anonymization. The package uses a bundled CenterFace ONNX model to detect face bounding boxes before applying blur or masks.

For this feature, WebCap should reuse the detector directly and never call the mutating deface route.

Current relevant code:
- `tool/server/media.py`: `update_media_metadata()` and `probe_media_metadata()`
- `tool/server/app.py`: existing `/fs/deface` route is mutating and should not be reused for this feature
- `tool/js/item_details.js`: item metadata panel
- `tool/js/preview_pane.js`: Review Captions report and media metadata panel

## Data Shape
Store a nested block under each image's existing `media_metadata.json` entry:

```json
{
  "example.png": {
    "size": 123456,
    "mtime": 1710000000,
    "resolution": "1024x1024",
    "aspect_ratio": "1:1",
    "face_focus": {
      "bucket": "close",
      "face_count": 1,
      "largest_height_pct": 34.2,
      "largest_area_pct": 8.1,
      "largest_score": 0.91
    }
  }
}
```

Suggested fields:
- `bucket`: `close`, `medium`, `body`, or `unknown`
- `face_count`: number of detected faces
- `largest_height_pct`: largest detected face height as a percentage of image height
- `largest_area_pct`: largest detected face bounding-box area as a percentage of image area
- `largest_score`: detector confidence for the largest/useful face
- `error`: optional string if analysis fails for this image

## Bucket Defaults
Use largest face height as the primary bucket signal:

| Bucket | Rule |
| --- | --- |
| `close` | largest face height >= 30% of image height |
| `medium` | largest face height >= 12% and < 30% |
| `body` | face detected, but largest face height < 12% |
| `unknown` | no face detected or analysis failed |

Face height is preferred over area because it maps more naturally to framing and is less sensitive to aspect ratio.

Use the largest clear face for bucket assignment. Multiple detected faces do not automatically make an image unknown.

Low-confidence, unclear, ambiguous, or non-central detections should be classified as `unknown`. The goal is not to count partial face fragments; the goal is to identify whether the image contains a clear dominant face signal.

## Review Report
Add a `Face Focus` panel to Review Captions with counts and percentages for the currently reviewed/filtered image set:

| Bucket | Count | Percent |
| --- | ---: | ---: |
| Close | 14 | 40.0% |
| Medium | 13 | 37.1% |
| Body | 6 | 17.1% |
| Unknown | 2 | 5.7% |

Rows should be clickable, matching the spirit of existing review links:
- clicking `Close` focuses all close-bucket image files
- clicking `Unknown` focuses images that need manual review
- video files should be excluded from face-focus counts in v1
- counts and percentages should ignore videos entirely in v1

The existing balance distribution wheel can be reused if it fits cleanly, but this feature should remain independent of Balance Phrases. Any wheel or visual summary should be driven from image metadata buckets, not configured phrases.

## Item Metadata Panel
Add image-only rows to the item metadata panel:

- `Face Focus`: `close`, `medium`, `body`, or `unknown`
- `Faces`: detected face count
- `Largest Face`: height percentage, optionally area percentage
- `Face Score`: detector confidence when available

Prefer rounded, easy-to-read values over raw precision. For example, show `34% height` rather than `34.2381%`. Use subtle emphasis, color, or a compact visual treatment where it improves scanability.

If metadata is missing, show nothing or a compact unavailable state consistent with the existing metadata panel.

## Cache Behavior
Reuse the existing metadata cache invalidation:

- if file `mtime` and `size` match cached metadata, keep existing face analysis
- if an image changes, rerun normal media probing and face analysis
- if a file is removed, remove its metadata entry
- if a media transform/crop runs, existing metadata refresh should also refresh face analysis
- face analysis should run automatically whenever media metadata is generated

## Safety
This feature must be read-only with respect to media files.

Do:
- read image files for analysis
- write cached metadata into `media_metadata.json`
- show errors visibly in the app/report

Do not:
- blur or overwrite media
- copy to originals
- call `/fs/deface`
- add tags automatically
- edit captions automatically
- block caption review because face analysis is missing

## Error Handling
Follow `docs/copilot_rules.md`:

- coded dependencies should fail loudly when missing
- errors should be visible and actionable
- analysis errors for one image should be recorded on that image's metadata entry rather than silently swallowed
- report-level failures should state that face focus metadata could not be generated

## Implementation Sketch
1. Add image face-analysis helper in `tool/server/media.py`.
2. Initialize one reusable CenterFace detector per metadata generation call.
3. Extend `probe_media_metadata()` for image files to include `face_focus`.
4. Ensure `media_metadata_response()` returns face-focus fields.
5. Render face-focus rows in `tool/js/item_details.js`.
6. Add Face Focus summary panel in `tool/js/preview_pane.js`.
7. Wire report bucket clicks to existing focus-message behavior.
8. Add focused tests for metadata shape and image-only behavior where practical.

## Open Questions
- Should the file be named `docs/face_counts.md`, `docs/face_focus.md`, or something else?
- What exact confidence threshold should define a clear dominant face?
- What exact centrality rule should separate a clear central face from an ambiguous off-frame/partial detection?
