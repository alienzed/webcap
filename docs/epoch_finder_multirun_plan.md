# Epoch Finder multi-run implementation plan (Set-scoped)

Status: implementation in progress. Single-run campaign compatibility is mandatory.

## Contract
- Run discovery stays limited to the current Set; use Test Generations' proven run-label policy: Set name, user-supplied run name and/or sequence, model/stage, available checkpoint count. Missing metadata is visibly labeled, not fabricated.
- Run chooser is a checkbox list. One or several runs of the same Test model may be checked. Epoch selection remains individual within each chosen run; defaults to all available saved epochs.
- Candidate identity is **(jobId, epoch)**. Never identify candidates by epoch alone, filename alone, run name or timestamp. All selected candidates face the same approved prompts/seeds/settings per round. Rank collectively with tie-aware retention/re-entry.
- Campaigns saved before multi-run support retain existing scalar epochs and `jobId` and behave identically. A new v2 campaign has explicit run/candidate identities; avoid rewriting legacy files.
- Reference approval stays explicit. Reference images for comparisons must be validated against a well-defined source run / common Set context, not inadvertently switched to a different run. Never silently repurpose a training reference across a different training dataset.
- Staging filenames and captured frame paths must be unique across runs, even for the same epoch number. Pending/resume/cleanup only touch campaign-owned staging.
- Preserve queue lanes, campaign scheduling, scoring protocols, Activity and lifecycle semantics. No new queue, database, automatic scan or cross-Set discovery.

## Phases
1. Trace and test run identity: model compatibility, run labels, provenance and source reference semantics. Add identity helpers and test fixtures for two runs sharing epoch numbers, legacy campaign and missing run.
2. Backend v2: normalize selected (jobId, epoch) pairs, freeze membership, stage per-run checkpoint distinctly, execute/rank/prune correctly. Keep legacy branch unchanged. Tests for ties/reentry, lifecycle interruption, reference validation and unit identity.
3. Frontend: replace scalar picker with checkboxes and per-run epoch selectors, preserve selection, show labels in campaigns/leaderboard/gallery, pass v2 criteria and maintain old follow-up behavior. Follow-up on v2 preserves run membership.
4. Audit: targeted Python tests and browser interaction, load legacy campaign, compare mixed same-Set runs, preserve owner identifiers, check no backend scheduler change. Review diff, merge only after tests.

## Implementation risks
- Legacy ranking/epoch-key paths are numerous; merely submitting more run IDs without comprehensive candidate identity migration would silently conflate scores.
- Exact-tag training-reference validation currently binds to one `jobId`. For multi-run campaigns the approved reference must either be valid for all selected runs or use an explicit reference-source run; do not silently adopt an arbitrary run.
- Test Generations' checkpoint candidates and Epoch Finder campaigns have different ownership. Reuse label/selection behavior, not another feature's mutable DOM.
