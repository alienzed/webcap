# GPU Dispatcher Migration Plan

> **Status:** implementation plan only. No runtime code changes are included in this document.
>
> **Grounding:** this plan was derived from the current `main` branch and hostile-audited again after the queue-semantics rewrite at commit `0d187973ef3e340da4269079af7f17f25fd0f28c`. The audit covered `docs/queue-semantics.md`, `tool/server/execution_queue.py`, `inference_runner.py`, `llm_runner.py`, `training_runner.py`, `storyboard_llm_runtime.py`, `inference_runtime.py`, `activity_monitor.py`, startup wiring in `app.py`, and the queue/runner regression tests.
>
> The goal is not to merge the three domain queues. The goal is to replace distributed GPU negotiation with one small ephemeral dispatcher while keeping lane-specific work, ordering, recovery, and failure semantics inside each lane.

## 1. Problem statement

WebCap currently has three local-GPU clients:

- **Inference** — durable Queue/Backlog work executed through ComfyUI.
- **LLM** — server-session FIFO work executed locally through llama.cpp or remotely without the local GPU.
- **Training** — specialized long-running Diffusion-Pipe work with its own durable queue, checkpoint semantics, recovery, and history.

The shared GPU is currently coordinated indirectly. Each subsystem contains some combination of:

- shared-owner inspection,
- cross-lane queue inspection,
- runtime cleanup of another lane,
- direct reservation attempts,
- retry monitors,
- persisted-state interpretation.

The most important current cross-lane dependencies are:

- `inference_runner._local_llm_work_pending()` reads the LLM lane before Inference acquires the GPU.
- Inference and LLM both call `training_runner.reserve_gpu_for_external_work()`, which reads Training queue state before allowing another lane to reserve the GPU.
- `llm_runner._queue_wait_state()` calls `training_runner.gpu_reservation_block_reason()`.
- Training and Inference call `storyboard_llm_runtime.release_loaded_model_for_gpu_work()` before they start.
- Training calls `_prepare_comfyui_for_training()` to inspect ComfyUI before it starts.
- `storyboard_llm_runtime.chat()` can reserve the GPU itself when called without an already-reserved flag.
- `execution_queue.py` owns a process-local `_resource_owner`, but it is not itself the dispatcher; each lane independently decides when to acquire or release it.

The result is distributed scheduling. The same yes/no execution decision is partly recreated in several places.

## 2. Target architecture

The target is:

```text
domain lane owns work
        |
        | submit runnable client claim
        v
+----------------------+
| ephemeral GPU        |
| dispatcher           |
|                      |
| pending clients      |
| one active client    |
+----------------------+
        |
        | dispatch(client)
        v
client lane re-checks only its own state
        |
        +-- started      -> client owns GPU lease until release
        +-- not_ready    -> dispatcher skips it and tries another client
        +-- empty/stale  -> submission is removed
```

The dispatcher does **not** own domain jobs. It owns only current execution eligibility.

A submission is therefore not a second copy of an Inference/LLM/Training job. It is an ephemeral statement:

> “This client currently has local-GPU work worth considering.”

The domain queue remains the source of truth for:

- exact job ordering,
- job payloads,
- pause/resume semantics,
- Queue vs Backlog,
- cancellation and stop,
- restart behavior,
- provider/process identity,
- result application,
- history.

This is deliberately closer to an OS run queue than to a second job database.

## 3. Core invariants

The implementation should be judged against these invariants.

### 3.1 One common authority

Only the GPU dispatcher may grant local-GPU execution.

No lane may independently reserve the GPU after cutover.

### 3.2 The dispatcher is ephemeral

Dispatcher submissions and active ownership are process-local only.

They are never written to:

- `execution_queue.json`,
- `training_queue.json`,
- Story/Test/Generate state,
- any new dispatcher state file.

A restart starts with an empty dispatcher.

### 3.3 Domain state does not become dispatcher truth

Persisted queue state can tell a lane what work exists and what future user intent was.

It cannot directly restore dispatcher ownership.

The only restart exception is an actually surviving runtime that its owning lane positively re-establishes from authoritative runtime identity.

### 3.4 Clients do not inspect one another

Inference does not inspect LLM or Training state.

LLM does not inspect Training or Inference state.

Training does not inspect ComfyUI or llama state to determine whether another client is safe.

Cross-lane ordering comes from dispatcher submissions, not cross-lane reads.

### 3.5 The dispatcher does not inspect runtimes

The dispatcher never calls:

