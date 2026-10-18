# Backend-owned Revise Scenes

## Phase 1 — Existing contracts
Revise Scenes previously called `runSceneDirectorPass` in browser JS, issuing one
`refine_prompt` LLM request per Scene and waiting for it before issuing the next.
The existing `llm_runner` owns queue execution and applies validated prompt changes
via `storyboard_store.apply_director_prompt`.

## Phase 2 — Queue ownership
Storyboard POST `/fs/storyboard/director` with operation
`revise_scenes_sequence` queues **one** job in the existing LLM lane containing
the Story ID, fixed Scene ID order, user instruction, and model. No new queue
or filesystem state is introduced. This replaces only the frontend sequence.

## Phase 3 — Worker execution
The backend processes those Scene IDs in order, regenerating each
`refine_prompt` contract from the current saved Story and applying the existing
validated result. Completed Scene changes persist immediately. Failure stops the
sequence and reports the number completed; stop checks occur before and after
each model call. The rest of the queue behaves normally.

## Phase 4 — UI and regression
The existing Revise Scenes button submits the batch job, polls its receipt,
reloads the Story on completion, and uses the existing recovery watcher on
reentry. Leaving the Storyboard view does not cancel the worker job.
Tests should cover multi-Scene ordering, failure after a partially completed
sequence, browser-navigation independence, cancellation and other Director
operations.

This preserves one-model-call-per-Scene output quality rather than replacing
the workflow with the bulk `repair_scenes` contract. As with the existing
ephemeral LLM lane, a **server restart** does not resume unfinished LLM jobs;
this is a browser-navigation/refresh resilience improvement, not durable
server-restart recovery.
