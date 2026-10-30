# WebCap Docs Map

Documentation index reconciled: 2026-10-30. A repo-wide link inventory covered 155 Markdown files; active-contract comparisons were targeted, not a line-by-line verification of every historical plan.

This folder mixes three different kinds of documents:

1. Current-behavior references
2. Implementation notes for shipped features
3. Planning / design notes that are intentionally ahead of the code

Do not treat every file in `docs/` as live product truth.

## Canonical Current-Behavior References

Start here when you need to know what the app does today:

- `README.md` - top-level map of the app workspaces, shared shell, and workflows
- `docs/spec.md` - current behavior and route/workflow contract
- `docs/dataset_workflow.md` - end-to-end working flow
- `docs/config_file_system.md` - config-file discovery and edit flow
- `docs/filtered_selection_set.md` - visible-media training capture behavior
- `docs/train.md` - run capture, managed queue, Resume, and manual-handoff behavior
- `docs/training_runner_contract.md` - managed Training lifecycle, ownership, recovery, and failure behavior
- `docs/training_profiles.md` - supported models, persistent files, media requirements, and output roots
- `docs/training_review.md` - bucket review plus the relationship between Run setup overrides and persistent TOMLs
- `docs/dataset_config.md` - generated dataset roles, direct-folder capture, and saved-TOML behavior
- `docs/repeat_targeting.md` - fixed-reference repeat calculation and its separation from run epochs
- `docs/app_settings.md` - Settings tabs, runtime paths, Copy-to-Test roots, and repeat-reference setting; tab names reconciled 2026-10-18
- `docs/image_bucketing.md` - single-bucket image selection and audit behavior
- `docs/src_videos_semantics.md` - current `src_videos` rules
- `docs/phrase_copy.md` - helper panel, annotate strip, and tag copy/paste
- `docs/primer_mappings_v2.md` - structured mappings/rules storage and UI contract
- `docs/execution_queue.md` - shared inference/LLM scheduling, backlog, GPU arbitration, and Activity/queue boundaries; state path reconciled 2026-10-18
- `docs/gpu_coordination_invariants.md` - authoritative local-GPU coordination invariants; runtime truth, ownership, restart, and deterministic dispatch
- `docs/storyboard.md` - broader Storyboard storage/production architecture and phased history; its underlying legacy LLM operations are **not** the active Studio Director field contract
- `docs/storyboard_llm_guidance.md` - underlying Storyboard authoring/generation boundaries and legacy operations; distinguished from current Studio controls
- `docs/studio-blocks.md` - current standalone Studio Blocks library and explicit `/` insertion workflow
- `docs/mmh3-prompt-runtime-context.txt` - **active H3 model-facing prompt shape** used by Studio Director and legacy prompt authoring
- `docs/mmh3-prompt-guidelines.md` - human-readable H3 guidance and distinctions between active Studio and legacy Storyboard requests
- `INSTALLATION.md` - current installation/bootstrap and environment-diagnostics guide

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
- `docs/lora_initializer.md` - fine-tune-from-saved-LoRA workflow and validation rationale
- `docs/frame-scrubbing.md` - authoritative decoded-frame navigation and exact clip starts
- `docs/vision_schema_assist.md` - active Structured Sight / vocabulary discovery and guided tagging boundaries
- `docs/progressive_deep_qa.md` - implemented Deep QA behavior with dated implementation-plan history; current per-item retries differ from its original phase text

## Planning / Direction Docs

These are useful product notes, not authoritative implementation references:

- `docs/live_activity_panel.md` - design history for Activity presentation; verify shipped behavior in the app and execution queue reference

- `docs/model-modules.md` - North Star for model-owned training configuration and policy boundaries
- `docs/queue-semantics.md` - product queue-semantics North Star, **not** a claim that every fine-grained behavior is implemented
- `docs/studio-director-expertise.md` - living expertise gap/evidence tracker, not runtime authority or proof of live-model behavior
- `docs/studio-director-materialization-contract.md` - staged Studio intention-to-reviewed-Apply implementation record; distinguish historical checkpoints from shipped code
- `docs/studio-director-revamp.md` - historical evolution/design plan, not the present Studio Director primer
- `docs/filesystem_state_contract.md` - authoritative filesystem lifecycle rules (partially migrated; contains historical/planned sections)
- `docs/ui_gold_master.md`
- `docs/workspace_shell_architecture_audit.md` - pre-refactor shell audit retained as architecture history; superseded by the completed shell
- `docs/ui_shell_refactor_plan.md` - completed phased migration record for the permanent activity rail/header shell
- `docs/qa_panel.md`
- `docs/generate_config_mode.md` - current model/stage dataset configuration
- `docs/video_clip.md`
- `docs/vram_bucket_calibration.md` - implemented H3 shape calibration, persistent result reuse, Training Settings controls, and calibrated bucket margins
- `docs/stable_set_training_layout_plan.md` - approved set-root/logical-run layout and Resume implementation record
- `docs/webcap-lora-valley-candidate-detection.md` - retrospective TensorBoard valley selection and staged LoRA candidates
- `docs/high_confidence_analysis_scanner.md` - future confirmed-signal scanner boundaries and evidence rules
- `wildcard_template.md` - parked wildcard-template-builder concept

## Historical / Superseded

These are intentionally retained for context. Some have a current-status preface because later implementation superseded part of their original design:

- `docs/epoch_test_bench_plan.md` - original Test Bench architecture; its in-memory FIFO and original session-placement design predate the shared inference lane
- `docs/prompt_assistant_activity_plan.md` - retained-model/activity-card implementation history; its original synchronous request transport predates the durable `llm` lane
- `docs/generic_inference_generate_plan.md` - implementation sequence/history; its current-baseline preface is maintained while older phase text remains historical

Additional superseded references:

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

- **Coverage:** inventoried 166 `docs/` files, checked local Markdown links in all 155 `.md` files, and compared priority active references against current source and tests. This was **not** a line-by-line semantic audit of every design/plan file.
- **Confirmed drift:** Deep QA's original fail-fast plan did not describe current per-item invalid-output deferral/retry; the H3 human reference blurred active Studio fields with legacy Story Guidelines/Entry/Exit state; the Studio expertise tracker still exposed already-resolved P0 items as fresh gaps. These references have dated corrections.
- **Links:** three bad relative paths in the archived `feature_spec.legacy-2026-05.md` were repaired; active Markdown links checked in this pass were valid.
- **Current-vs-history rule:** Plan, design, audit, and revamp documents are snapshots unless explicitly verified as present-tense contracts. Historical phase steps are preserved, not automatically converted into implementation requirements. A follow-up verified that legacy Storyboard prompt/context claims must not be read as current Studio instructions.
- **Training baseline:** model visibility, visible-media capture, per-run LR/rank/epochs/dropout overrides, fixed-reference repeat planning, logical-run ownership, lightweight Training History, and Resume/Test boundaries remain documented in their specialist references.

## Documentation maintenance notes

The README and this index describe navigation, not a guarantee that every specialist document has been audited recently. In particular, inspect queue persistence paths, output-root separation, UI labels, and implementation-status claims against current code before relying on older prose. Do not promote a proposal into shipped behavior merely because it appears in a design document.

When documents disagree, the current implementation and `AGENTS.md` constraints take precedence. Update any affected behavior reference alongside its code change.
