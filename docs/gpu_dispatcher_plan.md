# GPU Dispatcher Migration Plan

> **Status:** implementation plan only. No runtime code changes are included in this document.
>
> **Grounding:** this plan was derived from the current `main` branch at commit `0152c3087346c6e52e26cd6088e160c09d5e4ca0`, including `docs/queue-semantics.md`, `tool/server/execution_queue.py`, `inference_runner.py`, `llm_runner.py`, `training_runner.py`, `storyboard_llm_runtime.py`, `inference_runtime.py`, `activity_monitor.py`, startup wiring in `app.py`, and the queue/runner regression tests.
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

### 3.6 A client owns handoff cleanup

Before a client releases its GPU lease, it is responsible for bringing **its own** managed runtime to the lane's handoff boundary.

The next client does not clean up the previous client.

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

- registered clients,
- at most one pending submission per client,
- an insertion sequence for stable equal-priority ordering,
- one provisional/active client,
- a condition variable / wake event,
- a started/stopped flag,
- read-only diagnostic snapshot data.

No provider/job payload should be stored.

A useful pending record is conceptually:

```text
client_id
priority
sequence
eligible
submitted_at
```

The client callback is registered separately.

### 4.2 Client registration

Each GPU client registers one callback:

```text
register_client(client_id, dispatch_callback)
```

The callback is the only place where the dispatcher calls back into a lane.

The callback re-checks current lane-local truth immediately before it starts anything.

### 4.3 Submission

```text
submit(client_id, priority)
```

Requirements:

- idempotent per client,
- duplicate submit must not create duplicate runnable entries,
- re-submit may update priority and re-arm a previously deferred client,
- submission wakes the dispatcher,
- submission does not claim a domain job.

This avoids synchronizing two copies of Queue/LLM/Training ordering.

### 4.4 Withdrawal

```text
withdraw(client_id)
```

Withdrawal removes a pending claim only.

It must not silently release an active client. An active client owns its lease until it explicitly releases it.

### 4.5 Dispatch result

The callback should return one of three outcomes:

- **STARTED** — the client started or reattached local-GPU work; it now owns the active lease.
- **NOT_READY** — the client still has meaningful work, but a lane-local condition prevents start right now.
- **EMPTY** — there is no longer runnable local-GPU work represented by this submission.

The names can differ in code, but the semantics should remain this small.

Important behavior:

- The dispatcher marks the candidate provisionally active before calling the callback so a second client cannot start concurrently.
- The callback must be invoked outside the dispatcher's lock.
- `NOT_READY` clears the provisional active slot and defers that client; the dispatcher immediately considers the next pending client.
- A deferred client is not busy-looped. Its lane must re-submit/re-arm it when its own state changes or when its own retry timer decides to try again.
- `EMPTY` clears the submission and continues.
- An unexpected callback exception must never wedge the dispatcher. The provisional slot is cleared, the error is logged, and the lane wrapper must make its own job failure visible.

### 4.6 Release

```text
release(client_id)
```

Only the active client may release.

Release clears the active client and immediately wakes dispatch.

A client may retain the lease across multiple domain jobs if that is part of its lane semantics. The dispatcher does not need to understand why.

This is how existing lane stickiness remains lane-local.

### 4.7 Snapshot

Provide a passive:

```text
snapshot()
```

containing only:

- active client,
- ordered pending clients,
- priority/sequence,
- deferred/eligible state.

This powers diagnostics and wait-reason projection.

The snapshot must not call any client callback or trigger scheduling.

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

### 6.6 Outgoing handoff

Before Inference voluntarily releases at a natural idle boundary:

- no exact managed provider job may still be confirmed active;
- Inference performs its own Comfy cache/model release request.

Today `/free` is not a synchronous proof that all model memory has vanished. Do not compensate by making Training or LLM query ComfyUI again.

If real-machine testing shows the Comfy handoff is still too weak, strengthen **Inference's** handoff primitive or Comfy integration. Do not reintroduce incoming-client checks.

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

While LLM owns the lease:

- consecutive local FIFO jobs may execute without releasing between them;
- when local work drains, hold the existing short continuation grace;
- a new local job arriving during grace reuses the same lease;
- if the next FIFO job is remote, end the local lease before executing the remote job;
- when grace expires with no local continuation, quiesce the local runtime and release.

The dispatcher only sees that LLM still owns or has released the lease.

### 7.6 Remove runtime-level arbitration

`storyboard_llm_runtime.chat()` currently has a fallback path that reserves the GPU itself when `gpu_reserved=False`.

After cutover, local app-owned LLM execution must not bypass the LLM lane.

The runtime should therefore:

- accept an explicit “dispatcher lease already granted” contract for local work;
- fail loudly if managed local work reaches the runtime without that contract;
- continue to allow remote work without a local GPU lease.

