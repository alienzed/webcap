# Authoritative Frame Scrubbing

The Clip modal combines normal HTML video playback with server-resolved decoded frames. Browser playback and its native scrubber are the quick, approximate navigation path; WebCap only resolves an exact frame when the user asks for precision.

## Workflow

1. Use the video player or `-5s` / `+5s` to navigate approximately.
2. **Preview Frame** resolves the decoded source frame at the browser playhead. WebCap displays its FFmpeg-decoded PNG directly over the main video stage and aligns the player to that frame's presentation timestamp.
3. `◀ 1f` and `1f ▶` move by authoritative decoded frame index. From normal video mode, they first resolve the current playhead, then step from that decoded frame.
4. **Mark Start** commits the current exact frame. Stepping to another candidate frame does not clear the committed start; manually changing the start boundary does.
5. Exact export verifies the source fingerprint, trims with `trim=start_frame=N`, resets timestamps with `setpts=PTS-STARTPTS`, then crops. The committed source frame `N` is therefore output video frame 0.

## Current Frame extraction

**Extract Frame** becomes available only while an exact frame is active. It saves the authoritative, native-resolution source PNG—not the browser image, stage preview, or Clip crop—as an ordinary set image. The source video caption sidecar is copied when present.

When the video is open from a direct `src_videos` child, the new image is added to its parent set folder, matching Clip export behavior. Otherwise it is added to the current folder. Existing image names are rejected rather than overwritten.

Frame identity includes a source fingerprint based on the normalized path, size, and modification time. A changed source invalidates an inspected frame: Preview, extraction, and exact export fail visibly until the frame is resolved again.

## Non-goals

- Browser-FPS-derived frame identity or stepping.
- A second decoded-frame preview outside the main video stage.
- Frame-rate normalization, model-specific video handling, or training-bundle changes.
- Bulk frame extraction or automatic best-frame selection.
