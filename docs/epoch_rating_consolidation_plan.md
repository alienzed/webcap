# Checkpoint evidence and human rating integration (main-based, Oct 17 2026)

## Grounded state
- Main has Epoch Finder campaigns with independent JSON assessments, rank/retention based on weighted concept fidelity, and an existing client-side campaign summary. Keep these unchanged.
- The earlier cross-campaign and follow-up experiment remains in unmerged PR #392, now diverged from main. Reconcile separately; do not lift the whole branch into a new PR.
- Test Generations already owns per-image human ratings in session folder state, plus independent VL and reference assessment files. `_candidate_rating_scores` aggregates human ratings by *candidate filename*, which is not an unambiguous training-run identity.
- Staged checkpoints carry a versioned `.webcap.json` sidecar with `sourceFolder`, `sourceJobId`, `sourceEpoch`, and stage. This is the supported deterministic joining key. Keep unmatched legacy items separate, not guessed.

## Safe implementation phases
1. **Read-only identity projection:** map rated staged candidates to (source folder, run ID, epoch, stage), preserving rating count and average. Use Test session aggregation; do not modify session data, candidate ratings or Epoch Finder score formulas. Add tests for same epoch in distinct runs, unmatched provenance and unrated candidates. Do not infer identity from filenames.
2. **Join at presentation (partial, implemented):** Test Generations now shows a separate pooled checkpoint human rating only when more than one staged copy with the same provenance has ratings. Existing per-candidate ratings remain unchanged; no reruns or copied scores. Cross-campaign automated evidence display is still deferred pending PR #392 reconciliation.
3. **Shortlist:** implement a dynamic, transparent list within Epoch Finder; start with established concept fidelity and explain per-evaluator coverage, without pretending RVN/DINO counts are quality scores. Preserve manual promotions separately. Only introduce alternate evaluator admission rules after real validation of those signals.
4. **Additional testing:** integrate only after reconciling PR #392 to current main and validating the wizard's frozen plans, first-round breadth, explicit Launch and existing FIFO. New follow-up campaigns retain separate protocols and independent evidence.
5. **Later:** calibrate against actual human ratings and only then consider a combined score; leave Run Analytics to its own surface.

## Verification
Run `python -m pytest tests/test_epoch_finder.py tests/test_test_reference.py tests/test_epoch_reference.py` plus new provenance tests. Browser smoke tests of Test sessions and campaign inspection; verify same-epoch distinct-run identity, stale/missing sidecars, manually staged legacy candidates, copied checkpoints, and independent human ratings. No new storage system, event queue, automatic evaluation, or autonomous winner selection.

## Safety and merge
Ship in small reviewable PRs, based on main. No merges without tests and browser checks; repository connector access cannot prove GPU/browser runtime correctness.
