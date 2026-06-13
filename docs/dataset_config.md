# Dataset Configuration Strategy (WAN2.2)

## Overview

WebCap generates dataset configuration files (dataset.hi.toml, dataset.lo.toml) that define size buckets and training data organization for LoRA training on WAN2.2.

For planned step-targeted repeat defaults, see `docs/repeat_targeting.md`.

The strategy is to:
- Use fixed, preset resolution pools per aspect ratio (not dynamically generated).
- Select buckets that are actually supported by media in the folder (coverage-based).
- Differentiate configuration by training profile: lo-noise (motion + detail, fuller image detail) vs hi-noise (motion only for video, slightly coarser image preference).
- Ensure every media item lands in at least one bucket.

---

## Resolution Presets

All resolutions divisible by 32.

### Preset Pool (352–768px range)
- 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768

### Aspect Ratios

#### Square (1:1)
- Presets: 256, 288, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768

#### 4:3
- Presets (w×h): 288×384, 320×416, 352×480, 384×512, 416×544, 448×576, 480×640, 512×672, 544×704, 576×768

#### 16:9
- Presets (w×h): 288×512, 320×576, 352×640, 384×672, 416×736

#### 9:16
- Presets (w×h): 512×288, 576×320, 640×352, 672×384, 736×416

---

## Bucket Selection Logic

### Video Buckets

**Motion Bucket** (primary, covers all/most clips):
- Frame count: 33
- Resolution: lowest preset where ≥90% of clips are supported
- Rationale: maximum coverage; motion learns well across resolutions
- Goal: every video lands here

**Detail Bucket** (high-res, selective):
- Frame count: 13
- Resolution: highest preset where ≥60% of clips are supported
- Rationale: detail benefits from high-res but needs sufficient support
- If support <60%: omit bucket rather than force it
- Lo-noise profile only: included if supported
- Hi-noise profile only: omitted entirely

### Image Buckets

**Image Buckets per Profile** (no motion; frame count = 1):
- Resolution: choose from supported presets while staying near the mode target
- Normal: prefers the smallest fully-supported bucket at or just above target, instead of the largest fully-supported bucket
- Quality: can still climb to larger fully-supported buckets when supported
- Hi-noise: biased one short-side step below lo-noise for the same mode
- Lo-noise: keeps the fuller-detail image preference and may emit a second supporting bucket in Normal mode

---

## Profile Split

### Lo-Noise Profile (dataset.lo.toml)
- **Videos**: motion bucket + detail bucket (if ≥60% support)
- **Images**: target-near detail bucket per AR, with an optional second supporting bucket in Normal mode

### Hi-Noise Profile (dataset.hi.toml)
- **Videos**: motion bucket only
- **Images**: target-near bucket per AR, biased slightly smaller than lo-noise

---

## Coverage Thresholds

- **Motion bucket**: ≥90% of video frames must support the resolution
- **Detail bucket**: ≥60% of videos must support the resolution
- **Image bucket**: ≥60% of images must support the resolution
- **Floor guarantee**: unsupported media items are logged but not included

---

## Frame Counts

- **Motion**: 37 frames
- **Detail**: 13 frames
- **Images**: 1 frame (static)

---

## TOML Output Format

Each selected bucket emits a `[[directory]]` block:

```toml
[[directory]]
path = "{TRAINING_ROOT}/{DATASET}/auto_dataset/square"
num_repeats = 2
group = "videos"
size_buckets = [
  [512, 512, 33],  # motion
  [768, 768, 13],  # detail (lo-noise only)
]
```

For images:

```toml
[[directory]]
path = "{TRAINING_ROOT}/{DATASET}/auto_dataset/square_img"
num_repeats = 1
group = "images"
size_buckets = [
  [640, 640, 1],  # single image bucket
]
```

---

## Implementation Notes

- Presets are fixed constants (JSON or Python dicts).
- Bucket selection is deterministic: same inputs → identical outputs.
- No blind copying from legacy dataset.auto.toml; all configs are intentionally authored.
- Unsupported media (extremely low resolution) are excluded with clear console logging.

---

## Future Extensions

- Configurable coverage thresholds (e.g., allow 50% detail support if user prefers).
- Per-folder override metadata to lock bucket choices manually.
- Separate image-quality tiers (e.g., regular vs high-detail images) if needed.
