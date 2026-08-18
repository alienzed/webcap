# Image Resolution Classes

Last reviewed against code: 2026-08-17

Status: **Planning / direction document.** This describes intended future behavior and is not current WebCap behavior.

## Purpose

WebCap already calculates image bucket support from native image dimensions, but current dataset TOMLs do not preserve that per-image support membership.

The goal of this work is to keep WebCap's existing image bucketing philosophy while changing how it is expressed to diffusion-pipe:

> Train images near the highest useful resolution their source data can support, without letting a small low-resolution minority drag an entire aspect-ratio cohort down, and without letting a small high-resolution minority lose useful detail.

This work is **images only**. Existing video spatial/temporal bucketing should remain unchanged.

A future VRAM-ceiling mechanism, including MiniMax H3-specific limits, is a separate project.

## Confirmed downstream behavior

Two diffusion-pipe discussions are important context:

- https://github.com/tdrussell/diffusion-pipe/issues/51
- https://github.com/tdrussell/diffusion-pipe/issues/168

The maintainer confirms that configured spatial resolutions resize media up or down, and recommends separating low- and high-resolution media into different directories when they should train at different resolutions.

For explicit `size_buckets`, current diffusion-pipe chooses a bucket by aspect ratio plus frame eligibility. It does **not** check whether source width/height are large enough for the selected spatial bucket.

Therefore this is unsafe:

```toml
[[directory]]
path = ".../916_img"
size_buckets = [
  [352, 640, 1],
  [576, 1024, 1],
]
```

WebCap may intend the first bucket for lower-resolution images and the second for higher-resolution images, but diffusion-pipe does not know that membership. It may assign a lower-resolution image to the larger bucket solely because its rounded aspect ratio is closer.

## Current WebCap behavior worth preserving

The current implementation already contains most of the resolution intelligence required for this feature.

Relevant code is primarily in:

- `tool/server/dataset_config.py`
- `tool/server/dataset_prep.py`
- `tests/test_dataset_config.py`

### Prepared image cohorts

`dataset_prep.py` currently:

- classifies media into the canonical AR families:
  - `square`
  - `4:3`
  - `3:4`
  - `16:9`
  - `9:16`
- stores images under `<ar>_img`
- records real `width` and `height` in `prep_manifest.json`

The crop ratio and training resolution are separate concepts. Images with the same crop ratio can legitimately have very different native pixel dimensions.

### Canonical resolution ladder

`generate_image_candidates()` already produces the useful 32-pixel-aligned spatial candidates for an AR, subject to the selected mode's caps.

There are only a small number of meaningful canonical candidates per AR. This is intentionally a discrete training-resolution ladder, not clustering over arbitrary native image dimensions.

### Native support matrix

`pick_image_buckets()` already calculates:

```python
support[(w, h)] = sum(
    1
    for (_, iw, ih) in supported_images
    if iw >= w and ih >= h
)
```

This is the key definition of **native support**:

> An image natively supports a bucket when both source dimensions are at least the bucket dimensions.

The existing primary and secondary image-bucket strategies already use support, coverage, target resolutions, mode caps, and scale differences.

The missing piece is not basic bucket math. The missing piece is transmitting **which images belong to which spatial bucket**.

## North Star

Within each AR cohort:

1. Use the existing canonical 32-pixel resolution ladder.
2. Prefer the selected mode's intended resolution range.
3. Preserve useful higher-resolution detail when enough distinct images support it.
4. Do not let one slightly smaller image force the dominant population to train lower.
5. Allow a small amount of upscale when that avoids creating a tiny, low-diversity class.
6. Never create one resolution class per native image size.
7. Base class health on **distinct source images**, never repeats.
8. Keep the number of classes small.
9. Express every final resolution class as a separate diffusion-pipe directory with exactly one spatial `size_bucket`.

## Proposed v1 policy

These are deliberately simple starting constants:

