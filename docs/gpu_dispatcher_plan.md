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

### 3.6 The dispatcher owns the handoff event; the outgoing client owns the cleanup implementation

A client never clears shared GPU ownership by itself.

When the active client reaches its natural yield boundary, it tells the dispatcher that the current lease may be yielded.

The dispatcher then decides whether a real client switch is required.

- If the same client has already submitted more runnable work, the dispatcher may reuse the existing lease without cleanup.
- If a different client is next, or the resource is being returned to idle, the dispatcher asks the **outgoing** client to prepare the GPU handoff.
- The dispatcher does not know how ComfyUI, llama.cpp, Training, VRAM caches, or processes are cleaned.
- The incoming client never cleans the outgoing client's runtime.
- Ownership changes only after the outgoing client reports a completed handoff.

This gives one deterministic transfer boundary:

```text
outgoing client owns lease
        |
        | yield(lease)
        v
dispatcher chooses next
        |
        | different client / idle
        v
dispatcher -> outgoing.prepare_handoff(lease)
        |
        | cleanup completed
        v
dispatcher clears old lease
        |
        v
dispatcher grants next client
```

Once handoff cleanup has begun, a late same-client submission does not cancel the cleanup in progress. It remains pending and may reacquire the resource afterward.

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

Do not embed this into `execution_queue.py`. That file should remain the durable/ephemeral domain-queue substrate; the GPU dispatcher is a separate resource scheduler.

### 4.1 State

The dispatcher needs only:

- registered client callbacks,
- at most one pending submission per client,
- a monotonically increasing **submission revision** per client,
- priority plus insertion sequence for stable ordering,
- one active **lease** with a unique lease ID,
- an explicit dispatcher phase such as `idle`, `granting`, `active`, or `handoff`,
- a condition variable / wake event,
- a started/stopped flag,
- passive diagnostic snapshot data.

No provider/job payload should be stored.

The lease ID is mandatory. A stale worker from an earlier dispatch must never be able to release or yield a newer lease acquired later by the same client.

The submission revision is also mandatory. A stale dispatch callback result must never erase a newer submission created while that callback was in flight.

A pending record is conceptually:

```text
client_id
priority
submission_revision
sequence
eligible
submitted_at
```

An active lease is conceptually:

```text
lease_id
client_id
submission_revision
phase
granted_at
```

### 4.2 Client registration

Each GPU client registers two callbacks:

```text
register_client(
    client_id,
    dispatch_callback,
    handoff_callback,
)
```

The dispatcher invokes neither callback while holding its own internal lock.

The **dispatch callback** re-checks current lane-local truth and starts exactly one current execution turn.

The **handoff callback** performs that client's own runtime cleanup when the dispatcher has decided that the lease must leave that client.

### 4.3 Submission

```text
submit(client_id, priority)
```

Requirements:

- at most one pending submission per client,
- re-submit is idempotent with respect to queue multiplicity,
- re-submit increments/replaces the client's submission revision when it represents a new or re-armed execution opportunity,
- priority may be updated by the client,
- submission wakes the dispatcher,
- submission does not claim a domain job,
- submission during an in-flight dispatch callback is preserved as a newer revision and cannot be erased by the older callback result.

This avoids synchronizing two copies of Queue/LLM/Training ordering while still making stale callback races impossible.

### 4.4 Withdrawal

```text
withdraw(client_id, submission_revision=None)
```

Withdrawal removes pending execution eligibility only.

It never releases an active lease.

If a revision is supplied, only that exact pending revision may be withdrawn. This prevents a stale cancellation path from deleting a newer submission.

### 4.5 Dispatch callback and result

The dispatcher chooses one pending submission, creates a unique lease, marks the lease `granting`, then invokes the client's dispatch callback **outside the dispatcher lock**.

The callback receives the lease identity and submission revision.

It returns one of three outcomes:

- **STARTED** — the client atomically claimed/started or reattached managed local-GPU work under that lease.
- **NOT_READY** — the submission is still meaningful, but a lane-local condition prevents start right now.
- **EMPTY** — the submission no longer represents runnable local-GPU work.