- ComfyUI,
- llama.cpp,
- WSL,
- `nvidia-smi`,
- provider status endpoints,
- process inspection,
- queue JSON readers.

Those facts are meaningful only to the owning client.

### 3.6 The dispatcher owns switching; the outgoing client owns cleanup

A client never clears shared GPU ownership by itself.

When a client reaches its lane-defined natural boundary, it marks its lease **idle/parked**. A parked lease may keep the client's runtime/model cache resident.

The dispatcher then owns the only decision that matters:

- no different client needs the GPU -> leave the current lease parked; do no cleanup,
- the same client becomes runnable again -> reuse the parked lease,
- a different client is selected -> ask the outgoing client to hand off, then transfer the lease.

The dispatcher therefore knows **when** VRAM cleanup is needed without knowing **how** to perform it.

The outgoing client implements the cleanup through its handoff callback. The incoming client never cleans another client's runtime.

This intentionally avoids unloading ComfyUI/llama merely because the GPU is momentarily idle.

### 3.7 No indefinite uncertainty hold

Positive authoritative evidence of still-running managed work may keep a client's lease.

Unknown, unreachable, stale, or ambiguous state must not create an immortal dispatcher claim.

A bounded cleanup/reconciliation failure is surfaced loudly and the owning lane resolves its own job state.

### 3.8 No global domain FIFO

The dispatcher does not replace lane ordering.

Inference keeps Queue/Backlog order.
LLM keeps FIFO.
Training keeps its specialized queue.

The dispatcher orders only **client claims for one GPU**.

## 4. Dispatcher contract

Create a new module:

`tool/server/gpu_dispatcher.py`

Do not embed this into `execution_queue.py`. That file remains the domain-queue substrate; the GPU dispatcher is a separate, process-local resource scheduler.

### 4.1 Minimal state

The dispatcher needs only:

- registered client callbacks,
- at most one pending submission per client,
- a monotonically increasing submission revision per client,
- priority/order plus insertion sequence,
- at most one lease with a unique lease ID,
- lease phase: `granting`, `active`, `parked`, or `handoff`,
- one wake primitive and one dispatcher worker,
- passive diagnostic snapshot data.

No provider IDs, domain job IDs, queue payloads, runtime health, VRAM measurements, or feature state belong here.

Keep the concurrency fencing, but do not grow it into a generalized scheduler:

- the **lease ID** prevents an old worker from completing/releasing a newer lease,
- the **submission revision** prevents an old dispatch/cancel result from erasing newer work.

### 4.2 Client registration

Each local-GPU client registers two callbacks:

```text
dispatch_callback(lease_id, submission_revision)
handoff_callback(lease_id)
```

Neither callback runs while the dispatcher lock is held.

The dispatch callback re-checks lane-local truth, claims the lane's current exact work, starts a lane-owned worker/process, and returns quickly.

The handoff callback cleans only that client's runtime.

### 4.3 Submission

```text
submit(client_id, priority)
```

There is one pending submission per client.

Re-submit:

- never creates a duplicate queue entry,
- re-arms a previously not-ready client,
- advances/replaces the submission revision when needed,
- may update the client's current scheduling priority,
- wakes the dispatcher.

A submission is only “this client has GPU work worth considering.” It is not a second copy of the lane's job queue.

### 4.4 Withdrawal

```text
withdraw(client_id, submission_revision=None)
```

Withdrawal removes pending execution eligibility only.

It never changes an active/parked lease.

A revision-aware withdrawal cannot erase a newer submission.

### 4.5 Dispatch result

When there is no lease, or a lease is parked and owned by the selected client, the dispatcher grants/reuses that lease and calls the client's dispatch callback outside the lock.

The callback returns:

- **STARTED** — exact lane work started under the lease,
- **NOT_READY** — the submission is still meaningful but cannot start now,
- **EMPTY** — it no longer represents runnable work.

`NOT_READY` is not a persisted blocker. The dispatcher moves on immediately and the lane re-arms its submission when its local condition changes.

A stale callback result affects only the revision it received.

The callback must not execute the full long-running workload synchronously. The lane worker owns that lifetime.

### 4.6 Marking a lease idle

When the lane reaches its natural non-preemptive boundary:

```text
mark_idle(client_id, lease_id)
```

The lease ID must match the current lease.

The dispatcher marks the lease `parked` and immediately evaluates pending submissions.

- If no other client needs the GPU, leave the lease parked and keep the runtime warm.
- If the same client is selected, reuse the lease with no cleanup.
- If a different client is selected, begin handoff.

