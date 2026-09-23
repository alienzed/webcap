# Execution Queue

WebCap has one shared execution-queue substrate for scheduled accelerator-backed work.

The substrate owns durable queue mechanics. Domain code owns execution semantics and result storage. WebCap now has three execution classes that share one exclusive local GPU resource:

- `training`: long-running Diffusion-Pipe work with its specialized scheduler;
- `inference`: short-form ComfyUI work for Generate, Storyboard Takes, and Test renditions;
- `llm`: serialized Prompt Assistant / Director requests through llama.cpp.

Remote Director endpoints still use the `llm` lane for request serialization but do not reserve the local GPU.

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

Test Generations now uses the common `inference` lane at rendition granularity.

A Test Session remains a Test-owned domain grouping, but Base and every selected candidate are frozen as independent inference jobs. They share the Session's resolved prompt, seed, model settings, and workflow snapshot while carrying their own Base/candidate identity.

Test still owns:

- Session folders and `test.json`;
- Base/candidate comparison semantics;
- candidate provenance and result naming;
- Session progress aggregation;
- Grid/Compare/rating UX;
- missing-candidate skip behavior.

The common inference runner owns scheduling, GPU acquisition/release, provider polling/cancellation, and lifecycle transitions. The full Generation Queue exposes each Test rendition individually, while the Test workspace continues to show the Session as the useful comparison unit.

### LLM

Prompt Assistant and Storyboard Director requests use the common `llm` lane.

The LLM runner owns:

- durable request ordering and queue position;
- restart reconciliation;
- local GPU acquisition/release for llama.cpp work;
- serialization across Generate and Storyboard Director clients;
- client-specific result finalization before a job becomes terminal.

The Director runtime still owns llama.cpp process/model lifecycle, model loading/unloading, completion transport, structured-output parsing, and safe cleanup when model state cannot be confirmed.

The browser enqueues Director work and polls the durable job instead of keeping one HTTP request open while waiting behind Training or inference.

Preload remains speculative rather than queued work. It must yield to launchable inference or LLM work and may reserve the GPU only when no scheduled workload owns it.

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

Only one execution owner may hold the shared local GPU resource at a time.

- active Training blocks local inference and local LLM execution;
- an unpaused queued Training job blocks a new external local GPU start;
- paused Training allows inference or LLM execution;
- queued inference and queued LLM work remain durable while Training is busy;
- running work is not preempted;
- inference and local LLM cannot execute concurrently;
- remote LLM work does not reserve the local GPU;
- retained or unsafe provider/model state keeps its resource reservation rather than guessing that the GPU is free;
- if a retained idle Director model cannot yield on a launch attempt, Training or inference leaves the job queued and retries later instead of converting a transient handoff failure into a manual queue pause.

## Startup and observers

Training keeps its always-on observer because it is a long-running scheduler.

Inference and LLM execution are demand-driven. WebCap startup does not contact ComfyUI or llama.cpp merely because the server is running. Enqueueing work reconciles the relevant durable lane and starts its worker; workers go dormant when their lane is idle or deliberately paused.

Queue reads are passive and must not become a dispatch mechanism. Navigating to Media, captioning, Training, Storyboard, Test, Generate, or another activity does not itself start provider work.

## UI rule

Shared scheduling does not imply one monolithic workflow UI.

- Generate exposes the full Generation Queue.
- Storyboard projects its work as pending Take cards.
- Test projects its work as Session progress/results.
- Training keeps its own queue rows and progress.

Storyboard and Test now use the common `inference` lane, so contextual queue positions are the same global positions shown by Generate. Contextual views may omit controls that do not fit their workflow, but they must not maintain competing queue state.
