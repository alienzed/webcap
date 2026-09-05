# Authoritative Frame Scrubbing

The Clip modal uses normal browser playback for quick navigation and resolves decoded source frames only when precision is needed. Browser time is never used as frame identity.

## Workflow

1. In `src_videos`, use `-5s` / `+5s` for coarse navigation. Those buttons are intentionally absent for normal set videos.
2. Use `◀ 1f` or `1f ▶` to move by authoritative decoded-frame index. On a fresh modal, either button first resolves the browser playhead (including `0`) and then moves to its adjacent decoded frame.
3. **Extract Frame…** pauses playback, resolves the authoritative frame at the current position, and shows its native decoded PNG over the main stage. The transport then shows `Frame N · time` with **Add to Set** and **Cancel**. Frame stepping refines that candidate.
4. **Mark Start** commits the currently viewed exact frame. It is separate from the current candidate: later stepping does not change it, while manual start edits or timeline moves invalidate it.
5. Exact export verifies the source fingerprint, trims with `trim=start_frame=N`, resets timestamps with `setpts=PTS-STARTPTS`, then crops. The committed source frame `N` is output video frame 0.

## Crop

Choose one of `1:1`, `4:3`, `9:16`, or `16:9` to make it the pending output aspect ratio and open crop placement. Cropper changes update the pending crop live. Click the selected ratio again to finish placement; click it later to reopen it. A subtle ratio indicator marks a supported source-native aspect ratio, but it is not a required crop choice.

## Extracted images

**Add to Set** saves the authoritative native-resolution source PNG, ignoring the Clip crop, and copies the source caption sidecar when present. The default name is collision-safe in form (for example, `g12-frame-0018.png`); existing images or captions are rejected rather than overwritten.

For a video opened directly from `src_videos`, the image is saved in the parent set folder. For a normal set video, it is saved in the current folder. Extraction and exact export both fail visibly if the source changes after frame inspection.

## Non-goals

- FPS-derived browser frame stepping.
- Frame-rate normalization, model-specific video behavior, or training-bundle changes.
- Bulk extraction, automatic best-frame selection, or general video editing.
