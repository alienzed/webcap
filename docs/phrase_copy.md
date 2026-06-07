# Phrase Helper Panel

## Purpose
Provide fast, low-friction caption editing helpers while keeping state per set and minimizing annotation overhead.

## Current UI
- The caption helper is a bottom panel in the editor area.
- Tabs: `Requirements`, `Phrases`, `Tags`, `Metadata`.
- Header actions:
  - `Annotate` toggle: show/hide floating annotate strip.
  - Collapse toggle: collapse helper body to header row only.
  - `X`: close helper panel.

## Phrases Tab
- Input: `Add/search quick phrase...`
- Phrase row behavior:
  - Click phrase pill: toggle phrase in caption (insert at cursor if missing, remove if present).
  - `Tag` button: add phrase as a tag for the current media item.
  - Up-arrow button: move phrase up one slot.
  - `X` button: remove phrase from active quick phrases.
- Search results:
  - Existing term click: add to quick phrases.
  - Missing term create option: create term and add to quick phrases.

## Annotate Strip Integration
- Annotate groups are derived from:
  - `caption_requirements`
  - `caption_requirement_keywords` (comma-separated per group)
- Group behavior:
  - Clicking a term chip toggles that tag for the current media item.
  - Term chip heat is based on nearby annotated sibling media, not the visible/filtered list.
  - Nearby range is 8% of captioned/tagged siblings, with a 12 item floor and 40 item ceiling.
  - Term chip tooltips show both nearby usage and full-folder usage.
  - If one term in a group is active, inactive sibling terms are muted as alternatives.
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
- Old `Shift+1..9` quick-phrase reorder behavior is retired.
- Reordering is button-based (up-arrow) in the panel.
