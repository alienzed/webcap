# Evaluation checkpoint discovery: Set-first audit and implementation

## Codebase findings
- `epoch_test_bench._staged_loras_for_set` correctly enumerates the configured Set Test LoRA directory. Sidecar provenance enriches it; no Training job record is needed for membership.
- Evaluation's saved campaigns are Set-scoped under the Test workspace. `epoch_finder._runs` was different: it began at the global Training queue / Recent Runs and only then discovered the Set's saved epochs.
- The existing `training_action.managed_actions_for_folder` is the Set-owned source of managed action manifests and `action/output` run directories. The older `training_history.discover_runs` is **not** a general saved-LoRA enumerator: it requires resumable DeepSpeed checkpoints and current configuration compatibility.
- Campaigns, Manual Screening and Test deep links record historical **jobId + epoch**, and `training_runner._candidate_run_snapshot` is still the shared checkpoint resolver. Replacing job IDs with invented directory IDs would break copies, staging, analytics and history.
- The managed action manifest preserves original job IDs per stage even if the global queue or Recent Runs entries disappear. When there is exactly one recorded job and a single matching saved run directory, provenance is sufficient to recover the original identity. More complex ambiguous associations must not be guessed.

## Safe implementation phases
1. **Audit identity and ownership**: preserve Set path mapping, action manifests, recorded job IDs and checkpoint artifact validation; do not reuse the resume-only discovery helper.
2. **Set-first available epochs**: start with each Set-owned action/output directory and the existing `saved_artifacts_for_run` verifier; enrich with queue/history when a recorded job path matches. Retain existing indexed legacy discovery for runs outside managed actions. Avoid hiding valid Set-managed epochs when the global Training queue is unavailable.
3. **Historical job resolution**: extend existing resolver narrowly for a uniquely provable action-manifest job/run mapping after queue/history/staged provenance fail. Do not rewrite saved campaigns or invent IDs. Leave ambiguous associations unresolved and visible as warnings/errors instead of selecting an arbitrary checkpoint.
4. **Regression and merge**: test empty Training indexes, saved epochs without resumable markers, queue/history overlap, ambiguous run identity, legacy indexed discovery and staging. Audit all diff paths against `AGENTS.md` and merge on green CI.

No new registry, cache, scanner process, backend queue, scheduled task, storage migration or data deletion. Renders, queues and frozen round plans remain unchanged.