Important behavior:

- `STARTED` makes the lease active.
- `NOT_READY` destroys only the provisional lease for that revision, defers that revision, and immediately lets the dispatcher consider another client.
- `EMPTY` removes only that revision and continues.
- A newer submission revision created while the callback ran remains pending regardless of the older result.
- An unexpected callback exception clears only the provisional lease, is logged loudly, and must not wedge dispatcher state.

The dispatch callback must be **short**. It may claim a domain job and start a lane-owned worker/process, but it must not synchronously occupy the dispatcher thread for the entire lifetime of a long LLM inference, ComfyUI generation, or Training run.

Existing Inference/LLM synchronous execution loops therefore need a client-worker adaptation: the dispatcher grants the lease; the lane-owned worker performs execution and later signals the lease boundary.

### 4.6 Yield and handoff

An active client does not call `release()`.

Instead:

```text
yield_lease(client_id, lease_id)
```

means:

> “The work covered by this lease has reached this client's natural yield boundary.”

The lease ID must match the current active lease. Stale yields are rejected loudly and cannot affect current ownership.

On a valid yield:

1. If the same client already has a newer pending submission that can continue under the same runtime, the dispatcher may reuse the existing lease and dispatch that client again without handoff cleanup.
2. Otherwise the dispatcher marks the lease `handoff`.
3. The dispatcher calls the outgoing client's `handoff_callback(lease_id)` outside the dispatcher lock.
4. Only after that callback completes successfully does the dispatcher clear the old lease.
5. The dispatcher then grants the next pending client, if any.

Once phase 3 has begun, new same-client work does not cancel the handoff. It remains pending for a later lease.

### 4.7 Handoff failure

The handoff callback is not a fuzzy readiness probe. It is a bounded cleanup operation owned by the outgoing client.

A successful return means the client has reached its authoritative GPU handoff boundary.

If handoff fails:

- the lease remains owned by the outgoing client,
- the dispatcher does not start another local-GPU client,
- the exact failure is surfaced,
- the owning client must retry or escalate through its own deterministic cleanup path.

There is no `maybe released` dispatcher state.

This makes authoritative client cleanup a **pre-cutover requirement**. We must not switch to the centralized dispatcher while a client can enter handoff without a deterministic way to complete or loudly fail that handoff.

### 4.8 Snapshot

Provide a passive:

```text
snapshot()
```

containing only:

- dispatcher phase,
- active client,
- active lease age/identity for diagnostics,
- ordered pending clients,
- priority/sequence,
- deferred/eligible state.

The public UI does not need the raw lease token.

Snapshot must not call any client callback or trigger scheduling.

### 4.9 Locking and race rules

The dispatcher lock protects only dispatcher state.

No lane callback is ever invoked while that lock is held.

A lane may submit/withdraw from normal request or worker threads while another callback is executing.

The minimum race guarantees are:

- stale lease completion cannot affect a newer lease,
- stale submission results cannot erase newer submissions,
- cancel/reorder between submit and dispatch is resolved by the lane's dispatch-time re-check,
- a callback exception cannot strand a provisional owner,
- a yield racing a same-client submission either reuses the lease before handoff starts or completes handoff and leaves the new submission pending,
- there is never more than one active/provisional local-GPU lease.

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

Inference does not voluntarily free the shared resource and then hope another client can use it.

At its natural yield boundary, Inference calls `yield_lease()`.

If the dispatcher decides the lease is actually leaving Inference, it calls the Inference handoff callback.

That callback must establish:

- no exact managed provider job covered by the lease is still confirmed active;
- ComfyUI's WebCap-managed execution state is quiesced;
- cached model/allocator state has been released to the proven handoff boundary.

Today `/free` is asynchronous and an HTTP 200 is not by itself proof that VRAM has been relinquished. Therefore `free_cached_models()` alone is not sufficient as the final authoritative handoff contract.

