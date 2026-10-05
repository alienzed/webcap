# GPU Coordination Invariants

> **Authoritative contract.**
>
> This is the governing contract for local-GPU coordination in WebCap. Implementation details, older plans, queue documents, and defensive runtime code must conform to these invariants. If a proposed implementation needs additional coordination state or nondeterministic fallback behavior, stop and reassess instead of extending the model.

## 1. One owner

There is exactly one process-local local-GPU ownership fact:

```text
owner ∈ {none, training, llm, inference}
```

GPU free means `owner == none`.

No second variable, persisted lock, lease, hold, grace flag, provider flag, lane opinion, or derived boolean may independently represent shared GPU ownership.

## 2. Disk never proves occupancy

Persisted files record requested work, recovery identity, queue state, and history. They do not prove that the GPU is occupied now.

Persisted `running`, provider IDs, queue state, or old ownership records cannot recreate local-GPU ownership by themselves after restart.

## 3. Runtime reality is authoritative

Each managed local runtime has one concrete source of truth:

- **Training:** the recorded managed runner PID identifies the process to check. H3 calibration is Training traffic and uses the same rule: its recorded exact probe PID identifies the expected `h3_shape_probe.py` process. No exact PID means no surviving Training process. A PID that is not alive as the expected managed runner means no surviving Training process. Only an exact expected managed Training or H3 probe process being alive establishes active Training.
- **Inference / ComfyUI:** ComfyUI's own queue answers whether ComfyUI is busy. Any running or pending ComfyUI work counts, regardless of who submitted it. WebCap provider identity is still used to associate and recover WebCap requests, but it is not required to decide whether ComfyUI itself is busy. Persisted provider IDs from a prior WebCap process never recreate WebCap GPU ownership.
- **LLM:** only current-session WebCap local LLM execution establishes LLM ownership. A loaded/cached model is not execution. Remote LLM work never owns the local GPU. The managed local runtime may be queried or stopped as needed; inability to do so is an operation failure, not an uncertain scheduling state.

## 4. Runtime questions are binary

A runtime coordination question resolves to **yes** or **no**.

There is no `unknown`, `maybe`, `uncertain`, `unverified`, or conservative-busy coordination state.

If the operation required to answer a runtime question itself fails, raise/surface the real error. An operation failure does not become a third scheduling state.

## 5. Only real execution owns

Queued work does not own the GPU.

Backlogged work does not own the GPU.

A timer cannot acquire, recreate, or extend GPU ownership after a lane's ordinary queue is empty.

Cached model/runtime residency by itself does not own the GPU.

Stale persisted state does not own the GPU.

Real managed execution starts -> that lane owns.

That execution reaches its defined terminal/handoff boundary -> ownership ends.

If exact current-session provider work is positively still executing, the Inference execution has not reached that boundary yet.

## 6. Requests are FIFO and lanes are sticky

There is no built-in lane priority.

When `owner == none`, the first legitimate GPU request to acquire ownership gets it. Once a lane owns the GPU, it drains its ordinary FIFO before releasing. New ordinary work added to that lane joins that FIFO and extends the turn. Nothing preempts active work.

Backlog is not a competing request system. It may supply one Inference job at a time only as a secondary stay-busy-when-idle mechanism; each Backlog job ends its turn before another Backlog item may be attempted.

## 7. Client lanes stay local; handoff prep is shared

LLM and Inference know their own queue/runtime state only. They do not inspect each other or infer each other's intent.

Training is intentionally asymmetric only where its long-lived runtime and durable queue require stronger reconciliation/protection. External lanes request the same canonical GPU owner through that boundary, but Training does not assign a lane priority.

Cross-runtime GPU handoff preparation is a shared operation independent of client-lane health. It may
invoke concrete runtime cleanup primitives directly (for example unloading a retained local LLM model
or freeing ComfyUI caches). Client lanes do not own or veto that cleanup. A concrete runtime-busy
result may defer the handoff; an operational failure is surfaced according to the existing fail-loudly
policy rather than becoming new scheduler state.

## 8. Restart reconstructs reality, not ownership history

A WebCap restart starts without inherited LLM or Inference ownership.

```text
LLM       -> none
Inference -> none
Training  -> exact recorded managed Training/H3 PID is alive as our expected runner ? training : none
```

Inference may preserve unfinished requests as Backlog. LLM session work may be discarded. Training may recover its specialized queue state. Those recovery actions are independent from shared GPU ownership.

## 9. Coordination state cannot grow casually

Any proposed GPU-coordination state beyond these invariants must identify a concrete supported sequence that cannot be represented by this model.

Do not add a new blocker, hold, timer, fallback truth, ownership proxy, lane-to-lane permission check, or persisted scheduling fact to handle hypothetical or ambiguous conditions.

If implementation starts growing exceptions, stop and reassess the lifecycle/call chain.

## 10. Failure beats philosophy

WebCap prefers a visible deterministic failure to nondeterministic defensive coordination.

The allowed outcomes are concrete:

```text
yes
no
error
```

`error` is an operation failure. It is not scheduler state and never means "treat the GPU as busy just in case."