```python
IMAGE_CLASS_MIN_UNIQUE = 3
IMAGE_CLASS_MAX_PER_AR = 3
IMAGE_CLASS_MAX_UPSCALE_RATIO = 1.15
```

`1.15` is a per-axis ceiling. It permits a small repair such as:

```text
448 -> 512 = 1.1429x
```

but does not make large upscaling normal policy.

These values should live beside the existing image-bucket policy constants in `dataset_config.py`.

### Why minimum 3 unique images

A resolution class made from one image repeated many times may be numerically trainable, but repeats do not create visual diversity.

The intent is to avoid creating tiny resolution islands unless there is no safe alternative.

Three is not claimed to be mathematically optimal. It is a conservative v1 guardrail that works with the small datasets WebCap commonly handles.

### Why at most 3 classes per AR

Typical WebCap sets may contain only about 25 images total, often split across multiple AR families.

The desired abstraction is roughly:

```text
low / primary / high
```

not a class for every occupied rung of the canonical ladder.

Most cohorts should still produce one class. Two should be common only when there is a real resolution split. Three should be exceptional.

## Resolution-class selection

Implementation should reuse the existing candidate generation, support calculations, mode targets, and mode caps rather than introducing a second independent bucketing system.

The exact helper names may change, but the intended sequence is:

### 1. Build the normal support table

For an AR cohort, calculate the existing canonical candidates and native support counts.

Also retain per-image membership, not only aggregate counts.

For each candidate bucket, WebCap should be able to answer both:

```text
How many images natively support this bucket?
Which images are they?
```

### 2. Choose the primary population without requiring one low outlier to control it

Current primary selection strongly favors full cohort coverage. That is safe against upscaling, but it means one low-resolution image can pull the whole cohort down.

For resolution classes, the primary class should represent the dominant useful population near the current mode target, not necessarily 100% of the cohort.

The existing mode target should remain important. This feature should not accidentally turn `Normal` into `Quality`.

A good implementation should prefer the existing target bucket when a healthy population supports it, and move downward only when the target is not meaningfully supported.

### 3. Create a higher class only when it has real diversity

Higher-resolution images should not automatically be collapsed into the primary class merely because they are the minority.

A higher class is justified when:

- it contains at least `IMAGE_CLASS_MIN_UNIQUE` distinct images;
- it is meaningfully above the primary class;
- it remains within the current mode/cap rules;
- it does not push the total over `IMAGE_CLASS_MAX_PER_AR`.

This replaces the current assumption that a secondary bucket can simply be listed beside the primary bucket in one directory.

### 4. Create a lower class only when it has real diversity

Low-resolution images should not automatically drag the primary class down.

If a lower-resolution population contains at least `IMAGE_CLASS_MIN_UNIQUE` distinct images, it may justify its own lower class.

If it is sparse, first try to fold it into the nearest healthy class.

### 5. Permit small upscale when folding sparse images

A sparse image may join a higher class when both dimensions stay within:

```text
target_dimension <= source_dimension * IMAGE_CLASS_MAX_UPSCALE_RATIO
```

This is intended for cases like `448 -> 512`, not for turning `438x779` into `576x1024`.

Small upscale is a **sparse-class merge tool**, not a reason to greedily train everything above native resolution.

When more than one class is valid, choose the closest spatial class.

Prefer no-upscale assignment when distances are otherwise comparable.

### 6. Sparse orphan fallback

Do not silently prune or exclude an image solely because it cannot join a healthy resolution class.

If a sparse image cannot join any existing class within the upscale ceiling:

- prefer an existing lower class if one is available;
- otherwise retain a fallback lower-resolution class and emit a clear generation warning.

This fallback is expected to be rare.

The feature should not add automatic pruning. Resolution-related pruning policy remains separate.

## Example

Input square images:

```text
10 x approximately 512x512
 3 x approximately 768x768
 1 x 448x448
```