There is no separate “release to idle” path.

### 4.7 Client switch / handoff

For a different selected client:

1. mark the existing parked lease `handoff`,
2. call the outgoing client's `handoff_callback(lease_id)` outside the dispatcher lock,
3. on success, retire the old lease,
4. grant a fresh lease to the selected client.

Once handoff begins, late work from the old client becomes a normal pending submission; it does not cancel cleanup already in progress.

If handoff fails, the old lease remains the current lease and no different client starts. Surface the real cleanup failure.

### 4.8 Snapshot

A passive snapshot contains only:

- lease phase,
- active/parked client,
- lease age/identity for diagnostics,
- ordered pending clients,
- priority/order and deferred state.

The UI does not need raw lease tokens.

Snapshot never invokes callbacks or scheduling.

### 4.9 Race rules

The dispatcher lock protects dispatcher state only.

Required guarantees:

- never more than one provisional/active/parked local-GPU lease,
- stale lease completion cannot affect a newer lease,
- stale submission results cannot erase newer submissions,
- callback exception cannot strand a provisional lease,
- cancellation/reorder between submission and dispatch is resolved by the lane's dispatch-time re-check,
- a same-client submission can reuse a parked lease,
- a different client cannot start before outgoing handoff succeeds.

## 5. Scheduling policy

The current effective policy should be preserved during migration.

When there is already an active client, it remains non-preemptive until that client releases.

When the GPU becomes free, current effective next-turn behavior is:

1. runnable Training,
2. local LLM,
3. foreground Inference Queue,
4. opportunistic Inference Backlog.

The dispatcher does not need semantic names for those classes. Clients can submit a generic integer priority.

For example:

```text
Training            10
local LLM           20
Inference Queue     30
Inference Backlog   40
```

Lower number runs first; equal priority is FIFO by submission sequence.

These values are policy, not durable data.

### 5.1 Why priority belongs at submission time

The dispatcher should not open a Training queue to discover that Training deserves the next turn.

Training says it has runnable work and submits at Training's priority.

Likewise, Inference decides whether it is foreground Queue or Backlog before submitting.

The common layer sorts claims; it does not derive them.

## 6. Inference client design

### 6.1 Preserve

Keep:

- durable Inference Queue and Backlog,
- frozen request payloads,
- Queue-before-Backlog,
- Queue/Backlog promotion and parking,
- Inference pause/resume,
- reorder/cancel/stop,
- provider availability as an Inference-local readiness fact,
- exact Comfy provider IDs persisted before submission,
- exact provider polling/cancellation,
- execution-failure behavior that preserves the head request and pauses Inference,
- restart shelving to Backlog,
- committed-output recovery,
- current-session exact provider hold behavior when provider work is positively still active.

### 6.2 Replace

Replace `_advance_queue()` as a cross-lane scheduler with two responsibilities:

1. **submission synchronization** — decide whether Inference should currently have a dispatcher claim;
2. **dispatch callback** — when the dispatcher grants Inference, re-check lane-local state and start/drain the appropriate work.

Inference should submit:

- foreground priority while unpaused Queue work exists;
- Backlog priority only when Queue is empty and Backlog draining is explicitly enabled.

On WebCap restart, `_backlog_drain_enabled` remains clear and no Inference dispatcher claim is created.

### 6.3 Provider unavailable

Before claiming a domain job, Inference may call its own authoritative availability check.

If ComfyUI is unavailable:

- return `NOT_READY`,
- leave the domain job untouched,
- keep the lane-local wait reason “ComfyUI unavailable”,
- allow the dispatcher to try another client,
- re-arm the submission from Inference's own retry mechanism.

The dispatcher never learns what ComfyUI is.

### 6.4 Foreground drain

Once Inference receives the GPU lease, preserve the existing foreground drain rule:

- Inference may execute consecutive foreground Queue jobs while it keeps the lease.
- It does not yield merely because another client submitted after Inference already became active.
- At the Queue-to-Backlog boundary, Inference releases the lease.
- If Backlog remains eligible, it then submits a low-priority Backlog claim.

This preserves the behavior covered by the current queue-drain tests without teaching the dispatcher about Inference Queue/Backlog internals.

### 6.5 Current-session provider hold

If an Inference execution fails and exact provider state positively says that WebCap's provider job is still active:

- Inference keeps its dispatcher lease,
- Inference owns the reconciliation,
- it releases only when that exact provider job is terminal or when authoritative evidence no longer confirms it active.

