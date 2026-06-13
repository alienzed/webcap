# Generate Config Mode - Implementation-Safe Specification

## Scope
Define how Training Mode (POC/Normal/Quality) affects generated dataset and training config outputs in a deterministic, low-risk way.

This document intentionally avoids changing existing AR validity rules, fallback behavior, or video bucketing semantics.

## Final Decisions

1. Mode source is app settings (`training.mode`), default `normal`.
2. Generate overwrites standard outputs (deterministic). No mode-suffixed file names.
3. Image bucketing uses target-near selection per AR, with `hi` biased slightly smaller than `lo`.
4. Video bucketing keeps current multi-bucket logic (motion + optional detail).
5. Modes provide preferred targets/ceilings. Existing support/fallback logic decides what is actually emitted.
6. If dataset constraints force convergence, outputs across modes may be similar or identical. That is expected.

## Why Image and Video Differ

Images are static and do not gain the same temporal benefit from multi-resolution per AR.
Videos benefit from multiple buckets because lower-res higher-frame motion coverage and higher-res lower-frame detail are both useful.

So:
- Images: target-near bucket selection per AR, with `hi` slightly coarser than `lo`.
- Videos: keep existing motion/detail behavior.

## Mode Tables

All dimensions are divisible by 32.

### Image Target Resolution by AR

POC:
- square 1:1: 384x384
- 4:3: 448x336
- 16:9: 512x288 
- 9:16: 288x512

Normal:
- square 1:1: 512x512
- 4:3: 640x480
- 16:9: 736x416
- 9:16: 416x736

Quality:
- square 1:1: 768x768
- 4:3: 896x672
- 16:9: 1024x576
- 9:16: 576x1024

Notes:
- `lo` uses the target table directly.
- `hi` is biased one short-side step below the corresponding mode target.
- `Normal` prefers the smallest fully-supported bucket at or just above target instead of the largest fully-supported bucket.
- `Quality` can still climb to larger fully-supported buckets when support allows.

### LoRA Rank Defaults

POC:
- config.hi rank: 16
- config.lo rank: 16

Normal:
- config.hi rank: 16
- config.lo rank: 32

Quality:
- config.hi rank: 32
- config.lo rank: 32

Note: LR policy is intentionally not changed in this phase. Rank-only adjustment keeps the change small and reversible.

## Hard Guardrails

1. Do not relax AR validation tolerance rules.
2. Do not add upscaling behavior.
3. Do not force unsupported target resolutions.
4. Do not change video frame candidate logic for this feature.
5. Keep Generate deterministic and overwrite-based.

## Current Code Reality (Important)

Current Generate path:
- endpoint: `tool/server/app.py` route `/fs/generate_dataset_config`
- response wiring: `tool/server/run_ops.py` -> `generate_dataset_configs(...)`
- generation logic: `tool/server/dataset_config.py`

Mode persistence status:
- `tool/server/config.py` normalizes and persists `training.mode`.
- Allowed values are `poc`, `normal`, `quality` (fallback to `normal`).

## Required Implementation Changes

### 1) Persist Training Mode in Backend Config Validation

File: `tool/server/config.py`

Update `validate_config_payload` training key allowlist to include `mode` with strict normalization:
- allowed values: `poc`, `normal`, `quality`
- unknown or empty -> `normal`

### 2) Make Generate Mode-Aware

File: `tool/server/run_ops.py`

`generate_dataset_config_response` should pass resolved mode into generation layer, along with the snapshot-comments flag from app settings when enabled.
Recommended signature change:
- `generate_dataset_configs(folder_path: Path, mode: str = "normal", write_selection_snapshot_comments: bool = False)`

Mode should come from runtime config (`app_config.config.training.mode`) to stay consistent with settings behavior.

### 3) Apply Mode to Image Bucket Selection Only

File: `tool/server/dataset_config.py`

Implement mode tables as constants and route image bucket selection through them.

Practical approach:
- keep current candidate/support/fallback logic
- constrain preferred selection to the mode target neighborhood
- bias `hi` one short-side step below `lo`
- keep the optional second Normal image bucket on the `lo` side only

Minimum safe delta:
- keep the image picker deterministic and target-near
- keep unsupported-image warnings
- keep video block logic unchanged

### 4) Apply Mode to Config Template Rank Values

Files:
- `tool/server/run_ops.py`
- template write path currently used for `config.hi.toml` and `config.lo.toml`

When writing config templates during Generate:
- patch adapter rank according to mode table above
- do not alter unrelated template keys in this change

## Deterministic Behavior Contract

1. User picks mode in settings.
2. User clicks Generate.
3. Generate always rewrites:
   - `dataset.hi.toml`
   - `dataset.lo.toml`
   - training config files in `auto_dataset` as current flow dictates
4. No mode-specific filename branching.
5. Re-running Generate with a new mode is the intended workflow.

## Acceptance Criteria

1. `training.mode` survives app settings save/load and reboot.
2. Generate reads persisted mode without needing request payload changes.
3. Image output stays deterministic and target-near, with `hi` generally landing below `lo`.
4. Video output still contains current motion/detail behavior where applicable.
5. Rank values in generated config templates match selected mode.
6. Low-res/small sets may produce identical POC/Normal/Quality outputs without error.
7. Existing tests pass; add focused tests for mode persistence and image single-bucket behavior.

## Test Plan (Minimal, High Value)

1. Config persistence:
- save settings with each mode
- read back from `/app/config`
- verify exact `training.mode`

2. Image-only set:
- run Prepare + Generate for each mode
- verify `hi` and `lo` image buckets separate as intended
- verify mode shifts selected resolution only when supported

3. Video set:
- run Prepare + Generate for each mode
- verify video bucket count/shape is unchanged relative to pre-mode behavior

4. Rank patching:
- inspect generated `config.hi.toml` and `config.lo.toml`
- verify mode rank matrix

5. Regression:
- run existing tests in `tests/` and ensure no behavior drift outside this scope

## Out of Scope (This Iteration)

1. Learning-rate mode tuning
2. New UI controls for per-run mode selection
3. File naming variants by mode
4. Broader dataset-preparation pipeline refactors

## Notes

This feature intentionally treats mode as a preference layer over existing safety and support logic. It should not increase risk of invalid buckets, upscaling, or non-deterministic generation.

## Step Budget Note

Repeat targeting is intentionally separated from `POC` / `Normal` / `Quality`.

- `hi` targets about `5000` steps
- `lo` targets about `20000` steps

Modes primarily change bucket selection and effective training cost, not the step-budget model itself.
