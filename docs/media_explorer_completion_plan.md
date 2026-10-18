# Media Explorer — remaining product completion plan (2026-10-18)

Grounded in `docs/media_explorer_design.md`, `docs/media_explorer_implementation_plan.md`, and root `AGENTS.md`.

## Current baseline
Explorer already has a first-class shell surface, gallery, responsive viewer, Compare/Survey, search, type/model/Set/rating facets, owner-backed Generate ratings, inspection of recorded prompts/evidence, and source navigation. Do not rebuild those or introduce a new DAM, filesystem index, queue, or database. The design explicitly excludes new saved collections.

## Phase 1 — Relational browsing (merged in PR #420)
- Add optional owner-specific filtering to the existing discovery function and GET route.
- Let the inspector pivot to other media from the same producing artifact, while preserving the working Set, source routes and removable filter state.
- Regression test source-owner isolation and absent owners. No changes to records or stored metadata.

## Phase 2 — Workflow and rating completeness (implemented where owners support it)
- Validate real-image navigation to Generate, Test, Epoch Finder and Storyboard against existing owner APIs; close genuine missing links with owner-specific functions only.
- Add Test and source Set rating controls through their existing owner-backed rating endpoints; Generate already supports rating. Existing Epoch/Storyboard assessments and recorded ratings remain read-only where no equivalent write operation is established.
- Audit usage and source relationships on actual saved artifacts before offering actions not supported by producer data.

## Phase 3 — Scale measurement (requires representative local library)
- Benchmark cold/warm searches, repeated pagination and full discovery on representative thousands-of-media libraries.
- If scan times are materially slow, add narrowly scoped **request-lifetime** reuse or bounded metadata scanning, preserving explicit freshness and no persisted index.
- Measure first; do not add caching solely on assumption.

## Phase 4 — Product verification (pending runtime environment)
- Exercise real image/video libraries, deep-link restoration, filter chips, owner pivots, rapid activity switches, failure states, low memory and responsive sizes.
- Run `tests/test_media_explorer.py`, `node --test tests/media_explorer.test.js` and browser QA, correcting only confirmed regressions.
- Follow `AGENTS.md` failure visibility and no hidden cleanup or background inference.

### Why this is incremental
The SOTA goal cannot be verified from code alone. The previous polish pass reports broad browser QA, but user-library performance and producer-specific owner links remain unverified. The first safe increment provides useful relational browsing without changing files, generations, or evaluation semantics.

## Finish-line implementation (this branch)
- Adds direct Set and Test result rating in the Explorer inspector; changes are written through `/fs/folder_state/rating` and `test_rate_result`, not duplicated in Explorer storage.
- Maintains existing source navigation and read-only assessment presentation.
- Adds discovery regression coverage for both owner-backed rating sources.
- Runtime and browser verification require a running WebCap instance and representative saved sessions/Set media. No timing claims or persistent cache added without measured evidence.
