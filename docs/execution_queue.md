# Execution Queue

WebCap has one shared execution-queue substrate for GPU-backed work and separate domain-owned lanes.

The substrate exists to prevent Training, Test Generations, and Storyboard Takes from reimplementing the same queue mechanics. It is not a single mixed user-facing queue. Each feature keeps its own scheduling policy, execution semantics, and UI.

## Shared contract

Every execution job has:

- a stable job ID and lane
- an immutable payload snapshot captured when queued
- queued, starting, running, stopping, and terminal lifecycle states
- queue position and FIFO ordering
- created, started, updated, and finished timestamps
- generic metadata, runtime details, result data, and errors
- a requested action field for domain executors to honor
- persisted queue state under `<filesystem.root>/.webcap/execution_queue.json`

Every lane supports the general queue mechanics that are useful across GPU work:

- enqueue / start
- pause / resume scheduling
- stop active jobs
- cancel queued jobs
- reorder queued jobs
- restart reconciliation
- exclusive GPU/resource ownership

The substrate owns these mechanics and state transitions. It does not know how to stop Diffusion-Pipe, cancel a ComfyUI job, create a Storyboard Take, or interpret a Test Generation session.

## Domain ownership

Domain-specific behavior stays with the caller.

### Storyboard Takes

Storyboard is the first migrated customer. Each Generate Take click queues a distinct job, including multiple Takes for the same Scene. The queued payload freezes the Scene generation settings at enqueue time.

Storyboard owns:

- MiniMax H3 / ComfyUI workflow construction
- ComfyUI cancellation when Stop is requested
- generated media download
- Take creation and provenance
- pending Take cards in the Scene UI

The shared lane owns the queued/running state, ordering, persistence, cancellation state, and resource claim.

### Test Generations

Test Generations uses the `test-generations` lane. A queued job freezes the prompt, selected staged LoRAs, model settings, and workflow snapshot; starting the job creates the normal Test Session and hands execution back to the existing batch runner.

The Sessions UI remains intentionally linear. The shared substrate supports queue mechanics such as pause/resume and reordering, but Test Generations only exposes the controls its current workflow uses. Queued Test work may wait behind another GPU owner and is pumped by a small Test-owned observer, so it does not depend on the pane staying open.

### Training

Training migrates last because its active-job semantics are richer. Checkpoint-safe Pause/Finish, epoch progress, disk protection, runner recovery, and Training History remain Training-owned. Its generic queue mechanics move to the shared substrate.

## Resource arbitration

GPU ownership is global while queues remain independent. Only one execution owner may hold the shared resource at a time.

During migration, the existing Training priority rules remain in force: active Training or an unpaused Training queue blocks external GPU work. Test Generations and Storyboard use the shared resource owner through the Training compatibility bridge until Training itself is migrated.

## UI rule

Shared queue mechanics do not imply shared UI.

- Training projects jobs as Training queue rows and progress.
- Test Generations projects jobs as Sessions and pending results.
- Storyboard projects jobs as pending Take cards.

A caller may choose not to expose reorder, pause, or other supported mechanics when that would damage its workflow.
