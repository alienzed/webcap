# Activity / Process Awareness IA

**Status:** design direction only; intentionally split into independent implementation chunks.

## Purpose

As WebCap grows across Prep, Training, Test Generations, Generate, Storyboard, Storage, shared Inference, and local Director / Prompt Assistant work, long-running or asynchronous work increasingly outlives the screen that created it.

The missing product layer is **process awareness**: a calm, global way to answer:

- What is WebCap doing right now?
- What finished or failed since I last checked?
- Where did that work come from?
- Where can I go to inspect the owning result or workflow?

This is **not** a queue-consolidation project. Training, shared Inference, Test Sessions, Storyboard Takes, and Director work have different semantics and should keep their own ownership.

## Core IA decisions

### 1. Activity is observational, not a master queue

Activity should behave more like a browser download popup / activity center than a scheduler dashboard.

Its primary hierarchy is:

1. **Now** — the currently executing meaningful process.
2. **Since you last checked** — newly completed, failed, interrupted, paused, or otherwise attention-worthy work.
3. **Waiting** — only a lightweight summary when useful, with links to the specialized queue that owns the work.

Raw queue depth is secondary metadata, not the main point of Activity.

Activity should not reproduce every specialized queue in full.

### 2. One meaningful GPU owner at a time

Training, shared ComfyUI Inference, and local llama.cpp Director / Prompt Assistant work are competing GPU claimants, not parallel execution lanes.

Activity must not imply that all three can be actively running GPU work simultaneously.

A retained or preloaded local LLM model may remain resident while another subsystem is idle, but that is not the same as an actively running process.

The UI should therefore normally present one dominant GPU-bound **Now** item, with waiting work summarized beneath it.

### 3. Observing Activity must never change Set location

Opening Activity, expanding a row, checking status, marking completions seen, or viewing process details must not mutate:

- state.folder;
- the current Set;
- the current workspace;
- Story / Scene selection;
- Test Session selection.

Cross-context navigation must be an explicit user action whose label names the destination, for example:

- **Open Training · Clothing**
- **Open Test · Swimwear**
- **Open Story · The Last Hotel**
- **Open Generate result**

This is especially important because the current Test activity helper can reach openTrainingWorkspaceFolder(...), which changes Set context. The global Activity surface must not inherit that behavior implicitly.

### 4. Specialized queues keep specialized homes

Activity may summarize waiting work, but queue management belongs with the queue that understands its semantics.

#### Training

The existing Training Queue is a legitimate domain control surface because it owns:

- long-running runs;
- epochs / steps;
- checkpoints;
- Finish / Pause / Resume;
- reorder / cancel;
- Training History.

The queue block itself is not the problem. Its visibility is currently tied too closely to the Training surface. Activity can provide global awareness without replacing or flattening the Training UI.

#### Shared Inference

The backend already has one canonical inference execution lane used by:

- Generate;
- Storyboard Takes;
- Test Generations.

Its current visual home is accidental: Generate renders the whole shared lane as **Generation Queue**.

That queue deserves a proper, neutral home because it is genuinely cross-feature and supports:

- active provider work;
- queue ordering;
- pause / resume;
- cancel;
- stop;
- reorder;
- provider cleanup holds.

Activity should link to that home rather than embed the entire queue.

#### Director / Prompt Assistant

Current local LLM work is synchronous request work with retained/preloaded model state. Do not invent a full Director queue merely to satisfy the Activity design.

If real workflows later require multiple Story / Prompt Assistant requests to survive navigation and return results to their owner, that should be a separate background-work project with explicit ownership / destination semantics.

## Current-app IA audit

### Activity rail

The thin left rail currently mixes:

- navigation;
- active-surface indication;
- some workload hints.

Badges fit naturally there, but they should represent **attention or new activity**, not act as miniature queue dashboards.

A global Activity affordance should be distinct from the domain navigation buttons.

### Training

The Training Queue is semantically strong and can remain largely as-is.

The IA issue is not that the queue needs consolidation. It is that active Training becomes hard to observe once the user leaves Training.

Activity should expose current progress and link back to Training without moving the queue itself.

### Generate

Generate currently renders /fs/inference, including Test and Storyboard jobs, while calling the panel **Generation Queue**.

This is the clearest ownership mismatch in the current UI.

Generate should eventually show only Generate-relevant submission/result context, while the canonical shared Inference queue gets a neutral home.

### Test Generations

The current Session list groups:

- **Running** — Test Session records;
- **Queued** — shared execution jobs;
- **Finished** — Test Session records.

These are not three equal collections, even though the UI presents them as peer headings.

A more natural Test-specific hierarchy is:

- **Current Test**
- **Up next**
- **Recent Tests**

Running + queued are current work. Finished Sessions are history.

This cleanup is useful independently of global Activity and should not wait for it.

### Storyboard

Storyboard's local Take state belongs with Scenes and should remain visible there.

Global Activity supplements Storyboard by showing cross-app execution / completion awareness; it should not replace Scene / Take ownership.

### Storage

Storage is already a global activity in the navigation sense, but it is not process activity. Keep the concepts separate.

## Activity content model

A compact Activity popup should prioritize:

### Now

One dominant active process when GPU-bound work owns the machine, for example:

- Training · Clothing · Epoch 46 / 90
- Inference · Storyboard · Scene 4 · Take 3
- Director · Developing “The Last Hotel”

Show only grounded, useful progress:

- elapsed time;
- epoch / step / candidate progress where available;
- provider phase where useful;
- relevant failure / blocked state;
- destination.

### Since you last checked

Recent attention-worthy transitions:

- completed;
- failed;
- interrupted;
- stopped;
- paused / blocked where user action may be needed.

Successful completion can be visually lighter than failures.

Every completion should link to the owning result/context when a safe destination exists.

### Waiting

Keep this secondary.

Examples:

- **4 inference jobs waiting** → View Inference Queue
- **1 training job queued** → View Training Queue

Do not turn Activity into a second rendering of either queue.

## Badge semantics

### Global Activity badge

Should primarily reflect **unseen attention**, not total queued work:

- unseen completions;
- failures / interruptions;
- blocked or paused states that need attention.

Current execution can use a separate running/spinner indicator rather than increasing an unread count.

### Domain rail badges

A domain badge should indicate meaningful live / newly completed work for that domain, not raw queue inventory.

Examples:

- Storyboard: a Take completed or failed;
- Test: a Session completed / needs rating / failed;
- Generate: a generation completed / failed;
- Training: active / paused / completed run state.

Exact badge semantics should be defined per domain rather than forced into one numeric rule.

## Ownership and destination requirements

For any work surfaced globally, Activity needs enough stable identity to answer:

- **type** — Training / Inference / Director / other;
- **owner** — Generate / Test / Storyboard / Training;
- **human label** — Run 06, Scene 4, generation prompt summary, etc.;
- **destination identity** — Set folder, Story ID, Scene ID, Session ID, result ID as appropriate;
- **status**;
- **timestamps**;
- **attention state** if new / failed / seen is implemented.

Do not create a generic job registry solely for UI symmetry. Reuse existing owner data and add only the smallest missing stable identity required for navigation.

## Separate implementation chunks

These are intentionally independent. Do not implement them as one large branch.

### Chunk A — Test Generations IA cleanup

Goal: fix the current local hierarchy without changing execution architecture.

- replace peer **Running / Queued / Finished** grouping with **Current Test / Up next / Recent Tests**;
- preserve Session behavior, queue cancellation, ratings, and result opening;
- do not add global Activity infrastructure;
- preserve DOM identity during polling.

This is the safest and most local first chunk.

### Chunk B — Give shared Inference a neutral home

Goal: remove the ownership mismatch where Generate visually owns the global Inference queue.

- define a dedicated neutral Inference Queue surface / panel;
- reuse /fs/inference and current queue actions;
- keep shared scheduler semantics unchanged;
- Generate should stop being the canonical global queue renderer once the neutral home exists;
- do not combine Training with Inference.

This chunk is operational UI, not Activity notifications.

### Chunk C — Compact global Activity popup

Goal: browser-download-style process awareness.

Initial MVP:

- always-available shell affordance;
- **Now**;
- **Since you last checked**;
- lightweight waiting summaries with links to the correct specialized queue;
- explicit destination links;
- opening / inspecting Activity never changes current Set or workspace.

Do not require a full Activity page for MVP.

### Chunk D — Unseen / completion state and rail badges

Goal: make completed work discoverable without turning queue counts into notifications.

Define and implement:

- what counts as unseen;
- when it becomes seen;
- persistence scope (session-only vs small app-owned persisted state);
- failure persistence;
- global Activity badge semantics;
- per-domain rail badge semantics.

Keep this separate from the first popup implementation if the seen-state contract is not obvious.

### Chunk E — Full Activity page, only if compact Activity proves insufficient

Potential uses:

- longer recent history;
- filtering by owner/type;
- richer diagnostics;
- links to queue homes.

Do not pre-commit to embedding complete Training / Inference queues here. The page should remain an activity center, not become a federation of every management UI.

### Chunk F — Background Director / Prompt Assistant work, only when justified

Potential workflow:

- submit several Story ideas / develop operations;
- navigate away;
- serialized llama.cpp work continues;
- each result returns to the correct Story / prompt owner;
- Activity reports completion.

This requires durable ownership / destination semantics and is a separate architecture change. Do not infer it merely from the existence of Activity.

## Recommended order

1. **Chunk A — Test Generations IA cleanup**
2. **Chunk B — neutral shared Inference Queue home**
3. **Chunk C — compact global Activity popup**
4. **Chunk D — unseen state + rail badges**
5. Reassess whether **Chunk E** is actually needed.
6. Consider **Chunk F** only after real usage proves synchronous Director work is limiting.

This order fixes two existing IA mismatches before adding global chrome, then builds Activity on top of clearer ownership.

## Non-goals

- Do not merge Training and Inference into one queue.
- Do not create one universal scheduler.
- Do not imply Training, ComfyUI Inference, and llama.cpp can actively own the GPU simultaneously.
- Do not move the existing Training Queue merely for architectural symmetry.
- Do not make opening Activity change Set context.
- Do not use raw queue counts as the primary definition of user attention.
- Do not add an event bus, service framework, database, or generalized process registry without a concrete need.