Before dispatcher cutover, Inference needs a tested, bounded handoff primitive that can either:

- prove the required ComfyUI handoff state, or
- perform an explicitly authorized hard cleanup path.

Training and LLM must never compensate by querying or cleaning ComfyUI themselves.

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

While LLM owns a lease:

- consecutive local FIFO jobs may execute without yielding,
- when local work drains, LLM keeps the existing short continuation grace before yielding,
- a new local job arriving during grace may reuse the same lease,
- if the next FIFO job is remote, the local lease reaches its yield boundary before remote execution,
- after grace expires with no local continuation, LLM calls `yield_lease()`.

The dispatcher, not LLM, decides whether that yield becomes an actual handoff.

If same-client work has already appeared before handoff starts, the dispatcher may reuse the lease with no unload.

If a different client is next, the dispatcher invokes the LLM handoff callback before transferring ownership.

### 7.6 Remove runtime-level arbitration

`storyboard_llm_runtime.chat()` currently has a fallback path that reserves the GPU itself when `gpu_reserved=False`.

After cutover, local app-owned LLM execution must not bypass the LLM lane.

The runtime should therefore:

- accept an explicit “dispatcher lease already granted” contract for local work;
- fail loudly if managed local work reaches the runtime without that contract;
- continue to allow remote work without a local GPU lease.

Current model-test/calibration routes already enqueue through `llm_runner`, so there is no product requirement for a second local arbitration path.

### 7.7 Dispatcher-initiated llama handoff

Training/Inference must stop calling `release_loaded_model_for_gpu_work()`.

When the dispatcher decides a lease is leaving LLM, it calls the LLM handoff callback.

That callback must:

- ensure no local LLM request covered by the lease is still executing,
- unload the local model authoritatively,
- if unload cannot be established, stop the exact WebCap-owned llama server,
- return only after the LLM runtime has reached its handoff boundary.

The existing short grace remains useful because it delays the yield event itself; it does not belong in dispatcher cleanup logic.

Stale llama ownership after a backend crash must also be made deterministic before cutover, because dispatcher state disappears on restart while the child process may not.

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

On startup, Training performs its own runner recovery.

If it positively re-establishes the exact surviving managed runner:

- Training registers/re-establishes the Training client as active under a fresh dispatcher lease,
- the dispatcher learns only that Training currently owns local-GPU execution,
- it does not inspect the PID, script, WSL, queue file, or GPU process list.

If there is queued Training but no surviving active runner:

- the existing first-startup rule pauses the queue,
- Training submits nothing.

This preserves the existing “Training never auto-starts merely because WebCap restarted” behavior.

### 8.4 Training recovery authority is a pre-cutover boundary requirement

The current Training implementation can preserve an active status when exact runner inspection returns `unknown`.

That behavior cannot be allowed to automatically recreate a dispatcher lease, because it would reintroduce persisted uncertainty as shared GPU truth.

At the same time, simply ignoring `unknown` is not safe if Training really is still executing.

Therefore dispatcher cutover requires a narrow Training recovery hardening step **without migrating the Training queue**:

- a surviving Training lease may be recreated only from positive exact runtime evidence;
- queued-only Training remains paused;
- the startup barrier must not open while Training recovery is still genuinely unresolved;
- if current WSL PID+script inspection cannot deterministically classify the surviving runner, strengthen Training's launch/recovery identity before cutover rather than guessing.

Potential stronger identity evidence includes:

- WSL boot identity,
- Linux process start identity in addition to PID,
- exact process group/session identity,
- a host-visible managed launcher/guardian if WSL control-plane availability otherwise leaves an unresolvable gap.

`nvidia-smi` may corroborate exact owned process identity but generic GPU utilization or VRAM residency is not sufficient proof.

Deeper Training queue semantics remain untouched. Only the shared-GPU recovery boundary must be authoritative from the first dispatcher cutover.

## 9. Restart lifecycle

The dispatcher has an explicit startup barrier and does not accept normal dispatch until restart reconciliation finishes.

