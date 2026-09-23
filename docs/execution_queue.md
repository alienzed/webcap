# Execution Queue

WebCap has one shared execution-queue substrate for GPU-backed work.

The substrate owns durable queue mechanics. Domain code owns execution semantics and result storage. The long-term inference target is one common `inference` lane for Generate, Storyboard Takes, and Test renditions, while Training remains a separate long-running scheduler that shares only the GPU execution resource.

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

Every lane supports the general queue mechanics useful across GPU work:

- enqueue / start
- pause / resume scheduling
- stop active jobs
- cancel queued jobs
- reorder queued jobs
- restart reconciliation
- exclusive GPU/resource ownership

The substrate owns these mechanics and state transitions. It does not know how to stop Diffusion-Pipe, cancel a ComfyUI provider job, create a Storyboard Take, persist a standalone Generate result, or interpret a Test Generation session.

State transitions are explicit:

```text
queued -> starting -> running -> completed / failed / stopped
                      \
                       -> stopping -> stopped
```

Only queued jobs can be cancelled directly. Only active jobs can be stopped or finished.

## Inference target

Generate, Storyboard Takes, and Test renditions are all short-form GPU inference clients and should ultimately share one `inference` lane.

That target means:

- queue position is global across inference clients;
- FIFO ordering is global unless the user explicitly reorders queued work;
- valid inference may be queued while another inference job or Training owns the GPU;
- GPU availability affects when work starts, not whether valid work may be queued;
- a running inference job is not preempted;
- each client may show a contextual projection of the same queue;
- the Generate activity owns the full visual **Generation Queue** management surface.

No automatic priorities, client weights, or fairness scheduler are required initially. Manual ordering is enough.

## Migration state

The target is being reached incrementally so mature workflows are not destabilized.

### Generate

Generate is the first clean client of the common `inference` lane.

Generate owns:

- its standalone prompt/generation UI;
- generic Director prompt-writing/refinement context;
- persistent generated-media provenance;
- generated-media previews.

The inference runner owns:

- durable scheduling;
- GPU acquisition/release;
- common ComfyUI transport;
- provider polling/cancellation;
- lifecycle transitions.

### Storyboard Takes

Storyboard Takes now use the common `inference` lane.

Storyboard still owns:

- converting saved Story/Scene state into a frozen inference request;
- Story-wide and Scene LoRA resolution;
- Storyboard reference semantics;
- Take creation and provenance;
- pending Take cards.

The common inference runner now owns scheduling, GPU acquisition/release, ComfyUI transport/polling/cancellation, and lifecycle transitions. Pending Take cards project the same global queue position shown in Generate. Legacy persisted `storyboard-takes` jobs are reconciled at startup so active work is interrupted safely and queued work can be migrated forward.

### Test Generations

Test Generations currently uses the shared queue substrate through the `test-generations` lane.

A queued Test job freezes the prompt, staged LoRAs, model settings, and workflow snapshot. A Test-owned observer pumps durable queued Sessions, so work no longer depends on the Test pane staying open.

Test owns:

- Session folders and `test.json`;
- Base/candidate comparison semantics;
- result aggregation;
- Grid/Compare/rating UX.

A later migration moves Test execution onto the common `inference` lane. The Test Session remains a domain grouping even when its GPU work becomes common inference work.

### Training

Training remains separate because its semantics are materially different:

- multi-hour duration;
- checkpoint-safe Pause/Finish;
- epoch progress;
- disk protection;
- resume and runner recovery;
- Training History.

Training continues to use its own queue/runner and shares only the global GPU execution resource with inference.

## Resource arbitration

Only one execution owner may hold the shared GPU resource at a time.

During migration:

- active Training blocks inference execution;
- an unpaused queued Training job blocks a new external inference start;
- paused Training allows inference;
- queued inference remains durable while Training is busy;
- an already-running inference job is not preempted;
- the remaining legacy Test lane stays mutually exclusive through the same resource owner until Test moves into `inference`.

## Startup and observers

Durable inference lanes reconcile interrupted active work before their queue observers start.

Queue reads should not be used as a dispatch mechanism. Background observers are responsible for advancing queued work, so navigating to Media, Storyboard, Test, Generate, or another activity does not determine whether GPU work continues.

## UI rule

Shared scheduling does not imply one monolithic workflow UI.

- Generate exposes the full Generation Queue.
- Storyboard projects its work as pending Take cards.
- Test projects its work as Session progress/results.
- Training keeps its own queue rows and progress.

As Storyboard and Test move to the common `inference` lane, their displayed queue positions must be the same global positions shown by Generate. Contextual views may omit controls that do not fit their workflow, but they must not maintain competing queue state.
