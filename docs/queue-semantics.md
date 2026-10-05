# Queue Semantics

> **North Star, not an implementation plan.**
>
> This document defines the intended semantics of queued, pending, running, and blocked work in WebCap.
> It describes what the product should mean to the user. It does **not** require the current UI to implement
> every dependency at the narrowest possible scope, and it should not be used as justification for speculative
> backend guards. When a coarser UI lock is simpler and still preserves these semantics, prefer the simpler UI.

## 1. Fundamental model

WebCap has three separate concerns:

1. **UI validity** — whether an action makes sense to offer *right now* given the user's current data and pending mutations.
2. **Queue admission** — recording valid requested work.
3. **Execution scheduling** — deciding when queued work may run given GPU/tool/runtime availability.

These concerns must not be collapsed into one another.

### Enabled means queueable

If WebCap presents an action as enabled, clicking it should successfully create the requested work.

The queue must not independently invent reasons to refuse a valid enabled action because:

- another job exists,
- the GPU is busy,
- Training is running,
- ComfyUI is unavailable,
- a local Director model is loaded,
- another Story has work pending,
- the same Story has unrelated work pending,
- or two jobs merely look as though they touch the same broad target.

If an action should not be requested yet, that is normally expressed through **UI state before the click**.

### Queueing and execution are different

A valid request may be queued even when it cannot execute immediately.

Execution resources affect **when** work runs, not whether the work is allowed to exist.

### Frozen requests

Queued inference and Director work should be treated as frozen requests unless a feature explicitly defines otherwise.

Once queued:

- later edits do not silently rewrite the job,
- later changes affect future requests,
- the queued job runs from the inputs captured for it,
- and stale-result validation may reject a result rather than applying it to incompatible current state.

A later mutation does **not** retroactively invalidate valid frozen work that was already requested.
If a Take, generation, or test was valid when queued, a subsequent authoring mutation does not cancel,
rebase, or rewrite that job. The pending mutation may constrain **new** dependent requests until it
completes, but earlier frozen work remains an intentional historical request.

The normal UI should make semantically invalid follow-up requests **unreachable**, not merely reject
them later. If a pending mutation owns a Scene or authoring region, the corresponding overlay/disabled
state prevents new dependent actions from being triggered against stale inputs. Queue ordering is
therefore not a substitute for correct UI state and should not be used to make an otherwise-invalid
request seem safe.

## 2. The dependency rule

Pending-work UI state is based on **data dependency**, not generic busy state.

There is an important asymmetry:

> **Pending consumers do not lock their source authoring state merely because they exist. Pending writers may constrain future consumers.**

If a Take, generation, test, or other consumer has already snapshotted valid inputs, the user may keep
editing those inputs for future work. The queued consumer keeps its frozen version. By contrast, when
pending work will mutate an input that a new consumer would snapshot, the new consumer should wait
when the user would reasonably expect it to use the completed mutation.

> If pending operation A will modify data X, and action B would read or snapshot X if clicked now,
> the user would normally expect B to use A's completed result. Therefore B should not be offered
> against the old value while A is pending.

The practical question is:

> **Would the user expect this action, if clicked now, to use the result of the pending operation?**

If yes, the UI should wait.

If no, the action should normally remain available.

WebCap should block **semantic hazards**, not make editorial judgments for the user. An action may
be wasteful, premature, or creatively odd and still be perfectly safe. If it does not create a
misleading dependency, stale-input expectation, race, or destructive conflict, the app should
normally leave the decision to the user.

This rule is intentionally independent of queue identity, thread identity, GPU ownership, or broad
Story/Scene "busy" concepts.

## 3. Locking granularity

The semantic dependency graph may be precise; the UI does not have to reproduce it with hundreds
of microscopic lock rules.

A feature may protect a broader region when that is materially simpler and remains unsurprising.

Examples:

- one exact action may be disabled for a duplicate request,
- one Scene may be protected when only that Scene can change,
- the entire **Scenes** workspace for one Story may be overlaid while Scene authoring material is being mutated,
- a whole Story may be protected for a truly Story-wide mutation.

Prefer a **small number of obvious scopes** over a brittle graph of special-case controls.

This is deliberate conservatism: it is easier to later relax a correct broad lock than to recover
from subtle stale-input workflows caused by an incomplete dependency graph.

Broad UI protection is acceptable. Broad **queue-admission refusal is not**.