If provider state becomes unavailable/unknown, the existing fail-open principle remains: the lane must not hold the shared GPU forever on uncertainty.

### 6.6 Dispatcher-initiated Inference handoff

Inference owns the ComfyUI side of handoff.

At its natural lane boundary, Inference marks its dispatcher lease idle. It does **not** unload ComfyUI merely because no work is waiting.

Only when the dispatcher selects a different client does it call the Inference handoff callback.

That callback should:

- ensure no exact WebCap-managed provider job covered by the lease is still confirmed active,
- issue the existing ComfyUI cache/model release operation,
- return success/failure from that concrete API interaction.

Do not add `nvidia-smi` thresholds, VRAM polling, Comfy process ownership, or a new hard-reset mechanism merely to prove that an HTTP cleanup request “really” freed memory. The current codebase does not provide such an ownership contract, and inventing one pre-emptively would recreate the uncertainty machinery this dispatcher is intended to remove.

If real execution later demonstrates that ComfyUI's documented/API cleanup boundary is insufficient, fix that concrete Inference-runtime problem then.

## 7. LLM client design

## 7. LLM client design

## 7. LLM client design

### 7.1 Preserve

Keep:

- one server-session FIFO,
- frozen LLM contracts,
- job-local cancel/stop,
- stale-result validation at ingest,
- visible model/runtime failures,
- restart discard of unfinished LLM work,
- remote runtime support,
- the short local-GPU continuation grace.

### 7.2 Remove the accidental pause concept

The backend currently exposes LLM `pause_queue` / `resume_queue`, but the application UI does not call those operations. A full scan of the current JS tree found `pause_queue` / `resume_queue` only in the Inference Queue UI; Training has its own `resume_queue` endpoint.

LLM pause is therefore not part of the product semantics and should not be carried into the dispatcher design.

Remove the LLM pause/resume action branches and the test that exists only to exercise pausing the grace window after the dispatcher cutover is stable.

### 7.3 Remote head

Remote LLM work does not submit to the GPU dispatcher.

The LLM lane itself still owns FIFO:

- if the FIFO head is remote, execute it without the local GPU;
- a later local job cannot bypass an earlier remote job;
- a later remote job cannot bypass an earlier local job that is waiting on the dispatcher.

This keeps queue meaning inside LLM.

### 7.4 Local head

If the FIFO head is local:

- submit one LLM client claim at local-LLM priority;
- the dispatcher callback re-checks the FIFO head;
- if it is no longer local/runnable, return `EMPTY` or `NOT_READY` as appropriate;
- otherwise execute through the existing LLM job lifecycle.

### 7.5 Local lane stickiness, grace, and parked ownership

Preserve the existing short local-LLM continuation grace.

While local LLM work is active:

- consecutive local FIFO jobs may drain under the same lease,
- when the local FIFO drains, keep the current short grace before marking the lease idle,
- if another local LLM job arrives during grace, continue under the same lease,
- after grace expires, mark the lease idle/parked.

Parking does **not** unload llama.cpp.

If no other local-GPU client is waiting, the dispatcher leaves LLM parked and the model may remain warm beyond the grace window.

If a different client is selected, the dispatcher invokes the LLM handoff callback and only then is the local model unloaded/stopped.

This preserves the existing “brief related LLM burst wins before a waiting lane” behavior while removing cleanup/reload churn during ordinary GPU idle time.

### 7.6 Remove runtime-level arbitration

`storyboard_llm_runtime.chat()` currently has a fallback path that reserves the GPU itself when `gpu_reserved=False`.

After cutover, local app-owned LLM execution must not bypass the LLM lane.

The runtime should therefore:

- accept an explicit “dispatcher lease already granted” contract for local work;
- fail loudly if managed local work reaches the runtime without that contract;
- continue to allow remote work without a local GPU lease.

Current model-test/calibration routes already enqueue through `llm_runner`, so there is no product requirement for a second local arbitration path.

### 7.7 Dispatcher-initiated llama handoff

Training/Inference stop calling `release_loaded_model_for_gpu_work()`.

When the dispatcher selects a different client from a parked LLM lease, it calls the LLM handoff callback.

That callback:

- runs only after the LLM lane has reached its own idle boundary,
- unloads any loaded local model through the existing llama.cpp model API,
- may stop the WebCap-owned server if the existing runtime code already needs that for a real unload failure,
- reports the concrete cleanup result.

