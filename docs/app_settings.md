# App Settings

Last reviewed against code: 2026-08-15

The app settings modal is the global configuration surface for values stored in `tool/config.json`.

## Current sections

- `Paths`: workspace, models, Diffusion Pipe, WSL, Conda, and activation paths.
- `Caption Editor`: app-wide default caption template.
- `Training Models`: models available for new training setup and Train actions.
- `Analysis & Appearance`: optional analyzers, theme, and debug mode.
- `Advanced JSON`: raw on-disk configuration.

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
