# Media Explorer IA quick-win implementation plan

Per root AGENTS.md: preserve owner-specific state and delete routes, avoid new abstraction and state.

## Phase 1 — clarify discovery and IA (applied)
Rename the global Generated media category (distinct from Generate workflow); rename Discover all to Scan full history and explain recent vs full discovery. No API changes.

## Phase 2 — selection and provenance clarity (applied)
Explain the existing 2–4 Compare limit beside selection; distinguish multi-owner Storyboard media by asking users to select an owning scene from recorded Uses. No inferred ownership.

## Phase 3 — separate destructive actions (applied)
Group owner-backed permanent delete away from ordinary Inspector navigation and viewing controls. Reuse the existing exact confirmation/owner operation; no new delete path.

## Phase 4 — validation
Review changes against AGENTS.md; run `node --test tests/media_explorer.test.js` and relevant Python tests in local checkout and exercise responsive UI/browser on actual generated media. No filesystem mutation or migrations; outstanding runtime validation must not be claimed as complete.

## Render curation: from Generations to an organized library (2026-11-19)

Current source baseline: `tool/js/generate.js`, `tool/js/media_explorer.js`,
`tool/server/media_explorer.py`, `tool/server/generate_store.py`,
`tool/server/external_media.py`, and their corresponding tests.

**Product contract:** Generations produces Takes; Media Explorer organizes them. A Take
remains stored whether it is rated, tagged, or in a collection. Collections are
owner-backed tags plus saved views, not copies or physical folder moves. Copy to Set
is an explicit separate operation.

### Phase 1 — Direct, discoverable handoff (applied)
- Label the existing per-Take Explorer action **Organize**, preserving its exact
  Generate artifact deep link and existing in-Generations star rating.
- No new generation state, save operation, or cross-workspace DOM ownership.

### Phase 2 — An optional triage queue (applied)
- Add **Unsorted Generations**, meaning generated outputs with **no rating and no
  tags**. Previously rated or tagged results are already curated; references are
  excluded. This is a filter, not a deletion queue or required workflow.
- Filter before paging/sorting through the existing owner-backed discovery path,
  retaining the recent/full-history distinction; support saved views and deep links.
- Rating or tagging a result refreshes the active unsorted listing. Leaving a
  result untouched leaves its original media and provenance intact.

### Phase 3 — Make existing organization easy to find (applied)
- Show existing saved collection views directly in Explorer's source rail
  (regular saved views remain available in the toolbar, including on narrow screens).
- Reuse the existing collection tags, owner APIs, item/selection menus, rating,
  tag editor and Inspector. Bring Generate rating near Inspector actions.
- Do not invent a second favorites store, auto-copy, file reorganization, or
  mandatory disposition controls.

### Phase 4 — Acceptance and evidence
- Backend: unsorted classification, reference exclusion, scoped filtering,
  request forwarding, persistence and invalid filters.
- Frontend: per-Take Organize handoff, filtered discovery and filter clearing,
  rating-driven refresh, collections visible and navigable, saved-view reuse,
  plus existing Gallery/Inspector/External folder regressions.
- Run `node --test tests/media_explorer.test.js` and focused Python tests,
  plus browser checks at wide/narrow widths with real images and videos.
- Keep live media and filesystem behavior distinct from static/mock test results;
  do not claim browser acceptance before it actually runs.

**Risk boundary:** No schema or storage migration, no generated-file rename/move,
no new automatic destructive action, and no changes to Prep/Set file ownership.
The only new filter state is `curation=unsorted`; catalog entries and tags remain
in their existing owner and saved-view stores.
