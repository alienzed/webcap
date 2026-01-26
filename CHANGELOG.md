# Changelog

All notable changes to MediaWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-25

### Added

#### Core Features
- ✨ **Offline-first Media CMS** - Complete media management without server
- 📚 **Media Library** - Upload, tag, and organize images & videos
- 🏷️ **Tag-based Organization** - Flat string tags with AND/OR filtering
- 📄 **Page Builder** - Drag-drop pages with sections and blocks
- 💾 **Auto-save** - All changes saved immediately to local files
- ⌨️ **Keyboard Shortcuts** - Power user shortcuts for navigation & editing

#### Media Management
- Upload multiple files at once
- Edit metadata (title, caption, tags)
- Tag-based filtering and search
- Search by title, caption, or filename
- Media type detection (image/video)
- Metadata sidecars (JSON) for all media

#### Page Builder
- Create pages with custom titles and URL slugs
- Organize content in sections
- Support for multiple block types:
  - **Text blocks** - HTML content
  - **Image blocks** - Single media items
  - **Gallery blocks** - Query-based media collections
  - **Video blocks** - Video embeds
- Block editing and deletion
- Real-time page preview

#### UI/UX
- **Grey & Orange theme** - Professional color scheme
- Responsive design (desktop-first)
- Navigation via sidebar
- Modal-based editors
- Real-time search and filter
- Settings panel with database stats

#### Data Format
- **JSON-based storage** - All data is human-editable
- **Metadata sidecars** - One JSON file per media item
- **Portable structure** - Works from any directory
- **Version-control friendly** - Can be tracked with git

#### Keyboard Shortcuts
- `M` - Media section
- `P` - Pages section  
- `S` - Settings section
- `/` - Focus search
- `Esc` - Close modal
- `Ctrl+U` - Upload media
- `Ctrl+N` - New page
- `Ctrl+S` - Save
- `Ctrl+Shift+A` - Add section

#### Documentation
- Comprehensive README
- Installation guide (INSTALL.md)
- Development guide (DEVELOPMENT.md)
- Technical specification (SPEC.md)
- Keyboard shortcuts (SHORTCUTS.md)
- Data format examples (data/EXAMPLE.md)

### Technical Stack
- **Tauri 1.5** - Desktop framework
- **Rust 1.70+** - Backend
- **HTML5/CSS3/ES6 JavaScript** - Frontend
- **Zero dependencies** in frontend (vanilla JS)
- **Minimal Rust dependencies** (tokio, serde, uuid, chrono)

### Infrastructure
- Tauri command handlers for filesystem I/O
- Async Rust operations
- LocalStorage for demo/caching
- JSON serialization for all data

### Browser Support
- Windows 10+ (WebView2)
- macOS 10.13+ (WebKit)
- Linux (GTK/WebKit)

## Roadmap for Future Versions

### v0.2.0 (Planned)
- [ ] Image cropping UI (visual editor)
- [ ] Video trimming UI (timeline editor)
- [ ] Drag-to-reorder blocks
- [ ] Query builder UI (visual query editor)
- [ ] HTML export with media bundling

### v0.3.0 (Planned)
- [ ] Dark mode toggle
- [ ] Batch tagging operations
- [ ] Full undo/redo stack
- [ ] Media preview cache
- [ ] Syntax highlighting in block editor

### v0.4.0+ (Future)
- [ ] Plugin system for extensions
- [ ] Multi-document editing
- [ ] Collaborative sync (via git or cloud)
- [ ] Advanced image filters
- [ ] Template system for pages
- [ ] Import from other CMSs
- [ ] PDF export

## Known Limitations

### Current Version (0.1.0)
- No visual image cropping (metadata-only)
- No visual video trimming (metadata-only)
- No drag-to-reorder (keyboard-based editing)
- Limited to ~500 media items for smooth UI
- No undo/redo (session-based recovery only)
- Block editing via JSON prompt (not visual)
- No built-in sync (manual or git-based)

### By Design
- No database (filesystem-only)
- No server required
- No cloud sync (data stays local)
- No user accounts (single-machine)
- Deleting files = permanent deletion

## Migration Guide

### From v0.0 (Not Released)
N/A - First release.

## Contributors

- [Your Name] - Initial development

## License

MIT - Free for personal and commercial use.

---

**Last updated:** 2025-01-25

For detailed changes, see git commit history.
