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
domain subsystem owns durable work
        |
        | submit exact runnable work reference
        v
+--------------------------------+
| ephemeral GPU dispatcher       |
|                                |
| ordered pending submissions    |
| one active execution future    |
| last client (cache residue)    |
+--------------------------------+
        |
        | choose + execute
        v
dispatcher-owned worker calls client adapter
        |
        +-- runs until that exact execution is finished
        +-- DEFERRED -> no execution started; keep dormant until re-armed
        +-- OBSOLETE -> remove submission
        +-- exception -> visible execution failure; dispatcher moves on
```

The dispatcher is the **only authority** over local-GPU scheduling and active execution state.

A lane/subsystem is not a resource owner and does not grant, retain, release, yield, or transfer GPU authority.

Its responsibilities are limited to:

- owning its durable/domain work,
- submitting exact execution opportunities,
- implementing the actual operation when the dispatcher invokes it,
- exposing runtime-specific stop/cancel/cleanup primitives.

The dispatcher owns:

- which submitted work runs next,
- when execution starts,
- whether an execution slot is active,
- when that execution has ended,
- when cache cleanup should be requested before a different client runs.

A submission is an ephemeral reference to domain work, not a second durable job record.

## 3. Core invariants

The implementation should be judged against these invariants.

### 3.1 One common authority

Only the GPU dispatcher decides what local-GPU work runs and when.

Lanes have **no scheduling or ownership authority**.

They may submit/withdraw exact pending work and implement execution, but they may not:

- reserve the GPU,
- claim ownership,
- keep a lease,
- release/yield ownership,
- veto a different client after their own execution has ended,
- decide whether the dispatcher may move on.

A lane-local inability to begin work is merely an execution result reported to the dispatcher; it is never a resource claim.

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

### 3.6 Dispatcher-owned execution and cleanup timing

The dispatcher owns the active execution record.

Client code does not signal “I still own the GPU” or “you may release me.”

Instead, the dispatcher runs the selected submission in a dispatcher-owned worker/future. That active record exists until the execution callback returns or raises.

After execution ends:

- there is no active GPU owner in scheduler state,
- the dispatcher may remember the **last client** only so it knows whose caches may still be resident,
- if the next selected submission belongs to the same client, no cleanup is needed,
- if the next selected submission belongs to a different client, the dispatcher invokes the last client's cleanup callback before starting the next execution.

Cleanup is a command, not a permission request.

Cleanup failure is logged as a concrete runtime problem but does not grant the old lane authority to block the dispatcher indefinitely.

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

Do not embed this into `execution_queue.py`.

### 4.1 Minimal state

The dispatcher needs only:

- registered execution/cleanup adapters per client,
- ordered pending submissions,
- one active submission/future at most,
- dormant/deferred submissions waiting to be re-armed,
- one internal dispatch generation/token for stale-future fencing,
- the last completed client for cache-handoff optimization,
- one wake primitive and one dispatcher worker,
- passive diagnostic state.

No client-visible lease exists.

No provider IDs, runtime health, VRAM measurements, queue payloads, WSL/process facts, or feature semantics belong in the dispatcher.

### 4.2 Submission identity

Each submitted execution opportunity has a unique immutable submission ID.

Conceptually:

```text
submission_id
client_id
priority/category
sequence
work_reference
state = pending | deferred | active
```

The work reference is only enough for the client adapter to identify exact domain work. The durable payload remains in the domain subsystem.

Submission IDs are never reused for unrelated work.

This removes the need for client-visible lease IDs and submission revisions: stale completion is fenced internally by the dispatcher's active future/generation, while newer work has a different submission ID.

### 4.3 Client registration

Each local-GPU client registers:

```text
execute(submission) -> COMPLETED | DEFERRED | OBSOLETE
cleanup_for_switch()
```

The dispatcher invokes these outside its internal lock.

`execute()` runs in a dispatcher-owned worker/future and may remain blocked for the lifetime of that exact execution. This is intentional: the worker is the authoritative active record while the dispatcher's scheduling loop remains free.

The lane does not spawn a separate scheduler-owned lifetime and later “release” anything.

### 4.4 Submit / withdraw / re-arm

```text
submit(submission)
withdraw(submission_id)
rearm(submission_id)
```

Rules:

- submit is idempotent by exact submission ID,
- withdraw removes only pending/deferred work,
- active work is stopped/cancelled through the owning domain's exact stop path,
- re-arm changes a deferred submission back to pending,
- none of these operations grant GPU authority to the client.

### 4.5 Execution outcomes

The dispatcher selects one pending submission and runs its `execute()` adapter in the sole active GPU worker.

Outcomes:

- **COMPLETED** — that exact execution opportunity is done; remove the submission.
- **DEFERRED** — no execution actually began because of a lane-local external condition; keep the submission dormant and immediately consider another pending submission.
- **OBSOLETE** — the referenced domain work no longer exists/is runnable; remove it.
- **exception** — surface the real execution failure according to the lane wrapper, clear active state, and continue scheduling.

`DEFERRED` is not lane authority. It is simply the result of an attempted operation that could not begin.

The dispatcher never waits for a lane to grant permission to move on.

### 4.6 Active execution

The dispatcher owns one active future.

While that future is running, no other local-GPU submission starts.

When it completes or raises, active state ends automatically in the dispatcher.

There is no:

- `lease`,
- `mark_idle()`,
- `yield_lease()`,
- client `release()`,
- parked ownership.

If a runtime keeps VRAM cached after execution, that is cache residue, not scheduler ownership.

### 4.7 Cache handoff

After an execution ends, remember only `last_client`.

Before starting the next selected submission:

- same client -> skip cleanup,
- different client -> call `last_client.cleanup_for_switch()`,
- no last client -> start directly.

Cleanup is best-effort/bounded runtime maintenance. It cannot become a scheduling veto.

If cleanup raises, log the exact failure and continue to the selected submission. If the next workload genuinely cannot run because residue remains, that workload produces a real execution failure.

### 4.8 Snapshot

Passive snapshot contains:

- active submission/client,
- ordered pending submissions,
- deferred submissions,
- last client,
- dispatcher state.

Snapshot never invokes client code or changes scheduling.

### 4.9 Race rules

The dispatcher lock protects dispatcher state only.

Required guarantees:

- at most one active GPU future,
- a stale future completion cannot clear a newer active record,
- exact withdrawal cannot remove unrelated/new submissions,
- cancel/reorder races are resolved against exact submission/domain identity,
- callback exceptions cannot strand active state,
- cleanup failure cannot strand ownership because there is no old-client ownership after execution completes.

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

### 6.6 Inference execution and cleanup adapter

Inference does not hold/release dispatcher ownership.

Its dispatcher execution adapter:

- resolves the exact submitted Inference work,
- checks ComfyUI availability before domain claim,
- returns `DEFERRED` if ComfyUI is unavailable,
- otherwise claims and executes the exact job through the existing synchronous provider lifecycle,
- does not return until that exact Inference execution attempt has reached its lane-defined completion/failure boundary.

After the callback returns, the dispatcher is automatically free.

Inference's separate `cleanup_for_switch()` performs Comfy cache/model cleanup only when the dispatcher is about to run a different client.

Cleanup failure is diagnostic; it does not let Inference veto the next client.

## 7. LLM client design

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

### 7.5 Local lane stickiness and grace

Preserve the existing local-LLM drain/grace behavior as **submission timing**, not resource ownership.

The LLM domain driver may wait the existing short continuation grace before it considers the local burst finished and exposes the next cross-client scheduling opportunity.

Once the dispatcher-owned LLM execution callback returns, LLM has no GPU authority.

If the next dispatcher submission is also LLM, cleanup is skipped and the local model may stay warm.

If the next submission is another client, the dispatcher commands LLM cleanup before starting it.

### 7.6 Remove runtime-level arbitration

`storyboard_llm_runtime.chat()` currently has a fallback path that reserves the GPU itself when `gpu_reserved=False`.

After cutover, local app-owned LLM execution must not bypass the LLM lane.

The runtime should therefore:

- accept an explicit “dispatcher lease already granted” contract for local work;
- fail loudly if managed local work reaches the runtime without that contract;
- continue to allow remote work without a local GPU lease.

Current model-test/calibration routes already enqueue through `llm_runner`, so there is no product requirement for a second local arbitration path.

### 7.7 LLM cleanup adapter

Training/Inference stop calling `release_loaded_model_for_gpu_work()`.

LLM registers `cleanup_for_switch()`, which unloads the local model using existing llama.cpp runtime operations.

The dispatcher calls it only after LLM execution has ended and only when another client is actually about to run.

The cleanup callback cannot claim continued ownership or block future scheduling indefinitely.

## 8. Training adapter design

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

Training keeps its specialized queue and observer.

For a normal queued Training start, Training submits an exact Training execution opportunity.

When selected, the dispatcher-owned execution worker calls the Training adapter. The adapter:

- launches the existing Training runner through current Training code,
- waits for that exact managed runner to reach the Training lifecycle boundary using Training's existing observer/state signals,
- returns only when that execution turn is over.

The dispatcher, not Training, therefore owns the active scheduling slot for the full Training run.

Training does not reserve/release/yield shared GPU ownership.

### 8.3 Surviving Training after restart

Training remains special only because its external runner may survive WebCap.

On startup, Training performs its existing recovery and submits a reattachment execution opportunity for the recovered runner.

While the dispatcher startup barrier is closed, that recovered Training submission is established before normal new work is allowed to dispatch.

When the dispatcher opens, the reattachment adapter waits on the already-running exact Training runner until its lifecycle ends.

The dispatcher still owns scheduling authority; Training merely supplied the recovered work reference.

Queued-only Training remains paused and submits nothing.

No Training queue migration is required.

## 9. Restart lifecycle

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

Runtime cleanup is maintenance, not ownership.

### 10.1 Inference

Keep exact Comfy provider identity and current cancellation/reconciliation behavior inside Inference execution.

Remove the separate shared-GPU provider-hold ownership concept after cutover. If an exact provider job must still be waited on, the dispatcher-owned Inference execution callback simply has not finished yet.

This means `_provider_runtime_holds` can disappear rather than merely shrink to one element.

### 10.2 LLM

Keep llama runtime operations inside LLM execution/cleanup adapters.

Remove runtime-busy checks that existed only so another lane could ask LLM for permission to take the GPU.

### 10.3 Training

Keep Training recovery/observer logic.

The dispatcher-owned Training execution future remains active until the exact Training run ends. Training itself never mirrors shared-resource ownership.

### 10.4 Cleanup failure

Cleanup happens only after the previous execution is already over.

A cleanup error is logged and the dispatcher continues.

Do not convert cleanup failure into an ownership hold, uncertainty state, or permission handshake.

## 11. Activity and wait-state projection

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

The central rule is:

> **Lanes submit and execute work; the dispatcher alone owns scheduling authority and active execution state.**

No lane-side reserve/release/yield/lease mechanism survives the cutover.

### Phase 1 — dispatcher in isolation

Add `gpu_dispatcher.py` and tests for:

- exact submissions,
- category/priority ordering,
- one active future,
- `DEFERRED` skipping to other pending work,
- `OBSOLETE` removal,
- stale future fencing,
- exact withdrawal,
- same-client cache reuse,
- different-client cleanup command,
- cleanup failure logging without blocking,
- no persistence.

### Phase 2 — native Inference adapter

Replace Inference cross-lane scheduling with dispatcher submissions.

Reuse the existing synchronous Inference execution path inside the dispatcher worker.

Delete:

- Training reservation wrappers,
- LLM-pending inspection,
- shared resource owner checks,
- separate provider GPU-hold ownership,
- incoming llama cleanup.

Keep only targeted Comfy-unavailable re-arm/retry.

### Phase 3 — native LLM adapter

Use the existing synchronous LLM execution path inside the dispatcher worker.

Remote LLM bypasses dispatcher.

Delete:

- Training reservation wrappers,
- shared resource owner checks,
- pause/resume/reorder backend-only queue controls,
- incoming Comfy cleanup,
- cleanup-time `DirectorRuntimeBusy` permission logic.

Preserve FIFO and the short continuation grace as domain scheduling behavior.

### Phase 4 — thin Training adapter

Do not migrate Training queue/state.

Normal Training submit -> dispatcher executes adapter -> adapter launches current runner and waits on exact Training lifecycle completion.

Recovered surviving runner -> startup submits reattachment adapter -> dispatcher owns the active future after startup opens.

Delete only shared-resource reserve/release and incoming runtime cleanup from Training.

### Phase 5 — startup barrier

- dispatcher created closed,
- Inference restart -> Backlog,
- LLM restart -> discarded,
- Training performs recovery and submits surviving-runner reattachment if applicable,
- open dispatcher,
- normal submissions proceed.

### Phase 6 — atomic cutover

Remove `execution_queue._resource_owner` and every production caller.

Activity shared GPU state comes from dispatcher active submission, not lane claims.

### Phase 7 — event-driven cleanup

Remove generic LLM and Inference scheduler polling where dispatcher submissions/events replace it.

Keep only runtime-specific polling that genuinely observes an external system:

- exact Comfy provider lifecycle,
- temporary Comfy-unavailable retry,
- Training external runner observer.

### Phase 8 — dead-code/UI/docs cleanup

Remove obsolete wait-state reconstruction, imports, tests, and queue controls.

Update implementation docs after runtime behavior is verified.

## 14. Required integration tests

### Authority

- no lane can reserve/release/yield shared GPU state,
- dispatcher active state is defined only by its one active execution future,
- callback completion automatically frees scheduler authority,
- lane cleanup cannot veto the next selected submission.

### Ordering

- submitted Training/LLM/Inference work follows dispatcher policy,
- one active execution is non-preemptive,
- Inference Queue/Backlog policy is preserved through submission ordering,
- equal-priority submissions are stable.

### Deferred work

- Comfy unavailable -> exact Inference submission becomes deferred; another pending client runs,
- re-arm later retries that same work,
- deferred state does not own/block GPU execution.

### Cache handoff

- same client after previous completion skips cleanup,
- different client commands previous-client cleanup,
- cleanup exception is logged and next client still runs.

### Long-running execution

- LLM execution future remains active until exact local request returns,
- Inference execution future remains active until exact provider lifecycle returns,
- Training execution future remains active until exact runner lifecycle ends,
- no lane-side ownership mirror exists.

### Restart

- dispatcher state starts empty,
- Inference -> Backlog only,
- LLM -> discarded,
- surviving Training is represented by a startup reattachment submission,
- queued-only Training remains paused,
- no dispatcher persistence.

### Races

- stale future completion cannot clear a newer active future,
- exact pending withdrawal cannot affect another submission,
- cancel/reorder races resolve by exact domain/submission identity,
- cleanup and scheduling callbacks never run under dispatcher lock.

## 15. Tests to rewrite or delete

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

1. `gpu_dispatcher.py` is the sole local-GPU scheduling authority.
2. lanes contain no shared GPU reserve/release/yield/lease authority.
3. dispatcher owns one active execution future at most.
4. active state ends automatically when that future ends.
5. exact deferred work does not block unrelated submissions.
6. cleanup is dispatcher-commanded maintenance, never a permission handshake.
7. cleanup failure cannot create an ownership hold.
8. same-client consecutive work can reuse warm runtime state.
9. no lane inspects another lane for scheduling permission.
10. `execution_queue.py` has no shared resource owner.
11. dispatcher state is not persisted.
12. Inference restart remains Backlog-only.
13. LLM restart remains session discard.
14. Training remains specialized and integrates only by submitting/waiting on exact runner work.
15. remote LLM bypasses dispatcher.
16. generic cross-lane polling/wait reconstruction is removed.
17. real execution failures remain visible.

## 17. Explicit non-goals

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

The prior lease/parked-owner design was rejected because it accidentally returned scheduling authority to lanes.

Final authority model:

- **lanes own domain data and implementation only,**
- **the dispatcher owns all local-GPU scheduling state,**
- lanes submit exact work references,
- dispatcher chooses and runs one submission in its own worker/future,
- callback return/exception ends active state automatically,
- `DEFERRED` means an execution attempt could not begin; it is not a veto or ownership claim,
- dispatcher commands cache cleanup when switching clients,
- cleanup cannot block scheduling as an ownership decision.

An internal dispatcher generation/token may still exist solely to ignore stale future callbacks. It is never exposed as a client lease or resource right.

