# Generic Inference and Generate Activity Plan

## Purpose

WebCap now has enough overlapping generation workflows that inference should become an explicit shared capability rather than remaining embedded in Test Generations or Storyboard.

The target is:

- one shared inference queue for short-form GPU inference;
- a generic inference request/execution/result layer;
- Generate as the first clean client of that layer;
- Storyboard Takes migrated next without changing Storyboard product semantics;
- Test Generations migrated after that, with each rendition becoming independently queueable;
- Training remaining a separate long-running queue that only shares GPU resource arbitration;
- Director runtime reused by Generate while Storyboard keeps Story-specific Director contracts.

This plan is intentionally incremental. It follows the repo contract in `AGENTS.md`: reuse working behavior, keep ownership explicit, avoid framework-like indirection, fail visibly, and prove abstractions with concrete workflows before migrating mature clients.

## Current baseline

As of the start of this work:

- `tool/server/execution_queue.py` provides durable queue mechanics:
  - immutable payload snapshots;
  - FIFO ordering and queue positions;
  - pause/resume;
  - cancel/stop requests;
  - reorder/requeue;
  - restart reconciliation;
  - global execution-resource ownership.
- Storyboard Takes are already migrated to that substrate through the `storyboard-takes` lane.
- Storyboard Takes use the shared substrate through the `storyboard-takes` lane and a Storyboard-owned observer/dispatcher.
- Test Generations now also uses the shared substrate through the `test-generations` lane. Its previous in-memory pending queue has already been removed; a Test-owned observer pumps durable queued Sessions.
- Startup reconciliation for Storyboard and Test inference is explicit and runs before their observers start.
- Training remains independently scheduled in `tool/server/training_runner.py`, but its `reserve_gpu_for_external_work()` bridge already arbitrates with the shared execution resource.
- `tool/server/test_models/` already contains model-specific ComfyUI knowledge for H3 and Krea2 that is broader than testing alone.
- The current shared queue API has hardened explicit transitions: queued jobs are claimed into `starting`, marked `running`, stopped with `request_stop`, and only active jobs may be finished. New inference clients must respect that contract.
- The current Storyboard Scene form already contains most of the controls a generic Generate activity needs: prompt, Director actions, model-facing generation controls, LoRAs, references, seed, and result previews.

## Target architecture

```text
Generate -------------------+
                            |
Test Generations -----------+--> Generic inference request
                            |        |
Storyboard Takes -----------+        v
                                 inference lane
                                      |
                                      v
                              inference runner
                                      |
                                      v
                               model adapter
                               H3 / Krea2
                                      |
                                      v
                                   ComfyUI
                                      |
                                      v
                             generic result/provenance
                               /        |        \
                              /         |         \
                         Generate      Test      Take

Training --> Training runner / Training queue
                |
                +---- shares only the GPU execution resource
```

The user-facing queue should be called **Generation Queue**. Internally the shared lane and runner use the more precise term **inference**.

## Scheduling rules

### Inference

- Generate, Storyboard Takes, and Test renditions share one FIFO queue.
- Queue position is global across inference clients.
- Valid work may always be queued even when the GPU is occupied.
- The GPU being busy affects execution, not enqueue.
- Manual reordering is supported.
- No automatic client priorities or fairness system is introduced initially.
- A running inference job is not preempted.

### Training

Training remains separate because its semantics are materially different:

- multi-hour duration;
- checkpoint-aware pause and finish;
- resume semantics;
- progress parsing;
- disk protection;
- Training History;
- runner recovery.

Initial arbitration remains conservative:

- active Training blocks inference execution;
- an unpaused pending Training queue retains priority before new inference starts;
- paused Training allows inference;
- inference jobs may accumulate safely while Training is active.

## Shared inference job contract

The generic queue payload should freeze enough information that execution is deterministic even if the originating UI changes afterward.

Conceptually:

```text
payload
  request
    modelId
    prompt
    sourcePrompt
    settings
    seed
    loras[]
    references[]
    wildcardsEnabled
  clientContext
    client
    domain identifiers needed to commit the result

metadata
  client
  label
  modelId
  mediaKind
  optional storyId / sceneId / sessionId / candidate identity
```

The generic result should expose:

```text
mediaKind
output reference/path
resolved prompt
seed
provider job ID
workflow/profile identity
elapsed time
```

The queue substrate does not interpret client context. Client/domain code remains responsible for committing a successful result.

---

# Phase 0 - Correct the queue contract

## Goal

Change the documented architecture from separate inference lanes to one shared inference lane, while retaining the generic queue substrate.

## Implementation

Update `docs/execution_queue.md`:

