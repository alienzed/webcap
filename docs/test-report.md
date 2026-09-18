# Test Report v1

## Goal

Add a simple set-wide report for Test Generations so rated generated videos can be rolled back up to their source training epochs.

The report should help answer:

- Which run + epoch combinations performed best?
- How much evidence exists for each score?
- What qualitative tags/notes are associated with those results?
- Which staged or source epochs should be removed after testing?

This should stay small and evidence-driven. The generated videos remain the observations; epoch scores are derived from those rated results.

## Scope

- Report scope is the **current set**.
- Launch point is **Training**.
- Aggregate across all Test Generation sessions found under the current set.
- Group results by **source run + source epoch**.
- Sort groups by **score, highest first**.

## Provenance

Test Generation results already preserve enough provenance to support this:

- source training job / run
- source epoch
- staged LoRA filename
- generated video
- prompt
- seed

Generated videos remain the primary evidence. The report derives run/epoch summaries from that evidence rather than introducing a separate manually maintained epoch-rating system.

## Scoring

For each source run + epoch:

- Use the existing media star rating on generated videos.
- Average **rated videos only**.
- Do not treat unrated videos as zero.
- Show both the average and coverage, for example:
  - `4.3★ · 3/5 rated`

If no generated videos are rated, the epoch has no score yet.

The report should not automatically declare a winner or delete anything based on score.

## Tags / Notes

Use generated-video tags as qualitative evidence alongside the numeric rating.

For v1, all tags may be included unless a cleaner special grouping becomes obviously useful during implementation.

Example:

`great detail ×2 · identity leak ×1 · weak motion ×1`

A dedicated test-note/tag namespace can be introduced later if ordinary media tags become too noisy.

## Display

Prefer a simple stacked list/card layout rather than a dense table.

Example:

```
Run 03 · Epoch 24
4.3★ · 3/4 rated · 2 prompts
great detail ×2 · stable clothing ×2 · weak motion ×1

[Open Results] [Remove from Test] [Delete Source Epoch]
```

Use the existing compact run identity / explicit run name where available so results from multiple same-set experiments are easy to distinguish.

For v1, show aggregate totals rather than a detailed prompt-by-prompt breakdown.

Prompt count and/or seed count may be shown when useful.

## Cleanup Actions

### Remove from Test

Remove the staged LoRA copy from the configured Test folder.

- This is a staging cleanup action.
- It should not delete generated test videos.
- It should remove the associated WebCap provenance sidecar.
- Existing source training output remains untouched.

### Delete Source Epoch

Provide an explicit destructive action for epochs that clearly failed testing.

Expected behavior:

- delete the actual saved source epoch/checkpoint directory
- remove its staged Test copy if present
- keep generated test videos/report evidence unless we deliberately decide otherwise
- require clear confirmation before deletion

This action must use stored provenance to resolve the source run/epoch. It should not infer destructive filesystem targets from display filenames alone.

## Multiple Prompts and Seeds

The report data model should naturally extend to:

```
run -> epoch -> prompt -> seed -> generated video -> rating/tags
```

Initial Test Generations uses one prompt and one fixed seed, but results already record prompt and seed.

A future multi-prompt workflow can therefore aggregate the same way without redesigning the report.

Likely progression:

1. one prompt × one fixed seed × N epochs
2. a small prompt set × one fixed seed
3. optional additional seeds for finalists / ambiguous epochs

The report should continue to score the observed generated videos and aggregate upward by source run + epoch.

## v1 Non-Goals

Do not add:

- automated winner selection
- automated epoch deletion
- weighted scoring
- prompt-specific scoring UI
- seed-quality heuristics
- experiment dashboards
- a separate epoch-rating database
- automatic training feedback / retraining decisions

Keep v1 as a lightweight report over existing media ratings, tags, and provenance.

## Open Implementation Details

The implementation should confirm the simplest way to:

- discover all Test Generation session folders for the current set
- retrieve existing media ratings and tags for generated videos
- map those videos back to their source run + epoch using `test.json` provenance
- expose report launch from Training without adding another major workspace surface

Prefer existing WebCap media/rating/tag APIs over creating parallel storage.
