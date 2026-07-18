# Dataset Configuration

WebCap generates Diffusion Pipe dataset TOML from `auto_dataset/prep_manifest.json`. The manifest is created by **Prepare Dataset** from the media currently visible in the set, so filtering deliberately changes the generated training subset.

## Profile outputs

| Profile | Dataset output |
| --- | --- |
| Wan2.2 T2V | `dataset.hi.toml` and `dataset.lo.toml` |
| Krea2 Raw | `dataset.train.toml` |
| Wan2.1 T2V 14B | `dataset.train.toml` |

Wan2.2 has separate high-noise and low-noise dataset policies. Krea2 and Wan2.1 use the neutral, single-stage dataset filename. Krea2 is image-only; generation rejects a prepared set containing video data.

## Buckets and repeat targeting

Generated TOML contains `[[directory]]` entries pointing at prepared media grouped by aspect ratio and media kind.

- Image buckets use supported, 32-pixel-aligned resolutions and choose a target-near resolution for the selected Dataset target: POC, Normal, or Quality.
- Wan2.2's high-noise and low-noise datasets are generated separately. They may use different image bucket choices; video treatment can also differ by stage.
- Single-stage Krea2 and Wan2.1 generation uses the generic low-style image bucket policy under `dataset.train.toml`.
- Repeat values are solved from the prepared sample count, configured epochs, and per-run target step budget. They are a generated starting point; editing TOML is the intentional override path.
- `auto_dataset/training_plan.json` records the selected profile, dataset target, estimated steps, and epochs used for the generated run plan.

Generation writes dataset TOML and the training plan. It does not overwrite existing configuration TOML; see [config_file_system.md](config_file_system.md).
