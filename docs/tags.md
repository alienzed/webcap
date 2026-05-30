# Item Tags

## Purpose

Item tags provide lightweight per-media annotations that are distinct from captions, checklist requirements, and flags.

- Scope: per media item in the current folder.
- Storage: persisted in `.webcap_state.json` under `caption_tags_by_media`.
- UI:
  - add tags through the `Tags` helper input (`Add/search tag...`)
  - remove tags from the `Tags` panel list for the selected item

## Behavior

- Tags are stored as a list for each media filename key.
- Filter includes tags in addition to filename and caption text.
- Tag text is normalized (trimmed; duplicate tags are ignored case-insensitively).
- Selecting a tag in the `Tags` panel applies that tag to the filter input.

## Metadata Display

The Item Details panel also shows read-only metadata for the selected media item.

- Metadata source: `/fs/media_metadata` for the current folder.
- Display policy: only non-empty fields are shown.
- Typical fields: resolution, size, duration, fps, frames, bitrate, codec, aspect, color.