When an operation has frozen source inputs, the UI may also protect those source inputs while the
operation is pending when editing them would reasonably imply that the pending work will see the
new values. This is about truthful UI semantics, not technical inability to edit frozen requests.

Prefer region-level overlays when a coherent authoring area is protected. Avoid maintaining large
lists of individually disabled descendants when one clear overlay communicates the same state.

Information architecture must not define queue semantics. If unrelated controls happen to share a
visual container today, that is an IA concern; do not invent a semantic dependency merely to make
the lock implementation convenient.

## 4. Independence boundaries

### Stories are independent

Pending work for Story A must not lock or disable Story B unless there is an explicit shared-data
dependency between them.

This applies even when both Stories share:

- the Director queue,
- the Inference queue,
- ComfyUI,
- the local GPU,
- the same model,
- or the same runtime.

### Features are independent by default

Storyboard, Generate, Test Generations, Chat, and Training may share execution machinery without
sharing semantic state.

Cross-feature UI locking requires an actual shared-data dependency.

## 5. Duplicate work

Some actions are semantically repeatable; others are not.

The UI should prevent a second request when repeating an already-pending action has no useful
meaning.

Examples of intentionally repeatable work include:

- generating additional Takes,
- generating additional images/videos,
- batch test candidates.

Examples of normally non-repeatable pending mutations include:

- expanding the same current concept twice,
- asking the same pending mutation to rewrite the same authoring state twice.

Duplicate prevention is a **UI semantic**. It must not become a generic backend "target busy" rule
that also rejects distinct valid operations.

## 6. Storyboard dependency map

This section records the durable data-flow facts. UI locking may be coarser than this map.

### Expand Concept

Reads:

- Story concept
- Story visual / atmosphere
- current Story invariants

Writes:

- Story concept
- previous-concept restore state

Downstream consumers include:

- Define Invariants
- Develop / Re-develop Scenes
- operations that explicitly use Story concept as context

It does not directly rewrite existing Scenes or existing Takes.

While Expand Concept is pending, its direct source/target authoring state should be protected so the
visible inputs do not drift away from the frozen request. Existing Scene/Takes work that does not
consume the pending Concept result remains semantically independent.

### Define Invariants

Reads:

- Story concept
- existing Story invariants

Writes:

- Story invariants

Downstream consumers include:

- Expand Concept
- Develop / Re-develop Scenes
- Scene Director work that consumes Story/Scene invariant context

Existing Take generation uses already-materialized Scene generation input; it does not directly
rerun invariant definition as part of generating the Take.

While Define Invariants is pending, its direct source/target authoring state should be protected so
the visible Story does not imply that the queued operation is using edits it cannot see. However,
safe independent actions such as generating a Take from an already-materialized Scene remain valid.
The fact that such work may later be creatively obsolete is not itself a reason to block it.

### Develop / Re-develop Scenes

Reads:

- Story concept
- Story visual / atmosphere
- Story invariants
- target Scene count
- Story planning context

Writes:

- Scene set
- Scene ordering
- Scene summaries
- Scene entry/exit states
- Scene prompts
- Scene continuity/shared-context planning state
- Story development state

This operation consumes the Story's defining authoring state and replaces/rebuilds the Scene
structure. While Develop / Re-develop Scenes is pending, the **entire affected Story should be
treated as read-only** until completion or cancellation. This is one of the cases where a true
Story-wide lock is semantically justified.

Other Stories remain fully available.

### Check & Repair / Refine All Scenes

Reads:

- Story concept
- Story visual / atmosphere
- Story invariants
- current Scene order
- current Scene summaries
- current Scene entry/exit states
- current Scene prompts

Writes:

- zero or more Scene summaries
- zero or more Scene entry/exit states
- zero or more Scene prompts
- repair/restore metadata

It does not intentionally add, remove, merge, split, or reorder Scenes, but it may modify arbitrary
Scene authoring material. A whole-Scenes overlay is therefore an appropriate conservative UI scope.

### Write Scene Prompt

Reads:

- Story visual / atmosphere
- applicable invariant context
- shared Scene continuity context
- Scene summary
- Scene entry/exit state
- duration
- references
- previous Scene handoff where applicable

Writes:

- Scene generation prompt

### Refine Scene Prompt

Reads:

- current Scene prompt
- Scene summary
- Scene entry/exit state
- duration
- Story concept
- Story visual / atmosphere
- applicable invariant/shared context
- previous Scene context

