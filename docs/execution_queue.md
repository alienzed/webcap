# Execution Queue

WebCap has one shared execution-queue substrate for GPU-backed work. Short-form inference shares one common `inference` lane; Training remains a separate long-running scheduler that uses the same execution-resource lock.

The substrate exists to prevent Generate, Test Generations, and Storyboard Takes from reimplementing the same queue mechanics. Domain workflows keep their own result/session/Take semantics and contextual UI, but inference scheduling is global so queue position and ordering mean the same thing everywhere.

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
- stop or cancel requests
- cancel queued jobs
- reorder queued jobs
- requeue jobs
- restart reconciliation
- exclusive GPU/resource ownership

The substrate owns these mechanics and state transitions. It does not know how to stop Diffusion-Pipe, cancel a ComfyUI job, create a Storyboard Take, persist a Generate result, or interpret a Test Generation session.

## Inference lane

Generate, Storyboard Takes, and Test renditions share the `inference` lane.

This means:

- queue position is global across inference clients;
- FIFO ordering is global unless the user explicitly reorders queued work;
- valid inference work may be queued while another inference job or Training owns the GPU;
- GPU availability affects when work starts, not whether valid work may be queued;
- a running inference job is not preempted;
- client-specific UI may show a filtered projection of the same jobs.

The inference runner owns dispatch for this lane. Client/domain code owns translating its state into a frozen inference request and committing a successful result back into its own storage.

## Domain ownership

### Generate

Generate is the first clean client of the generic inference layer.

Generate owns:

- its generation form and local UI preferences;
- persistent generated-result provenance;
- generated-media browsing/preview behavior;
- the full visual Generation Queue surface.

The common inference layer owns model execution, ComfyUI transport, job lifecycle, cancellation, and queue scheduling.

### Storyboard Takes

Storyboard projects inference jobs as pending Take cards. Each Generate Take click queues a distinct job, including multiple Takes for the same Scene. The queued payload freezes Scene generation settings at enqueue time.

Storyboard owns:

- converting saved Story/Scene state into an inference request;
- Story-wide and Scene LoRA resolution;
- Storyboard reference semantics;
- Take creation and provenance;
- pending Take cards in the Scene UI.

Storyboard does not own a private inference scheduler after migration.

### Test Generations

A Test Session remains a Test-domain grouping, but each Base/candidate rendition becomes an ordinary inference job. This lets other inference work be manually interleaved without losing the frozen comparison settings shared by the Session.

Test Generations owns:

- Session folders and `test.json`;
- staged/global candidate selection;
- Base comparison semantics;
- result aggregation;
- Grid/Compare/rating UX.

Test Generations does not own a private execution queue after migration.

### Training

Training remains separate because its active-job semantics are materially richer and much longer-lived:

- checkpoint-safe Pause/Finish;
- epoch progress;
- disk protection;
- resume and runner recovery;
- Training History.

Training continues to use its own queue/runner and shares only the global GPU execution resource with inference.

## Resource arbitration

Only one execution owner may hold the shared GPU resource at a time.

The existing Training priority rules remain in force during the inference refactor:

- active Training blocks inference execution;
- an unpaused queued Training job blocks a new inference start;
- paused Training allows inference;
- queued inference remains durable while Training is busy;
- an already-running inference job is not preempted.

## UI rule

Shared inference scheduling does not imply one monolithic workflow UI.

- Generate owns the full Generation Queue management surface.
- Test Generations projects its jobs as Session progress/results.
- Storyboard projects its jobs as pending Take cards.
- Training continues to project its own queue rows and progress.

Client projections must use the same global queue positions for inference jobs. A client may omit queue controls when they would be redundant or disruptive, but it must not maintain competing queue state.
