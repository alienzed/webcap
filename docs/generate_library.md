# Generate Library

## Goal

Give Generate a practical media library without creating a second media-curation system.

V1 should solve the immediate problem:

- generated media must not become an unmanageable pile;
- scratch output must be easy to browse, rate, tag, save, and delete;
- saved media must remain browsable across multiple configured locations;
- Generate/Library reuses the existing Media Grid curation behavior instead of cloning it;
- media carries its own portable metadata where supported;
- Prep storage behavior is not migrated or deprecated by this work.

KISS applies: build only what the current Generate/Library workflow requires.

## Product model

### Scratch

Scratch is generated working media.

Scratch is physically partitioned into timestamped session folders so one directory never grows without bound.

A session is only a storage batch. It is not a concept, project, collection, or semantic grouping system.

New Session means: the next successful media write starts a new scratch folder.

Rules:

- do not create an empty session folder before media is written;
- restarting WebCap does not implicitly start a new session;
- startup resumes the most recently written scratch session;
- no separate persisted active-session pointer is required for V1;
- concepts, collections, and projects are explicitly out of scope.

Suggested physical layout:

    generations/
      scratch/
        YYYY-MM-DD/
          YYYY-MM-DD_HH-MM-SS/
            media files

The date is only a storage partition. The timestamped session directory is the cleanup/write boundary.

### Saved

Saved is promoted media.

Saving means move, not copy.

Normal actions:

- Save moves to the configured default Saved library location.
- Save To... chooses another destination.
- Saving to a new destination may offer to add that folder to configured Library Locations.

Saved is one logical library over multiple configured filesystem roots.

Configured roots are stored as paths only. No friendly-name layer is needed.

Saved storage may be partitioned internally by year/month, but that physical layout is not the primary UI model.

Promoted files disappear from Scratch because they have moved.

## Library surface

Library is one browsing surface with two top-level sources:

- Scratch
- Saved

Both use the same shared Grid/viewer/curation behavior.

Scratch and Saved keep separate in-memory-only view/filter state for the running WebCap process. Do not persist that state to LocalStorage or disk.

## Grid reuse

The current Media Grid is the existing curation surface and should be reused where ownership is genuinely shared:

- cards/tiles;
- selection;
- viewer;
- rating;
- tags and tag groups;
- reusable filter semantics;
- safe existing bulk behavior.

Do not create Generate-only rating, tag, or selection systems.

Do not couple Generate to Prep-owned DOM controls merely to reuse them.

Current Grid source/filter/action plumbing is still Prep-shaped, so V1 should introduce the smallest explicit source/context seam necessary while leaving the existing Prep path as the default.

Generate-specific actions remain source-owned.

For Scratch V1, the only new actions required are Save, Save To..., and Delete.

## Browsing model

This is a live preview browser, not a canonical full media-list load.

Requirements:

- newest first;
- recursive library roots;
- lazy, demand-driven discovery;
- infinite-scroll style pagination;
- discover enough media to fill the current page plus a small next-page buffer, then stop;
- resume discovery only when scrolling farther, refreshing, or filtering needs more matches;
- do not scan the full library merely because Library opened;
- do not require exact total counts before the scan is exhausted;
- filters apply immediately to known items and may continue scanning only until enough matching items are found;
- changing a filter must not restart scanning from scratch;
- WebCap-created media enters the current in-memory catalog immediately;
- external filesystem changes are picked up on explicit Refresh;
- no filesystem watcher in V1.

Refresh performs an incremental reconcile against configured roots. It must not reset the whole browsing surface.

### DOM stability

Preserve DOM identity.

- Never replace the entire live Grid/container during refresh, filtering, polling, or incremental discovery.
- Add, update, or remove keyed cards only when those items actually change.
- Filter changes should hide/show existing cards where practical rather than rebuild them.
- Do not add speculative video pause, unload, autoplay, or lifecycle machinery.
- Normal browser media behavior is sufficient until profiling proves otherwise.

## Sessions in the UI

Sessions stay lightweight and mostly invisible.

Generate may show a subtle current-session/date indicator and a visible but low-emphasis New Session control near Save Prompt and Library.

V1 Library remains flat-ish. It does not need a dedicated session-management product surface.

Session/date/location may appear as lightweight relative-path/footer context on previews.

Do not generate permanent thumbnails or thumbnail caches.

### Clear Session

Clearing a session:

- requires confirmation;
- moves the entire session folder to OS Trash/Recycle Bin in one operation;
- leaves already-promoted Saved files untouched.

Single-item Scratch delete likewise moves the media to OS Trash/Recycle Bin.

Do not create WebCap tombstones or undo journals.

## Embedded media metadata

Generate/Library introduces a dedicated embedded metadata reader/writer.

This work does not migrate or deprecate Prep metadata storage.

Prep may later learn to read embedded metadata opportunistically, but its existing write paths remain unchanged in this phase.

### Contract

Embedded metadata is portable reproduction/curation metadata, not WebCap bookkeeping.

Store only structured text useful to understand, reproduce, search, or curate the asset.

Expected fields, where applicable:

