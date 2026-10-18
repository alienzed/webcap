# Media Explorer — interface and interaction specification

This document is the **UI implementation contract** for the new WebCap Media Explorer. Read together with `media_explorer_implementation_plan.md` and root `AGENTS.md`. Date: 2026-10-17.

## Inspiration (patterns, not copies)

- **Eagle:** dense image-first gallery, persistent source navigation on left, docked property/metadata inspector on right. https://eagle.cool/support/article/interface-inspector
- **Lightroom Classic Library:** Grid / Loupe / Compare / Survey, thumbnails sizing, selection vs active photo, filmstrip, ratings and metadata filters. https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/browse-compare-photos.html
- **PhotoPrism:** searchable facets, mixed photo/video browsing, list/mosaic/card modes, explicit refresh. https://docs.photoprism.app/user-guide/navigate/
- **PureRef:** prioritize visual references and minimal chrome, but **do not** create an infinite spatial canvas or another saved-board format. Explorer remains searchable and source-aware.

The design should feel like a professional local media workstation rather than a file browser, settings table, or a new project database. The goal is to maximize **visible media**, **findability**, and **one-click access to meaningful context**.

## Desktop spatial model

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ WebCap global header and activity rail (unchanged)                                             │
├────────────────┬─────────────────────────────────────────────────────┬─────────────────────────┤
│ SOURCE RAIL    │ MEDIA EXPLORER                                      │ INSPECTOR               │
│ ~210–235 px    │                                                     │ ~300–350 px             │
│                │ Search media, prompts, names …          [Refresh]    │ preview                 │
│ All media      │ [All] [Generations] [References] [Samples] [Video] │ role(s) · source links  │
│ Generated      │ [Source ▾] [Model ▾] [Set ▾] [Rating ▾] [More ▾]    │ rating / assessments    │
│ References     │ 2,400 items          [Newest ▾] [− thumb size +]   │ metadata / prompt       │
│ Training       │                                                     │ related media / usages  │
│   Runs         │ ┌────────────┐ ┌────────────┐ ┌────────────┐       │ contextual actions      │
│   Samples      │ │            │ │            │ │            │       │                         │
│ Tests          │ │   MEDIA    │ │   MEDIA    │ │   MEDIA    │       │                         │
│ Epoch Finder   │ │            │ │            │ │            │       │                         │
│ Generate       │ └────────────┘ └────────────┘ └────────────┘       │                         │
│ Storyboard     │  epoch · 4★    sample · ref    video · 00:14        │                         │
│ Unlinked       │                                                     │                         │
│                │ ┌────────────┐ ┌────────────┐ ┌────────────┐       │                         │
│                │ │            │ │            │ │            │       │                         │
│                │ └────────────┘ └────────────┘ └────────────┘       │                         │
│                │                                      [Load more]    │                         │
└────────────────┴─────────────────────────────────────────────────────┴─────────────────────────┘
```

The **global WebCap activity rail** remains the primary app navigation. Explorer's internal source rail is a filtering/navigation hierarchy, *not* a second app sidebar. It collapses to icons or a source dropdown in narrower widths. Inspector is closed by default for maximal grid area; selecting/inspecting opens it without replacing the grid.

## Information architecture

1. **All Media** is default and means recognized durable media plus discoverable references; visible incomplete-scan status if applicable.
2. **Roles:** Generated, Reference, Training Sample, Source (only for supported Set originals), Unlinked. **A file may have multiple roles.** Clicking a role is a view/filter, not moving any file.
3. **Producer shortcuts:** Generate, Test Generations, Epoch Finder, Training, Storyboard and actual discovered producers. Hierarchy only as deep as supported metadata allows; do not emulate a filesystem folder tree.
4. **Saved collections** are out of scope. A later 'Favorites' filter is appropriate only where an owner-backed rating/favorite already exists; avoid a second source of truth.
5. **Storage** remains separate, accessible from the global rail; do not put cleanup quotas or disk meters into Explorer chrome.

## Gallery cards

- **Media must fill most of each card.** Default object-fit contain on a neutral checker/letterboxed preview backdrop; crop-to-fill is a separate toggle, not the only view, since image composition matters to model evaluation.
- Responsive regular grid: 2–3 columns at moderate desktop widths, 3–5 with inspector collapsed on larger screens. Thumbnail-size slider persisted in *session* only. Card height follows a consistent thumbnail frame to preserve scan order.
- On image hover: subtle selection checkbox; open/expand affordance. On video: play glyph and duration when known. No hover-only essential action.
- Under image: **one concise line** (model/epoch/source as available), secondary role(s) and rating. No multi-line prompts or manifest dumps on cards.
- Media badges indicate role and video; any AI score is explicitly named by evaluator and only shown when real evaluation exists. Empty scores are **unknown**, not zero.
- Filename visible in tooltip/inspector. No repeated file extension labels unless it distinguishes media type.
- Selected cards have an obvious outline; active/focused item distinct from multi-selection.

## Toolbar and filtering

Search is the largest/first control. Scope: filenames, prompts or recorded source labels only when actually available. Below: role chips, producer, model, Set, date, media type, rating and sort. Hide unsupported filters or mark them unavailable rather than offering empty choices.

Use **one compact row of primary facets**, with a More panel for rarely used facets. Show active filters as removable chips; Clear All is always available when filtering. Counts reflect the *completed discovery scope*; when results are partial, label them as partial. Avoid a permanent large filter form.

Sort: Newest (default), Oldest, Rating (rated first), Name. Discovery must be complete to guarantee global sort. Use **Load more** pagination rather than scroll-triggered fetch initially: predictable keyboard/selection/back behavior, no confusing scroll jumps.

## Inspector (right dock; not modal by default)

Selecting one card opens a 300–350 px contextual dock with:
- enlarged preview and Open Fullscreen action;
- compact provenance breadcrumb: `Source → Run/session/campaign → Artifact`, with **Open source** button only for a proven route;
- **Used by** section for every known workflow that references the file, separated from **Owned by** (the on-disk owner); deduplicate uses by stable identifiers, not by filename;
- prompt, model, LoRA, seed, epoch, date, resolution, duration, file size, roles, tags and ratings **only if available**; sections collapse as needed;
- contextual actions: e.g. Rate, View VL, Recheck via originating workflow, Download/Open folder, Compare, Delete. Never show a misleading universal Edit control.
- explicit permission and destructive-action language for Set originals versus generated media.

No giant fullscreen modal for basic metadata. **Loupe** is a separate fullscreen/focus mode with dark background, fit/1:1 zoom, next/previous, native video playback, thumbnail filmstrip optional at bottom and a toggle for metadata. Escape returns to exactly the previous grid/selection/scroll.

## Comparison

Selected 2 items → **Compare** (side-by-side, linked zoom optional). Selected 3–4 → **Survey** (even tiles, choose a winner if a source-backed rating action exists). For video, synchronized frame-level comparison is deferred; offer ordinary side-by-side playback rather than pretending to have time sync. Compare the original media, not thumbnails stretched up. Keyboard left/right moves candidate; number of selected items is always shown. Do not recreate Epoch Finder's scoring: link to its existing workflow for scoring or assessment.

## Discoverability and connectivity

- **Inward navigation:** context actions on Generate results, Test sessions, Epoch campaign items, training samples and Storyboard Takes may use `View in Media Explorer` with a stable artifact identity.
- **Outward navigation:** source breadcrumb and **Open source** use feature-owned navigation functions. A deleted source may leave media visible with **Origin unavailable** and no fake link.
- Clickable context uses stable source and artifact IDs; never relies on the current Set selection as a hidden requirement. Opening a media detail must **not** overwrite an editable Test prompt, current caption, current training candidate or active Set.
- Filter/search state should be encoded into a deep-linkable route when shell support exists; grid scroll and transient selection remain browser-memory state.
- If the same file has several verified uses, show all usage links; it is displayed **once per canonical source file**, not once per mention.

## Interaction details / keyboard

- Click card: open dock. Double-click / Enter: Loupe. Shift-click: range; Ctrl/Cmd-click: add/remove; Select All applies to *loaded* items and labels that scope.
- Arrow keys move focus in grid (respect column count); inside Loupe they navigate previous/next; Escape closes Loupe first then inspector/selection; Space plays/pauses video when focused on media.
- Contextual bulk selection bar replaces secondary toolbar controls only while >1 item selected. Do not blanket-enable destructive bulk actions with mixed owners.
- Loading: keep already-rendered cards stable. Discovery does **not** kick off VL or GPU work. Partial results remain usable. On scan error, keep current gallery visible and expose actionable error in WebCap Console plus a clear status.
- Responsive: under ~1100 px, right dock becomes a slide-out panel; under ~800 px, source rail collapses into one chooser. No card should shrink below a useful visual inspection size.
- Accessibility: keyboard focus outline, screen-reader role descriptions, labels for ratings/action controls, no essential hover-only functionality, respect reduced-motion.

## Build sequence (visual quality first)

**A. Real design shell:** activity-rail entry, source rail, search/facet toolbar, responsive gallery, empty/loading state, inspector dock. Use representative actual Generate results while designing so metadata labels fit realistic cases. Review narrow and wide widths before wiring more sources.

**B. Gallery behavior:** paging, local selection, focused card, preview/inspector and full-view navigation; restore scroll and selection. Scope badges/counts and incomplete-discovery honesty.

**C. Production sources:** Generations and their *saved references* first; then Test/Training/Epoch/Storyboard source adapters after backend provenance audit. Source shortcuts should appear only when supported.

**D. Source actions/deep links:** connect and test owner-specific actions; keep complex workflows in their own features. Comparison after inspector/navigation are coherent.

### Audit targets

- Source rail hierarchy does not conflict with global activity rail; no triple navigation.
- Media remains prominent at 1280–1920px widths and at 80%-zoom.
- Results cards do not suffer from Test Generations' cramped previews.
- Right inspector's Actions/Used by section still works for references with no ratings.
- Active sessions/video playback are not destroyed by periodic rerenders.
- Scans never silently mutate files or invoke GPUs; status remains visible.
- No new persisted library indexes, duplicate files or originals folders.
