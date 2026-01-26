# MediaWeb - Setup & Development Guide

## Quick Start

### Prerequisites

- **Rust 1.70+**: https://rustup.rs/
- **Windows, macOS, or Linux**

### Installation (5 minutes)

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/mediaweb.git
   cd mediaweb
   ```

2. **Run in development mode**
   ```bash
   cargo tauri dev
   ```

3. **On first launch**
   - Click "Choose" in Settings to select or create your data directory
   - Default location: `~/mediaweb/data`

4. **Start using**
   - Upload media files
   - Tag and organize them
   - Create and design pages
   - All changes auto-save to disk

## Project Architecture

### Frontend (`/frontend`)

- **No build step** - served directly from disk
- **Vanilla JavaScript** - no frameworks
- **HTML5 & CSS3** - modern standards
- **Local-first** - works offline

Files:
- `index.html` - Main layout & modals
- `styles.css` - Theme (grey + orange)
- `app.js` - All application logic (~800 lines)

### Backend (`/src`)

Tauri-based Rust commands for:

- **Filesystem I/O** - reading/writing metadata
- **Media scanning** - directory traversal
- **Tag management** - global registry
- **Page persistence** - JSON serialization

Key files:
- `main.rs` - App setup & Tauri handler registration
- `models.rs` - Data structures (Media, Page, Metadata, etc.)
- `commands/` - Command handlers
- `utils.rs` - Helper functions

### Data Model (`/data`)

```
data/
├── media/          # Original files (never modified)
├── meta/           # Metadata sidecars
├── pages/          # Page JSON definitions
└── tags.json       # Global tag list
```

**Why this structure?**
- Media files stay untouched
- Metadata is separate and human-readable
- Pages are portable (include all references)
- Tags are centralized for filtering

## Key Concepts

### Metadata Sidecars

For each file in `media/`, a companion JSON exists in `meta/`:

```
my-photo.jpg        (original, unmodified)
my-photo.json       (metadata: tags, title, caption, timestamps)
```

**Benefits:**
- Original files remain pristine
- Metadata is human-editable
- Easy to version in git
- Portable: move files, JSON follows

### Tag-Based Organization

Tags are flat strings (no hierarchy):

```json
["landscape", "nature", "travel", "summer"]
```

Galleries query by:
- **Any tag** (OR): "Show all landscape OR travel photos"
- **All tags** (AND): "Show photos with landscape AND summer"

### Page Structure

Pages are hierarchical containers:

```
Page ("About Us")
  └─ Section 1
      ├─ Text Block ("Hero heading")
      ├─ Image Block (single photo)
      └─ Gallery Block (query: "team-photos")
  └─ Section 2
      ├─ Text Block ("Bio section")
      └─ Video Block (introduction clip)
```

Each block is self-contained and can be reordered/edited independently.

## Development Workflow

### Adding a Feature

1. **Identify where it belongs:**
   - UI/Logic → `frontend/app.js`
   - Data model → `src/models.rs`
   - File I/O → `src/commands/`
   - Styling → `frontend/styles.css`

2. **For Rust changes:**
   - Edit source files in `src/`
   - Rebuild: `cargo tauri dev` will auto-recompile

3. **For Frontend changes:**
   - Edit `frontend/` files
   - Reload: `Ctrl+R` in dev window
   - Or restart `cargo tauri dev`

4. **Test locally:**
   - Use Settings panel to verify counts
   - Open browser DevTools (`F12`) for console errors
   - Check `data/` directory for file creation

### Building for Distribution

```bash
cargo tauri build
```

Creates:
- **Windows**: `.exe` installer in `src-tauri/target/release/bundle/msi/`
- **macOS**: `.app` and `.dmg` in `src-tauri/target/release/bundle/macos/`
- **Linux**: `.deb` and `.AppImage` in `src-tauri/target/release/bundle/deb/`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Media section |
| `P` | Pages section |
| `S` | Settings section |
| `/` | Focus search |
| `Esc` | Close modal |
| `Ctrl+U` | Upload |
| `Ctrl+N` | New page |
| `Ctrl+S` | Save |
| `Ctrl+Shift+A` | Add section |

## Troubleshooting

### App won't start

**Check Rust installation:**
```bash
rustc --version
cargo --version
```

**Update Rust:**
```bash
rustup update
```

### Data directory won't initialize

- Click "Choose" in Settings
- Ensure the path is writable
- Try a simple path without special characters

### Media files not showing

- Verify files are in `data/media/`
- Check browser console for errors (`F12`)
- Restart the dev server

### Metadata not saving

- Check that `data/meta/` directory exists
- Ensure it's writable
- Restart app and try again

## File I/O Flow

### Uploading Media

1. User selects files in UI
2. `FileReader` reads files (browser)
3. File data stored in `localStorage` (for demo)
4. Metadata JSON created with defaults
5. `data/meta/{id}.json` written
6. Tags updated in `data/tags.json`
7. UI refreshes

### Creating a Page

1. User fills title + slug
2. Creates sections and blocks
3. Each block has data (content, media_id, query_id)
4. `data/pages/{page_id}.json` written on save
5. File is self-contained, portable

### Querying Media

1. Get all metadata files from `data/meta/`
2. Parse each JSON
3. Filter by tag combinations
4. Return matching media IDs
5. Gallery blocks use these at render time

## Customization

### Styling

**Orange & Grey theme** defined in `frontend/styles.css`:

```css
--color-primary-orange: #FF8C42;
--color-grey-medium: #6B7280;
--color-grey-light: #F3F4F6;
```

Edit these CSS variables to rebrand.

### Adding Fields to Metadata

1. Update `MediaMetadata` struct in `src/models.rs`
2. Update form in `frontend/index.html`
3. Update save logic in `frontend/app.js`

Example: Adding "photographer" field

**models.rs:**
```rust
pub struct MediaMetadata {
    // ...existing fields...
    pub photographer: String,
}
```

**index.html:**
```html
<input type="text" id="mediaPhotographer" class="form-input">
```

**app.js:**
```javascript
const metadata = {
    // ...
    photographer: document.getElementById('mediaPhotographer').value,
};
```

## Performance Notes

- **Media grid**: Limited to ~500 items for smooth scrolling
- **Search**: Instant, client-side filtering
- **Pages**: All stored as JSON, loaded on demand
- **Tags**: Loaded once at startup, cached in memory

For larger collections, consider:
- Pagination in media grid
- Lazy-loading pages
- Caching metadata in IndexedDB

## Security

- **No network by default** ✓
- **No authentication needed** ✓
- **Data never leaves the machine** ✓
- **Optional**: Use file encryption for sensitive data

For shared systems, store `data/` in an encrypted folder.

## Future Enhancements

- [ ] Image cropping UI (vs metadata-only)
- [ ] Video trimming UI
- [ ] Drag-to-reorder blocks
- [ ] Query builder UI  
- [ ] HTML export with media bundling
- [ ] Dark mode toggle
- [ ] Batch tagging
- [ ] Full undo/redo stack
- [ ] Plugin system
- [ ] Multi-format import (PSD, SVG, etc.)

## Contributing

Found a bug? Want to add a feature?

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make changes
4. Test thoroughly
5. Submit a pull request

## License

MIT - Use for any purpose, personal or commercial.

## Credits

Built with:
- **Tauri** - Desktop framework
- **Rust** - Backend
- **HTML5/CSS3/JS** - Frontend
- **Designed for offline-first workflows**

---

**Questions?** Open an issue on GitHub.

**Have ideas?** Discussions welcome!
