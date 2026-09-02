# Authoritative Frame Scrubbing

## Status

Implemented Clip workflow. Browser-based frame-sized nudging remains available
for quick orientation; the explicit exact-frame controls provide the
authoritative selection/export path described below.

## Implemented Behavior

- **Check Frame** resolves the first decoded source frame at or after the
  browser playhead through `ffprobe`, displays an FFmpeg-decoded PNG preview,
  and records its zero-based decoded-frame index and presentation timestamp.
- **Exact Prev** and **Exact Next** navigate by decoded-frame index. Frame
  timestamp lists are cached only in memory, keyed by the source's normalized
  path, size, and high-resolution modification time, and retain at most eight
  source files.
- **Use Exact Start** attaches the selected frame index and opaque fingerprint
  to the pending export. The export worker rechecks the fingerprint immediately
  before it runs; a changed source fails visibly and must be checked again.
- Exact export trims video with `trim=start_frame=N`, resets timestamps, then
  applies the crop. Audio is trimmed from the selected frame timestamp and
  re-encoded for alignment. Ordinary timestamp-based exports remain available.

## Problem

An HTML video element can only seek by time. Using the reported frame rate to move `currentTime` by one nominal frame is useful for navigation, but it cannot prove which decoded source frame is displayed or guarantee that an export begins with that frame. Variable-frame-rate media makes an FPS-derived calculation especially unsuitable as an authoritative frame identity.

The desired workflow is:

- Check the frame near the browser's current position.
- Show the exact frame decoded from the source file.
- Move backward or forward by exactly one decoded frame at a time.
- Select that frame as the clip start.
- Guarantee that the selected frame is the first video frame in the export.

## Implementation Boundary

Keep the browser player as the fast, approximate navigation surface. Make ffprobe/FFmpeg authoritative only after the user chooses `Check Frame`.

The client should not attempt to prove frame identity. It should retain and return an opaque server result containing at least:

- decoded frame index
- presentation timestamp
- source fingerprint

The source fingerprint should identify the unchanged source file, initially with normalized path, size, and high-resolution modification time. Export must fail loudly and require another frame check if the source no longer matches.

## Workflow

1. `Check Frame` sends the browser's approximate time to the backend.
2. The backend uses ffprobe frame data to resolve that time to a decoded frame, then uses FFmpeg to return a PNG preview plus its frame index and presentation timestamp.
3. Previous and Next request frame index `N - 1` or `N + 1`. The backend returns the exact decoded frame and updated identity.
4. `Use as Start` copies that authoritative identity into the pending clip export. The browser may seek to its timestamp for orientation, but the video element remains only a preview.
5. Export verifies the source fingerprint and trims video by frame index, not only by timestamp.

No persistent directory of extracted frames is required. Individual previews can be piped from FFmpeg on demand. A short-lived frame timestamp/index cache keyed by source fingerprint may make repeated navigation practical without changing the file-based product model.

## Export Guarantee

The current timestamp-based `-ss startSec` export path is not sufficient to guarantee the first decoded output frame.

For an authoritative start, the video filter chain should trim by decoded input frame index, conceptually:

```text
trim=start_frame=N,setpts=PTS-STARTPTS
```

Crop and other video filters would follow that trim. This favors correctness over seek speed and may require decoding from earlier in a long source. Timestamp-assisted optimization should only be added if it preserves and verifies the selected frame identity.

Audio cannot share a video frame index. It should be trimmed from the selected frame's real presentation timestamp and have its timestamps reset. Exact video-frame start and audio alignment are separate guarantees; retaining stream-copy audio may not be compatible with precise alignment, so this path may require audio re-encoding.

## Backend Shape

Keep the feature localized:

- A helper in `tool/server/` owns frame inspection and normalized results.
- One route checks an approximate time or an explicit adjacent frame index and returns the preview and authoritative identity.
- The existing clip export accepts the authoritative frame identity when present and uses the exact trim path.
- Backend errors, stale fingerprints, out-of-range frame requests, and FFmpeg failures remain visible failures.

The backend response should be app-shaped rather than exposing raw ffprobe records.

## Deferred Questions

- Whether the initial time maps to the nearest frame or the first frame whose presentation timestamp is at or after that time.
- Whether an in-memory frame index is sufficient for very long sources or a small sidecar cache is justified.
- Which audio codec and alignment policy should replace stream copy for authoritative exports.
- Whether authoritative start selection should remain an explicit opt-in or eventually replace the normal start control.

## Non-Goals

- Extracting the entire video into individual frame files.
- Pretending browser `currentTime` is frame-accurate.
- Building a general-purpose video editor.
- Adding frame-analysis infrastructure before this workflow is resumed.
