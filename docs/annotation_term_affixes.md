# Annotation Term Styling

## Purpose
Keep requirement terms compact while still handling natural phrasing:

- wrappers like `on the floor` or `against the wall`
- descriptors like `red floor`, `carpeted floor`, or `patterned blouse`

This avoids exploding groups with every variation of a common base term.

## UX
- Left-click on an annotate chip keeps the existing behavior: toggle the tag on the current item.
- Right-click on an annotate chip opens a small modal with:
  - `Wrapper Prefix`
  - `Wrapper Suffix`
  - `Descriptor Prefix`
  - `Descriptor Suffix`
- The modal preview renders in this order:
  - `wrapperPrefix + descriptorPrefix + term + descriptorSuffix + wrapperSuffix`

## Behavior

### Wrappers
- Wrappers are set-wide.
- Editing a wrapper changes the rendered phrasing for that term across the set.
- Example:
  - term `floor`
  - wrapper prefix `on the`
  - rendered text becomes `on the floor`

### Descriptors
- Descriptors have a set-wide soft default plus per-item snapshots.
- The soft default is the current working value for future items.
- When a tag is added to an item, the current descriptor value is written onto that item.
- When the descriptor is edited while the current item already has that tag:
  - the set-wide soft default updates
  - the current item snapshot also updates
- When the descriptor is edited while the current item does not have that tag:
  - only the soft default updates
- Existing saved item snapshots do not retroactively change when the soft default changes later.

### Caption and primer rendering
- Raw tag storage stays plain and stable.
- Tag insertion uses the rendered text for the current item.
- Tag-scope primer mappings use the rendered text for the current item.
- Tag-match checks also use the current item's rendered text before falling back to the raw tag.

## Storage
- Persist in `.webcap_state.json` as:
  - `caption_term_wrappers`
  - `caption_term_descriptor_defaults`
  - `caption_term_descriptors_by_media`
- `caption_term_affixes` is still written as a legacy mirror of wrappers for compatibility with older state consumers.

### Shape

```json
{
  "caption_term_wrappers": {
    "floor": { "prefix": "on the", "suffix": "" }
  },
  "caption_term_descriptor_defaults": {
    "floor": { "prefix": "red", "suffix": "" }
  },
  "caption_term_descriptors_by_media": {
    "image_001.jpg": {
      "floor": { "prefix": "red", "suffix": "" }
    },
    "image_014.jpg": {
      "floor": { "prefix": "patterned", "suffix": "" }
    }
  }
}
```

## Guardrails
- This is intentionally lightweight.
- No descriptor cleanup is required when tags are removed.
- Wrapper edits are intentionally blunt and set-wide.
- Descriptor snapshots are best-effort and item-local.
