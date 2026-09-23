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

This plan was intentionally incremental. It follows the repo contract in `AGENTS.md`: reuse working behavior, keep ownership explicit, avoid framework-like indirection, fail visibly, and prove abstractions with concrete workflows before migrating mature clients.

**Implementation status: complete.** The phase sections below retain the implementation sequence and rationale; this "Current baseline" describes the resulting architecture.

## Current baseline

- `tool/server/execution_queue.py` provides durable queue mechanics:
  - immutable payload snapshots;
  - FIFO ordering and queue positions;
  - pause/resume;
  - cancel/stop requests;
  - reorder/requeue;
  - restart reconciliation;
  - global execution-resource ownership.
- Generate, Storyboard Takes, and individual Test renditions all use the common `inference` lane and `tool/server/inference_runner.py`.
- Storyboard owns Story/Scene/Take semantics and its contextual pending-Take projection; Test owns Session aggregation/comparison/rating semantics; Generate owns the full Generation Queue surface and standalone result history.
- Legacy persisted `storyboard-takes` and `test-generations` queue work is reconciled only as migration compatibility; neither legacy lane has an active scheduler/observer.
- Startup reconciliation runs before the shared inference observer begins dispatching, and unresolved provider work holds the shared GPU resource rather than allowing overlapping inference.
- Training remains independently scheduled in `tool/server/training_runner.py` and shares only GPU resource arbitration with inference.
- Shared H3/Krea2 inference adapters and runtime own model binding, ComfyUI transport, provider polling/cancellation, output retrieval, and generic lifecycle behavior.
- The shared queue API uses explicit transitions: queued jobs are claimed into `starting`, marked `running`, stopped with `request_stop`, and only active jobs may be finished.

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
- Expand with Director;
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

**Status:** implemented and merged.

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

**Status:** implemented and merged.

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

**Status:** implemented and merged.

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

# Current status and locked next milestone

As of 2026-09-22, the product-facing Storyboard workflow and the first Generate client are substantially in place.

Implemented product capabilities include:

- Storyboard Director concept expansion and Story-to-Scenes development;
- focused Scene authoring with continuity fields, Story invariants, Story-wide LoRAs, Scene overrides, references, multiple Takes, Take labels/ratings/selection, and selected-sequence export;
- standalone Generate with H3/Krea2 controls, LoRAs, references, persistent results/provenance, Director write/refine, and the visual Generation Queue;
- stable keyed Generate result reconciliation so live polling does not recreate existing media elements or restart playback.

The remaining work is intentionally ordered as follows:

1. **Storyboard Takes -> common `inference` lane:** implemented and merged.
2. **Test Generations -> common `inference` lane:** implemented and merged with one job per Base/candidate rendition and Session-owned aggregation.
3. **Harden and clean up the unified inference path:** implemented and merged; obsolete Test scheduler/transport paths were removed while migration compatibility and domain-owned Session/result behavior remain. Remove obsolete per-client scheduler/transport duplication only after both migrations are proven.
4. **Generate IA/UX polish:** implemented and merged. Director is a prompt-editing tool, rough-idea vs finished-prompt authoring is explicit, one-step restore protects Director edits, Setup/Output/Conditioning hierarchy is clearer, and permanent GPU/queue implementation prose was removed.
5. **Explicit Take deletion:** implemented and merged. Reversible Remove/Restore stays separate from permanently confirmed Delete Take.

Training remains a separate long-running scheduler and shares only GPU resource arbitration.

Local Director requests still use the same GPU reservation path as generation. Running local Director concurrently with active generation is not part of this milestone; remote Director remains the current path for that workflow. The Director runtime naming/settings cleanup remains a follow-up refactor, not a blocker for the queue migrations.

---

# Implemented sequence

The completed migration followed this order:

1. queue contract and shared `inference` lane;
2. shared H3/Krea2 inference runtime/model layer;
3. standalone Generate activity and Generation Queue;
4. shared Director runtime reuse for Generate;
5. Storyboard Takes migrated to the common lane;
6. Test Generations migrated at rendition granularity;
7. hardening/cleanup, Generate IA polish, explicit Take deletion, and post-migration stability fixes.

Training intentionally remains a separate long-running scheduler. There is still no event bus, plugin framework, database, arbitrary ComfyUI graph editor, automatic fair-share scheduler, or Director background inference queue.
