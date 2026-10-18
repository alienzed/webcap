# Media Explorer — implementation plan

Status: design and implementation contract; implementation phases below are not yet complete.

## Product decision

Promote media discovery and consumption to a first-class **Media Explorer** workspace. Keep Test Generations as a working bench, including its candidate staging, sessions, and in-context result evaluation. **Do not relocate those controls wholesale.** The explorer must discover artifacts from all supported producers, open them without changing the active editing context, and provide source-aware operations. Storage Manager remains responsible for accounting and cleanup, not for browsing.

This is an explorer over existing files, **not a central library or asset store**: no global persistent index, media relocation, duplicated originals, or new database. Discovery is advisory/read-only. Files and owner-local manifests/sidecars remain authoritative. A process-memory snapshot for responsive paging/filtering is permitted; reconstruct after server restart or explicit refresh. A small auto-starting discovery pass when entering Explorer is acceptable, but no long-running scan should start implicitly: show already known items and offer **Scan all** for the longer pass. Never preempt training/inference with GPU work.

## Codebase grounding (main as reviewed 2026-10-17)

- Root `AGENTS.md`: plain HTML/CSS/JS in `tool/` with classic scripts and load order; Python in `tool/server/`; no database or new architecture layers; shell owns navigation; no reaching into another feature's DOM; per-owner artifacts remain at source; failures propagate to Console. Generated inference artifacts can be explicitly deleted; Set source mutations need reversible treatment.
- `tool/tool.html`: activity rail and distinct Test (`test-generations-workspace`) and Storage (`storage-workspace`) surfaces. The current `test-generations-library` is *Candidates and Sessions*, not a generic output library. Results live in `test-generations-results` and `test-generations-compare` next to evaluation controls, plus metadata and rating controls.
- `tool/js/test_generations.js`: session-owned results, preview/compare rendering, evaluation, rating, session-navigation logic; `/fs/test_generations` and `/fs/test_generations/media`. Retain test-specific session control and evaluation ownership; expose small navigation/action entrypoints.
- `tool/js/generate.js`: existing result/media, rating and delete endpoints (`/fs/generate/results`, `/fs/generate/media`, `/fs/generate/result/rating`, `/fs/generate/result/delete`). Reuse owner operations; do not reimplement mutations in Explorer.
- `tool/server/storage_manager.py`: existing ownership-aware inventory/scan logic for Generate, Set Test Generations, and central Test Generations (including campaign associations); useful discovery references, *not* a license to couple the gallery to storage delete/scan state.
- `docs/filesystem_state_contract.md`: generated sidecars/manifests stay with owners; temporary work is not a durable media gallery; unknown or ambiguous ownership is never automatically deleted. Existing storage scan cache may be discarded.
- Epoch Finder, training, storyboard and other producer/route contracts require a dedicated per-source audit before those adapters are enabled. Do not infer support merely from directory names.

## IA and UX

Activity navigation: **Media Explorer** as its own primary workspace (separate from Storage). Entry points from Generate, Test Generations, Epoch Finder, Training history, and relevant previews: **View in Explorer**. Back-links from Explorer: **Open source** when a stable, valid source target exists. An unavailable source is labelled, not fabricated.

Top bar: title, discovered count, last completed scan, refresh, optional **Scan all** with progress/cancel. Filter strip: producer/source, image/video, model, Set, date range, rating (only where present); sort newest default, oldest, rating, filename. Do not show filters with no meaningful values. Use responsive image-forward masonry-like *regular grid* (predictable card geometry) and substantial previews; load-more/server-side fixed-size pages rather than an unbounded infinite scroller. Show file badge, owner badge and available rating; keep other metadata in inspector. Preserve selection and scroll on returning from inspector or a source route.

Inspector: large image/video (native playback), source breadcrumb with link, file details, prompt/metadata/provenance where known; contextual rating/assessment/action buttons **only if backed by existing owner operations**. Compare 2–4 selected same-kind items after basic gallery works. Keyboard: arrows for previous/next, Escape closes inspector; focus returns to triggering card. Grid focus, labels, empty states and reduced-motion styles are required.

Navigation uses stable per-owner identity and URL/query state, not a shadow relationship database. Normalize from existing provenance where possible: `{source, ownerId, artifactId, mediaKind, previewUrl, fileName, createdAt, rating?, model?, context?, sourceTarget?, capabilities[]}`. IDs must be deterministic across rescans; do not expose arbitrary filesystem paths through action URLs. An absent file drops from fresh discovery rather than generating a fictional placeholder; if a related workflow history remains, source context may show missing media separately.

## Mutation rule

Viewing/discovery never modifies media. Ratings and evaluations use the producing feature's metadata writer, **not** a new global metadata store. Permanent deletion uses the relevant owner endpoint with its current confirmation semantics; Explorer must not delete by raw absolute path. Creation of a derivative (crop/resize/convert) is deferred: it needs an explicit source-local naming/provenance contract and must never overwrite the parent by default. No universal Edit button and no new `originals/` for generated output. Set source media operations stay in Set workflow with its reversibility rules. Bulk operations limited to operations demonstrated to be safe for every selected item, with per-item failures visible.

## Reference media

