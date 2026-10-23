# Test Generations: 100+ candidate scaling cleanup

Scope: eliminate repeated queue-state file operations and DOM scans for large Test submissions. No throttling, limits, lane priority, persisted cache, or new queue ownership state.

## Phase 1 — Atomic batch insertion and promotion
- `execution_queue.enqueue_many()` appends an ordered set of jobs under the existing queue lock and persists once with the existing atomic file writer.
- `execution_queue.promote_backlog_many()` promotes only the submitted Test jobs in one write; unrelated backlog and existing queued work retain their ordering.
- `inference_runner.enqueue_test_many()` builds standard frozen Test job contexts and metadata.
- `epoch_test_bench._enqueue_frozen_test_request()` writes the complete session manifest before making the batch runnable.
- Tests cover 100 candidates, queue positions, FIFO, one write per batch operation, immutable request copies, and rejecting partial promotions.

## Phase 2 — Single queue snapshot per session read
- `execution_queue.jobs_by_id()` snapshots persisted public jobs under one lock/read, retaining legacy transient terminal receipts for jobs no longer in persisted state.
- `epoch_test_bench._session_job_records()` resolves all persisted references in one pass instead of one file read per job.
- No changes to session status, failure recording, cancellation, crash recovery, or provider checks.

## Phase 3 — Linear existing-card reconciliation
- `test_generations.js renderResults()` builds a per-render Map keyed by result ID, performs Set-based membership checks, and updates/adds/removes only affected cards.
- No retained DOM cache, no extra event listeners, and no changes to media element identity or user interaction.

## Verification
1. Run `pytest tests/test_execution_queue.py tests/test_epoch_test_bench.py tests/test_inference_runner.py`.
2. Run relevant JavaScript Test Generations DOM tests with their existing test harness.
3. Compare submission and refresh latency for 20, 100, and 200 candidates; confirm order, cancel, pause, resume, recovery, and live result updates.
4. Observe real-browser behavior on the target machine; no measured runtime claim is made until exercised there.

## Non-goals
Changing existing queue persistence format, GPU coordination, worker pacing, training, ComfyUI, or the Test UI design.
