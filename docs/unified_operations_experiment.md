# Unified Activity & Queues — reversible UI experiment

## Phase 1: preserve execution ownership
- Existing `inference_queue.js`, `job_queues.js` and `activity_monitor.js` continue fetching, rendering, and controlling their own jobs.
- Shared `operations_drawer.js` only reparents the existing DOM and selects a single visible section.
- No modifications to backend scheduling, queue persistence or GPU arbitration.

## Phase 2: entry points and interaction
- Header workload icon opens the Activity section.
- Bottom-left Job Queues control opens Queues, keeping Inference / LLM / Training tabs and all existing actions.
- History uses the existing bounded, session-scoped Activity list.
- Manual section changes are never overwritten by incoming Activity updates. Only one section is expanded.

## Phase 3: de-duplication
- Queue's active job is a compact row above waiting jobs; no telemetry graph is copied into the queue.
- Activity retains its full card and separate local/remote representation.
- Activity's old primary queue teaser is hidden in the shared shell. Queue execution controls remain where they already live.

## Phase 4: validation before merge
- Confirm both entry points, repeated opening/closing, Escape, outside click, and retained selected lane.
- Confirm simultaneous local GPU and remote LLM, and that remote cards do not inherit the GPU graph.
- Confirm every Inference, LLM and Training action (including confirmations, reordering and drag/drop) in a live test system.
- Confirm activity events do not steal a manually selected section.
- Confirm Recent appears after completion and does not acquire new persistence.
- Check responsive width, graph sizing and queue scrolling.

This is a branch-scoped experiment. No feature flag, backend route, scheduler or new state file has been added. A live browser/runtime validation is required before merge.