The nonblocking `DirectorRuntimeBusy` dance in `release_loaded_model_for_gpu_work()` becomes unnecessary because no incoming lane is attempting cleanup while an LLM request is running.

Do not add new persisted llama PID/process-guardian machinery solely for this refactor. On WebCap startup, perform a best-effort/visible local-runtime quiesce through the existing configured llama endpoint before opening normal GPU dispatch. If that proves insufficient in practice, harden llama process ownership as a separate concrete runtime issue.

## 8. Training adapter design

## 8. Training adapter design

## 8. Training adapter design

Training remains specialized.

Do **not** migrate Training into `execution_queue.py` or rewrite `training_queue.json`.

### 8.1 Preserve

Keep:

- Training's durable queue,
- Training queue pause/resume,
- checkpoint-safe Pause/Finish,
- scheduled finish,
- epoch/progress semantics,
- disk protection,
- captured bundles,
- resume/checkpoint handling,
- Training History,
- exact runner PID/script identity,
- observer,
- restart recovery.

### 8.2 Thin dispatcher adapter

Training gains only the shared-GPU boundary:

- when Training's own queue says it has runnable work, submit the Training client;
- when the dispatcher calls Training, Training re-checks its own queue under the Training lock;
- if it can start/continue, keep the lease and use the existing launch path;
- if it cannot currently start, return `NOT_READY` and let the dispatcher try another client;
- when Training reaches its natural idle/pause boundary, release.

The Training queue remains the authority for whether Training is runnable.

### 8.3 Surviving Training after restart

Training remains the one subsystem allowed to re-establish GPU participation after WebCap restart.

On startup, Training performs its existing runner reconciliation and then presents its own resulting state to the dispatcher.

Initial migration rule:

- Training's existing recovery semantics remain authoritative inside the Training subsystem,
- verified live Training can establish an active lease,
- queued-only Training remains paused and submits nothing,
- do not redesign Training's durable queue/recovery model as part of the dispatcher cutover.

The dispatcher never inspects Training PIDs, scripts, WSL, logs, or persisted queue state.

The known “unverifiable runner” behavior remains isolated inside Training for the initial adapter and should be revisited only after the dispatcher migration is stable. That preserves the explicit decision to integrate Training conservatively rather than forcing it onto the newer queue architecture.

## 9. Restart lifecycle

The dispatcher starts empty and closed to normal dispatch while the existing subsystem startup reconciliation runs.

Recommended startup order:

1. create the empty dispatcher and register clients;
2. recover invalid durable execution-queue state;
3. reconcile Inference to restart Backlog; submit nothing;
4. reconcile/discard LLM session work and quiesce any reachable configured local llama model; submit nothing;
5. perform the first normal Training reconciliation so Training can re-establish its own surviving state if applicable;
6. start the Training observer;
7. open the dispatcher;
8. begin normal request-driven submissions.

Do not add a second durable startup-recovery database for the dispatcher.

The critical restart invariant remains simple:

- old Inference -> Backlog only,
- old LLM -> gone,
- Training -> whatever Training itself authoritatively recovers,
- dispatcher -> fresh process-local state.

## 10. Runtime cleanup without new ownership systems

The dispatcher refactor should delete cross-lane cleanup logic, not replace it with a larger process-ownership framework.

### 10.1 Inference

Keep the existing write-ahead Comfy provider identity and provider cancellation/reconciliation.

For dispatcher handoff:

- exact live provider work remains an Inference-local fact,
- current-session provider hold can be represented by the active Inference lease,
- Comfy cache/model cleanup stays in Inference,
- do not add speculative GPU-utilization/VRAM heuristics.

Because only one Inference job can execute at a time, the current `_provider_runtime_holds` **set** is unnecessary after cutover. Replace it with at most one exact current-session held provider ID tied to the Inference lease.

### 10.2 LLM

Use the existing local llama endpoint/model APIs for normal handoff and startup quiesce.

Remove cross-lane cleanup and runtime-busy probing created solely to let another lane evict LLM.

Do not add persisted process ownership unless a concrete orphaned-server failure remains after the dispatcher architecture is in place.

### 10.3 Training

Leave Training runtime recovery alone during the initial dispatcher migration.

Delete only the shared-resource and incoming Comfy/LLM handoff responsibilities that the dispatcher makes obsolete.

A later Training-focused pass may tighten unknown-runner recovery without being coupled to this refactor.

### 10.4 Handoff failure

A real handoff callback failure keeps the outgoing parked lease and prevents a different local-GPU client from starting.

