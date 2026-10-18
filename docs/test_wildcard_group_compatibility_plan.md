# Test Generations wildcard compatibility — phased implementation

Ownership: Test Generations generates wildcards. Epoch Finder consumes those wildcards and alone validates references against the selected training run.

## Phase 1 — Supply observations at generation time (implemented)
- Read existing `.webcap_state.json` scoped tag annotations for actual Set media.
- Compute observed same-group tag sets; keep different groups independent.
- Supply the observations and exclusivity rule to the shared wildcard Director proposal.
- Preserve the existing Test Generations parser, captions, inference behavior, and saved campaigns.

## Phase 2 — Deterministic structured construction (outstanding)
- Require group identity on each learned-tag dimension in the structured wildcard proposal, not an inferred relationship from phrase overlap.
- Validate proposal groups/options against the scoped Set vocabulary and observed combinations, checking all resolved within-group choices. For multi-value group options, only accept combinations actually observed in a single item.
- Resolve and reject invalid proposal combinations before accepting the proposal in Test Generations. Preserve cross-group combinations even if unobserved.
- Avoid broad substring matching in natural prompt prose: tag identity must be explicit.
- Do not silently drop or rewrite incompatible alternatives; show a useful actionable error.

## Phase 3 — Epoch Finder reuse (outstanding)
- Consume the validated structured wildcard contract. Keep run-specific training membership and reference checks in Epoch Finder.
- Do not reintroduce an Epoch Finder-only compatibility implementation; the earlier `fix/epoch-finder-group-compatibility` branch is superseded and unmerged.

## Phase 4 — Real-case QA (outstanding)
- Test a multi-tag group with observed and unobserved combinations, overlapping text in different groups, and a run with fewer images than the Set.
- Verify generated wildcard expansion never produces forbidden same-group pairs, including nested alternatives; verify no cross-group exclusion.
- Verify actual browser workflow without starting generation/training.

## Limitation of phase 1
Phase 1 changes the Director's evidence and instructions. It does not yet enforce compatibility deterministically on the returned prompt; tests must not claim otherwise. No new database, index, runtime queue, or tag storage.
