# Dataset configuration

WebCap generates explicit, auditable Diffusion Pipe directory stanzas. Each generated stanza contains exactly one `size_bucket`, so a source folder never relies on closest-aspect-ratio selection among several bucket candidates.

## Images

Images use one direct stanza per populated canonical AR and stage. WebCap selects the highest 32-aligned bucket at or below the mode target that keeps every image within a 15% per-axis resize allowance. Wan2.2 HI retains its existing one-step-lower target than LO.

No `image_classes` folders are created. The run bundle captures each selected image once and rewrites the stanza to its captured direct folder.

## Videos

Video roles are declarative:

| Profile/mode | Temporal | Detail |
| --- | ---: | ---: |
| Wan2.1/2.2 POC | 33f | — |
| Wan2.1/2.2 Normal/Quality | 37f | 13f |
| MiniMax H3 POC | 34f | — |
| MiniMax H3 Normal/Quality | 68f | 17f |

Wan video timing is normalized to 16 fps and H3 timing to 24 fps. A temporal stanza uses all temporal-eligible clips for that AR and the highest common native bucket under the profile/mode ceiling. Its repeat weight is `1.0`.

Detail is an explicit subset role with repeat weight `0.25`. Clips long enough for detail but shorter than temporal are mandatory detail members and establish the highest common native target they support. Long clips join detail only when they natively support the selected bucket. When there are no mandatory clips, an optional detail stanza is created only if at least two clips support a native bucket.

The bundle captures every selected source media item once. It materializes only marked detail stanzas under `media/video_detail/<ar>__<width>x<height>x<frames>`, using hardlinks when possible and copies otherwise. Temporal and image stanzas remain direct paths; there are no general video-class folders.

Clips with unsupported ARs, missing required metadata, or insufficient role frames are skipped with explicit warnings and do not block a managed launch.

## Saved TOML and artifacts

Saved dataset TOML is authoritative. Bundle capture preserves frame/dimension edits and unmarked manually added stanzas, changing only runtime paths. It warns about potential upscale or empty detail selection instead of silently changing the user’s configuration.

`training_plan.json` version 2 records stanza-level roles, buckets, source files, eligibility, native/upscaled counts, limiting files, and repeats. `dataset_manifest.json` records the exact captured selection. `bundle_summary.json` remains a compact view for the existing captured-items UI.

H3 envelope probing remains separate experimental tooling. A saved compatible calibration can lower the fixed H3 resolution ceiling for an active frame role, but it never raises a built-in ceiling or adds runtime dataset roles. Because saved dataset TOML is authoritative, calibration affects newly generated or explicitly reset datasets rather than rewriting existing files.
