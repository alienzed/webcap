# Dataset Configuration

WebCap creates one persistent dataset TOML per model, mode, and stage directly from currently visible media metadata.

## Setup files

| Profile | Dataset files |
| --- | --- |
| Wan2.2 T2V | `dataset.wan22.{mode}.{hi|lo}.toml` |
| Krea2 Raw | `dataset.krea2.{mode}.toml` |
| Wan2.1 T2V 14B | `dataset.wan21.{mode}.toml` |
| MiniMax H3 | `dataset.h3.{mode}.toml` |

Selecting a setup creates missing files but never replaces an existing dataset TOML. Reset recalculates only the selected dataset file from the visible media.

## Buckets and repeats

- Image buckets use supported 32-pixel-aligned resolutions selected for `POC`, `Normal`, or `Quality`. Generated defaults may select low, primary, and high resolution classes; each source image contributes to one class only.
- Wan2.2 maintains separate high-noise and low-noise policies.
- Krea2 is image-only.
- Wan2.1 and Wan2.2 use a 16 fps training timebase; MiniMax H3 uses 24 fps and its model-specific frame grid.
- Repeat values are calculated from sample count, configured epochs, and target-step policy. Editing the TOML is the intentional override.

## Run capture

Train uses the exact saved dataset TOML as its intent. For image stanzas, it creates bundle-only resolution-class directories and expands non-empty classes into one-bucket runtime stanzas so Diffusion Pipe cannot choose an oversized bucket by aspect ratio alone. Each image enters its highest configured bucket within WebCap's 15% per-axis allowance. Manual bucket and repeat edits are preserved; the saved source TOML is never rewritten.

Fresh run bundles copy videos already at the selected profile FPS and otherwise make a high-quality constant-FPS training copy inside the bundle only. Source media and `auto_dataset` remain untouched. If conversion is unavailable or fails, WebCap logs a warning and captures the original video unchanged instead. Video stanzas retain the normal path-only rewrite. A run plan is written beside the captured files for runner progress behavior.
