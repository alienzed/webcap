# MediaWeb Technical Specification

## Overview

MediaWeb is a local-first Media CMS + Page Builder built with Tauri, Rust, and vanilla JavaScript.

**Core Principle:** All data lives in human-editable JSON files. No database. No server. No lock-in.

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Tauri Desktop App                      │
├──────────────────────────┬──────────────────────────────┤
│  Frontend (Web UI)       │  Backend (Rust)              │
│  ├─ index.html           │  ├─ main.rs                  │
│  ├─ styles.css           │  ├─ models.rs                │
│  └─ app.js (~800 lines)  │  └─ commands/                │
│                          │      ├─ filesystem.rs        │
│                          │      ├─ media.rs             │
│                          │      ├─ tags.rs              │
│                          │      └─ pages.rs             │
├──────────────────────────┴──────────────────────────────┤
│              Filesystem (User's Local Disk)              │
│  data/                                                   │
│  ├─ media/       (original files, untouched)            │
│  ├─ meta/        (JSON sidecars)                        │
│  ├─ pages/       (page definitions)                     │
│  └─ tags.json    (global tag registry)                  │
└─────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Technology |
|-------|-----------|
| **Desktop App** | Tauri 1.5 |
| **Backend** | Rust 1.70+ |
| **Frontend** | HTML5, CSS3, ES6 JavaScript |
| **Rendering** | WebKit (platform native) |
| **Data Format** | JSON, standard media files |
| **IPC** | Tauri Command Bus |

## Data Models

### Media

```rust
pub struct Media {
    pub id: String,
    pub filename: String,
    pub media_type: String,  // "image" | "video"
    pub size: u64,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
}
```

**Storage:** `data/media/{filename}`

### MediaMetadata

```rust
pub struct MediaMetadata {
    pub tags: Vec<String>,
    pub title: String,
    pub caption: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    pub crop: Option<CropData>,
    pub rotation: Option<i32>,
}

pub struct CropData {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
```

**Storage:** `data/meta/{media_id}.json`

**Format:**
```json
{
  "tags": ["landscape", "summer"],
  "title": "Mountain Vista",
  "caption": "Beautiful mountain landscape at sunrise",
  "created": "2025-01-15T10:00:00Z",
  "modified": "2025-01-20T14:30:00Z",
  "crop": null,
  "rotation": 0
}
```

### Page

```rust
pub struct Page {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub sections: Vec<Section>,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
}

pub struct Section {
    pub id: String,
    pub order: u32,
    pub blocks: Vec<Block>,
}

pub enum Block {
    Text { id, order, content: String },
    Image { id, order, media_id, caption },
    Gallery { id, order, query_id, layout },
    Video { id, order, media_id, caption },
}
```

**Storage:** `data/pages/{page_id}.json`

**Format:**
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

### Tags Registry

**Storage:** `data/tags.json`

**Format:**
```json
[
  "landscape",
  "nature",
  "travel",
  "summer",
  "tutorial"
]
```

## API Specification

### Tauri Commands

Commands are async Rust functions exposed to the frontend via `invoke`.

#### filesystem::init_data_directory

```rust
#[tauri::command]
async fn init_data_directory(data_path: String) -> Result<(), String>
```

Creates the data directory structure:
- `media/`
- `meta/`
- `pages/`
- `tags.json` (empty array)

#### media::get_media_list

```rust
#[tauri::command]
async fn get_media_list(data_path: String) -> Result<Vec<Media>, String>
```

Returns all media items in `data/media/`.

#### media::get_media_metadata

```rust
#[tauri::command]
async fn get_media_metadata(data_path: String, media_id: String) 
    -> Result<MediaMetadata, String>
```

Returns metadata for a specific media item, or default if not found.

#### media::update_media_metadata

```rust
#[tauri::command]
async fn update_media_metadata(
    data_path: String, 
    media_id: String, 
    metadata: MediaMetadata
) -> Result<(), String>
```

Writes metadata to `data/meta/{media_id}.json`.

#### media::query_media

```rust
#[tauri::command]
async fn query_media(
    data_path: String, 
    tags: Vec<String>, 
    match_all: bool
) -> Result<Vec<Media>, String>
```

Filters media by tags:
- `match_all: true` → AND (all tags must match)
- `match_all: false` → OR (any tag matches)

#### tags::get_all_tags

```rust
#[tauri::command]
async fn get_tags(data_path: String) -> Result<Vec<String>, String>
```

Returns all tags from `data/tags.json`.

#### pages::get_pages

```rust
#[tauri::command]
async fn get_pages(data_path: String) -> Result<Vec<Page>, String>
```

Returns all pages from `data/pages/`.

#### pages::get_page

```rust
#[tauri::command]
async fn get_page(data_path: String, page_id: String) 
    -> Result<Page, String>
```

Returns a specific page.

#### pages::save_page

```rust
#[tauri::command]
async fn save_page(data_path: String, page: Page) -> Result<(), String>
```

Writes page to `data/pages/{page_id}.json`.

#### pages::delete_page

```rust
#[tauri::command]
async fn delete_page(data_path: String, page_id: String) 
    -> Result<(), String>
```

Deletes `data/pages/{page_id}.json`.

## Frontend Architecture

### Application Class

```javascript
class MediaWeb {
    constructor() {
        this.dataPath: String
        this.media: Array<Media>
        this.pages: Array<Page>
        this.tags: Array<String>
        this.currentEditor: EditorState | null
        
        this.init()
    }
    
    init()
    setupEventListeners()
    loadData()
    // ... all methods
}
```

**Lifecycle:**
1. Constructor creates instance
2. `init()` → `setupEventListeners()` → `loadDataPath()`
3. If dataPath set → `loadData()` → render sections
4. User interactions trigger methods
5. Methods update DOM and call `saveToDisk()`

### Storage Strategy

**SessionStorage:**
- Current section view
- Modal state
- Editor state

**LocalStorage:**
- Data path (user's choice)
- Media list
- Pages list
- Tags list
- Metadata for each media item
- File data (base64 for demo)

**Filesystem (via Tauri):**
- All permanent data (in production)
- JSON files in `data/` directory

### State Management

**No framework**, pure state in class properties:

```javascript
this.media = [
    { id: "abc", filename: "photo.jpg", ... },
    { id: "def", filename: "video.mp4", ... }
]

this.pages = [
    { id: "page1", title: "Home", sections: [...] },
    { id: "page2", title: "About", sections: [...] }
]

this.tags = ["landscape", "nature", "travel"]
```

**Renders happen on:**
- User actions (click, input, etc.)
- Command completion (data loaded)
- Modal state change (open/close editor)

### Event Handling

**Navigation:** `nav-item` clicks
```javascript
.nav-item → click → switchSection(id) → 
  update nav active state → 
  update section active state → 
  render section data
```

**Keyboard:** Global `keydown` listener
```javascript
Ctrl+U → click upload button
Ctrl+S → save current editor (media or page)
Ctrl+N → new page
```

**Search/Filter:** Input with debounce
```javascript
input#searchMedia → filterMedia() →
  re-render media grid with matches
```

**Modal:** Backdrop click or button click
```javascript
button.btn-close → closeModal() →
  remove active class →
  clear editor state
```

## File I/O Operations

### Directory Structure

```
data/
├── media/                   # Original files (user uploaded)
│   ├── sunset.jpg
│   ├── mountain.png
│   └── tutorial.mp4
├── meta/                    # Metadata sidecars
│   ├── sunset.json
│   ├── mountain.json
│   └── tutorial.json
├── pages/                   # Page definitions
│   ├── home.json
│   ├── about.json
│   └── gallery.json
└── tags.json               # Global tag registry
```

### Upload Flow

1. **User selects files** in file input
2. **Browser reads files** using FileReader
3. **Demo: Store in localStorage** (base64)
4. **Create media object** with metadata
5. **Create metadata JSON** with defaults
6. **Write to disk** (or localStorage in demo)
7. **Update tags.json** if new tags
8. **Re-render media grid**

### Page Save Flow

1. **User edits page** (title, slug, sections, blocks)
2. **Click Save** button
3. **Serialize page to JSON**
4. **Write to disk:** `data/pages/{page_id}.json`
5. **Update pages list**
6. **Re-render pages list**
7. **Close editor**

### Query Flow

1. **User selects tags** in filter
2. **Call query_media(tags, match_all)**
3. **Rust: Read all metadata files**
4. **Rust: Filter by tag logic**
5. **Return matching media IDs**
6. **Frontend: Re-render grid with matches**

## Styling System

### Theme Variables

```css
--color-primary-orange: #FF8C42
--color-primary-orange-dark: #E67E3C
--color-grey-dark: #1F2937
--color-grey-medium: #6B7280
--color-grey-light: #F3F4F6
--color-white: #FFFFFF
--color-success: #10B981
--color-danger: #EF4444
--color-border: #E5E7EB
```

### Component Hierarchy

```
app                          (flex container)
├── sidebar                  (240px, fixed)
│   ├── logo                 (brand)
│   ├── nav-menu             (3 items)
│   └── sidebar-footer       (about button)
└── main-content             (flex 1)
    ├── section.active       (section)
    │   ├── section-header
    │   ├── filters/search
    │   └── media-grid / pages-list / settings
    └── modals (overlay)
        ├── mediaEditorModal
        └── pageEditorModal
```

### Responsive Design

**Breakpoint: 768px**
- On smaller screens: sidebar collapses
- Nav icons only (text hidden)
- Media grid: smaller cells
- Page editor: single column

## Performance Considerations

### Client-Side
- **Search**: Real-time filtering (O(n) on each keystroke)
- **Grid rendering**: Limited to visible items (no virtual scrolling yet)
- **Tags**: Loaded once at startup, cached in memory
- **LocalStorage limit**: ~5-10 MB per browser (fine for ~500 media items)

### Optimization Opportunities
- Virtual scrolling for large media grids
- Lazy-load page metadata
- IndexedDB for larger datasets
- Web Workers for heavy operations

### Limits
- **Media count**: ~500 items before UI slowdown (depends on hardware)
- **File size**: Browser limit ~2 GB per file
- **Page size**: No practical limit (entire page in memory)

## Security Model

### Threat Model

**In Scope:**
- Malicious files uploaded (handled by file type detection)
- Data loss (user is responsible for backups)

**Out of Scope:**
- Network attacks (no network)
- Multi-user authentication (single-machine)
- Encrypted data (user's responsibility)

### Permissions

**Tauri Allowlist:**
```json
{
  "fs": { "all": true },        // Read/write entire filesystem
  "path": { "all": true },       // Path manipulation
  "shell": { "open": true }      // Open external links
}
```

**Implications:**
- App can read/write any file
- Ensure user trusts the application
- No sandboxing (by design)

## Testing Strategy

### Unit Tests

**Rust:**
```bash
cargo test
```

Tests for:
- File I/O operations
- JSON serialization
- Tag filtering logic

**JavaScript:**
- No framework, so manual testing
- Browser console for debugging

### Integration Tests

Manual testing workflow:
1. Create data directory
2. Upload various media types
3. Tag and filter
4. Create pages with all block types
5. Save and reload
6. Verify files exist and are readable

### Performance Testing

```bash
# Load test with many media items
for i in {1..500}; do
    cp sample.jpg data/media/photo_$i.jpg
    echo '{"tags":[]}' > data/meta/photo_$i.json
done
```

Monitor:
- Grid render time
- Filter responsiveness
- Memory usage

## Deployment

### Distribution

**Tauri Build Output:**
```
src-tauri/target/release/bundle/
├── msi/           (Windows installer)
├── macos/         (macOS app bundle)
└── deb/           (Linux installer)
```

**Publishing:**
- GitHub Releases (recommended)
- Package managers (optional)

### Version Management

```
version = "0.1.0"  // Cargo.toml & tauri.conf.json
```

Increment on:
- Major: Breaking changes (0.x.0)
- Minor: New features (x.0.0)
- Patch: Bug fixes (x.x.0)

### Update Strategy

**No built-in auto-updater** (by design):
- User downloads new version manually
- Data directory untouched
- Backward compatible file formats

## Future Extensions

### Plugin System

Allow users to extend with:
```javascript
MediaWeb.plugins.register('imageFilter', customFilter)
MediaWeb.plugins.invoke('imageFilter', media)
```

### Export Formats

```javascript
// Export page as static HTML
exportPageAsHTML(pageId) → {
    create page.html
    bundle media inline
    save to disk
}
```

### Collaborative Features

```javascript
// Multi-user sync (optional)
syncWithGit(dataPath) → {
    commit changes
    push to repo
    merge conflicts
}
```

### Advanced Editing

```javascript
// Image cropping UI
openImageEditor(mediaId) → {
    canvas + crop tool
    save crop metadata
}

// Video trimming
openVideoEditor(mediaId) → {
    timeline + trim tool
    save trim metadata
}
```

## Glossary

| Term | Definition |
|------|-----------|
| **Media** | An image or video file |
| **Metadata** | JSON sidecar with tags, title, caption, timestamps |
| **Page** | A document containing sections and blocks |
| **Section** | A container for blocks within a page |
| **Block** | A unit of content (text, image, gallery, video) |
| **Tag** | A flat string label for organizing media |
| **Query** | A filter by tag(s) to find matching media |
| **Tauri** | Desktop framework combining Rust + web tech |
| **IPC** | Inter-Process Communication (Tauri command bus) |
| **Sidecar** | Metadata file alongside a media file |

---

**This specification is living documentation.** Update as the project evolves.