- source prompt;
- resolved/submitted prompt;
- model identity;
- LoRA identities and strengths;
- seed;
- generation parameters that materially affect the render;
- lightweight reference-media identifiers needed for provenance/reproduction;
- rating;
- tags and tag groups.

Do not duplicate data already authoritative in the filesystem or media container.

Do not embed:

- filesystem path;
- created/modified timestamps that can be derived;
- session IDs;
- generation/job IDs;
- queue/runtime state;
- provider job IDs;
- manifest paths;
- WebCap workflow/version identifiers unless a concrete reproduction requirement later proves they are needed.

Use one small versioned WebCap payload so the schema can evolve.

### Supported formats

The Generate/Library contract should round-trip embedded WebCap metadata for:

- PNG
- JPEG/JPG
- WebP
- MP4

If a format is declared supported, read/write failures must be visible. Do not silently fall back to sidecar JSON.

Image metadata writes must preserve image pixels.

Video metadata writes must avoid re-encoding; a container rewrite/remux is acceptable when required.

Rating/tag edits in Library write back to the media immediately.

Non-WebCap media discovered in Saved may be adopted into the same curation system by writing WebCap rating/tag metadata into the file.

## generation.json transition

Current Generate results use generation.json as the per-result manifest and current rating storage uses .webcap_state.json.

Do not remove those paths abruptly.

Transition plan:

1. introduce and verify embedded metadata read/write;
2. write embedded metadata for new Generate output while continuing the existing manifest path;
3. teach Generate/Library reads to prefer embedded metadata with compatibility fallback to current manifests during migration;
4. move Generate Library rating/tag writes to embedded metadata;
5. only after round-trip and compatibility behavior are proven, deprecate Generate/Library dependence on generation.json and Generate-specific .webcap_state.json rating state.

Deprecation is a later cleanup milestone, not part of the first cut.

## Search and filters

Text search covers all indexed text available for an item, including filename, source/resolved prompt, tags/groups, model, LoRA names, and relative location/session context where useful.

Filters combine with AND semantics.

Model, LoRA, duration, aspect ratio, megapixels, and similar generated properties are secondary facets. Keep their V1 controls simple.

LoRA strength is stored when relevant but does not need a dedicated V1 filter.

Default sort is newest first.

## Library locations

Settings allows multiple recursive Saved library locations.

Store paths only.

One location may be the default Save destination.

Save To... may offer to add a newly chosen folder to Library Locations.

The UI may show paths relative to the configured library root.

## Metadata/indexing strategy

Do not add a persistent authoritative database or index.

The filesystem and embedded media metadata are the source of truth.

Library may maintain a disposable in-memory catalog for the running process.

Discovery is bounded and demand-driven rather than eagerly indexing every configured root.

Do not create permanent thumbnails.

Do not add background filesystem watchers.

## V1 implementation phases

### Phase 1 - Metadata contract

- add a small Generate/Library embedded metadata helper;
- define one normalized payload shape;
- implement round-trip read/write for PNG, JPEG, WebP, and MP4 using existing project/runtime capabilities where practical;
- add focused tests;
- do not alter Prep metadata writes.

### Phase 2 - Generate writes

- write reproduction metadata into newly persisted Generate media;
- keep generation.json during migration;
- preserve existing result/restart behavior;
- move Generate rating writes to embedded metadata only after the writer is proven.

### Phase 3 - Scratch sessions

- change Generate persistence to timestamped scratch-session storage;
- create a session directory only on first successful media write;
- New Session clears only the current in-memory write target;
- startup resumes the newest scratch session;
- add subtle current-session status in Generate.

### Phase 4 - Library backend

- expose lazy recursive Scratch/Saved discovery;
- page/buffer rather than full-scan;
- read embedded metadata first;
- support explicit incremental Refresh;
- support configured recursive Saved roots;
- no watcher and no persistent index.

### Phase 5 - Shared Grid source seam

- add the smallest explicit Grid source/context contract required to feed Library media without routing through Prep globals;
- keep existing Prep behavior as the default path;
- reuse cards, viewer, selection, ratings, tags, and safe existing bulk behavior;
- keep source-specific actions outside Prep-owned action DOM.

### Phase 6 - Library UI

- one Library surface;
- Scratch / Saved source switch;
- flat-ish newest-first browsing;
- infinite-scroll/demand-driven pagination;
- search/filter in memory with scan-forward only as needed;
- stable keyed DOM reconciliation;
- minimal Scratch actions: Save, Save To..., Delete;
- no concepts, collections, projects, semantic session management, generated thumbnails, autoplay policy, or speculative media lifecycle logic.

## Explicitly out of scope

- Prep metadata migration;
- replacing Prep .webcap_state.json or media_metadata.json;
- collections/concepts/projects;
- smart collections;
- semantic session naming;
- session dashboards;
- persistent thumbnails;
- persistent Library database/index;
- filesystem watchers;
- autoplay/pause/unload preview management;
- workflow/generation grouping UI;
- broad action redesign;
- generalized Single View refactor unless a concrete safe seam is required by Library.