Desired result:

```text
512 class:
  - 10 native ~512 images
  - 1 x 448 image, permitted to upscale slightly

768 class:
  - 3 native ~768 images
```

The `448` image must not pull the ten `512` images down.

The three `768` images must not be forced into `512` merely because they are a minority.

The emitted dataset should conceptually look like:

```toml
[[directory]]
path = ".../square_img_class_512"
group = "images"
size_buckets = [
  [512, 512, 1],
]

[[directory]]
path = ".../square_img_class_768"
group = "images"
size_buckets = [
  [768, 768, 1],
]
```

Each directory contains only the images assigned to that class.

## Important regression example

Given the previously observed 9:16 case:

```text
source image: 438x779

configured buckets:
352x640
576x1024
```

The source must **never** be placed in the `576x1024` class.

`438x779 -> 576x1024` exceeds the small-upscale policy and does not represent native support.

The old single-directory / multi-`size_buckets` form must no longer be used to represent image resolution classes.

## Materialization protocol

The source prepared AR directory remains useful as the canonical prepared copy:

```text
auto_dataset/916_img/
```

Resolution classes should be derived from it.

The implementation may choose the safest existing WebCap-compatible mechanism for materializing the subsets, but the contract is:

- one derived directory per final image resolution class;
- each derived directory contains the image and matching caption for only its assigned sources;
- each derived directory is referenced by one `[[directory]]` block;
- each block contains exactly one image `size_bucket`;
- no source image is duplicated across multiple image resolution classes for the same stage unless a future feature explicitly requests multi-resolution duplication.

Prefer correctness and compatibility with immutable run bundles over storage optimization.

Do not rely on symlink behavior unless the current run-bundle copy/rewrite path is verified to preserve it correctly. Hardlink/copy details are implementation choices, not product behavior.

Derived class paths must be deterministic so regenerated TOMLs and run capture remain reproducible.

## Stage and mode behavior

Preserve existing model/setup semantics:

- Wan2.2 HI and LO image policies may still differ.
- Krea2 remains image-only.
- Wan2.1 and MiniMax H3 remain single-stage setups.
- `POC`, `Normal`, and `Quality` must continue to use their existing targets/caps.
- Existing video entries must remain unchanged.

Resolution class assignment may therefore be stage/mode-specific if the selected image buckets differ.

Do not globally reorganize the user's source dataset.

## Repeats

Keep the existing repeat solver for v1.

Each resolution-class directory should enter repeat calculation using its real number of distinct assigned images as `sample_count`.

Do not count the same image once per possible bucket.

Do not use repeats when deciding whether a resolution class has enough diversity to exist.

If three images form a high-resolution class, their lower sample count should naturally contribute fewer raw exposures than a larger primary class under the existing repeat calculation unless existing weighting intentionally changes that balance.

Any future class-specific repeat weighting is separate work.

## Logging

Generation output should make the decision auditable.

For each AR/stage, log something similar to:

```text
[INFO] square_img: 14 image(s)
[INFO] square image class 512x512: 11 image(s), 10 native, 1 slight-upscale
[INFO] square image class 768x768: 3 image(s), 3 native
```

Warnings should identify:

- sparse orphan/fallback classes;
- any image assigned with allowed upscale;
- images smaller than every valid canonical candidate.

Avoid logging every candidate considered unless debug output already has a suitable place.

## Suggested implementation shape

The code should remain small and testable.

Possible helpers in `tool/server/dataset_config.py`:

```python
build_image_support(...)
choose_image_resolution_classes(...)
assign_images_to_resolution_classes(...)
materialize_image_resolution_classes(...)
```

Names are not contractual.

A useful internal class result would contain at least:

```python
{
    "bucket": (512, 512),
    "images": [...],
    "native_count": 10,
    "upscaled_count": 1,
}
```

The existing `pick_image_buckets()` / primary / secondary helpers may be adapted or replaced internally, but preserve their useful candidate generation and mode-policy concepts.

