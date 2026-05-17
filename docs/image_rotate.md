# Image Rotation and Flip

This feature adds image transformation commands to the image context menu.

## UI behavior

- Right click on an image in the media list or preview context menu.
- The context menu should include:
  - `Rotate Left`
  - `Rotate Right`
  - `Flip Vertically`
  - `Flip Horizontally`

## Expected behavior

- `Rotate Left` rotates the selected image 90 degrees counter-clockwise.
- `Rotate Right` rotates the selected image 90 degrees clockwise.
- `Flip Vertically` mirrors the image top-to-bottom.
- `Flip Horizontally` mirrors the image left-to-right.

## Notes

- The feature should be accessible from the same right-click menu used for other image actions.
- The transformation should be applied to the current image file.
- If the image is part of a set folder, the rotation should update the media file and preserve any caption or metadata associations.
