# Training layout - pre-Codex documentation cleanup

Apply this together with the replacement `docs/stable_set_training_layout_plan.md` before asking Codex to implement the feature.

## Replace

Replace:

```text
docs/stable_set_training_layout_plan.md
```

with the new canonical implementation plan.

The new plan is **approved implementation target**, not tentative design.

## Delete

Delete these overlapping planning documents:

```text
docs/training_artifact_cleanup.md
docs/training_run_identity.md
```

Do not preserve them as parallel authorities. Their useful decisions are absorbed into the canonical stable-layout plan, and their flat-layout / legacy-compatibility assumptions are intentionally rejected.

## `docs/README.md`

Make these narrow changes only:

1. Set the review date to `2026-09-03` if it is still older.
2. Move `docs/vram_bucket_calibration.md` out of Planning/Direction and treat it as shipped/implemented documentation.
3. Add a small **Approved Implementation Plans** section containing:

```text
- `docs/stable_set_training_layout_plan.md` - approved clean-break implementation plan for deterministic per-set training roots, first-class Custom Resume, current-set managed checkpoint discovery, and self-contained resumed output.
```

4. Remove the active planning entries for:

```text
docs/training_run_identity.md
docs/training_artifact_cleanup.md
docs/stable_set_training_layout_plan.md   # remove from the tentative Planning list because it now has the approved section
```

5. Do not rewrite current-behavior references yet. They must continue to describe shipped code until Codex lands the implementation.

## `docs/outstanding.md`

Add this near the top, after `## Enhancements / Ideas` and before parked work:

```markdown
## Approved Next Implementation

- [Stable Set Training Layout and Resume](stable_set_training_layout_plan.md): implement deterministic per-set logical-run roots, current-set-only managed checkpoint discovery, and first-class explicit Custom Resume. This is a clean break: do not add legacy action/discovery compatibility or migration. Existing queued jobs may survive only if their already-recorded paths continue to work naturally; otherwise reset `.webcap_training`.
```

Do not duplicate the detailed implementation plan in `outstanding.md`.

## Current-behavior docs - leave until implementation lands

Do **not** preemptively rewrite these files to claim the new layout is already shipped:

```text
README.md
docs/spec.md
docs/train.md
docs/training_stabilization.md
docs/training_runner_contract.md
```

The Codex implementation must update only their directly affected training-layout/Resume sections in the same commit as the code.

## Why the clean break is deliberate

The old output/action directories remain ordinary files and are not migrated or imported. After the new code lands they are simply outside managed discovery. Any old checkpoint that matters remains usable through the explicit Custom Resume path.

If old `.webcap_training` queue/history state happens to keep working because it already contains usable concrete paths, it may finish naturally. If supporting it requires a legacy condition, old action-ID parser, migration, alias, or other special handling, do not add that code. Delete `.webcap_training` and start with clean convenience state.
