# Epoch Finder: tag-grounded wildcard / reference contract

## Goal
Treat scoped annotation groups/tags from the **selected training run's captured image membership** as authoritative for learned Primary dimensions. Keep Test Generations' general wildcard parser unchanged. Do not generate inference, rebuild captions, mutate tags, or add a second metadata model.

## Confirmed mismatch
- `epoch_finder_plan.build_proposal` previously invited combined/rephrased Primary options.
- `epoch_finder.js.prepareReferences` sent each free-text option to `suggest_references`, whose word-overlap heuristic could assign a different tag/annotation group.
- The wizard silently discarded unmatched Primary choices and could present 0 comparisons as a normal launch state.
- `create_campaign` verified each *submitted* reference but did not enforce complete coverage when RVN/DINO scoring was enabled or enforce the resolved Primary dimension's tag identity.

## Safe phases

1. **Constrain the Director proposal (applied).** Proposal instructions require every Primary dimension to use exact tag options from a single run-local annotation group. Independent trained concepts require independent wildcard groups. Generalization still uses Leakage/Vary; Test wildcard behavior remains unchanged.
2. **Resolve references deterministically (applied).** Wizard requests `reference_vocabulary` for the selected run, requires each Primary dimension's options to match precisely one scoped group, then retrieves `reference_candidates` by exact group/tag. Missing or ambiguous mapping is an actionable error; no guessed partial matches and no silently dropped Primary options.
3. **Validate before launch (applied).** `create_campaign` independently verifies each Primary dimension's group membership, every submitted reference's group/tag identity and run membership, and complete reference coverage for enabled RVN/DINO evaluation. No campaign artifacts are created before these checks.
4. **Regression & browser QA (pending local execution).** Check multi-group options, compound text, distinct tags shared by multiple groups, reference membership exclusions, stale saved selections, follow-up campaigns and VL-only campaigns. Confirm layout/error visibility in the current wizard, with zero inference or GPU work.
5. **Refinement after observed behavior.** If identical option sets occur in multiple groups, add an explicit group-choice control to the wizard rather than guessing. Do not add a general mapping/reconciliation layer. Preserve chosen group identity across edits and follow-ups only when concrete workflows demand it.

## Decisions / risks
- A Primary group whose option values occur identically in multiple annotation groups is **ambiguous**; the current safe behavior is to reject it rather than select arbitrarily. If common in real Sets, add explicit group selection as a separate targeted improvement.
- Existing campaigns remain readable because no saved manifest schema is changed. Follow-up wizard edits must pass the stricter new-run validation.
- VL-only tests may use Leakage or Vary choices without training references; RVN/DINO require exact Primary references. This guarantees coherent inputs, **not** model recognition or similarity-quality accuracy.

## Architectural audit
Follows `AGENTS.md`: existing file-local authority, owner-backed run membership and candidate routes, no novel queues, no global index, no new storage, no generic text-matching fallback, and required failures remain visible.
