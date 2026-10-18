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


## Implementation checkpoint — 2026-10-18 (PR #408)

This is an **incremental implementation**, not the completed universal library. Do not mark later phases as done or merge solely because the gallery renders.

| Phase | Applied to branch | Remaining acceptance |
| --- | --- | --- |
| 0. Ownership & IA | Root AGENTS.md reviewed, reference roles documented, interface contract in `docs/media_explorer_design.md` | Audit source-specific owner contracts before broadening discovery |
| 1. Gallery foundation | New HTML/CSS/JS workspace, Flask read-only endpoint, Generate result and persisted reference discovery | Execute backend tests; test browser layout and app navigation; add uncapped/full discovery |
| 2. Visual exploration | Card grid, source-role filter, search, thumbnail sizing, inspector, fullscreen loupe, paging; sorting performed globally *within discovered scope* | Inspect keyboard, media playback, direct links, selection/compare and scroll preservation |
| 3. Producer coverage | Generate only | Test sessions, Epoch Finder, Training, Storyboard, source/reference usages (owner by owner) |
| 4. Owner actions | Read-only intentionally | Reuse proven source actions; no generalized deletion/editing |
| 5. Derivatives | Not started | Explicit ownership/lineage contract, if needed |

### Immediate correctness rules

- Until full scan lands, scope is `Generate (latest 500 results)` and counts are partial. Sorting is within that bounded set, not globally across all on-disk results. This is a real limitation, not a final design.
- Gallery paging and sort must be executed by the same backend snapshot/query (server-wide sort before slicing). Stale responses must not append to an invalidated gallery view.
- Source navigation must close the Explorer without overwriting Test/Set editing state. Every shell route must be reviewed for mutual exclusivity.
- Existing media-serving endpoint must enforce source ownership; do not expose arbitrary absolute or user-supplied filesystem paths.
- A test file has been added at `tests/test_media_explorer.py` but the linked GitHub environment has no executable checkout; tests have **not** been run or visually verified. Keep PR #408 draft and unmerged until runtime QA can run.

### Next safe cuts

1. Verify the shell navigation and Generate+reference discovery via runnable checkout and tests.
2. Replace the 500-result bounded source with complete, cancellable/visible discovery and true cross-page sorting without persistent index; stay read-only.
3. Add Test Generations artifact/session context, then Epoch Finder, Training and Storyboard incrementally based on verified manifest data; ensure references are included as media roles.
4. Implement deep links and owner-specific capability actions only after those contracts exist; compare/selection and visual polish thereafter.


### Phase 2 discovery update (2026-10-18)

- Added `list_results(limit=None)` to enumerate all Generate manifests without the legacy 500-result cap, leaving the existing default behavior unchanged for other Generate callers.
- The Explorer remains fast/bounded on entry. A visible **Scan all Generate media** action requests complete enumeration, with accurate per-scope count and sort-before-page behavior.
- No persisted index or copied media is introduced. Stored generated references remain discoverable through their owner manifests.
- `AbortController` cancels a stale browser request, **not** a server-side Python scan already underway. Progress is currently a busy status rather than incremental enumeration; do not claim server cancellation or progressive scan results.
- Full enumeration currently runs for each page/filter request in full mode. A reusable process-local snapshot and cooperative cancellation are potential next optimizations, but require measured costs and a clean lifecycle; do not introduce speculative caching.
- Next build phase is source-specific Test Generations discovery and safe deep links, after its actual session/manifest shape is examined. This does not mark the universal Explorer complete.
- Local clone/testing was unavailable in this execution environment (GitHub hostname not resolvable from the container). GitHub changes were committed through the connector; tests remain **not executed**.

### Test Generations integration checkpoint

Central Test session manifests at `output/test-generations` and `output/test-generations/sets/*/sessions` are now included through the existing owner/session resolver, with ratings read from session metadata and preview URLs served by `/fs/test_generations/media`. The source filter is exposed in the Explorer. Legacy Set-local sessions are not included yet. **Not yet delivered:** end-to-end source navigation, reference relationships for Test sessions, and verified runtime/browser tests. No source files or test results are modified.

### Source navigation checkpoint

- Test results now expose **Open Test session** from the Explorer inspector, using Test Generations' existing `openTestBenchActivity({folder, sessionId, modelId})` entry point, not direct DOM manipulation.
- Explorer requests are invalidated when leaving its workspace so late responses cannot append into an inactive view.
- The scope remains central Test session media plus Generate results/references. Per-Set legacy sessions, Test reference media, Epoch Finder, Training and Storyboard still require owner-specific discovery audits; do not label coverage complete.
- Source navigation and visual behavior still need executable runtime verification before merge.


### Legacy-only Test discovery checkpoint (PR #408)

Explicit full discovery now enumerates legacy Set-local `test-generations` directories using the same key directory exclusions as Storage Manager, without introducing a persisted index or scanning them when merely opening Explorer. For older `test.json` manifests without `ownerFolder`, the directory parent provides the Set owner, and the Test owner resolver must still confirm the session before it appears. A dedicated regression test covers a Set with no central Test record. Browser-side AbortController does not cancel an in-progress Python walk: cooperative server cancellation, incremental progress, and performance benchmarks remain outstanding. The Test manifest does not provide a universal collection of reference files; do not infer reference ownership from filenames. Runtime tests and visual QA have not been run.

### Epoch Finder source phase

Retained Epoch Finder campaign frames are discoverable in the gallery as a separate source. The adapter reads owner-validated campaign manifests via `storage_campaigns()` and serves only existing retained frames via `/fs/epoch_finder/frame`; pruned frames and staging files are omitted. No generic folder-level media server is introduced, and owner workflows remain unchanged. Training and Storyboard discovery, campaign navigation, and runtime QA are still pending. The current implementation calls `storage_campaigns()` per query and must be profiled before considering runtime caching.