Do not add a generic uncertainty loop around that failure.

Surface the concrete runtime error. Retry only where the owning runtime already has a meaningful bounded retry operation.

## 11. Activity and wait-state projection

## 11. Activity and wait-state projection

## 11. Activity and wait-state projection

The Activity UI and feature cards should not lose useful explanations.

### 11.1 Activity

Replace:

`activity_monitor.py -> execution_queue.resource_owner()`

with the dispatcher snapshot's active client.

Keep the existing public `gpuOwner` response field initially so the front end does not need a simultaneous UI migration.

### 11.2 Inference wait reason

Inference wait state has two sources:

- lane-local: paused, ComfyUI unavailable, exact provider hold, execution failure;
- dispatcher: submitted but waiting behind another active/higher-priority client.

Do not reconstruct dispatcher state inside Inference. Read the dispatcher snapshot.

### 11.3 LLM wait reason

Remove direct Training inspection from `llm_runner._queue_wait_state()`.

For a local head:

- queue-ahead within LLM remains LLM-local,
- GPU wait owner/order comes directly from the dispatcher snapshot,
- do not recreate labels by re-inspecting other queues.

Remote head has no GPU wait owner.

The same simplification applies to Inference: remove stored cross-lane wait strings such as “Waiting for Training/Director.” Keep only lane-local wait reasons (for example ComfyUI unavailable); shared-resource waiting is projected from dispatcher state.

### 11.4 Dispatcher diagnostics

Expose enough passive state to answer:

- active client,
- pending client order,
- deferred clients.

Do not expose domain payloads or turn the dispatcher into another UI queue surface unless a later product need appears.

## 12. Behavior migration matrix

| Current behavior | Target behavior |
| --- | --- |
| Inference reads pending LLM work before reserve | delete; LLM has its own dispatcher submission |
| Inference/LLM call Training reservation helper | delete; all three submit to one dispatcher |
| LLM reads Training queue to explain blocking | replace with dispatcher snapshot |
| Training/Inference unload llama before start | delete; LLM unloads before releasing its own lease |
| LLM calls Comfy `/free` before local load | delete; Inference handles its own outgoing Comfy handoff |
| Training inspects Comfy before launch | delete after outgoing Inference handoff is established |
| `execution_queue._resource_owner` | replace with dispatcher active client |
| Inference foreground lane stickiness | preserve by retaining Inference lease while foreground Queue drains |
| Inference Backlog yielding | preserve by releasing at Queue->Backlog boundary and resubmitting at lower priority |
| LLM grace | preserve by retaining LLM lease during grace |
| Training long-run non-preemption | preserve by retaining Training lease while Training is active |
| remote LLM | bypass dispatcher entirely |
| LLM pause/resume backend action | remove; no product caller |
| restart Inference | Backlog only, no submission |
| restart LLM | discarded, no submission |
| restart active Training | Training recovers exact runner and re-submits/reattaches |
| queued-only Training after restart | paused, no submission |
| provider/process uncertainty | remains owning-lane concern; never becomes dispatcher logic |

## 13. Implementation phases

### Phase 0 — semantic lock-in

Use this document and `docs/queue-semantics.md` as the boundary.

Do not add new runtime/process-management systems merely because the dispatcher exposes an old uncertainty. Preserve existing client runtime contracts unless a concrete failure requires more.

### Phase 1 — dispatcher in isolation

Add:

- `tool/server/gpu_dispatcher.py`,
- `tests/test_gpu_dispatcher.py`.

Test:

- one lease only,
- ordered submissions,
- one pending submission per client,
- revision fencing,
- lease fencing,
- `NOT_READY` moves on,
- `EMPTY` removes only its revision,
- parked lease reuse by same client,
- no cleanup while simply idle,
- different-client switch invokes outgoing handoff first,
- handoff failure prevents transfer,
- callbacks never run under dispatcher lock,
- no persistence.

### Phase 2 — thin client adapters

#### Inference

- submit foreground Queue / eligible Backlog intent,
- short dispatch callback claims exact current Inference work and starts its existing worker path,
- keep provider lifecycle inside Inference,
- mark lease idle only at the existing natural Queue/Backlog boundary,
- handoff callback performs Inference-owned Comfy cleanup,
- collapse provider runtime hold collection to one exact in-memory held provider ID.

#### LLM

