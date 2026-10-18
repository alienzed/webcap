# Training History: permanent run deletion implementation plan

**Status:** implementation plan; no destructive endpoint enabled yet. Follow `AGENTS.md` and `docs/filesystem_state_contract.md`.

## Verified current code

- `tool/server/training_history.py` owns `recent_runs.json`; `clear_history_job` removes *only* an indexed row.
- `tool/server/training_runner.py` owns authoritative queue state and `clear_history_response` (which only hides a history record and persists the queue). Queue jobs distinguish `ACTIVE_STATUSES`, `QUEUE_STATUSES`, and terminal statuses.
- `tool/server/app.py` routes `/fs/training_history/job/clear` to the runner.
- `tool/js/training_history_ui.js` renders history rows and the existing clear action.
- Physical trainer output is recorded in `outputRunPath`; action/job evidence may be in `actionPath`, `artifactDir`, `artifactPath`. Resumes and candidate revisions may share a physical output directory.
- `_candidate_test_file_name`, `_candidate_test_directory_for_run`, and `_candidate_test_sidecar_path` in `training_runner.py` identify Copy to Test artifacts. Their `.webcap.json` provenance records source identity.
- `save_candidate_epoch` can copy a selected candidate to a user-selected destination without writing the same provenance sidecar. **Do not infer deletion ownership by basename**.
- `docs/training_runner_contract.md` separates queue intent from recent-history presentation. `docs/train.md` describes action-owned frozen inputs and trainer directories.

## Phase 1 — precise backend ownership and preview

Create a dedicated delete-run helper in the existing Training runner/history ownership, not a new service or scheduler.

1. Resolve the selected row by recorded folder + job ID, on the server. Resolve its exact physical `outputRunPath` (the trainer timestamp folder), not merely `outputRoot` or a client-supplied path.
2. Gather *all* history entries referring to that same physical run path (including resume/revision records), and their recorded action/job artifact directories. Deduplicate paths; identify the **job/capture-specific** leaves, not the shared logical-run parent.
3. Read current Training queue state under its existing lock. Refuse deletion if **any active or queued Training job** references that physical run directory through `outputRunPath` **or** `resumeFromCheckpoint`, or references an action/job directory scheduled for removal. Include paused/continuation jobs represented as queued work. Do not block for completed history references or inference/evaluation/Test jobs.
4. Validate each deletion target against its known owner and expected directory shape; never delete a parent runs root, source Set media, configured Test root, or another run's directory. Missing already-deleted artifacts are shown as absent, not reconstructed.
5. Return a preview: exact trainer directory, action/job paths, count of history rows, and candidate copies eligible for optional cleanup.

Phase gate: unit tests for multiple rows sharing output, active/queued train job blocked, terminal jobs allowed, missing paths, unsafe parent-path targets.

## Phase 2 — permanent backend deletion

Implement an explicit `POST /fs/training_history/job/delete` using the **same** authoritative resolver/check as preview, rechecking queue state while holding the existing Training lock to avoid a preview/execution race. Respect the runner's existing queue/history lock ordering; do not add a new lock.

- Delete the exact timestamped Diffusion Pipe output directory and associated *run-owned* job/artifact/frozen-media directories **at verified action/job leaves only**. Do not remove an entire logical-run parent containing other captures/jobs.
- Retire matching terminal queue records through the existing `_write_state(..., retired_job_ids=...)` mechanism (and check continuation bookkeeping) so `_sync_histories` cannot recreate deleted history. Remove all history entries sharing the physical directory **only after** artifact cleanup completes. Ensure a retry remains possible if any filesystem operation fails.
- If optional candidate cleanup is selected, remove only Copy to Test files with verified matching provenance (and their sidecars); never sweep all Test sessions or unrelated Set-level files.
- Missing paths are ordinary idempotent cleanup; genuine I/O failures surface in the global Console and endpoint response. Do not report an uncompleted delete as success.
- No Archive, soft-delete, trash, generalized dependency manager, or special downstream inference failure checks.

Phase gate: focused filesystem tests with temporary training and Test roots, including failure mid-delete and retry, history reappearance after status reconciliation/restart, queued continuation references, and unrelated data surviving.

## Phase 3 — Training History UI

Add **Delete Run** next to the existing history actions in `training_history_ui.js`. Keep **Clear history entry** unchanged as a metadata-only operation.

- Open a small confirmation dialog showing the server preview (not client-guessed paths/counts).
- Include **Delete associated Test candidates** checkbox checked by default, clearly scoped to provenance-proven copies.
- On confirmation invoke the permanent delete endpoint; refresh Training History and queue state; show any actual filesystem errors in the global Console.
- Use existing app modal / request / event conventions. No new frontend persistence.

Phase gate: manually verify one completed run, shared-history Resume, optional candidate off/on, queued/running Training block, and missing directory.

## Phase 4 — regression audit

Run focused Training runner/history/Test candidate tests, then the full available suite. Review changes against `AGENTS.md`, `training_runner_contract.md`, and filesystem ownership contract. Specifically ensure `Clear History`, `Finalize & Archive`, and existing Copy to Test behavior are unchanged.

**Known capability boundary:** copies produced by `save_candidate_epoch` without a durable source sidecar are not reliably attributable after arbitrary renaming or moving. Keep them out of automatic candidate cleanup unless that existing save workflow is extended to record provenance going forward. Historical untracked copies are never guessed.