Recommended startup order:

1. create the dispatcher in stopped/barriered state and register all clients;
2. recover invalid durable execution-queue state;
3. run Inference restart reconciliation:
   - resolve committed outcomes,
   - cancel exact old provider IDs,
   - use broad Comfy discovery only as compatibility cleanup where still required,
   - shelve all unfinished work to Backlog,
   - create no Inference dispatcher submission;
4. run LLM restart reconciliation:
   - discard old ephemeral jobs,
   - terminate any exact stale WebCap-owned local llama runtime,
   - create no LLM dispatcher submission;
5. run one **synchronous** Training startup reconciliation:
   - exact surviving runner -> re-establish Training active lease,
   - queued-only Training -> pause and submit nothing,
   - unresolved runner identity -> startup barrier remains closed and the failure is surfaced;
6. start the Training observer;
7. open/start the dispatcher;
8. begin normal local-GPU dispatch.

The current `app.py` starts the Training observer asynchronously before LLM reconciliation. That ordering must change for dispatcher cutover; otherwise a fresh request could race startup recovery.

### Restart crash boundaries

The design must also be safe if WebCap dies:

- after a client submitted but before dispatch,
- while a provisional lease is being granted,
- after the outgoing client has cleaned up but before the next client starts,
- immediately after Inference submits to ComfyUI,
- while LLM is loading a local model,
- while Training has launched but before all queue state is persisted.

The restart rules above deliberately collapse those cases back into lane-owned recovery plus an empty dispatcher.

## 10. Runtime cleanup and crash hardening

The dispatcher is intentionally ignorant of physical runtimes, so each client's cleanup and recovery must be strong enough to support a deterministic handoff.

### 10.1 Inference restart identity

Keep the write-ahead Comfy provider ID:

`queue_managed_workflow()` persists `providerJobId` before provider submission.

That ID is the primary restart cleanup identity.

The current Comfy queue scan for WebCap-owned jobs can remain as compatibility coverage for older/partial state, but current-format recovery should not depend on discovery when the exact provider ID is already known.

Old Inference work never becomes a dispatcher submission after restart.

### 10.2 Inference handoff authority

The current `free_cached_models()` call only acknowledges that ComfyUI accepted `/free`; it does not prove the asynchronous unload/free work has completed.

Before cutover, define and test one authoritative Inference handoff primitive.

The preferred solution is the least invasive ComfyUI-owned signal that proves its managed execution and cache have reached the handoff boundary.

If ComfyUI exposes no sufficient confirmation, the remaining product decision is whether WebCap is allowed to perform a hard ComfyUI restart/termination when graceful handoff cannot be proven. This decision is intentionally not guessed in code.

Do not replace this with arbitrary VRAM percentage thresholds.

### 10.3 LLM process ownership

The current local llama `_process` handle is memory-only. A backend crash can therefore leave a WebCap-started llama server alive while the new backend no longer has its `Popen` handle.

Fix this **before cutover**.

Preferred approaches, in order:

1. OS lifecycle ownership that guarantees the child dies with WebCap;
2. otherwise persist enough exact process identity at launch to positively recognize and terminate only the WebCap-owned stale llama process on startup.

PID alone is not enough where PID reuse is possible; include command/executable identity and creation/start identity where available.

### 10.4 Training survivor identity

The current PID + exact runner-script check is good positive evidence while WSL inspection works, but its `unknown` result cannot become dispatcher ownership.

Before cutover, make the surviving-runner decision exact enough that startup can resolve Training to:

- verified active,
- verified absent/terminal,
- explicit startup recovery failure that keeps the dispatcher barrier closed.

This is a narrow recovery-boundary requirement, not a Training queue migration.

### 10.5 Handoff failure

A handoff failure is materially different from a client's pre-dispatch `NOT_READY`.

`NOT_READY` means another client may be tried.

A failed handoff means the current client has not yet established that the shared GPU can safely transfer. The dispatcher therefore keeps that lease and does not start another local-GPU client.