- define `inference` as the common lane for Generate, Storyboard, and Tests;
- keep Training separate;
- distinguish shared queue state from client-specific UI projections;
- state that queue positions are global across inference clients;
- state that busy GPU state must never reject otherwise-valid inference enqueue;
- state that client-specific output/session/take semantics remain domain-owned.

## Tests

Extend `tests/test_execution_queue.py` with mixed-client metadata/payload cases to verify:

- FIFO ordering across client types;
- frozen payload behavior remains unchanged;
- reordering works regardless of client metadata;
- resource exclusivity still applies.

## Exit criteria

- documentation matches the new product intent;
- no behavior regression;
- existing Storyboard queue behavior still works.

---

# Phase 1 - Add the inference runner and global inference lane

## Goal

Move dispatch responsibility out of Storyboard and establish a server-side scheduler that can continue running queued inference when no inference UI is open.

## New module

Create:

`tool/server/inference_runner.py`

Responsibilities:

- fixed lane name: `inference`;
- enqueue generic inference jobs;
- expose global queue snapshots;
- claim the next job;
- reserve/release the GPU through the existing Training compatibility bridge;
- start client execution;
- observe terminal completion and advance;
- support queue pause/resume/cancel/reorder;
- recover active jobs after WebCap restart;
- run a lightweight background dispatcher so navigation/polling is not required for progress.

The runner should not know ComfyUI node IDs and should not know Story/Test storage formats.

## Dispatch model

The first version should use a small explicit client switch, not a registry framework:

```python
if client == "generate":
    ...
elif client == "storyboard":
    ...
elif client == "test":
    ...
else:
    raise RuntimeError(...)
```

During this phase only Generate will execute through the new common `inference` lane. Storyboard and Test remain on their already-shared but separate domain lanes until their migration phases. This proves the new common lane without destabilizing either mature workflow. This allows the scheduler contract to be proven without destabilizing Storyboard.

## Queue API

Add backend routes for:

- queue snapshot;
- enqueue through Generate;
- cancel queued job;
- stop active job;
- reorder;
- pause/resume.

Prefer one `/fs/inference` route with explicit operations rather than many tiny routes unless the current Flask patterns make separate routes materially clearer.

## Background wakeups

The dispatcher must be triggered by:

- enqueue;
- resume;
- job completion;
- periodic lightweight retry while work is queued but Training/GPU is busy.

This is justified async behavior because the requested product behavior requires generation to continue while the user is in Media, Storyboard, Test, or another activity.

## Exit criteria

- a durable `inference` lane exists;
- queued jobs remain queued while Training owns the GPU;
- background dispatch does not depend on browser polling;
- stop/cancel/reorder/pause/resume work at the shared lane level;
- no Storyboard behavior changed yet.

---

# Phase 2 - Extract reusable model inference behavior

## Goal

Move model-specific ComfyUI behavior that is genuinely shared out of Test-only ownership so Generate can use H3 and Krea2 without duplicating workflows.

## Package

Create:

```text
tool/server/inference_models/
    __init__.py
    common.py
    h3.py
    krea2.py
```

The first implementation may reuse/adapt code from `tool/server/test_models/`; do not delete Test adapters yet.

## Shared model responsibilities

Each inference model owns only model-specific facts:

- profile/model identity;
- media kind;
- workflow template;
- supported settings;
- default/normalized settings;
- available setting options;
- installed asset resolution;
- LoRA compatibility;
- workflow binding;
- output discovery.

The common inference runner owns:

- ComfyUI transport;
- provider queueing/polling;
- cancellation;
- generic result timing;
- job lifecycle.

## H3 capability shape

Initial H3 Generate support:

- prompt;
- aspect ratio;
- megapixels;
- duration;
- seed;
- LoRAs;
- first frame;
- last frame;
- wildcard intent.

The exact H3 reference wiring should be taken from the current Storyboard implementation rather than independently reinvented.

## Krea2 capability shape

Initial Krea2 Generate support:

- prompt;
- dimensions;
- seed;
- LoRAs;
- image output.

## Randomness

Random seeds must be resolved before enqueue and stored in the immutable queue payload.

Wildcard source text and resolved text should both be retained for provenance.

## Exit criteria

- Generate can ask a generic model layer for capabilities/defaults;
- H3 and Krea2 can build valid workflows through that layer;
- Test and Storyboard remain untouched until later migrations.

---

# Phase 3 - Build Generate as the first generic inference client

## Goal

Add a first-class **Generate** activity that does not require a Set or Story and proves the shared inference architecture end to end.

## Shell integration

Add Generate to:

- activity rail;
- route normalization;
- hash restoration;
- shell title/context;
- active activity state;
- relevant model selector behavior.

Suggested activity ordering:

```text
Media/Prep
Generate
Test
Storyboard
Training
```

Do not rename Prep/Media in this phase unless needed for the new route.

## Files

Create:

`tool/js/generate.js`

Add static Generate markup to `tool/tool.html`.

Add Generate styles to the existing stylesheet, following current static-markup + behavior-only binding patterns used by Test Generations.

Add UI contract tests.

## Generate form

Use the current Scene form as the visual/product starting point, but remove Story-specific fields:

Remove:

- Scene title;
- Scene intent/summary;
- Entry state;
- Exit state;
- continuity fields;
- Story inheritance concepts;
- Take selection semantics.

Keep/adapt:

- Base Model;
- prompt;
- Write with Director;
- Refine with Director;
- duration / aspect / megapixels / dimensions as model capabilities permit;
- seed;
- wildcards;
- LoRAs;
- references;
- Generate action;
- result previews.

The form should breathe at large desktop widths; do not compress it into the historical Test side-rail proportions.

## Results

Generate results should be persistent file-based artifacts under a dedicated output root, for example:

`<filesystem.root>/output/generations/<run-or-date>/...`

Each result needs provenance sufficient to reopen/inspect later:

- model;
- media kind;
- source/resolved prompt;
- seed;
- settings;
- LoRAs;
- references;
- workflow/profile identity;
- provider job ID;
- elapsed time;
- creation time.

Use a small JSON sidecar or a generation manifest owned by the Generate domain. Do not introduce a database.

## Generation Queue UI

Generate owns the full visual queue-management surface.

Each row should show:

- status;
- global queue position;
- client origin;
- useful label/context;
- model;
- concise output settings;
- stop/cancel;
- reorder controls for queued jobs.

Example:

```text
RUNNING  Storyboard · Agatha · Scene 03       MiniMax H3 · 8s
#1       Generate · portrait reference         Krea2 · 1024x1024
#2       Test · Clothing · Epoch 44            MiniMax H3
#3       Storyboard · Agatha · Scene 04        MiniMax H3 · 6s
```

Generate results and the Generation Queue are separate concepts:

- Results = completed artifacts created from Generate.
- Generation Queue = all current inference work across clients.

## Generate persistence

The Generate workspace itself may keep lightweight local UI preferences such as last selected model, but generated result provenance belongs on disk.

## Exit criteria

- Generate appears as a first-class activity;
- Generate works without a Set;
- H3 and Krea2 can be selected where supported;
- multiple Generate jobs can be queued;
- jobs continue when navigating away;
- the queue UI shows global inference ordering;
- results persist and can be previewed after completion;
- Generate Director can draft/refine prompts.

---

# Phase 4 - Promote Director runtime to shared ownership

## Goal

Reuse the existing local/remote llama.cpp runtime in Generate without duplicating Storyboard transport.

## Refactor boundary

Current:

`tool/server/storyboard_llm_runtime.py`

Split conceptually into:

```text
tool/server/director_runtime.py
tool/server/storyboard_llm_contract.py
tool/server/generation_director_contract.py
```

`director_runtime.py` owns:

- local llama-server lifecycle;
- remote OpenAI-compatible endpoint;
- model discovery;
- load/unload;
- completion calls;
- structured response handling;
- GPU reservation/release.

Storyboard keeps Story-specific prompt/context assembly in `storyboard_llm_contract.py`.

Generate gets a small generic contract supporting:

- write generation prompt;
- refine existing generation prompt.

## Settings

Promote App Settings language from **Storyboard Director** to **Director** while preserving stored config compatibility initially.

Do not queue Director requests in this phase. Keep the current synchronous UX until Generate/Storyboard/Test inference migration is stable.

## Exit criteria

- Storyboard Director behavior remains unchanged;
- Generate uses the same runtime;
- no duplicated llama.cpp server management exists.

---

# Phase 5 - Migrate Storyboard Takes to generic inference

## Goal

Keep the new Storyboard Scene UX and Take semantics while removing its private generation scheduler/runtime duplication.

## Storyboard retains ownership of

- converting a saved Scene into an inference request;
- Story-wide + Scene LoRA resolution;
- Storyboard reference semantics;
- creating/finalizing Takes;
- Take provenance;
- pending Take cards;
- selected Take/rating/label behavior.

## Storyboard stops owning

- its own lane;
- `_advance_queue()`;
- GPU reservation;
- generic ComfyUI transport/polling;
- generic stop/cancel lifecycle;
- common output retrieval.

## Queue projection

Pending Take cards remain in the Scene.

