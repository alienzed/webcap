# Dataset configuration

WebCap generates explicit, auditable Diffusion Pipe directory stanzas. Each generated stanza contains exactly one `size_bucket`, so a source folder never relies on closest-aspect-ratio selection among several bucket candidates.

## Images

Images use one direct stanza per populated canonical AR and stage. WebCap selects the highest 32-aligned bucket at or below the current target that keeps every image within a 15% per-axis resize allowance. Wan2.2 HI retains its existing one-step-lower target than LO.

No `image_classes` folders are created. The run bundle captures each selected image once and rewrites the stanza to its captured direct folder.

## Videos

Video roles are declarative:

| Profile | Balanced | Temporal | Detail |
| --- | ---: | ---: | ---: |
| Wan2.1/2.2 | — | 37f | 13f |
| MiniMax H3 | 34f | 68f | 17f |

Wan video timing is normalized to 16 fps and H3 timing to 24 fps. Full-cohort roles use every clip that reaches their frame count and the highest common native bucket under the current model policy. H3 defaults to Balanced `1.0`, Temporal `0.5`, and Detail `0.25` repeat weights.

Detail is an explicit subset role. Clips long enough for detail but shorter than the next full-cohort role are mandatory detail members and establish the highest common native target they support. Longer clips join detail only when they natively support the selected bucket. H3 permits a one-clip detail subset so newly generated H3 datasets include all three roles; other profiles retain the existing two-clip minimum.

The bundle captures every selected source media item once. It materializes only marked detail stanzas under `media/video_detail/<ar>__<width>x<height>x<frames>`, using hardlinks when possible and copies otherwise. Balanced, Temporal, and image stanzas remain direct paths; there are no general video-class folders. A direct full-cohort video folder may include clips shorter than that stanza's frame count; Diffusion Pipe skips those clips.

Clips with unsupported ARs, missing required metadata, or insufficient role frames are skipped with explicit warnings and do not block a managed launch.

## Saved TOML and artifacts

Raw saved dataset TOML is authoritative. A valid TOML with buckets outside the managed model policy is preserved as raw/custom and is not approximated by Training Review. Managed Review video buckets must be exact members of the current policy; capture asserts that invariant before queue mutation.

`training_plan.json` version 2 records stanza-level roles, buckets, source files, eligibility, native/upscaled counts, limiting files, and repeats. `dataset_manifest.json` records the exact captured selection. `bundle_summary.json` remains a compact view for the existing captured-items UI.

H3 envelope probing remains separate experimental tooling. Each active H3 video role has a conservative uncalibrated ceiling. A saved compatible calibration replaces that exact frame/aspect ceiling, expanding or contracting it within the app-owned model/probe envelope; it does not add runtime dataset roles. The exact calibrated ceiling remains selectable; automatic calibrated defaults retain two 32px ladder rungs below it where available. Calibration affects newly generated or explicitly reset managed datasets rather than rewriting existing TOMLs.
