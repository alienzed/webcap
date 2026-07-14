# WebCap Docs Map

Last reviewed against code: 2026-07-14

This folder mixes three different kinds of documents:

1. Current-behavior references
2. Implementation notes for shipped features
3. Planning / design notes that are intentionally ahead of the code

Do not treat every file in `docs/` as live product truth.

## Canonical Current-Behavior References

Start here when you need to know what the app does today:

- `README.md` - best top-level map of the shipped app surface
- `docs/spec.md` - current behavior and route/workflow contract
- `docs/dataset_workflow.md` - end-to-end working flow
- `docs/config_file_system.md` - config-file discovery and edit flow
- `docs/filtered_selection_set.md` - visible-subset Prepare behavior
- `docs/train.md` - managed-training, readiness, queue, and manual-handoff behavior
- `docs/src_videos_semantics.md` - current `src_videos` rules
- `docs/phrase_copy.md` - helper panel, annotate strip, and tag copy/paste
- `docs/primer_mappings_v2.md` - structured mappings/rules storage and UI contract

## Shipped Feature Notes

These describe implemented features, but they are narrower than `README.md` / `docs/spec.md` and may lag if the UI is rearranged:

- `docs/create_set_from_results.md`
- `docs/duplicate_image.md`
- `docs/focused_annotation.md`
- `docs/annotation_term_affixes.md`
- `docs/review.md`
- `docs/console_panel.md`
- `docs/sets.md`

## Planning / Direction Docs

These are useful product notes, not authoritative implementation references:

- `docs/ui_gold_master.md`
- `docs/qa_panel.md`
- `docs/train_execution_preflight.md`
- `docs/generate_config_mode.md`
- `docs/repeat_targeting.md`
- `docs/face_counts.md`
- `docs/scene_complexity.md`
- `docs/selection_pose_stack.md`
- `docs/video_clip.md`

## Historical / Superseded

These are intentionally retained for context:

- `docs/archive/ui-revamp-2026-07/` - completed workspace-consolidation planning; use `README.md` and `docs/spec.md` for current behavior
- `docs/archive/`
- `docs/feature_spec.md`
- `docs/caption-review.md`
- `docs/media_metadata.md`
- `docs/media_metadata_panel.md`
- `docs/phrases_tags_balance_unification.md`
- `docs/caption_requirements.md`

## Notes From This Audit

- `docs/focused_annotation.md` previously documented `N` for `Not Applicable`, but the shipped modal currently supports `Enter` to mark reviewed and `S` to skip.
- `docs/create_set_from_results.md` was still written partly as a proposal even though `/fs/create_set_from_results` is implemented.
- `docs/duplicate_image.md` was also still framed as a proposal; the feature is shipped and has a concrete backend contract.

When a doc conflicts with code and does not explicitly say it is planning-only, prefer `README.md`, `docs/spec.md`, and the code.
