# Test Generations: focused launch unification and epoch media browsing

Scope: refine proven Test Generations and Epoch Finder, **not** a new all-media homepage or a replacement shell. Follow AGENTS.md: native feature controllers own their DOM, no new queue/db/FS roots, no background scan or localStorage, visible failures. Original four workspaces and execution controls stay functional until verified.

## Phase 1 — regular launch, one form
- Keep existing prompt, aspects, resolution/MP, duration, seed, staged-LoRA selection, Base include, per-candidate weight and Weight Sweep untouched.
- Add a **Sessions** number (1–20, default 1) and optional **Ask VL after generation** checkbox directly beside Run Tests. These route through native `test_enqueue` for 1/no VL or existing `test_batch` server orchestrator for multiple sessions or automatic VL.
- Keep Batch modal callable as a compatibility path while making it unnecessary for normal use. Keep optional session name in compatibility UI but de-emphasize it; do not change persisted identity.
- Test with real DOM contract for 1 vs multi and VL selection, invalid count and full existing launch settings.

## Phase 2 — advanced campaign mode
- Provide Regular/Campaign mode navigation inside the Test setup, with **Campaign** entering the existing Finder wizard. Preserve all original wizard steps, saved-run/epoch choices (not promoted LoRAs), training concept, wildcard groups, rounds, cases, retention, explicit training-reference picker with Previous/Next/Back, and the original center campaign progress, leaderboard, frames and follow-ups.
- Provide a clear **Back to regular tests** control from Finder, preserving both workflows. Keep original Tests/Epoch Finder/References/Analytics tabs as compatibility navigation.
- Do not move complete feature DOM trees; use existing `epochFinderShowMode` and owned controllers.

## Phase 3 — epoch-based media explorer in Run Analytics
- Add **View images** on a saved checkpoint row in Run Analytics, scoped to exact jobId+epoch. Read only through existing `workspace_gallery` endpoint (already filters by checkpoint, campaign and source provenance), with eight results/page.
- Display media only when opened. Bound media/video loading, preserve missing/pruned items, provide explicit Close/Back to analysis, open original media, and source navigation; load additional pages only on demand/scroll.
- Preserve session view, native synchronized video Compare, ratings, VL details and campaign evidence. Never auto-load all media.

## Phase 4 — regression and merge
- Run JS/Python syntax, targeted DOM and endpoint tests, existing Test/Batch/Finder/Analytics contracts, check identity/missing results, compare failures against main where legacy contracts are stale.
- Leave original screens intact; defer retiring old navigation until actual visual and runtime review.
- Merge only passing additive functionality, not a mockup or an unvalidated UI rewrite.

Acceptance: One familiar Regular form launches one or many Test sessions and optional VL; Campaign retains full guided wizard and native saved checkpoints; from a selected epoch in Analytics users can see all attributable results without bulk media loading.
