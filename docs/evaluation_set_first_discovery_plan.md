# Evaluation discovery — Set-first implementation and review

## Findings in the existing code
- `epoch_test_bench._staged_loras_for_set` already reads the Set's configured Test LoRA folder. Provenance enriches candidates, but does not decide their membership.
- `training_action.managed_actions_for_folder` resolves the Set-owned action manifests and output directories. `training_candidates.saved_artifacts_for_run` already validates actual epoch LoRAs.
- `training_history.discover_runs` is intended for **resumable DeepSpeed checkpoints**: it needs a valid `latest` marker and compatible training configs. It cannot replace saved-LoRA discovery.
- An action manifest can identify one original job ID and one output directory directly. **Multi-job or multi-output actions cannot always establish job-to-output identity** without existing indexed Training records. Do not invent an association.
- Existing `campaign.json` records use job IDs for historical run selections; user can remove obsolete Evaluation sessions, so this project does **not** add legacy Campaign repair or storage migration.

## Implementation phases
1. **Set-owned discovery.** Enumerate actual checkpoint files within the Set's managed action/output directories using the existing saved-artifact validator. Preserve original job IDs from action manifests only when job/output association is unique. Test LoRA discovery stays unchanged.
2. **Direct Evaluation consumption.** For uniquely associated saved checkpoints, copy their verified files directly into existing Campaign staging and inspect Test staging status without resolving a Training Runner job. Keep the established run/job resolver only as a fallback for ambiguous or non-managed historical runs.
3. **Read-only metadata and existing paths.** Keep optional training queue/history enrichment and legacy indexed-run support without making Set-owned epoch visibility depend on them. No changes to Training Runner, execution queues, saved Training state or inference requests.
4. **Regressions, audit, merge.** Cover absence of Training queue/history, saved epochs without resumable markers, unique/ambiguous associations, unrelated model stages, existing staging, legacy candidates, and preserved saved Evaluation data; run CI before merge.

## Bounds
No new service, registry, cache, background scanner, storage migration, automatic deletion or change to GPU operations. Source paths are obtained from server-managed Set action folders, not accepted from the client. Ambiguous associations remain explicit instead of silently guessing.

Evaluation's *Copy to Test* button still uses the existing Training Candidates copy endpoint. Reworking that user-initiated action is outside this read-only discovery cleanup.