Current model-test/calibration routes already enqueue through `llm_runner`, so there is no product requirement for a second local arbitration path.

### 7.7 Outgoing llama cleanup

Training/Inference must stop calling `release_loaded_model_for_gpu_work()`.

Instead, when LLM actually releases its dispatcher lease:

- unload the local model,
- if unload cannot be made authoritative, stop the WebCap-owned llama server,
- then release the lease.

The short grace exists specifically so this unload does not happen between causally adjacent local requests.

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

On startup, Training performs its normal runner recovery.

If it positively re-establishes the exact surviving managed runner:

- Training re-submits/reattaches itself to the dispatcher;
- the dispatcher only learns that the Training client owns the GPU;
- it does not inspect the PID, script, WSL, or queue file.

If there is queued Training but no surviving active runner:

- the existing first-startup rule pauses the queue,
- Training submits nothing.

This preserves the existing “Training never auto-starts merely because WebCap restarted” behavior.

### 8.4 Initial adapter vs deeper recovery cleanup

The first dispatcher migration should not rewrite Training recovery.

The existing “unverifiable active runner remains active” behavior is a known transitional debt:

- if exact process inspection returns `unknown`, persisted active status may remain;
- today that can indirectly reassert shared GPU ownership.

In the first adapter phase, preserve this behavior inside Training so the migration does not destabilize the queue that has proven robust.

After the dispatcher is stable, harden this separately so an unverifiable persisted runner cannot become a permanent GPU claim.

### 8.5 Final Training recovery target

The final rule should be:

- exact runner verified active -> Training may submit/retain the dispatcher lease;
- exact runner positively absent -> recover to paused/resumable queue state;
- exact runner inspection unavailable -> remain a Training-local recovery error, not a durable cross-lane scheduling fact.

Do not use GPU utilization percentages as proof.

If WSL `/proc` inspection alone cannot provide a deterministic fallback, add a stronger exact identity channel at Training launch time rather than guessing from stale queue status.

Possible evidence to investigate in the later Training phase:

- WSL boot identity recorded at launch,
- exact process group/session identity,
- an OS-visible guardian/launcher identity,
- CUDA PID correlation only when it can be tied to the exact managed process tree.

`nvidia-smi` remains diagnostic unless it can be correlated to an exact owned runtime identity.

## 9. Restart lifecycle

The dispatcher should have an explicit startup barrier.

Recommended startup order:

1. create/register dispatcher clients, but do not allow dispatch yet;
2. recover invalid durable execution-queue state;
3. run Inference restart reconciliation:
   - resolve committed results,
   - cancel exact old provider IDs best-effort/authoritatively where possible,
   - shelve all unfinished work to Backlog,
   - submit nothing;
4. run LLM restart reconciliation:
   - discard old ephemeral jobs,
   - terminate any stale WebCap-owned local llama runtime,
   - submit nothing;
5. run one synchronous Training startup reconciliation:
   - verified surviving runner may submit/reattach Training,
   - queued-only Training is paused and submits nothing;
6. start the Training observer;
7. start the dispatcher;
8. begin serving normal requests.

This avoids a startup race where a fresh Inference/LLM request could be dispatched before Training has had the opportunity to re-establish an actually surviving runner.

## 10. Runtime cleanup and crash hardening

The dispatcher is intentionally ignorant of physical runtimes, so client cleanup must become stronger.

### 10.1 Inference restart cleanup

Keep the write-ahead Comfy provider ID:

`queue_managed_workflow()` persists `providerJobId` before submission.

That ID is the primary restart cleanup identity.

The current Comfy queue scan for WebCap-owned jobs can remain as transitional compatibility for older jobs, but after write-ahead coverage is proven it should not be required for ordinary current-format recovery.

Old Inference work never becomes a dispatcher submission after restart.

### 10.2 LLM process ownership

The current local llama `_process` handle is memory-only. A backend crash can therefore leave a WebCap-started llama server alive while the new backend no longer has its `Popen` handle.

This must be fixed before relying completely on “dispatcher empty means no old LLM owner.”

Preferred options, in order:

1. OS lifecycle ownership that guarantees the child dies with WebCap;
2. otherwise persist enough exact process identity at launch to positively recognize and terminate only the WebCap-owned stale llama process on startup.

PID alone is not enough if PID reuse is possible; include executable/command identity and a creation/start identity where available.

This remains LLM-runtime logic, not dispatcher logic.

### 10.3 Outgoing cleanup failures

A client may keep its lease while it has positive evidence that its own managed runtime is still active.

If cleanup becomes uninspectable:

- record the exact failure,
- fail/terminalize the owning work as appropriate,
- do not convert uncertainty into an indefinite dispatcher hold.

This follows the existing `AGENTS.md` managed-runtime rule.

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

### Phase 0 — semantic lock-in