Their queue position becomes the real global inference queue position.

Example:

`Queued · #4`

means fourth in all inference work, not fourth among Storyboard jobs.

## Exit criteria

All current `tests/test_storyboard_generation.py` behavior remains covered:

- frozen settings;
- multiple Takes per Scene;
- random seed snapshots;
- LoRA inheritance/overrides;
- references;
- cancellation;
- completed Take provenance.

---

# Phase 6 - Migrate Test Generations

## Goal

Remove the Test-specific execution queue and make Test Sessions aggregations over ordinary inference jobs.

## Important granularity decision

One Test Session is **not** one inference job.

A Session with Base + four candidate LoRAs becomes five independently queueable inference jobs.

```text
Session
  Base -> inference job
  Epoch 20 -> inference job
  Epoch 30 -> inference job
  Epoch 40 -> inference job
  Epoch 50 -> inference job
```

This preserves frozen comparison settings while allowing other work to interleave through manual queue order.

## Remove from Test backend

After migration:

- `_pending_tests`;
- `_test_gpu_reserved`;
- `_advance_test_queue()`;
- duplicate GPU reservation logic;
- private worker scheduling that is now inference-owned.

## Retain in Test backend

- Session folders;
- staging/candidate selection;
- Base concept;
- candidate provenance;
- Test result naming;
- `test.json` aggregation;
- rating integration;
- Grid/Compare;
- missing-candidate skip behavior.

## Session progress

Session UI should aggregate child jobs:

`3 / 7 complete · 1 running · 3 queued`

The global Generation Queue exposes the individual renditions.

## Exit criteria

- Tests can be queued while user is in Media/Captioning;
- Tests can coexist in queue with Generate and Storyboard;
- frozen same-seed/same-prompt comparisons remain valid;
- existing rating/Compare/session UX remains stable.

---

# Phase 7 - Allow Test without a Set

## Goal

Keep the excellent Training -> candidate -> Test path while also allowing direct testing of arbitrary installed compatible LoRAs.

## Entry modes

### Set-associated

Current flow remains:

`Training candidate -> staged Test folder -> Test Session`

### Global

From Test activity:

`choose installed compatible LoRA(s) -> Test Session`

## Rules

- a Session may have an optional Set context;
- Set context is not required by the inference engine;
- direct/global sessions still write durable result folders/manifests;
- current Set-associated history remains navigable.

## Exit criteria

- arbitrary installed LoRAs can be compared without constructing a fake Set;
- existing Training candidate workflow is unchanged.

---

# Phase 8 - Hardening and cleanup

## Goal

Delete obsolete paths only after all clients are migrated and verify restart/error behavior across the combined system.

## Cleanup

- remove deprecated Storyboard queue scheduler code;
- remove Test private queue code;
- remove duplicate ComfyUI transport helpers where the common runtime fully owns them;
- update docs and README;
- update comments/names that still describe separate inference queues.

## Reliability tests

Add coverage for:

- mixed client FIFO;
- reorder across clients;
- queued work while Training owns GPU;
- automatic start after Training releases GPU;
- WebCap restart with queued work preserved;
- active job marked interrupted after restart;
- ComfyUI restart/disappeared provider job;
- Stop breaks provider polling;
- one failed job advances the queue;
- deleting a Test candidate before its queued rendition runs;
- deleting/changing a Story Scene after its Take job is queued does not mutate the frozen request;
- Generate results remain readable after restart.

## Later optional work

Only after the above is stable:

- queue Director GPU requests;
- first/last/reference-image convenience actions from Generate;
- promote generated assets directly into Media workflows;
- additional inference models;
- richer queue drag/drop;
- optional queue filters by client;
- rename Prep to Media if the broader workspace naming review supports it.

---

# Implementation order for this branch

This branch will work through the plan only until Generate is in place:

1. Phase 0 - queue contract.
2. Phase 1 - inference runner / shared inference lane.
3. Phase 2 - shared inference model/runtime layer sufficient for H3 + Krea2 Generate.
4. Phase 3 - Generate activity, persistent results, global Generation Queue.
5. Phase 4 - shared Director runtime only to the extent required for Generate Director support.

Storyboard and Test migrations remain follow-up phases after Generate proves the new path.

## Non-goals for the initial Generate landing

- no Training migration;
- no Test lane migration yet (Test already uses the shared execution substrate);
- no Storyboard lane migration yet (Storyboard already uses the shared execution substrate);
- no event bus;
- no generic plugin framework;
- no database;
- no arbitrary ComfyUI graph editor;
- no automatic priority/fair-share scheduler;
- no Prep -> Media rename;
- no Director background queue yet.