To prevent a new form of immortal uncertainty:

- each client handoff must have a bounded graceful path,
- each managed runtime should have a deterministic escalation path where technically possible,
- failures are surfaced with exact runtime identity/evidence,
- no generic “maybe still owns VRAM” loop is permitted.

The cutover gate is that every production local-GPU client has a known handoff path with these semantics.

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

- queue-ahead within LLM remains LLM-local;
- GPU wait owner/order comes from the dispatcher snapshot.

Remote head has no GPU wait owner.

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

### Phase 0 — semantic lock-in and hostile-audit corrections

This document and `docs/queue-semantics.md` define the target before runtime changes.

Lock in:

- one dispatcher authority,
- ephemeral submissions,
- unique lease IDs,
- submission revisions,
- dispatcher-owned handoff events,
- outgoing-client cleanup,
- no cross-client state inspection,
- no unresolved runtime identity becoming shared GPU truth.

### Phase 1 — add the dispatcher in isolation

Files:

- add `tool/server/gpu_dispatcher.py`;
- add `tests/test_gpu_dispatcher.py`.

Unit tests must cover:

- only one provisional/active lease;
- priority ordering;
- stable FIFO for equal priority;
- idempotent one-submission-per-client behavior;
- submission revision replacement/re-arm;
- stale callback result cannot erase a newer submission;
- stale lease yield cannot release a newer same-client lease;
- withdrawal of one revision cannot delete a newer revision;
- `NOT_READY` immediately allows another client;
- `EMPTY` removes only the dispatched revision;
- callback exception never wedges provisional state;
- same-client continuation can reuse the lease before handoff begins;
- once handoff begins it is not cancelled by late same-client submission;
- handoff callback is never invoked under dispatcher lock;
- failed handoff retains ownership;
- successful handoff clears ownership and wakes the next client;
- passive snapshot has no side effects;
- dispatcher state is never persisted.

### Phase 2 — prove client handoff authority while old arbitration still exists

Do not cut over scheduling yet.

#### Inference

- build one lane-owned handoff primitive around exact provider quiescence plus Comfy cache/model release;
- prove what authoritative completion signal exists after `/free`;
- if graceful completion cannot be proven, resolve the hard-cleanup product decision before cutover;
- keep incoming Training/LLM cleanup temporarily only as compatibility until cutover.

#### LLM

- add an explicit lane-owned llama handoff primitive;
- after local grace/yield, unload the model authoritatively;
- hard-stop the exact owned server if unload cannot complete;
- make stale llama ownership across backend crash deterministic.

#### Training

- keep the specialized queue unchanged;
- strengthen only the startup survivor identity boundary enough that `running` vs `absent` is authoritative for dispatcher restoration;
- do not allow current `unknown` status to become a new dispatcher lease.

### Phase 3 — build dormant client adapters

Add client-facing functions while old arbitration still remains the only production scheduler.

#### Inference adapter

- submission synchronization,
- short dispatch callback that claims current Inference work and starts a lane worker,
- handoff callback using the Phase 2 primitive,
- lease-token-aware worker completion/yield.

#### LLM adapter

- FIFO driver distinguishes remote head vs local head,
- local submission callback,
- short dispatch callback starts lane worker,
- local grace delays `yield_lease()`,
- handoff callback unloads/stops local llama,
- remote work never touches dispatcher.

#### Training adapter

- synchronize one Training submission from existing Training state,
- short dispatch callback wraps existing launch path,
- verified surviving runner can establish an active Training lease,
- queue schema and long-running lifecycle remain untouched.

### Phase 4 — startup barrier and recovery wiring

Before dispatcher authority is enabled:

- register clients;
- reconcile Inference to Backlog;
- discard/clean stale LLM runtime;
- synchronously resolve Training survivor identity;
- restore only verified Training active ownership;
- keep dispatcher closed until this sequence completes.

Add restart-boundary tests before production cutover.

### Phase 5 — atomic dispatcher cutover

This is the one-authority switch.

At the same time:

