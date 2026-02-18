# MediaTool – Lean Specification

## Purpose

MediaTool is a standalone desktop utility for managing AI-generated images and short videos, tagging them, organizing them into simple pages, exporting Bootstrap HTML, and preparing LoRA training datasets.

This tool prioritizes simplicity, stability, portability, and usability over architectural complexity or UI polish.

---

## Core Constraints

- Single-file application: `main.py`
- Desktop UI using Tkinter (`ttk`)
- SQLite for persistence (`sqlite3`)
- Media stored in `media/`
- Exports stored in `export/`
- Database file: `media.db`
- Runs with: `python main.py`
- No web server
- No Flask
- No REST APIs
- No browser-based UI
- No plugin system
- No multi-module architecture
- No build step
- Clone-and-run simplicity

---

## Allowed Dependencies

- Pillow (for image cropping)
- FFmpeg (system-installed, for video clipping via subprocess)
- send2trash (for safe OS-level file deletion)

No additional dependencies unless explicitly added to this document.

---

## V1 Features (Core)

### 1. Media Management

- Import media (copy into `media/`)
- In V1, only `filename` is stored in the media table.
- Additional metadata (size, type, timestamps, EXIF, etc.) is not required.
- Delete media:
  - Moves file to OS recycle bin using `send2trash`
  - Database record is removed only after successful trash operation
  - Related records in `media_tags` and `page_items` are also removed

### 2. Tag Management

- Create tags
- Many-to-many relationship between media and tags
- Filter media by tag

### 3. Pages

- Create named pages
- Add media to page
- Media are added to pages in append order
- Reordering is not supported in V1

### 4. Export

- Export operates on one page at a time
- Batch export is not supported
- Uses Bootstrap CDN
- Renders media in simple `col-md-4` grid layout
- Uses relative paths to `../media/filename`
- Generates standalone HTML file in `export/`

---

## V2 Features

### 5. Image Cropping

- Implemented using Pillow
- Supported aspect ratios:
  - 1:1
  - 4:3
  - 16:9
  - 9:16
- Ratio is locked during crop
- Cropping produces a new file (never overwrites original)
- Cropped file is inserted into database

### 6. Video Clipping

- Extract preview frames into a temporary directory
- Frame selection is performed by clicking extracted frame thumbnails (start frame and end frame)
- Numeric frame entry is not required
- Frame rate is determined using FFmpeg during extraction
- Frame index is converted to timestamp
- Clip is re-encoded using FFmpeg for accurate trimming
- Result is saved as a new file
- New clip is inserted into database
- Temporary preview frames are deleted immediately after clip creation or if operation is cancelled
- No embedded video playback engine
- Users may open video in system default player for reference

---

## Non-Goals

- No embedded video player
- No real-time timeline editing
- No advanced video editing
- No transcoding tools beyond clipping
- No format conversion utilities
- No GPU acceleration
- No theme engine
- No cloud integration
- No user authentication