Avoid maintaining two different definitions of image support.

## Files likely affected

Primary:

- `tool/server/dataset_config.py`
- `tests/test_dataset_config.py`

Likely, depending on where derived subsets are materialized:

- `tool/server/dataset_prep.py`
- run-bundle/path-rewrite tests if derived paths expose an assumption there

Documentation after implementation:

- `docs/dataset_config.md`
- `docs/README.md`

The new planning doc should move from planning/direction to shipped behavior only after implementation and tests match it.

## Required regression tests

At minimum:

### Dominant primary plus low singleton plus high minority

```text
10 x 512
3 x 768
1 x 448
```

Expected:

- 512 class contains 11 sources;
- 768 class contains 3 sources;
- 448 is allowed into 512 under the small-upscale ceiling;
- 768 sources do not train at 512.

### 9:16 accidental upscale regression

Include `438x779` with a cohort that can produce both approximately `352x640` and `576x1024` candidates.

Expected:

- `438x779` is not assigned to `576x1024`;
- assignment is based on WebCap class membership, not diffusion-pipe AR tie/rounding behavior.

### Homogeneous cohort

All images support the same useful target.

Expected:

- exactly one image directory/class;
- no unnecessary splitting.

### Sparse high-resolution outlier

One high-resolution image among a healthy primary population.

Expected:

- it does not automatically create a one-image high-resolution class;
- it joins the closest healthy class unless the fallback policy requires otherwise.

### Healthy high-resolution minority

At least `IMAGE_CLASS_MIN_UNIQUE` high-resolution sources above the primary population.

Expected:

- a separate high-resolution class is retained.

### Video-only dataset

Expected:

- generated video behavior is unchanged;
- no image-class directories are created.

### Mixed images and videos

Expected:

- image directory behavior changes only as specified;
- video bucket selection, frame logic, and video repeat weighting remain unchanged.

### Mode behavior

Verify `POC`, `Normal`, and `Quality` do not collapse into identical behavior merely because resolution classes exist.

### Repeat accounting

Expected:

- each source image contributes to exactly one image class per stage;
- repeat planning uses assigned unique source counts;
- no accidental multi-resolution duplication occurs.

## Non-goals

This project does **not** include:

- changing diffusion-pipe;
- video resolution-class redesign;
- video temporal bucket redesign;
- automatic VRAM detection;
- MiniMax H3 VRAM ceiling discovery;
- automatic resolution pruning;
- image-quality scoring;
- changing crop behavior;
- arbitrary native-resolution buckets;
- training one image at every resolution it can support.

## Acceptance criteria

The work is complete when:

1. Image resolution classes are based on WebCap's explicit per-image assignment.
2. A diffusion-pipe image directory contains only one spatial `size_bucket`.
3. Small low-resolution outliers no longer force an otherwise healthy primary population down.
4. A healthy higher-resolution minority can retain a higher class.
5. Small upscale is bounded and auditable.
6. Class viability is based on distinct source images, not repeats.
7. No AR cohort produces more than the configured maximum number of classes.
8. Existing video behavior is unchanged.
9. Repeat/sample accounting does not duplicate an image across spatial classes.
10. Regression tests cover the known accidental-upscale case.

## Follow-up ideas

After this ships and produces real training results, revisit the policy from evidence rather than intuition:

- Is 15% the right upscale ceiling?
- Is 3 unique images the right minimum class size?
- Is 3 classes per AR ever useful in practice, or should the normal case cap at 2?
- Should a very low sparse orphan become a stronger prune candidate?
- Should class selection use perceptual sharpness in addition to pixel dimensions?
- Should future VRAM-aware policy lower the maximum allowed class for specific models/hardware?

Those are tuning questions. They should not block fixing the current information-loss problem between WebCap's support calculations and diffusion-pipe's directory-level bucket semantics.