- Inference stops reserving shared GPU through Training;
- LLM stops reserving shared GPU through Training;
- Training launch stops directly reserving `execution_queue` resource ownership;
- all local-GPU starts require a dispatcher lease;
- all lease exits go through dispatcher-initiated handoff;
- Activity `gpuOwner` projects dispatcher state;
- wait-state projections use dispatcher state.

Do not leave old and new acquisition paths live simultaneously.

### Phase 6 — delete cross-lane arbitration and incoming cleanup

Remove from `inference_runner.py`:

- `_local_llm_work_pending()`;
- Training reservation wrappers;
- direct shared-owner scheduling;
- incoming llama cleanup.

Remove from `llm_runner.py`:

- Training reservation helpers;
- direct shared-owner scheduling;
- Training blocker inspection;
- LLM pause/resume actions and pause-only tests.

Remove from `training_runner.py`:

- external GPU reservation/block-reason helpers;
- direct shared-resource claim/release;
- `_prepare_comfyui_for_training()`;
- incoming Director cleanup.

Remove from `storyboard_llm_runtime.py`:

- implicit local GPU reservation fallback;
- cross-lane Comfy cleanup;
- `release_loaded_model_for_gpu_work()` once no callers remain.

Remove from `execution_queue.py`:

- `_resource_owner`;
- `reserve_resource()`;
- `release_resource()`;
- `resource_owner()`.

Keep domain queue mechanics intact.

### Phase 7 — simplify lane monitors

#### Inference

Keep monitoring only for:

- active provider lifecycle,
- lane-local Comfy availability retry/re-arm,
- submission synchronization.

No cross-lane polling.

#### LLM

Reduce to a FIFO/client worker driver:

- run remote head directly,
- submit local head,
- execute active local work,
- manage local grace/yield.

No generic GPU polling.

#### Training

Keep its always-on observer for the long-running external runner.

Its shared-GPU role becomes only dispatcher submission/lease synchronization.

### Phase 8 — compatibility/UI cleanup

- keep public queue/job payloads stable where practical;
- remove obsolete LLM pause fields/actions;
- update Activity and Director/Inference wait labels to dispatcher facts;
- update `docs/execution_queue.md` to describe the post-migration implementation;
- update `AGENTS.md` only if implementation exposes a missing invariant not already covered by Managed Runtime Ownership.

### Phase 9 — deeper Training cleanup only if justified

After the dispatcher proves stable, revisit remaining Training-local complexity independently.

Do **not** migrate Training into `execution_queue.py` merely for symmetry.

Any later Training refactor must be justified by a concrete Training problem, not by the dispatcher architecture.

## 14. Required integration tests

In addition to dispatcher unit tests, preserve or replace the current cross-lane regressions with tests against the new architecture.

### Ordering

- Training ready + LLM ready + Inference ready -> Training gets the next free GPU turn.
- LLM ready + Inference ready -> LLM gets the next free GPU turn.
- Inference foreground already active -> it drains foreground Queue before yielding.
- Inference Queue -> Backlog boundary yields before Backlog can compete again.
- Backlog waits behind newly ready foreground clients.
- equal-priority submissions are stable FIFO.
- an active client is never preempted merely because a higher-priority submission arrives.

### Readiness

- Comfy unavailable -> Inference returns `NOT_READY`; another client may dispatch.
- stale/cancelled Inference submission -> Inference returns `EMPTY`; dispatcher moves on.
- remote LLM never appears as a GPU submission.
- local LLM runtime failure fails its job without inventing a readiness blocker.
- Training paused/empty -> no Training submission.

### Lease and handoff

- every grant has a unique lease ID.
- stale yield from an old same-client worker cannot affect the current lease.
- LLM grace delays yield for the intended short window.
- new local LLM work during grace reuses the lease.
- same-client submission racing yield may reuse the lease if handoff has not begun.
- same-client submission arriving after handoff begins waits for a new lease.
- a different next client cannot start before outgoing handoff succeeds.
- handoff failure leaves outgoing ownership intact and visible.
- positive current-session Comfy provider activity keeps Inference lease until resolved.
- unverifiable provider state does not become an indefinite hold.
- active Training retains its lease until Training's own lifecycle reaches a yield boundary.