This document and `docs/queue-semantics.md` define the target before runtime code changes.

No implementation should be merged that violates:

- one dispatcher authority,
- ephemeral submissions,
- client-owned readiness,
- client-owned cleanup,
- no cross-client state inspection.

### Phase 1 — add the dispatcher in isolation

Files:

- add `tool/server/gpu_dispatcher.py`;
- add `tests/test_gpu_dispatcher.py`.

Do not connect production lanes yet.

Tests must cover:

- only one active client;
- priority ordering;
- FIFO for equal priority;
- idempotent duplicate submit;
- priority update/re-arm;
- withdraw pending client;
- `NOT_READY` skips to the next client;
- `EMPTY` removes the submission;
- callback exception never wedges active state;
- release wakes next client;
- callbacks are not invoked under the dispatcher lock;
- passive snapshot has no side effects;
- dispatcher state is not persisted;
- dispatcher starts empty after module/process recreation.

### Phase 2 — strengthen outgoing runtime handoff while old arbitration still exists

Purpose: remove the need for incoming-client cleanup before the dispatcher becomes authoritative.

#### LLM

- add an explicit “quiesce local runtime for GPU handoff” path;
- after local grace expires, unload the local model or hard-stop the owned server before old GPU release;
- add exact stale llama startup cleanup identity.

Keep incoming `release_loaded_model_for_gpu_work()` temporarily as a compatibility check until cutover, then delete it.

#### Inference

- add an explicit “quiesce Comfy state for GPU handoff” path owned by Inference;
- invoke it when Inference actually leaves the foreground lane / releases old ownership;
- keep existing provider exact-live rules.

Keep incoming Training/LLM Comfy cleanup temporarily until cutover, then delete it.

This phase should not change cross-lane scheduling yet.

### Phase 3 — build dormant client adapters

Add client-facing functions but keep old arbitration active until all three are ready.

#### Inference adapter

- `sync_gpu_submission()`
- `dispatch_gpu_client()`
- `release_gpu_client()`

The callback must be testable directly without the live dispatcher thread.

#### LLM adapter

- lane driver distinguishes remote head vs local head;
- local submission callback;
- local lease release after FIFO/grace;
- no LLM pause semantics in the adapter.

#### Training adapter

- sync a single Training submission from existing Training state;
- dispatch callback wraps the existing launch path;
- active-runner recovery can represent Training as active without changing the Training queue schema.

Do not delete old reservation helpers yet.

### Phase 4 — atomic dispatcher cutover

This is the phase where there must be only one authority.

Wire startup and client submissions to the dispatcher.

At the same time:

- Inference stops calling `reserve_gpu_for_external_work()`;
- LLM stops calling `reserve_gpu_for_external_work()`;
- Training launch stops directly calling `execution_queue.reserve_resource()`;
- active Training is represented through the dispatcher adapter;
- Activity `gpuOwner` comes from the dispatcher;
- wait-state projections come from dispatcher state.

Do not leave old and new acquisition paths live simultaneously.

The old resource-owner compatibility functions may remain temporarily only if they are dead wrappers for diagnostics/tests; they must not be a second scheduler.

### Phase 5 — delete cross-lane arbitration

Once cutover tests pass, remove:

From `inference_runner.py`:

- `_local_llm_work_pending()`;
- `_reserve_gpu()` / `_release_gpu()` Training wrappers;
- direct `execution_resource_owner()` scheduling branches;
- incoming `release_loaded_model_for_gpu_work()` logic.

From `llm_runner.py`:

- Training reservation helper calls;
- direct shared-owner scheduling branches;
- Training blocker inspection in wait-state projection;
- LLM pause/resume actions and related pause-only test coverage.

From `training_runner.py`:

- `external_gpu_work_block_reason()`;
- `reserve_gpu_for_external_work()`;
- `gpu_reservation_block_reason()`;
- `release_gpu_for_external_work()`;
- direct shared-resource claim/release;
- `_prepare_comfyui_for_training()`;
- incoming Director cleanup.

From `storyboard_llm_runtime.py`:

- implicit local GPU reservation fallback;
- cross-lane Comfy cleanup before local generation;
- `release_loaded_model_for_gpu_work()` once no callers remain.

From `execution_queue.py`:

- `_resource_owner`;
- `reserve_resource()`;
- `release_resource()`;
- `resource_owner()`.

Keep queue mechanics intact.

### Phase 6 — simplify lane monitors

After dispatcher cutover, simplify the existing polling loops.

#### Inference

The monitor no longer polls for other lanes or GPU ownership.

It is needed only for:

- active provider lifecycle,
- lane-local retry while Comfy is unavailable,
- submission synchronization.

Prefer condition/event wakeups for queue changes. Keep a bounded Inference-owned provider retry interval only where an external Comfy availability change otherwise has no event source.