- remove backend-only pause/resume **and reorder** actions; no current product UI uses them,
- drive remote FIFO head directly outside dispatcher,
- submit local FIFO head,
- preserve local drain + 3-second grace,
- after grace mark lease idle rather than unloading,
- handoff callback performs LLM-owned unload,
- remove incoming-runtime `DirectorRuntimeBusy` cleanup path.

#### Training

- keep Training queue/recovery intact,
- replace only shared-GPU reservation calls with a thin dispatcher adapter,
- let existing Training recovery determine whether it presents itself as active/runnable.

### Phase 3 — event-driven lane driving

Do not reproduce the current 1-second/2-second generic scheduler polls around the dispatcher.

#### LLM

The current 1-second monitor can disappear.

Drive the lane from:

- enqueue,
- worker completion,
- cancel/stop,
- one grace timer.

There is no external local readiness condition worth polling before dispatch.

#### Inference

Drive normal scheduling from:

- enqueue/resume/promotion,
- worker completion,
- cancel/stop/reorder,
- dispatcher callback.

Use a targeted retry timer only while ComfyUI is actually unavailable or while one exact current-session provider hold needs reconciliation.

Do not keep a permanent 2-second “maybe I can schedule now” loop.

#### Training

Keep the Training observer. It monitors a genuinely external long-running process and remains justified.

### Phase 4 — startup wiring

- create empty dispatcher,
- run Inference restart shelving,
- discard LLM session and quiesce reachable local llama state,
- run initial Training reconciliation,
- start Training observer,
- open dispatcher.

No dispatcher persistence or recovery layer.

### Phase 5 — atomic cutover

At once:

- all local-GPU starts require a dispatcher lease,
- Activity `gpuOwner` comes from dispatcher,
- cross-lane wait projection comes from dispatcher,
- old resource-owner acquisition paths stop being production authority.

### Phase 6 — delete superseded logic

Delete from Inference:

- `_local_llm_work_pending()`,
- Training reservation wrappers,
- direct shared-owner branches,
- incoming llama cleanup,
- generic cross-lane wait strings,
- generic monitor polling once targeted wake/retry paths exist.

Delete from LLM:

- Training reservation helpers,
- direct shared-owner branches,
- Training blocker inspection,
- pause/resume/reorder queue actions,
- incoming Comfy cleanup,
- generic 1-second monitor,
- cleanup-only `DirectorRuntimeBusy` path.

Delete from Training:

- external GPU reservation/block-reason helpers,
- direct `execution_queue` resource ownership,
- `_prepare_comfyui_for_training()`,
- incoming Director cleanup.

Delete from `storyboard_llm_runtime.py`:

- implicit local GPU reservation fallback,
- cross-lane Comfy cleanup,
- `release_loaded_model_for_gpu_work()` once handoff callback replaces it.

Delete from `execution_queue.py`:

- `_resource_owner`,
- `reserve_resource()`,
- `release_resource()`,
- `resource_owner()`.

Keep generic queue mechanics used by Inference.

### Phase 7 — UI/docs cleanup

- keep public job payloads stable where useful,
- remove obsolete LLM pause/reorder surfaces from backend payloads,
- update wait labels to dispatcher projection,
- update `docs/execution_queue.md`,
- run a final dead-code/import/test cleanup.

### Phase 8 — optional later Training hardening

Only after the dispatcher is stable, revisit Training's unknown-runner recovery if it is still a practical problem.

Do not bundle that with the shared scheduler migration.

## 14. Required integration tests

### Ordering

- Training + local LLM + Inference submitted -> configured next-turn order is respected.
- active work is never preempted.
- Inference foreground lane drains to its natural boundary before becoming switchable.
- Inference Backlog remains lower priority than foreground clients.
- equal-priority submissions are stable FIFO.

### Readiness

- Comfy unavailable -> Inference returns `NOT_READY`; another client may start.
- stale/cancelled Inference submission -> `EMPTY`.
- remote LLM never enters dispatcher.
- Training paused/empty -> no runnable Training submission.

### Parked ownership and handoff

- finishing a lane with nobody else waiting parks the lease and performs **no** VRAM cleanup.
- same client later reuses its parked lease.
- different client arrival triggers outgoing handoff before new grant.
- handoff failure leaves old parked ownership intact.
- LLM's existing 3-second grace still delays its idle boundary.
- after grace, LLM may remain parked/warm indefinitely until another client needs the GPU.
- Inference provider hold uses only one exact held provider identity.
- unknown provider state does not become an indefinite hold.

### Races