### Submission races

- a re-submit during an in-flight dispatch callback survives the old callback's `EMPTY`/`NOT_READY` result.
- stale withdrawal cannot remove a newer submission revision.
- cancel/reorder between submission and dispatch is resolved by the lane callback's current-state re-check.
- callback exception cannot leave a phantom provisional owner.

### Restart

- dispatcher starts empty and barriered.
- Inference unfinished work becomes Backlog and creates no submission.
- LLM unfinished work is gone and creates no submission.
- stale WebCap-owned llama is terminated before dispatcher opens.
- queued-only Training is paused and creates no submission.
- only positively verified surviving Training re-establishes active ownership.
- unresolved Training survivor identity keeps the startup barrier closed rather than guessing.
- old Inference provider cleanup never becomes a dispatcher submission.

### Crash boundaries

Simulate/reason through process death:

- after submission but before dispatch,
- during provisional grant,
- after provider launch identity is persisted but before active status is written,
- during handoff cleanup,
- after handoff cleanup but before next grant,
- after Training process launch but before queue projection catches up.

Every case must recover through the owning lane without persisted dispatcher state.

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

The migration is complete when all of the following are true:

1. There is exactly one production authority that grants local-GPU execution: `gpu_dispatcher.py`.
2. Every active grant has a unique lease ID; stale workers cannot release newer ownership.
3. Pending client submissions are revisioned so stale callback/cancel results cannot erase newer work.
4. No lane imports another lane merely to ask whether it may use the GPU.
5. No incoming client cleans up another client's runtime.
6. The dispatcher initiates every lease transfer and the outgoing client implements the handoff.
7. The dispatcher never directly calls ComfyUI, llama.cpp, WSL, process inspection, `nvidia-smi`, or queue JSON.
8. `execution_queue.py` contains no shared GPU owner.
9. Dispatcher state is never persisted.
10. Restart creates no Inference or LLM dispatcher submission.
11. Only positively verified surviving Training may re-establish active local-GPU ownership after restart.
12. Remote LLM never touches the dispatcher.
13. Inference Queue/Backlog semantics and Training's specialized queue remain intact.
14. LLM local grace and lane stickiness remain intact without cross-lane polling.
15. Activity/wait UI explanations come from either lane-local facts or dispatcher facts, never guesses assembled from several subsystems.
16. A pre-dispatch `NOT_READY` client never prevents the dispatcher from considering another submitted client.
17. No different client starts until outgoing handoff has succeeded.
18. Every production client has a bounded, authoritative handoff path or deterministic escalation.
19. No ambiguous runtime state can become an indefinite shared GPU blocker.
20. Real runtime failures remain visible and traceable.

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

The architecture is internally consistent after hostile audit with one explicit product/ownership decision still open:

### Open: authority to hard-reset ComfyUI on failed graceful handoff

The current code does not appear to own ComfyUI's process lifecycle; it talks to ComfyUI over HTTP.

ComfyUI's `/free` endpoint is asynchronous, so “HTTP request accepted” is not sufficient proof that the VRAM handoff is complete.

Before dispatcher cutover we need to establish one of these:

1. ComfyUI exposes a sufficiently authoritative completion signal that WebCap can wait on; or
2. WebCap is allowed to hard-stop/restart the ComfyUI process when graceful handoff cannot be proven.

The dispatcher itself will do neither. In either case the behavior belongs to the Inference handoff callback.

Everything else in the dispatcher design now has a concrete ownership rule:

- dispatcher owns ordering, leases, and handoff timing;
- lane owns readiness, execution, runtime identity, and cleanup implementation;
- stale operations are fenced by submission revisions and lease IDs;
- restart is lane recovery plus an empty/barriered dispatcher;
- Training remains specialized and is integrated only at the shared-GPU boundary.

