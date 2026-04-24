# Media Metadata Panel Feature

## Overview
Adds a small info panel below the media preview area that displays key media metadata (fps, duration, size, codec, etc.) for the selected media file. This leverages ffprobe (from ffmpeg) on the backend to extract metadata and returns it to the frontend for display.

## Requirements
- On media selection or preview, the backend extracts metadata using ffprobe.
- Metadata includes: duration, resolution, fps, codec, file size, and container format (at minimum).
- Metadata is returned as part of the media/caption load endpoint (or a new endpoint).
- The frontend displays the metadata in a panel below the preview area.
- The panel is always visible when a media file is selected, and updates on selection change.

## Implementation
- **Backend:**
  - Add a function to call ffprobe and parse the output for the required fields.
  - Update the media/caption load endpoint to include a `metadata` field in the JSON response.
- **Frontend:**
  - When selecting media, extract the metadata from the response and render it in a new panel below the preview area.
  - The panel should be styled minimally and not interfere with existing controls.

## Example Metadata JSON
```json
{
  "duration": 12.34,
  "width": 1920,
  "height": 1080,
  "fps": 29.97,
  "codec": "h264",
  "size": 12345678,
  "container": "mp4"
}
```

## UI Example
```
+------------------------------+
|      [Media Preview]         |
+------------------------------+
| Duration: 12.3s  Size: 12MB  |
| Resolution: 1920x1080  FPS: 30|
| Codec: h264  Format: mp4     |
+------------------------------+
```

## Notes
- If metadata extraction fails, the panel should display "N/A" or a suitable fallback for each field.
- This feature is optional for images, but should be shown if available.
