# App Settings

Last reviewed against code: 2026-07-05

The app settings modal is the global configuration surface for values stored in `tool/config.json`.

## Current Sections

- `Paths`
  - filesystem root
  - models root
  - diffusion-pipe WSL path
  - activate script
- `Caption Editor`
  - app-wide default caption template
- `Training`
  - selection snapshot comment toggle
  - training mode
- `Analysis & Appearance`
  - face analysis toggle
  - MediaPipe analysis toggle
  - theme toggle
  - debug mode
- `Advanced JSON`
  - raw config editor for the on-disk JSON

## Caption Template Behavior

- `primer.template` is stored in app config.
- It is only a fallback default.
- Folder-specific `primer.template` inside `.webcap_state.json` still overrides it.
- Blank app-level template means: use the built-in default template.

## Implementation Notes

- Frontend modal logic: `tool/js/app_settings.js`
- Frontend primer-specific UI logic: `tool/js/primer_settings.js`
- Backend config validation / persistence: `tool/server/config.py`
