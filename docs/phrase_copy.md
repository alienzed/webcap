# Phrase Helper Panel

## Purpose
A vertical panel for quickly inserting/removing active phrases in captions. Designed for speed and minimal distraction during captioning while keeping term creation centralized.

---


## UI/UX

- **Placement:**
  - For now, the panel is always at the bottom of the editor (like the caption requirements panel), regardless of screen width.
  - The panel HTML is static and present in the DOM from the start—not injected or created by JavaScript.
  - (If a side-by-side layout is ever used, the panel must never shrink the textarea below a comfortable minimum width.)
- **Integration:**
  - The panel is part of a tabbed interface with the caption requirements panel (Tab 1: Requirements, Tab 2: Phrases).
  - A floating toggle button (top right of the editor) collapses/expands the panel (optional).
- **Interaction:**
  - Each active phrase is shown as a button.
  - Clicking the phrase toggles it in the caption at the cursor (insert if missing, remove if present).
  - Inserted phrases are spaced so they do not stick to adjacent caption text.
  - A small `Tag` button assigns the phrase as a tag to the current media item.
  - The `X` button removes the phrase from the active shortlist.
  - Term search/create for quick phrases is handled by the `Phrases` input (`Add/search quick phrase...`).
  - Search results support:
    - primary click: add term to active quicklist
    - `📌`: pin term into active quicklist (same outcome, explicit quicklist action)
  - No checkboxes, no drag/drop.
- **Persistence:**
  - Catalog terms are saved per-folder in `caption_phrases`.
  - Active shortlist is saved per-folder in `stats.phrases`.
  - No import/export/reset; list is managed in-place.
- **No keyboard shortcuts, search, or advanced features.**

---

## Data Model

- `caption_phrases`: set-local catalog terms.
- `stats.phrases`: active shortlist used by this panel and phrase-count review.
- `config.json -> vocabulary` (optional): seeded starter terms shown in shared search/add.

---

## Implementation Notes

- No fallback logic or error guards—fail loudly if state or UI is out of sync.
- Minimal, deterministic, and linear JS.
- Use async where it is the natural fit (for example clipboard or network calls), but keep implementation direct and minimal.
- UI and state must always be in sync.
