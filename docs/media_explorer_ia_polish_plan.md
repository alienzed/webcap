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
