# Image Crop Feature Specification

## Goal

Add a small, explicit crop command for image files so simple aspect-ratio fixes can be done inside WebCap without opening another editor.

This is not a general image-editing workflow. V1 is intentionally bare bones.

## User Flow

- User right-clicks an image file in the media list.
- Context menu shows `Crop...` for image files only.
- A modal opens with the selected image.
- User chooses one hard-coded aspect ratio:
  - Square `1:1`
  - `4:3`
  - `16:9`
  - `9:16`
- User adjusts the crop box.
- User clicks `Apply`.
- WebCap crops the working media file in place.
- Modal closes and the preview refreshes.

## Safety Model

- Crop is an explicit user action from the context menu.
- Crop replaces the current working image file.
- WebCap relies on the existing `originals/` backup model, like deface/reset workflows.
- The original backup behavior should be reused, not reinvented.
- The `.txt` caption sidecar is left unchanged.

## UI Scope

- Use a modal, not permanent preview-pane controls.
- Do not add crop controls to the normal preview pane.
- Do not show crop UI unless the user chooses `Crop...`.
- Keep the modal simple:
  - image area
  - aspect ratio buttons
  - `Apply`
  - `Cancel`
  - minimal status/error text

## Technical Direction

- Use Cropper.js for the browser crop UI.
- Use Pillow for the backend crop operation.
- Add one small backend crop endpoint if needed.
- Reuse existing folder/media path handling where practical.
- Keep crop code isolated so existing preview, caption, prune, reset, and deface behavior stay untouched.

## V1 Non-Goals

- No save-as-copy mode.
- No batch crop.
- No freeform custom ratios.
- No preset management.
- No upscaling.
- No export settings.
- No caption duplication or caption changes.
- No external editor/window handoff.
- No broad preview-pane redesign.

## Expected Edge Cases

- Crop is unavailable for videos and non-image files.
- Cancel closes the modal without changes.
- Failed crop leaves the current file as-is and shows an actionable error.
- Unsupported image formats should fail cleanly rather than guessing.

## Implementation Touchpoints

- `tool/js/main.js`: add `Crop...` to the image context menu.
- `tool/js/crop.js`: modal behavior and Cropper.js lifecycle.
- `tool/tool.html`: include Cropper.js assets and modal markup.
- `tool/css/styles.css`: minimal modal styling.
- `tool/server/app.py`: small crop endpoint.
- Optional small helper if the backend route becomes too large.
