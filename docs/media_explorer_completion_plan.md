# Media Explorer — remaining product completion plan (2026-10-18)

Grounded in `docs/media_explorer_design.md`, `docs/media_explorer_implementation_plan.md`, and root `AGENTS.md`.

## Current baseline
Explorer already has a first-class shell surface, gallery, responsive viewer, Compare/Survey, search, type/model/Set/rating facets, owner-backed Generate ratings, inspection of recorded prompts/evidence, and source navigation. Do not rebuild those or introduce a new DAM, filesystem index, queue, or database. The design explicitly excludes new saved collections.

## Phase 1 — Relational browsing (implemented in this branch)
- Add optional owner-specific filtering to the existing discovery function and GET route.
- Let the inspector pivot to other media from the same producing artifact, while preserving the working Set, source routes and removable filter state.
- Regression test source-owner isolation and absent owners. No changes to records or stored metadata.

## Phase 2 — Workflow and rating completeness (follow-up)
- Validate real-image navigation to Generate, Test, Epoch Finder and Storyboard against existing owner APIs; close genuine missing links with owner-specific functions only.
- Show existing Set/Test/Epoch assessments and ratings where their actual storage semantics support it. Do not invent global ratings or duplicate review state.
- Audit usage and source relationships on actual saved artifacts before offering actions not supported by producer data.

## Phase 3 — Scale measurement (follow-up)
- Benchmark cold/warm searches, repeated pagination and full discovery on representative thousands-of-media libraries.
- If scan times are materially slow, add narrowly scoped **request-lifetime** reuse or bounded metadata scanning, preserving explicit freshness and no persisted index.
- Measure first; do not add caching solely on assumption.

## Phase 4 — Product verification (follow-up)
- Exercise real image/video libraries, deep-link restoration, filter chips, owner pivots, rapid activity switches, failure states, low memory and responsive sizes.
- Run `tests/test_media_explorer.py`, `node --test tests/media_explorer.test.js` and browser QA, correcting only confirmed regressions.
- Follow `AGENTS.md` failure visibility and no hidden cleanup or background inference.

### Why this is incremental
The SOTA goal cannot be verified from code alone. The previous polish pass reports broad browser QA, but user-library performance and producer-specific owner links remain unverified. The first safe increment provides useful relational browsing without changing files, generations, or evaluation semantics.
