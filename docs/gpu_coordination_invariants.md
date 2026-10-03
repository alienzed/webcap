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

- **Training:** the recorded managed runner PID identifies the process to check. No PID means no surviving Training process. A PID that is not alive as the expected managed runner means no surviving Training process. Only that exact expected runner being alive establishes active Training.
- **Inference:** only exact current-session ComfyUI work that WebCap started and can positively identify as still active establishes continuing Inference execution. Persisted provider IDs from a prior WebCap process never recreate GPU ownership.
- **LLM:** only current-session WebCap local LLM execution establishes LLM ownership. A loaded/cached model is not execution. Remote LLM work never owns the local GPU.

## 4. Runtime questions are binary

A runtime coordination question resolves to **yes** or **no**.

There is no `unknown`, `maybe`, `uncertain`, `unverified`, or conservative-busy coordination state.

If the operation required to answer a runtime question itself fails, raise/surface the real error. An operation failure does not become a third scheduling state.

## 5. Only real execution owns

Queued work does not own the GPU.

Backlogged work does not own the GPU.

A timer cannot acquire or recreate GPU ownership. A short deterministic quiescence deadline may
bound when an already-owning lane ends a same-lane drain turn; during that interval the canonical
`owner` remains the only ownership fact.

Cached model/runtime residency by itself does not own the GPU.

Stale persisted state does not own the GPU.

Real managed execution starts -> that lane owns.

That execution reaches its defined terminal/handoff boundary -> ownership ends.

If exact current-session provider work is positively still executing, the Inference execution has not reached that boundary yet.

## 6. Idle selection is deterministic

Training is the explicit local-GPU arbitration backbone. When `owner == none`, it applies this order
when granting a new local-GPU turn:

```text
Training
> local LLM FIFO head
> foreground Inference Queue
> eligible Inference Backlog
```

Already-running work is non-preemptive. LLM and Inference request a turn through the Training
arbiter; they do not reproduce this priority rule themselves.

## 7. Client lanes stay local; handoff prep is shared

LLM and Inference know their own queue/runtime state only. They do not inspect each other, infer each
other's intent, or independently decide shared priority.

Training is intentionally asymmetric: as the durable arbitration backbone, it may inspect the narrow
lane-local readiness facts required to apply the ordering above. That authority does not create a
second ownership fact; `owner` remains canonical.

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
Training  -> exact recorded managed PID is alive as our expected runner ? training : none
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