Writes:

- Scene prompt
- optionally Scene summary
- optionally Scene entry state
- optionally Scene exit state
- optionally duration

Because a Scene may consume continuity from an adjacent Scene, a precise dependency graph can extend
between Scenes. WebCap does not need an unbounded set of adjacency-specific lock rules to honor that
fact; a broader Scenes-workspace lock is a valid first implementation.

### Generate Take

Reads/snapshots at enqueue:

- current Scene prompt
- resolved shared continuity context
- Story/Scene generation defaults
- duration
- seed / seed mode
- references
- resolved LoRAs

Writes:

- derived Take
- Take metadata

Generate Take is intentionally repeatable. A queued Take is already frozen and therefore does not
itself make Scene authoring unsafe.

The important dependency runs the other direction: when pending work will mutate generation inputs
that a new Take would snapshot, the UI should avoid offering a new Take against the stale inputs.

### Restore actions

Restore Concept, Restore Prompt, and Restore Repair are authoring mutations.

They follow the same dependency rule as any other write: actions that would consume the state being
restored should not be offered against the pre-restore value when the user would expect the restored
value instead.

## 7. Generate dependency map

### Prompt Assistant: Write / Refine

Reads:

- current prompt idea or prompt
- refinement instruction
- selected generation-model context

Writes:

- editable Generate prompt

A pending prompt rewrite may temporarily make a new Generate action semantically premature if the
user would expect that generation to use the rewritten prompt.

### Generate inference

Reads/snapshots:

- current prompt
- selected model
- generation settings
- LoRAs
- references / conditioning inputs

Writes:

- derived generation result

Generation is intentionally repeatable. Existing queued/running generations keep their frozen
inputs. Editing after enqueue affects later work, not the already-queued request.

## 8. Test Generations dependency map

Test Generations is batch-oriented.

A test job reads/snapshots:

- selected test session/candidate
- resolved prompt/wildcard values
- selected model
- generation settings
- LoRA/candidate context

It writes:

- derived test result
- test metadata

North Star semantics:

- Run Tests may intentionally create many jobs.
- Queue and Backlog are scheduling intent, not validity states.
- queued tests keep frozen inputs,
- edits affect subsequent jobs,
- ComfyUI availability affects execution, not whether valid test work may be requested.

Where a Director/Prompt Assistant action is actively rewriting material that a new test run would
snapshot, the ordinary dependency rule applies.

## 9. Inference Queue semantics

The Inference Queue is an **execution-management surface and durable domain queue**.

Its responsibilities are:

- preserve requested work,
- distinguish Queue from Backlog,
- pause/resume Inference dispatch intent,
- reorder where supported,
- cancel pending work,
- stop active work,
- expose Inference-local failures and wait reasons.

It does **not** arbitrate the shared GPU against LLM or Training. Inference exposes only its own Queue/Backlog state and requests the canonical local-GPU owner. There is no built-in cross-lane priority order; ownership is FIFO and lane-sticky as defined in `docs/gpu_coordination_invariants.md`.

**Pause affects execution, not admission.** While the Inference Queue is paused, valid Generate,
Storyboard Take, and Test requests may still be queued normally. They simply do not become runnable
local-GPU work until Inference is resumed.

**Reordering changes priority inside Inference, not meaning.** Moving frozen work earlier or later
changes only which Inference request would run first when Inference is dispatched. It must not
re-resolve, rebase, or reinterpret that job against newer authoring state.

Inference work is **durable across normal WebCap server restarts**:

- browser reload does not change queued Inference work,
- unfinished Inference work survives a WebCap server restart as durable frozen requests,
- on restart, unfinished work returns to **Backlog** rather than automatically resuming execution,
- the frozen request remains unchanged,
- restart creates **no Inference GPU ownership**,
- the user decides when preserved Backlog work becomes executable again.

**Queue and Backlog have distinct execution meaning:**

- **Queue** contains normal requested Inference work and drains FIFO while Inference owns the GPU,
- **Backlog** is parked durable work, not a competing GPU request system,
- fresh/manual Inference requests enter Queue,
- when Queue is empty and the shared GPU is idle, Backlog may supply one Inference job as a stay-busy convenience,
- that Backlog job ends its Inference turn before another Backlog item may be attempted,
- while Inference is paused, neither Queue nor Backlog advances,
- moving work between Queue and Backlog changes Inference execution order/intent only; the frozen request itself remains unchanged.

