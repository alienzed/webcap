
## Purpose
Display clip metadata (resolution, duration, frame count) for all media in the current set, instantly and reliably, with zero UI clutter or performance penalty.

## UI/UX
- New rectangular panel in the Review Captions area (matches existing report panels; not collapsible).
- Only visible during review (when the report is shown).
- Lists all clips with:
  - Filename (linked to media if possible, with resolution in parenthesis)
  - For videos:
    - fps (frame rate)
    - Aspect ratio (e.g., 16:9)
    - Size (bytes or MB)
    - Bitrate (kbps or Mbps)
    - Codec (e.g., h264, hevc)
    - Color space (e.g., yuv420p)
    - Duration (seconds, 1 decimal)
    - Frame count
  - For images:
    - Resolution
    - Aspect ratio
    - Size
- Minimal DOM impact: only rendered when the report is visible.

## Backend Implementation
- On folder load/refresh, backend scans all media files in the folder.
- For each file, collects:
  - Filename
  - mtime (modification time)
  - Size (bytes)
- Loads existing `media_metadata.json` (if present).
- For each file:
  - If filename, mtime, and size match an entry in `media_metadata.json`, reuse cached metadata (no ffprobe).
  - If new or changed, run ffprobe to extract resolution, duration, frame count; update cache.
- Writes updated `media_metadata.json` to disk in the folder.
- All logic is in a single backend Python function, triggered on folder load/refresh.


### Example `media_metadata.json` structure:
```json
{
  "ztd2.mp4": {
    "mtime": 1713980000,
    "size": 12345678,
    "resolution": "1920x1080",
    "aspect_ratio": "16:9",
    "duration": 12.3,
    "frame_count": 360,
    "fps": 29.97,
    "bitrate": 1200000,
    "codec": "h264",
    "color_space": "yuv420p"
  },
  "img1.png": {
    "mtime": 1713981000,
    "size": 234567,
    "resolution": "1024x768",
    "aspect_ratio": "4:3"
  }
}
```

### Table Layout (Frontend)

| File (Resolution) | FPS | Aspect | Size | Bitrate | Codec | Color | Duration | Frames |
|-------------------|-----|--------|------|---------|-------|-------|----------|--------|
| ztd2.mp4 (1920x1080) | 29.97 | 16:9 | 12.3 MB | 1200 kbps | h264 | yuv420p | 12.3 | 360 |
| img1.png (1024x768) |     | 4:3   | 229 KB|         |       |       |          |      |

*For images, leave video-only columns blank or omit them.*

## Frontend Implementation
- When the review panel is opened, fetch and parse `media_metadata.json` for the current folder.
- Render the panel using the cached metadata (no async/incremental UI needed).
- If the file is missing or incomplete, show a loading/error message.
- No changes to the main media list or core workflows.

## Performance
- For typical sets (10–20 files), metadata is always ready instantly after folder load.
- For large sets, only new/changed files are probed; all others are instant.
- No incremental UI, no async headaches, no risk of UI chaos.


## Regression Risk & Anticipated Issues
- All complexity is isolated to backend metadata generation and a single new frontend panel.
- No changes to media list, caption logic, or core workflows.
- If media_metadata.json is missing or corrupt, fallback to a loading/error message and prompt for regeneration.
- If ffprobe fails on a file, skip it and log a warning (do not break the panel).
- Always validate field presence and types before rendering.


## Extensibility
- Easy to add more metadata fields in the future (e.g., audio presence, keyframe count).
- Robust to file additions/removals/renames.

----

# Media Metadata Panel in Review Captions

**Status: Implemented (2026-04-28)**

This feature is now complete and available in the Review Captions screen. The panel displays all required metadata fields for each media file, as described below.

----