#### LLM

The monitor becomes a FIFO driver:

- run remote head directly,
- submit local head,
- observe active local job/grace.

No generic GPU polling.

#### Training

Keep the always-on observer. It is justified by long-running external runner recovery and progress.

Its GPU work is reduced to synchronizing the Training client with the dispatcher.

### Phase 7 — restart hardening

#### LLM

Prove that a WebCap-owned local llama process cannot survive a backend crash without being recognized and terminated on startup.

#### Inference

Verify every managed Comfy submission uses write-ahead `providerJobId` identity.

Once current-format coverage is complete, decide whether the broad WebCap Comfy queue scan is still necessary or only legacy cleanup.

#### Training

Add the synchronous first startup reconciliation so a verified surviving runner is re-established before normal request dispatch can begin.

Preserve queued-only restart pause.

### Phase 8 — Training recovery cleanup

Only after the dispatcher and thin Training adapter are stable:

- replace the “unverifiable runner remains active” behavior with a stronger exact recovery contract;
- add any extra process identity needed at Training launch time;
- ensure only verified surviving Training can re-establish a dispatcher lease.

Do not rewrite the Training queue or migrate it into `execution_queue.py`.

### Phase 9 — compatibility/UI cleanup

- keep public queue/job API payloads stable where practical;
- remove obsolete LLM pause fields/actions if still exposed;
- update Activity and Director/Inference wait labels to use dispatcher facts;
- update `docs/execution_queue.md` to describe the post-migration implementation;
- update `AGENTS.md` only if implementation reveals a missing invariant not already covered by Managed Runtime Ownership.

## 14. Required integration tests

In addition to dispatcher unit tests, preserve or replace the current cross-lane regressions with tests against the new architecture.

### Ordering

- Training ready + LLM ready + Inference ready -> Training gets the next free GPU turn.
- LLM ready + Inference ready -> LLM gets the next free GPU turn.
- Inference foreground already active -> it drains foreground Queue before releasing.
- Inference Queue -> Backlog boundary releases before Backlog can run.
- Backlog waits behind newly ready foreground clients.
- equal-priority submissions are stable FIFO.

### Readiness

- Comfy unavailable -> Inference returns `NOT_READY`; another client may dispatch.
- stale/cancelled Inference submission -> Inference returns `EMPTY`; dispatcher moves on.
- remote LLM never appears as a GPU submission.
- local LLM runtime failure fails its job and releases after cleanup/grace rules.
- Training paused/empty -> no active lease.

### Lease behavior

- LLM grace blocks other clients for the intended short window.
- a new local LLM request during grace reuses the lease.
- a remote LLM head ends the local lease before remote execution.
- positive current-session Comfy provider activity retains Inference lease.
- unverifiable provider state does not retain it indefinitely.
- active Training retains lease until Training's own terminal/pause boundary.

### Restart

- dispatcher starts empty;
- Inference unfinished work becomes Backlog and does not submit;
- LLM unfinished work is gone and does not submit;
- queued-only Training is paused and does not submit;
- verified surviving Training re-establishes the Training client before normal dispatch;
- stale local llama cleanup happens before dispatcher start;
- old Inference provider cleanup never becomes a dispatcher submission.

### Races

- cancel/reorder between submission and callback is resolved by the lane's callback re-check;
- duplicate submission is harmless;
- release and new submission cannot produce two active clients;
- callback exception cannot leave a phantom active client;
- Activity snapshot cannot trigger dispatch;
- passive queue reads cannot submit work.

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

1. There is exactly one production code path that grants local-GPU execution: `gpu_dispatcher.py`.
2. No lane imports another lane merely to ask whether it may use the GPU.
3. No incoming client cleans up another client's runtime.
4. `execution_queue.py` contains no shared GPU owner.
5. Dispatcher state is never persisted.
6. Restart creates no Inference or LLM dispatcher submission.
7. Only Training can re-establish active local-GPU work after restart, and that decision originates in Training recovery.
8. Remote LLM never touches the dispatcher.
9. Inference Queue/Backlog semantics and Training's specialized queue remain intact.
10. LLM local grace and lane stickiness remain intact without cross-lane polling.
11. Activity/wait UI explanations come from either lane-local facts or dispatcher facts, never guesses assembled from several subsystems.
12. A “not ready” client never prevents the dispatcher from considering another submitted client.
13. No ambiguous runtime state can become an indefinite shared GPU blocker.
14. Real runtime failures remain visible and traceable.

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

No blocking design question remains before implementation.

This plan deliberately preserves the current effective cross-lane order and lane-stickiness semantics while moving the mechanism into the correct layer.

If product policy later changes — for example, if Training should no longer have the next free turn ahead of already-waiting local LLM — that becomes a small dispatcher submission-priority change rather than another cross-lane code path.