Users can explicitly Add all to Queue when backlogged work should become normal requested work.

Inference is not the authority for feature-specific semantic validity. A feature decides whether an
action should be enabled. The Inference Queue preserves and orders the resulting valid request.

ComfyUI/provider state belongs entirely to Inference.

Provider **unavailability before an execution attempt** is an Inference-local wait state, not a
failed job. The request remains intact and unclaimed. Inference is simply not runnable for that
selection attempt, so shared scheduling may consider another lane.

If Inference has positively identified current-session ComfyUI work that WebCap itself started and
that work is still active, Inference remains the current GPU owner while it reconciles that exact
runtime. Provider IDs, stale persisted metadata, failed status probes, or uncertainty alone must
never create or retain a shared GPU claim.

Cross-runtime handoff cleanup is not owned by Inference. The shared GPU prep path performs any
required ComfyUI or retained-model cleanup directly from runtime facts before a new owner starts.

If execution genuinely starts and then fails, preserve the frozen request in Queue and pause
Inference. The failed attempt is the signal. The user resolves the problem and resumes the queue;
WebCap does not need a separate Retry semantic that rebuilds or duplicates the request.

Stopping the active Inference job is **job-local**. Once that job reaches a terminal state, normal
Inference scheduling continues with the next queued job unless Inference itself is paused.
**Stop does not imply Pause.**

Cancelling pending Inference work is also job-local. Cancelling one queued or backlogged job removes
only that job; remaining work keeps its relative order and no implicit queue pause occurs.

Generate, Storyboard Takes, and Tests share one Inference Queue with no hidden feature priority.
Within Queue, work is FIFO unless the user explicitly reorders it. Feature type alone does not let a
newer request jump ahead of older queued work.

## 10. LLM / Director Queue semantics

The LLM queue serializes Director, Prompt Assistant, Test Director, model-test/calibration, and Chat
work according to one server-session FIFO.

North Star semantics:

- valid feature actions may enqueue while other LLM work exists,
- broad "same Story/target has pending work" admission rules are invalid,
- feature UIs own semantic pending-state protection,
- local/remote runtime choice affects execution resources, not semantic validity,
- LLM Stop is a lane reset, not a job-local operation,
- stale-result protection belongs at application/commit time,
- LLM work is simple FIFO; manual queue reordering is not a product requirement,
- LLM has no product-level manual pause/resume queue semantic.

Local and remote LLM jobs share FIFO ordering, but only local jobs use the shared local GPU.

If the FIFO head is remote, LLM executes it without owning the local GPU.

If the FIFO head is local, LLM exposes that head as its runnable local work for shared idle selection.
A later remote LLM job does not bypass an earlier local job that is waiting for the GPU, and a later
local job does not bypass an earlier remote job.

LLM Stop is deliberately **lane-wide**. It resets unfinished LLM intent for the current server
session rather than trying to surgically stop one job while preserving successors:

- the active LLM request is stopped where WebCap owns the runtime, or abandoned where it does not,
- every queued LLM request is cancelled/discarded,
- results arriving after the reset must not mutate WebCap,
- the LLM lane returns idle,
- only a new explicit user action may create new LLM work afterward.

The practical LLM state after Stop should match a WebCap server restart: no unfinished LLM intent
survives. Unlike a real restart, Training, Inference, Story/Set state, and the rest of WebCap remain
untouched.

Semantic LLM requests are triggered by client-side actions and workflows; the backend executes only
requests it has been given. Any client workflow that can submit follow-up LLM requests must therefore
stop its own sequencing when LLM Stop occurs. Completed/applied work remains committed, and durable
Inference work already accepted before Stop remains independent.

LLM work is **server-session-bound** and held in backend memory rather than durable execution state:

- browser refresh, navigation, or returning to the feature does not end the server session; queued
  or running LLM work remains authoritative and the UI should reconnect to it,
- a WebCap server restart ends the LLM session,
- an explicit LLM Stop/reset has the same unfinished-work semantics without restarting WebCap,
- all unfinished LLM work is discarded across either boundary regardless of whether it was queued,
  starting, running, or stopping,
- restart/reset creates **no surviving LLM GPU ownership or scheduling intent**,
- successfully applied Story/prompt state remains because the authoritative result already lives in
  its feature store,
