# Example: Sample Data Structure

This directory demonstrates the MediaWeb data structure. All files are human-readable JSON or standard media formats.

## Directory Structure

```
data/
├── media/                    # Original media files
│   ├── sunset-beach.jpg
│   ├── mountain-view.jpg
│   └── intro-video.mp4
├── meta/                     # Metadata sidecar for each media item
│   ├── sunset-beach.json
│   ├── mountain-view.json
│   └── intro-video.json
├── pages/                    # Page definitions
│   ├── home.json
│   └── about.json
└── tags.json                 # Global tag registry
```

## Sample Files

### tags.json
```json
[
  "landscape",
  "nature",
  "travel",
  "summer",
  "featured",
  "tutorial"
]
```

### meta/sunset-beach.json
```json
{
  "tags": ["landscape", "summer", "featured"],
  "title": "Sunset at the Beach",
  "caption": "Golden hour light reflecting on the ocean",
  "created": "2024-06-15T18:30:00Z",
  "modified": "2025-01-15T10:20:00Z",
  "crop": null,
  "rotation": 0
}
```

### meta/intro-video.json
```json
{
  "tags": ["tutorial", "featured"],
  "title": "Getting Started with MediaWeb",
  "caption": "5-minute introduction to the interface",
  "created": "2024-12-01T09:00:00Z",
  "modified": "2025-01-10T14:15:00Z",
  "crop": null,
  "rotation": null
}
```

### pages/home.json
```json
{
  "id": "page_home_001",
  "title": "Welcome",
  "slug": "home",
  "sections": [
    {
      "id": "section_001",
      "order": 0,
      "blocks": [
        {
          "type": "Text",
          "id": "block_001",
          "order": 0,
          "data": {
            "content": "<h1>Welcome to MediaWeb</h1><p>Your offline-first media management solution.</p>"
          }
        },
        {
          "type": "Gallery",
          "id": "block_002",
          "order": 1,
          "data": {
            "query_id": "featured",
            "layout": "grid"
          }
        }
      ]
    },
    {
      "id": "section_002",
      "order": 1,
      "blocks": [
        {
          "type": "Text",
          "id": "block_003",
          "order": 0,
          "data": {
            "content": "<h2>How It Works</h2><p>All your data is stored locally in human-readable JSON files.</p>"
          }
        }
      ]
    }
  ],
  "created": "2025-01-01T12:00:00Z",
  "modified": "2025-01-20T18:45:00Z"
}
```

## Key Points

- **Human-Editable**: All metadata is JSON, not binary
- **Portable**: Copy the entire `data/` directory anywhere
- **Inspectable**: Open any file in your text editor to see the structure
- **Versionable**: Can be tracked with git
- **No Vendor Lock-in**: Standard formats, nothing proprietary
- **Media Immutable**: Original files in `media/` are never modified
- **Metadata Separate**: Each media item has a corresponding `.json` sidecar

## Metadata Sidecar Pattern

For every file in `media/`, there's a corresponding JSON file in `meta/`:

```
media/my-photo.jpg      → meta/my-photo.json
media/my-video.mp4      → meta/my-video.json
```

This keeps the original files untouched while maintaining rich metadata.