- stale lease completion cannot affect a newer lease.
- re-submit during an in-flight callback survives the older result.
- stale withdrawal cannot remove a newer revision.
- cancel/reorder between submission and dispatch is resolved by exact lane claim.
- callback exception cannot leave phantom ownership.

### Event driving

- LLM enqueue starts progression without a generic polling loop.
- LLM completion/grace schedules the next state transition without polling.
- Inference normal enqueue/completion progresses without a generic 2-second scheduling loop.
- Comfy unavailable arms only a targeted retry.
- targeted retry stops once the condition is resolved or work disappears.

### Restart

- dispatcher starts empty.
- Inference unfinished work -> Backlog; no inherited submission.
- LLM unfinished work -> gone; no inherited submission.
- Training startup behavior remains compatible with existing Training recovery.
- no dispatcher state file exists.

## 15. Tests to rewrite or delete

## 15. Tests to rewrite or delete

## 15. Tests to rewrite or delete

Current tests that encode valid product behavior should be retained but rewritten against the dispatcher.

Examples:

- `test_inference_queue_reuses_gpu_ownership_until_foreground_queue_is_drained`
- `test_inference_releases_gpu_at_queue_to_backlog_boundary`
- `test_inference_drains_foreground_then_yields_backlog_to_training`
- `test_local_llm_queue_reuses_gpu_ownership_until_queued_work_is_drained`
- `test_training_cannot_claim_gpu_during_retained_llm_grace`
- `test_llm_local_job_waits_while_shared_gpu_is_owned`
- Training launch/resource tests.

Tests that exist only because of cross-lane implementation details should be deleted/replaced:

- Inference explicitly inspecting queued LLM work;
- Training reservation helper behavior;
- Training Comfy handoff checks;
- incoming Director cleanup tests;
- LLM Training-blocker introspection;
- LLM queue pause/grace behavior once LLM pause is removed.

## 16. Acceptance criteria

The migration is complete when:

1. `gpu_dispatcher.py` is the only local-GPU grant authority.
2. every grant has a unique lease ID and pending client state is revision-fenced.
3. no lane asks another lane whether it may use the GPU.
4. no incoming lane cleans another lane's runtime.
5. idle GPU ownership may stay parked/warm; cleanup occurs only for an actual client switch.
6. the dispatcher initiates switches; outgoing client implements cleanup.
7. the dispatcher knows no Comfy/llama/WSL/provider/process semantics.
8. `execution_queue.py` has no shared GPU owner.
9. dispatcher state is never persisted.
10. restart creates no Inference/LLM submission.
11. Training remains on its specialized queue/recovery model.
12. remote LLM bypasses dispatcher.
13. Inference Queue/Backlog semantics remain intact.
14. LLM 3-second grace remains intact.
15. LLM normal scheduling has no generic 1-second polling loop.
16. Inference normal scheduling has no generic 2-second polling loop; only condition-specific retries remain.
17. LLM backend-only pause/resume/reorder behavior is removed.
18. Inference's provider runtime hold is a single exact current-session identity, not a collection.
19. Activity/wait state reads lane-local facts plus dispatcher facts, not cross-lane guesses.
20. real runtime failures remain visible rather than spawning speculative safety machinery.

## 17. Explicit non-goals

## 17. Explicit non-goals

## 17. Explicit non-goals

This work does **not**:

- migrate Training into the shared execution queue;
- create one global FIFO of all WebCap jobs;
- add fairness weights, aging, preemption, or a general-purpose scheduler;
- persist GPU dispatcher state;
- use `nvidia-smi` utilization as scheduling truth;
- make the dispatcher understand ComfyUI, llama.cpp, WSL, model loading, checkpoints, disk space, or feature semantics;
- change UI dependency/locking semantics;
- change result/history ownership.

## 18. Decision status

No new product decision is required by the simplification audit.

The previous proposal to make dispatcher cutover depend on proving physical VRAM release, adding hard ComfyUI reset authority, persisting llama process identity, and hardening Training recovery was too broad for this refactor.

The simpler boundary is:

- dispatcher owns ordering, leases, parked ownership, and client-switch timing,
- outgoing lane owns its existing runtime cleanup API,
- cleanup is required only for an actual switch to a different local-GPU client,
- runtime-specific hardening is added later only if a concrete failure demonstrates that the existing runtime API is insufficient,
- Training remains conservatively adapted rather than redesigned.

The main deliberate retained complexity is only the concurrency fencing (lease IDs + submission revisions). Those solve real stale-worker/stale-callback races created by asynchronous dispatch and should remain.