- orphaned external/remote model responses from before the restart/reset must not later mutate WebCap.

For local LLM work, the LLM client owns llama.cpp lifecycle and GPU handoff.

LLM may retain ownership across consecutive local FIFO jobs so real queued LLM work can drain without
needless model churn. It may also retain that already-established ownership through the existing short
post-empty quiescence window so a burst of closely spaced LLM calls does not expose an artificial
cross-lane gap. The timer only ends the current LLM turn; it never acquires or recreates ownership.
An explicit LLM Stop/reset ends that turn rather than preserving the quiescence window.
When LLM actually ends ownership, it is responsible for unloading/stopping its own local runtime to
the required handoff boundary. Inference and Training must not independently inspect or clean up
llama.cpp before they start.

A local model/runtime failure is a real LLM execution failure and should fail visibly. The scheduler
should not add speculative "runtime usable" gates in front of the request.

## 11. Director Chat semantics

Chat is conversational LLM work.

Unless a future feature explicitly connects Chat to mutable Storyboard/Generate/Test data:

- Chat has no semantic lock relationship with those features,
- shared LLM execution does not imply shared UI locking,
- Chat sequencing belongs to Chat's own conversation semantics.

## 12. Training semantics

Training is deliberately special.

Training owns a specialized long-running lifecycle with checkpoint, pause, finish, recovery, and
machine-ownership semantics that do not need to be forced into the shorter-lived Inference/LLM
queue model.

Training remains the authority for:

- its durable queue,
- whether that queue is paused,
- exact runner identity and recovery,
- checkpoint-safe Pause/Finish,
- disk protection,
- resume/checkpoint behavior,
- Training History.

Training participates in shared GPU scheduling only through the shared owner/idle-selection boundary.

North Star semantics:

- when the owner is empty and Training has runnable work, Training is the first shared selection,
- before launching, Training re-checks only its own authoritative state,
- a running Training job retains local GPU ownership until its normal/checkpoint-safe lifecycle ends,
- resuming or queueing Training does not preempt a lane that already owns the GPU,
- valid Inference and LLM work may remain queued while Training runs,
- Training state does not create semantic locks in Storyboard, Generate, Test Generations, or Chat,
- remote LLM work does not consume the local GPU.

Training restart recovery remains special:

- queued Training alone does not auto-start after WebCap restart,
- if no exact surviving runner is established, queued Training is paused and owns nothing,
- if Training positively re-establishes the exact prior managed runner, owner becomes `training`,
- shared scheduling does not inspect Training JSON, WSL, PIDs, logs, or checkpoints; Training does.

Training-specific runtime errors remain inside Training. Persisted Training status by itself must
not become shared GPU truth.

## 13. Shared GPU coordination semantics

The authoritative contract is `docs/gpu_coordination_invariants.md`.

Shared coordination is intentionally small:

- one process-local owner: `none | training | llm | inference`,
- no durable dispatcher queue, submission registry, lease table, or second GPU-availability truth,
- GPU requests are FIFO and lane-sticky; there is no built-in cross-lane priority order,
- LLM and Inference expose only their own runnable state and do not inspect each other,
- Training has stronger recovery/reconciliation because it is long-lived, not scheduling priority,
- cross-runtime handoff preparation is one shared mechanical operation, not a client-lane permission,
- remote LLM work never owns the local GPU,
- running work is non-preemptive,
- consecutive real same-lane work continues until that lane's ordinary queue drains,
- Backlog is only a secondary stay-busy-when-idle source,
- restart reconstructs ownership from runtime reality, never from persisted ownership history.

Runtime cleanup is lane-local maintenance, not a permission handshake. If cleanup itself fails, expose
the concrete failure; do not create another ownership state or speculative blocker.

## 14. Runtime and failure semantics

A domain queue should preserve user intent even when execution dependencies are unavailable.

Shared GPU coordination should preserve **serialization**, not invent domain state.

### Eventual terminalization

Every accepted domain job must have a path to a terminal state. A job may be queued, starting,
running, stopping, or otherwise in-flight temporarily, but it must not remain non-terminal forever
because an external provider, worker, or cancellation handshake disappeared.

Stop/Cancel requests do not release semantic UI ownership merely because the request was issued.
Ownership ends only when the job is actually terminal. Therefore the owning lane's
execution/reconciliation logic must guarantee eventual terminalization through normal completion,
cancellation, stop, visible failure, interruption/recovery handling, or equivalent authoritative
reconciliation.