References are first-class media, including training, Epoch Finder, Test Generations and Storyboard references. Explorer must display known roles and originating workflows while keeping files and their metadata with the owning feature. A file may serve more than one workflow; display related usages when owner-local provenance confirms them. Do not infer ownership from visual similarity and do not duplicate files into a global library.

## Source matrix / availability

1. Generate outputs: discover via Generate results/metadata; open source; rating/delete if existing endpoints support that result.
2. Test Generation session outputs: discover via session manifest and output files; open exact session; existing rating/Ask VL via Test owner (do not clone UI logic).
3. Epoch Finder campaign previews: require separate provenance/owner audit; initially browse/source-link only.
4. Training samples and references: require run layout/history audit; initially browse/source-link only; distinguish sample from dataset/reference.
5. Storyboard Takes and other inference outputs: audit owner manifest and endpoint first; initially browse/source-link only.
6. Unrecognized images/videos in known supported output folders: discover as **Unlinked**, inspect only; no inferred source/action. Do not recursively scan arbitrary Sets, input datasets, caches, checkpoints, work intermediates, or external drives.

No exhaustive action matrix until source-specific operations have been verified. Capability is determined by validated owner+artifact, not by file extension alone.

## Phased delivery and acceptance

### Phase 0 — contract and source inventory (this document)

Audit each producer's actual persistence, metadata, media-serving route, stable identities, ownership and source-entry hooks. Record supported vs unsupported capabilities. Verify existing Test Generations/Generate actions before exposing them elsewhere. Keep other workflows unchanged.

### Phase 1 — thin read-only Explorer, Generate + Test

Add shell workspace entry, isolated `tool/js/media_explorer.js` and `tool/css/media_explorer.css` loaded explicitly in `tool/tool.html`. Python read-only endpoint under existing Flask route organization: scans **known durable output roots** using bounded per-owner enumeration; emits normalized item summaries and bounded page/filter/sort results. No persistent index. On opening show first page immediately; further scan only when user explicitly requests it. Loading, error, empty, stale/rescan indicators. No GPU/model calls. Unit tests for directory scope, identity stability, paging, duplicate files and missing media.

### Phase 2 — gallery/inspector and navigation

Implement responsive cards, native image/video inspector, scoped search/filters, stable URL state and deep links. Add owner-specific `Open in Explorer` and `Open source` entrypoints using existing shell/navigation APIs. Avoid DOM cross-feature manipulation and preserve current editable Set and session state until the user explicitly navigates. Browser integration tests for cross-workspace routes and refresh.

### Phase 3 — more producers

Add Epoch Finder, Training, Storyboard and any other proven source *one owner at a time*, using each source's actual manifest/sidecars, avoiding generic recursive crawling and reusing its existing media serving rules. Verify sources with absent/expired manifests and source deleted while the media remains. No automatic deletion or "repair."

### Phase 4 — actions and curated comparison

Expose rating, recheck/evaluation, delete, download/reveal/copy path only where current owner contracts genuinely support them; link to feature UI for complex actions instead of transplanting its UI. Compare selected images/videos; add bulk operations only after one-item operations are validated, report partial failures item-by-item. Do not introduce global tagging or new metadata schemas solely for the explorer.

### Phase 5 — optional derivatives & polish

Only if users demonstrate need: `Save As` non-destructive crop/resize/convert alongside source with explicit lineage sidecar and visible destination. Before shipping, decide whether derivatives are explorer-owned or producer-owned; until decided, *do not expose transforms*. Load tests for thousands of results, scan cancellation, performance and keyboard accessibility.

## Explicit challenges / simplifications

- Existing Test **Candidates/Sessions** is orchestration, not library content; leaving it in Test is simpler and more coherent than moving it into a generalized browsing surface.
- Do not promise *every* operation on *every* media file. Unlinked/bare files can be viewed, but shouldn't acquire fake rating or owner semantics.
- Do not run a potentially slow full filesystem scan automatically on opening. A fast bounded initial discovery + visible manual deeper scan meets the goal without implicit long operations or surprising I/O.
- A live, cross-source **global sort** over arbitrarily many files needs complete discovery first. While scan is incomplete, clearly label results as partial; never imply global counts/sort completeness.
- No persistent universal index, thumbnails store, event bus, cross-feature service hierarchy, generalized action registry, originals mirror, or global refcount tracker.
- No background mutation of user-authored working state; no auto-cleanup while browsing.

## Serious unresolved decisions (gates, not blockers for read-only phase)

- **Derivatives:** who owns and can delete transformed media, how lineage is retained. Defer transforms to Phase 5.
- **Source scope:** whether raw training dataset/input media belongs in the explorer. Default **no** (generated durable outputs only), since Set Prep already owns user originals.
- **Completed scan semantics:** an exact global count/order requires enumerating all supported roots. Present partial results honestly until that scan finishes.

## Verification

Per-phase tests for route contracts, path boundaries, filtering/page counts, media serving and deep link identity; manual visual QA at narrow/wide widths, image/video playback, zero/hundreds/thousands of artifacts, partial scan, source deleted, Set navigation, keyboard focus, queued inference unaffected. Ensure error details surface in global Console. Run existing Test/Generate/Storage and shell regression tests. Only merge after relevant checks pass and `AGENTS.md` invariants are maintained.
