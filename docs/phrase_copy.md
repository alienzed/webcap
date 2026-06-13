# Caption Helper Panel

## Purpose
Provide fast, low-friction caption editing helpers while keeping state per set and minimizing annotation overhead.

## Current UI
- The caption helper is a bottom panel in the editor area.
- Tabs: `Requirements`, `Tags`, `Analysis`, `Metadata`.
- Header actions:
  - `Annotate` toggle: show/hide floating annotate strip.
  - Collapse toggle: collapse helper body to header row only.
  - `X`: close helper panel.

## Annotate Strip Integration
- Annotate groups are derived from:
  - `caption_requirements`
  - `caption_requirement_keywords` (comma-separated per group)
- Group behavior:
  - Clicking a term chip toggles that tag for the current media item.
  - Term chip heat is based on nearby annotated sibling media, not the visible/filtered list.
  - Nearby range is 8% of captioned/tagged siblings, with a 12 item floor and 40 item ceiling.
  - Term chip tooltips show both nearby usage and full-folder usage.
  - Stronger blue chips indicate terms that are common nearby but missing on the current item.
  - Active tags missing from the current caption are highlighted amber, including a group-edge cue.
  - Terms unused in the nearby range get a small novelty dot.
  - Group header pencil opens the per-group term editor modal.
  - `n/a` chip marks group not applicable for the current media item.
  - Heading color reflects group state (complete/incomplete/n-a).

## Persistence
- `caption_phrases`: term catalog.
- `quick_phrases`: active quick phrase list.
- `annotate_strip_visible`: annotate toggle state.
- `caption_helper_panel_collapsed`: helper collapsed/expanded state.

## Notes
- Quick-phrase persistence remains in state for backward compatibility, but the visible helper UI now centers on annotation and tags.
