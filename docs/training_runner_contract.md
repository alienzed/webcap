# Training Runner Contract

WebCap is a best-effort training command dispatcher, not the authority over training.

## Core Principles

- Training processes and output artifacts exist independently of WebCap.
- The queue is disposable convenience state. Losing it may forget ordering and control, but must not damage training output or disable future training.
- Exact evidence such as a verified PID, runner script, result record, or checkpoint path should be used when available.
- Missing or uncertain evidence must remain visible and recoverable. It must never create an immortal active state.
- Progress, logs, history, and presentation metadata improve the workflow but never decide whether training is allowed.
- Failures stay local to their item. One bad job or artifact must not poison the rest of the queue.
- Safety comes from explicit, reversible mutations, not defensive gates that trap the user.

## Queue Model

The queue is globally running or paused. Only its first item is actionable.

- `Pause` interrupts the active run, keeps that work first, and holds the queue.
- `Resume` runs the first item again, using its recorded checkpoint when one exists.
- `Finish` intentionally ends the active run and lets the next item start.
- `Cancel` removes queued intent only. It does not delete trainer output.

There is no independently paused item elsewhere in the queue and no user-facing action that merely disables a later handoff while the current run continues.

## Runner Recovery

On refresh or restart:

- A plainly verified live runner is reattached.
- A plainly absent runner becomes a local interrupted outcome, allowing the queue to continue.
- If runner inspection itself is unavailable, the same job returns to the front as queued intent and the queue pauses for the existing `Resume` or `Cancel` action.
- Uncertain evidence never occupies the active runner slot indefinitely.

Removing queue state means forgetting WebCap's queue. It does not kill external processes or delete training output.

## State Ownership

- `queue.json` owns ordered live dispatch state.
- Each job bundle owns its launch script, copied configuration, PID, action, log, and result evidence.
- `recent_runs.json` owns presentation history and never participates in scheduling.
- Set-local training metadata remembers optional conveniences such as the set's output group.

Helpful metadata may fail independently. Only the explicit information needed to launch the next command may influence dispatch.
