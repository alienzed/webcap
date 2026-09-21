# App Settings

Last reviewed against code: 2026-09-21

The app settings modal is the global configuration surface for values stored in `tool/config.json`.

## Current sections

- **General → Library**: filesystem root.
- **General → Caption Editor**: app-wide default caption template.
- **General → Analysis & Appearance**: optional Face Focus / MediaPipe analysis plus browser-scoped theme.
- **Training → Training Runtime**: models root, Diffusion Pipe/WSL runtime, Conda or activation script, and repeat-reference epochs.
- **Training → Copy to Test**: per-stage LoRA destination roots plus an optional one-folder subfolder.
- **Training → Training Models**: profiles available for new training runs.
- **Training → H3 calibration**: hardware-bound MiniMax H3 bucket calibration.
- **Advanced**: diagnostics, H3 troubleshooting options, and raw JSON editing.

## Repeat planning

`training.repeat_reference_epochs` defaults to 90. WebCap uses it only when solving generated dataset repeat counts. Changing a run's **Epochs** field does not cause repeats to be recalculated around that run length; Epochs changes the captured run configuration and its estimated total work.

## Copy to Test

`training.test_copy_roots` stores independent destination roots for H3, Krea2, Wan2.1, Wan2.2 High, and Wan2.2 Low. `training.test_copy_subfolder` is optional and must be a single directory name. These values control where saved candidate LoRAs are staged for testing; they do not move or rewrite the original training output.

## Training model visibility

All supported profiles are enabled by default. Clear a model checkbox to hide it from new training setup. At least one must remain enabled.

Each model row links to its Hugging Face file repository. These are ordinary external links; WebCap does not download or manage model files.

This is visibility only: disabling a model never deletes persistent TOMLs, captured run bundles, history, or resume metadata. If a set remembers a now-disabled model, Training selects the first enabled model instead. A single enabled model therefore appears as the only option.

Use **Save + Reboot** to apply runtime settings immediately.

## Caption template behavior

- `primer.template` is an app-wide fallback.
- A folder-specific template inside `.webcap_state.json` overrides it.
- A blank app template uses the built-in default.

## Implementation notes

- Frontend modal logic: `tool/js/app_settings.js`
- Backend validation and persistence: `tool/server/config.py`
- Available training profiles: `tool/server/training_profiles.py`
