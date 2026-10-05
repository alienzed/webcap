# Execution Queue

WebCap has one shared execution-queue substrate for scheduled accelerator-backed work.

The substrate owns shared queue mechanics. Domain code owns execution semantics and result storage. Durable persistence is lane-specific: Inference is durable, while LLM work is intentionally server-session-bound and in memory. WebCap now has three execution classes that share one exclusive local GPU resource:

- `training`: long-running Diffusion-Pipe work with its specialized scheduler;
- `inference`: short-form ComfyUI work for Generate, Storyboard Takes, and Test renditions;
- `llm`: serialized Prompt Assistant / Director requests through llama.cpp.

Remote Director endpoints still use the `llm` lane for request serialization but do not reserve the local GPU.

## Shared contract

Every execution job has:

- a stable job ID and lane
- an immutable payload snapshot captured when queued
- backlog / queued pending states, starting, running, stopping, and terminal lifecycle states
- queue position and FIFO ordering
- created, started, updated, and finished timestamps
- generic metadata, runtime details, result data, and errors
- a requested action field for domain executors to honor

Durable lanes persist the state they need under `<filesystem.root>/.webcap/execution_queue.json`.
The LLM lane does not: its unfinished work is session-only and is discarded on WebCap restart or an
explicit LLM reset.

The substrate provides the general queue mechanics useful across GPU work; each domain uses only the
ones that match its product semantics:

- enqueue / start
- pause / resume scheduling where supported
- stop/reset semantics owned by the lane
- cancellation of pending work where supported
- reordering where supported
- restart reconciliation for durable lanes
- exclusive GPU/resource ownership

The substrate owns these mechanics and state transitions. It does not know how to stop Diffusion-Pipe, cancel a ComfyUI provider job, create a Storyboard Take, persist a standalone Generate result, or interpret a Test Generation session.

State transitions are explicit:

```text
backlog <-> queued
   |         |
   +-------> starting -> running -> completed / failed / stopped
                         \
                          -> stopping -> stopped
```

Queue and Backlog are pending states and may be cancelled directly. Only active jobs can be stopped or finished.

## Inference target

Generate, Storyboard Takes, and Test renditions are all short-form GPU inference clients and should ultimately share one `inference` lane.

That target means:

- queue position is global across inference clients;
- new requested inference enters the ordered **Queue** even when Training, LLM, or another inference job owns the GPU;
- **Backlog** is ordered parked work, used for restart-preserved inference and explicit queue parking;
- normal Queue work drains FIFO and keeps the Inference turn while Queue remains non-empty;
- Backlog is only a secondary stay-busy-when-idle source: after Queue is empty and the shared GPU is free, one Backlog job may be attempted, and that turn ends before another Backlog item is considered;
- a Backlog item may be explicitly added to the end of Queue when the user wants it sooner;
- all queued work may be moved to Backlog without cancelling it;
- Pause / Resume controls inference dispatch without moving jobs between Queue and Backlog;
- unexpected inference execution errors pause dispatch and return the current request to the head of Queue instead of consuming it or advancing to later work;
- a running inference job is never preempted;
- each client may show a contextual projection of the same shared lane;
- the global **Inference Queue** drawer is the authoritative scheduling-management surface.

No automatic client weights, fairness scheduler, or cross-lane priority policy is required. Queue is normal requested work; Backlog is only idle-time fill.

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

The common inference runner owns scheduling, GPU acquisition/release, provider polling/cancellation, and lifecycle transitions. The global Inference Queue exposes each Test rendition individually, while the Test workspace continues to show the Session as the useful comparison unit.

### LLM

Prompt Assistant and Storyboard Director requests use the common `llm` lane.

The LLM runner owns:

- server-session FIFO ordering and queue position;
- lane-local LLM execution after shared GPU ownership is established;
- serialization across Generate, Storyboard, Test/diagnostics, and Chat clients;
- client-specific result finalization before a job becomes terminal;
- lane reset: stop/abandon the active request, discard all queued LLM work, and reject late results from the old session intent.

The Director runtime still owns llama.cpp process/model lifecycle, model loading/unloading, completion transport, structured-output parsing, and safe cleanup when model state cannot be confirmed.

The browser enqueues LLM work and polls the session-bound job instead of keeping one HTTP request open while waiting behind Training or inference. Higher-level client workflows own their own sequencing; after an LLM reset, pre-reset workflows must not submit follow-up LLM requests.

Preload remains speculative rather than queued work. It must yield to launchable inference or LLM work and may reserve the GPU only when no scheduled workload owns it.

### Training

Training remains separate because its semantics are materially different:

- multi-hour duration;
- checkpoint-safe Pause/Finish;
- epoch progress;
- disk protection;
- resume and runner recovery;
- Training History.

Training continues to use its own queue/runner and shares only the global GPU execution resource with inference and local LLM work.

## Resource arbitration

The authoritative local-GPU coordination contract is `docs/gpu_coordination_invariants.md`.

Only one process-local owner may exist: `training`, `llm`, `inference`, or none. GPU requests are FIFO and lane-sticky: there is no built-in lane priority. Once a lane owns the GPU, it drains its ordinary FIFO before releasing. Running work is non-preemptive, remote LLM work never owns the local GPU, and Backlog is not a competing request system.

The current implementation is being simplified incrementally toward that contract; older cross-lane
permission and cleanup paths are implementation debt, not additional scheduling semantics.

## Startup and observers

Training keeps its always-on observer because it is a long-running scheduler.

Inference and LLM execution are demand-driven. WebCap startup does not start new ComfyUI or llama.cpp work merely because the server is running. Persisted unfinished inference is reconciled into Backlog on restart; previously active provider work may receive a best-effort cancellation check, but restart never recreates Inference ownership. LLM work is not restored: restart begins with an empty LLM lane, matching the unfinished-work state produced by explicit LLM reset. Enqueueing new inference or explicitly resuming inference starts its worker; normal Queue work drains first, while Backlog may supply one idle-time job at a time. Inference goes dormant when empty or paused; the LLM worker goes dormant when its FIFO is empty.

Queue reads are passive and must not become a dispatch mechanism. Navigating to Media, captioning, Training, Storyboard, Test, Generate, or another activity does not itself start provider work.

## UI rule

Shared scheduling does not imply one monolithic workflow UI.

The permanent shell also exposes a read-only **Activity** drawer. Activity is a projection over domain-owned state: it shows what is running now, a bounded list of recently finished managed work, and compact queue summaries. It does not own scheduling, result state, or a second history database. Inference and LLM lanes retain a small bounded terminal receipt history so completed work remains visible after the owning client consumes its delivery receipt; Training and Storage continue to provide their own existing history/scan state.

The Activity drawer and Inference Queue drawer are sibling global surfaces: Activity answers **what is happening / what just finished**, while Inference Queue answers **what is scheduled and in what order**.

- The Inference Queue drawer owns Queue / Backlog ordering, Pause / Resume, parking, promotion, cancellation, and stop controls.
- Generate continues to show generation-specific state and results.
- Storyboard projects its work as pending Take cards.
- Test projects its work as Session progress/results; a Test Session remains a domain grouping rather than a second scheduler.
- Training keeps its own queue rows and progress.

Storyboard and Test now use the common `inference` lane, so contextual queue positions are the same global positions shown by Generate. Contextual views may omit controls that do not fit their workflow, but they must not maintain competing queue state.
