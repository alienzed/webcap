# WebCap Docs Map

Last reviewed against code: 2026-08-30

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
- `docs/filtered_selection_set.md` - visible-media training capture behavior
- `docs/train.md` - run capture, managed queue, Resume, and manual-handoff behavior
- `docs/training_profiles.md` - supported models, persistent files, media requirements, and output roots
- `docs/dataset_config.md` - generated dataset roles, direct-folder capture, and saved-TOML behavior
- `docs/image_bucketing.md` - single-bucket image selection and audit behavior
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
- `docs/face_counts.md` - Face Focus metadata and review reporting
- `docs/scene_complexity.md` - image scene-complexity metadata
- `docs/selection_pose_stack.md` - optional MediaPipe selection-pose analysis

## Planning / Direction Docs

These are useful product notes, not authoritative implementation references:

- `docs/model-modules.md` - North Star for model-owned training configuration and policy boundaries
- `docs/ui_gold_master.md`
- `docs/qa_panel.md`
- `docs/generate_config_mode.md` - POC, Normal, and Quality mode behavior
- `docs/repeat_targeting.md` - dataset repeat calculation
- `docs/video_clip.md`
- `docs/frame-scrubbing.md` - tabled design for authoritative decoded-frame navigation and export starts
- `docs/vram_bucket_calibration.md` - separate H3 shape-calibration tooling whose safe shapes can clamp generated ceilings
- `docs/training_run_identity.md` - proposed run names, captured-config visibility, and experiment lineage
- `docs/training_artifact_cleanup.md` - visible training action layout and clean-break rollout
- `docs/lora_initializer.md` - proposed fine-tune-from-saved-LoRA workflow
- `wildcard_template.md` - parked wildcard-template-builder concept

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
- `docs/train_execution_preflight.md`

## Notes From This Audit

- Training references describe model visibility, mode-owned TOMLs, visible-media capture, immutable run bundles, managed Resume reuse, and current output conventions.

When a doc conflicts with code and does not explicitly say it is planning-only, prefer `README.md`, `docs/spec.md`, and the code.