The UI must never reopen mutable state on the assumption that a worker stopped when that has not
been established.

Examples:

- ComfyUI unavailable before claim/start: valid Inference work remains queued unchanged; Inference
  remains unclaimed for that selection attempt and another lane may run,
- an Inference attempt starts and then errors: preserve the frozen job in Queue and pause Inference,
- local LLM is waiting for the GPU: its FIFO job remains queued while another lane owns the GPU,
- remote LLM work: executes without local GPU ownership,
- Training queue paused or not runnable: Training is not eligible for shared selection,
- model/runtime execution fails after start: the owning job fails visibly with useful detail.

WebCap should prefer truthful execution failure over speculative pre-emptive refusal.

### Runtime truth

Persistent state may identify work, ordering, future user intent, and exact runtime identities needed
for cleanup or recovery.

Persistent state has **zero authority over present physical runtime execution** by itself.

Present runtime claims must come from the owning subsystem using the closest authoritative evidence
available to that subsystem.

Machine-level tools such as `nvidia-smi` may be useful for diagnostics or for corroborating exact
owned process identity, but generic utilization, VRAM residency, or process presence is not a
replacement for exact managed-runtime identity and must not become another shared scheduler oracle.

## 15. Destructive ownership semantics

Destructive deletion is different from ordinary queue admission.

An object must not be purged while non-terminal work still owns, targets, or is expected to write
back into that object. The required semantic is **quiescence before deletion**.

How WebCap reaches quiescence is an implementation choice:

- if ownership is explicit and cancellation/stop is already reliable, deletion may cancel/stop the
  object's owned work, wait for authoritative terminalization, and then delete,
- if coordinated cancellation would add meaningful complexity or uncertainty, deletion may remain
  unavailable/refuse until the owned work is terminal,
- unrelated work must never be cancelled merely because it shares a queue or execution resource.

The North Star does **not** require every destructive action to orchestrate cancellation. Reliability
wins over convenience here. Automatic cleanup is preferable only when it is simple and trustworthy.

If deletion is unavailable because owned work is still active, the UI should make the blocking work
understandable enough that the user can resolve it without hunting for an unidentified job.

## 16. Stale results

Frozen queued work can become stale if its source state changes before its result is applied.

The correct protection is at the mutation boundary:

- detect incompatible current state,
- do not silently apply stale output,
- fail visibly with useful context.

Stale-result protection must not be generalized into "do not allow another job to exist."

## 17. Implementation posture

This document intentionally separates semantic truth from current implementation detail.

When implementing or repairing UI state:

- prefer existing disabled-state, Director-card, and overlay patterns,
- prefer region-level overlays when a coherent authoring area shares one pending state,
- prefer coarse, comprehensible locking over many fragile exceptions,
- keep locks scoped to the affected Story/workspace whenever possible,
- never let pending work in one Story unnecessarily freeze another,
- do not add backend admission guards to mirror UI state,
- do not treat stale persisted runtime state as semantic truth,
- relax broad UI locks later when there is clear workflow value and the dependency is well understood.

A correct conservative UI can be refined. A queue that refuses valid work based on guessed conflicts
has violated the model.

## 18. Review heuristic

For any new queued action, answer these questions in order:

1. **What data does this action read or snapshot?**
2. **What data can it write?**
3. **Is that write local to an item, Scene, Story, session, or global resource?**
4. **While it is pending, would another enabled action be expected to consume its completed result?**
5. **If yes, what is the simplest understandable UI scope that can protect that dependency?**
6. **Is the proposed restriction UI state, or has it accidentally become queue admission?**
7. **Does the restriction leak into unrelated Stories/features merely because they share execution resources?**

If the answer to #6 is "queue admission" or #7 is "yes", the design should be reconsidered.

## 19. Status of this document

This is the North Star contract for queue, dispatcher, and runtime-ownership semantics.

The centralized GPU-dispatcher migration is an intentional architectural change justified by repeated
cross-lane scheduling, restart, and ownership ambiguity. Its implementation plan lives in
`docs/gpu_dispatcher_plan.md`.

Implementation should proceed incrementally, preserving the lane-specific behavior defined here while
removing cross-lane GPU negotiation. Training's specialized queue must not be migrated merely to make
the implementations look uniform.
