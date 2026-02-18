# MediaWeb Python Webapp

## 1. Purpose & Scope
MediaWeb is a lightweight, cross-platform web application for managing, tagging, and arranging media files (images, videos, text) into simple HTML-based collages or pages. The app is designed for maximum portability, minimal dependencies, and modular extensibility.

## 2. Guiding Principles
- Minimal Dependencies: The core app should rely only on Python’s standard library and a minimal web framework (Flask or FastAPI).
- Modularity: Core features are separated from optional extensions. Extensions/add-ons must not affect the stability or footprint of the core app.
- Simplicity: Codebase is easy to understand, maintain, and refactor. UI is functional, not overengineered.
- Portability: Runs on Linux and Windows (and macOS) with any Python 3.x install. Distributed as a zippable folder; run with python main.py.

## 3. Core Features (Version 1)
- File Management: Upload/import media files (images, videos, text). Organize files using tags (stored in JSON, not a database). Move unwanted files to a “trash” folder (not immediate delete).
- Media Screens: Browse, filter, and view media files by tag. Basic screens for displaying media and metadata.
- HTML Page/Canvas: Arrange media and text into a simple HTML “canvas.” Export collages/pages as standalone HTML files. View/export HTML pages within the app.
- Filesystem-based Storage: All data (tags, metadata) stored as JSON files and folders. No database; structure mirrors the filesystem.

## 4. Optional Features (Version 2+)
- Image/Video Editing: Modular extensions for cropping, clipping, delogo, blurring, flipping, rotating, stabilizing. Only included if stable and dependency-light; otherwise, kept as separate modules.
- Other Extensions: Any feature with heavy dependencies or unstable behavior is a candidate for pruning or separation.

## 5. Architecture Overview
### 5.1. Backend (Python)
- Framework: Flask (or FastAPI, if async needed)
- Responsibilities: Serve static files (JS, CSS, images). Provide REST API for file/tag management, HTML export. Handle file uploads, tagging, trash logic. Generate/export HTML pages.

### 5.2. Frontend (HTML/JS/CSS)
- Reuse existing JS/CSS from Tauri app
- Responsibilities: UI for file upload, tagging, browsing, canvas/page creation. Communicate with backend via API calls. Render media screens and HTML canvas.

### 5.3. Folder Structure
mediaweb.py/
│
├── main.py            # Python backend entry point
├── static/            # JS, CSS, images (copied from frontend/)
├── templates/         # HTML files (copied from frontend/)
├── data/              # JSON, media, trash, etc.
├── extensions/        # Optional add-ons (editing, etc.)
└── requirements.txt   # Minimal dependencies (Flask)

## 6. Modularity & Extensibility
- Core app: Only core features, minimal dependencies.
- Extensions: Placed in extensions/ folder. Loaded optionally; do not affect core stability. Must be dependency-light and stable, or kept separate.

## 7. Distribution & Portability
- Zippable folder: User downloads/extracts folder, runs python main.py. App opens in browser (localhost).
- No installer required.
- No database required.

## 8. UI Design
- Functional, not fancy.
- Simple navigation: File upload/import, Tag management, Media browsing, Canvas/page creation/export

## 9. Maintenance & Refactoring
- Codebase is modular and easy to prune.
- Features with excessive dependencies or instability are removed or separated.
- Clear separation between core and extensions.
