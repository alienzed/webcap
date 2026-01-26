# MediaWeb - Local-First Media CMS + Page Builder

A portable, offline-first application for managing images/videos and composing simple HTML pages. Built with **Tauri**, **Rust**, and **vanilla JavaScript** — no database, no server, entirely local.

## Features

✨ **Offline-First**
- Works entirely on local files
- No network access required
- Data remains human-editable (JSON format)

📚 **Media Management**
- Upload and organize images and videos
- Tag-based organization and filtering
- Metadata storage (title, caption, timestamps)
- Basic editing: crop, rotate (images), trim (videos)

📄 **Page Builder**
- Drag-and-drop page layout composition
- Hierarchy: Pages → Sections → Blocks
- Block types: text, image, gallery, video
- Inline editing with keyboard shortcuts
- Gallery blocks resolve queries at render time

🏷️ **Tagging & Queries**
- Flat string tags (no enforced hierarchy)
- Filter media by tag combinations
- Save queries for reuse in galleries

💾 **Auto-Save**
- Automatic saves to disk
- Session-limited undo
- No proprietary formats

## Project Structure

```
mediaweb/
├── src/                          # Rust backend
│   ├── main.rs                   # Main app entry, Tauri setup
│   ├── models.rs                 # Data models
│   ├── utils.rs                  # Utilities
│   └── commands/                 # Tauri commands
│       ├── filesystem.rs         # Directory initialization
│       ├── media.rs              # Media operations
│       ├── tags.rs               # Tag management
│       └── pages.rs              # Page operations
├── frontend/                     # Web UI (vanilla JS)
│   ├── index.html                # Main layout
│   ├── styles.css                # Styling (grey + orange theme)
│   └── app.js                    # Application logic
├── data/                         # User data (created on first run)
│   ├── media/                    # Original assets
│   ├── meta/                     # JSON sidecars for each media item
│   ├── pages/                    # HTML pages
│   └── tags.json                 # Global tag registry
├── Cargo.toml                    # Rust dependencies
└── tauri.conf.json               # Tauri configuration
```

## Data Model

### Media Metadata (`data/meta/{filename_hash}.json`)

```json
{
  "tags": ["landscape", "summer"],
  "title": "Mountain Vista",
  "caption": "Beautiful mountain landscape",
  "created": "2025-01-01T10:00:00Z",
  "modified": "2025-01-15T14:30:00Z",
  "crop": null,
  "rotation": 0
}
```

### Pages (`data/pages/{page_id}.json`)

```json
{
  "id": "page_abc123",
  "title": "About Us",
  "slug": "about-us",
  "sections": [
    {
      "id": "section_def456",
      "order": 0,
      "blocks": [
        {
          "type": "Text",
          "id": "block_ghi789",
          "order": 0,
          "data": { "content": "<h1>Our Story</h1>" }
        },
        {
          "type": "Gallery",
          "id": "block_jkl012",
          "order": 1,
          "data": { "query_id": "team-photos", "layout": "grid" }
        }
      ]
    }
  ],
  "created": "2025-01-10T12:00:00Z",
  "modified": "2025-01-20T18:45:00Z"
}
```

### Saved Queries (`queries.json` - optional)

```json
[
  {
    "id": "query_abc",
    "name": "Summer Photos",
    "tags": ["summer", "landscape"],
    "match_all": false
  }
]
```

## Getting Started

### Prerequisites

- Rust 1.70+ ([Install](https://rustup.rs/))
- Node.js 16+ (optional, for frontend tools)

### Installation

1. **Clone and enter the project**
   ```bash
   cd mediaweb
   ```

2. **Set up data directory**
   - First launch will prompt you to select/create a data directory
   - Default: `~/mediaweb/data`

3. **Run the app**
   ```bash
   cargo tauri dev
   ```

   Or build for distribution:
   ```bash
   cargo tauri build
   ```

## Usage

### Media Management
1. **Add Media**: Click "Add Media" button and select files
2. **Edit Metadata**: Click any media item to edit title, caption, and tags
3. **Filter**: Use search or click tag names to filter
4. **Tags**: Tags are automatically indexed and appear in the filter UI

### Page Builder
1. **Create Page**: Click "New Page" in the Pages section
2. **Add Sections**: Click "+ Add Section"
3. **Add Blocks**: Click "+ Add Block" within a section
4. **Edit Content**: Click blocks to edit inline
5. **Reorder**: Drag blocks to reorder (implementation planned)
6. **Save**: Auto-save on every change

### Export & Sharing
- Pages can be exported as static HTML files
- Gallery blocks resolve media from local files at render time
- All data remains readable and editable as JSON files

## Architecture

### Backend (Rust + Tauri)

Tauri commands handle:
- File system operations (read/write metadata)
- Media scanning and validation
- Image processing (crop, rotate)
- Video operations (non-destructive trim metadata)

### Frontend (Vanilla JS)

No build step required. Features:
- Keyboard-first navigation
- Real-time filter and search
- Modal-based editor UX
- LocalStorage for session state
- Direct file operations via Tauri

### Data Persistence

- **All data is local JSON/files**
- Metadata sidecars keep media immutable
- Pages are self-contained HTML documents
- No hidden state, fully inspectable
- Can be synced with git/cloud tools

## Roadmap

- [ ] Image cropping UI
- [ ] Video trimming UI
- [ ] Drag-to-reorder blocks
- [ ] Query builder UI
- [ ] HTML export with media bundling
- [ ] Dark mode
- [ ] Batch operations on media
- [ ] Undo/redo (session-based)

## Design

**Theme**: Grey (#6B7280) + Orange (#FF8C42)

- Clean, minimal interface
- Keyboard shortcuts for power users
- No unnecessary chrome or animations
- Responsive design (desktop-first)

## Constraints

- ✅ Works entirely offline
- ✅ No database required
- ✅ No server needed
- ✅ All data human-editable
- ✅ No proprietary formats
- ✅ Portable (works from any directory)
- ⚠️ Deleting a file = deleting content (by design)

## License

MIT

## Contributing

This is a personal project, but feel free to fork and adapt for your needs!

---

**Built with ❤️ for creative professionals and minimalists.**
