# Queue Semantics

> Draft. This document defines intended user-visible queue and pending-work semantics.
> It is normative for UI state and queue admission, but it does not replace feature-specific
> execution behavior documented elsewhere.

## Core rules

1. **Queue admission is permissive.** If WebCap presents an enabled action, clicking it creates
   the requested work. Queue admission must not invent additional conflicts based on GPU state,
   another queued job, another Story, model residency, or broad "same target" heuristics.

2. **Impossible UI requests are application bugs, not queue policy.** WebCap should not grow
   backend refusal guards to compensate for an enabled control that should have been disabled.

3. **Pending-work safety is expressed in UI state.** Disable or overlay controls when pending
   work will change data that another action would read or snapshot if clicked now.

4. **Dependencies are data dependencies, not generic locks.** Sharing a Story, Scene, queue, or
   execution resource does not itself create a semantic conflict.

5. **Use the narrowest sensible UI scope.** Disable one action when only that action is unsafe;
   protect one Scene when only that Scene is unsafe; use the existing Scenes-area overlay when
   a pending operation may change the Scene set or arbitrary Scenes.

6. **Other Stories remain independent.** Pending Storyboard work for Story A must not lock or
   disable Story B.

7. **Queued work is a frozen request.** Once a job is queued, later edits do not rewrite that
   job's inputs. A pending reader does not normally lock its source data; a pending writer may
   lock downstream actions that would otherwise snapshot the old value.

8. **Execution contention changes when work runs, not whether it may be queued.** Training,
   local LLM, Inference, ComfyUI availability, GPU ownership, and queue depth are execution
   concerns.

9. **Training keeps its specialized semantics.** Training may legitimately own the local-GPU
   execution domain while active/unpaused. That must not prevent valid LLM or Inference work
   from being queued.

10. **Commit-time validation protects mutable state.** If a queued operation returns after its
    source state has materially changed, stale-result validation may fail loudly rather than
    applying the wrong result. This is data-integrity protection, not queue admission.

## Dependency rule

For UI enablement, think in reads and writes:

> If pending operation A writes data X, disable action B only when B would read or snapshot X
> before A completes.

Exact duplicate actions may also be disabled when a second identical request is semantically
meaningless.

The important question is therefore not "is this Story busy?" but "would the user expect this
action to use the result of the work that is currently pending?"

## Storyboard / Director

### Expand Concept

Reads:
- current Story concept
- visual / atmosphere style
- current Story invariants

Writes:
- Story concept
- previous-concept restore state

Expected UI semantics:
- disable another Expand Concept for the same Story
- disable Define Invariants while Expand is pending, because Define consumes the concept
- disable Develop Scenes while Expand is pending, because Develop consumes the concept
- disable Check & Repair while Expand is pending if the repair request would consume Story
  concept as part of its context
- existing Scene editing and Take generation remain available unless another pending operation
  affects those Scene inputs directly
- other Stories remain fully available

### Define Invariants

Reads:
- Story concept
- existing Story invariants

Writes:
- Story invariants

Expected UI semantics:
- disable another Define Invariants for the same Story
- disable Expand Concept while Define is pending because Expand consumes current invariants
- disable Develop Scenes while Define is pending because Develop consumes invariants
- disable Scene Director actions that consume Story/Scene invariants while Define is pending
- existing Generate Take remains available for already-materialized Scene prompts; current Take
  generation does not re-resolve Story invariants directly
- other Stories remain fully available

### Develop / Re-develop Scenes

Reads:
- Story concept
- style
- Story invariants
- target Scene count
- Story-level planning context

Writes:
- Scene set and ordering
- Scene summaries / entry / exit state
- Scene generation prompts
- Scene continuity/shared-context plan
- Story development state

Expected UI semantics:
- use the existing whole-Scenes-area overlay for that Story
- disable other actions that depend on the Scene set while development is pending
- Take generation for that Story is unavailable while the Scene set is being replaced
- Story-level fields that are inputs to Develop should not be edited in a way that creates an
  ambiguous pending request unless the UI explicitly treats the queued request as a frozen
  snapshot
- other Stories remain fully available

### Check & Repair / Refine All Scenes

Reads:
- Story concept
- style
- Story invariants
- current Scene order
- current Scene summaries / entry / exit state / prompts

Writes:
- zero or more Scene summaries
- zero or more Scene entry/exit states
- zero or more Scene generation prompts
- repair result/restore metadata
- does not intentionally add, remove, merge, split, or reorder Scenes

Expected UI semantics:
- use the existing whole-Scenes-area overlay for that Story
- Take generation for that Story is unavailable while Repair is pending because any Scene prompt
  may change
- per-Scene Director actions and editable Scene fields are unavailable while Repair is pending
- other Stories remain fully available

### Write Scene Prompt

Reads:
- Story style
- relevant Scene/Story invariants
- shared continuity context
- Scene summary / entry / exit state / duration / references
- previous Scene exit state where applicable

Writes:
- Scene generation prompt

Expected UI semantics:
- disable another Write Prompt for that Scene while pending
- disable Refine Prompt for that Scene while Write Prompt is pending
- disable Generate Take for that Scene while Write Prompt is pending because Take would snapshot
  the old prompt
- unrelated Scenes remain usable unless they depend on data being changed
- other Stories remain fully available

### Refine Scene Prompt

Reads:
- current Scene prompt
- Scene summary / entry / exit state / duration
- Story concept
- Story style
- relevant invariants/shared context
- previous Scene context

Writes:
- Scene prompt
- may also write Scene summary / entry state / exit state / duration

Expected UI semantics:
- protect that Scene while the refinement is pending
- disable Generate Take for that Scene while Refine is pending
- unrelated Scenes remain usable unless their action explicitly consumes fields this refinement
  may change
- other Stories remain fully available

### Generate Take

Reads/snapshots at enqueue:
- current Scene generation prompt
- resolved shared continuity context
- Story/Scene generation defaults
- duration
- seed mode / seed
- references
- resolved LoRAs

Writes:
- a new derived Take and Take metadata for that Scene

Expected UI semantics:
- may queue multiple Takes when the user explicitly asks for them
- does not lock the Scene simply because a Take is queued; the request is already frozen
- must be disabled while a pending writer is about to change one of the generation inputs it
  would snapshot now, especially Write Prompt, Refine Prompt, Repair All, or Develop Scenes
- other Scenes and other Stories remain usable

### Restore operations

Restore Concept / Restore Prompt / Restore Repair are mutations, not queue arbitration.
They should follow the same dependency rule: if a pending operation is writing the state being
restored or consumes the value that would be restored, the conflicting UI action should not be
presented as available.

## Generate screen

### Prompt Assistant: Write / Refine

Reads:
- current prompt idea or prompt
- refinement instruction
- selected generation-model context

Writes:
- the editable Generate prompt

Expected UI semantics:
- disable the same Prompt Assistant action while it is pending where repeating it is meaningless
- disable Generate while a pending Prompt Assistant operation is expected to replace/refine the
  prompt that Generate would snapshot
- an already-queued generation does not lock prompt editing; its request is frozen

### Generate inference

Reads/snapshots:
- current prompt
- selected model
- generation settings
- LoRAs
- references / conditioning inputs

Writes:
- derived generation result

Expected UI semantics:
- multiple generations may be queued intentionally
- queued/running Generate work does not lock the editable prompt/settings solely because it exists
- execution/provider availability affects execution, not admission

## Test Generations

Test jobs are intentionally batch-oriented.

Reads/snapshots:
- selected test session/candidate
- prompt/wildcard resolution
- selected model and generation settings
- LoRA/candidate context

Writes:
- derived test result and test metadata

Expected UI semantics:
- Run Tests may enqueue multiple jobs intentionally
- queued tests do not lock test configuration merely because they exist; queued jobs keep their
  frozen inputs
- changing configuration affects subsequent queued work, not already-queued work
- Queue vs Backlog is an explicit scheduling choice, not an admission-validity distinction
- ComfyUI availability does not prevent the user from creating valid queued test work

Any Test Director/Prompt Assistant action that will rewrite the material a test run would snapshot
should disable the corresponding Run action until that rewrite completes.

## Inference Queue

The Inference Queue is an execution-management surface, not a semantic-validation layer.

- Queue contains requested runnable inference work.
- Backlog contains intentionally deferred work.
- Pause/Resume controls execution progression.
- Move to Queue/Backlog changes scheduling intent.
- Cancel removes pending work.
- Stop requests termination of active work.
- None of these states should cause feature screens to invent unrelated queue-admission failures.

Feature-specific dependencies are owned by the originating feature UI, not by the global Inference
Queue.

## LLM / Director Queue

The LLM queue serializes Director, Prompt Assistant, Test Director, and Chat work according to its
execution behavior.

- valid feature actions may enqueue while other LLM work exists
- broad "same Story/target already has pending work" refusal is not a valid queue rule
- feature UIs own semantic pending-state controls
- local-vs-remote model execution affects execution resource use, not whether valid work may exist
- Stop/Cancel affect the exact queued/running job; they do not create a broad target lock

## Director Chat

Chat is conversational LLM work and has no Storyboard mutation dependency unless a future feature
explicitly adds one.

- sending another chat message follows Chat's own conversation/serialization semantics
- Chat work must not lock Storyboard, Generate, or Test feature controls merely because it shares
  the LLM execution lane

## Training

Training owns a specialized long-running queue and lifecycle.

- Training may keep priority/special ownership of the local GPU while its active/unpaused work is
  draining
- LLM and Inference may wait to execute locally
- valid LLM and Inference actions may still be queued
- Training queue state is not a semantic dependency for Storyboard, Generate, or Test UI controls
- remote LLM work does not consume the local GPU and should not be treated as blocked by Training
  on semantic grounds

## Cross-feature rule

Queue/resource sharing does not imply UI locking across features.

A Storyboard Director job, Generate inference job, Test job, Chat request, or Training job may share
execution machinery without sharing semantic state. Cross-feature UI locks require an actual data
dependency, not merely a shared GPU or queue.

## Implementation guidance

- Prefer existing Director cards, disabled controls, and Story/Scenes overlays.
- Prefer the existing whole-Scenes overlay when an operation may change arbitrary Scenes.
- Do not add backend admission guards to mirror these UI states.
- Do not turn stale persisted queue/provider state into semantic UI locks.
- Keep pending state scoped by exact Story and, where appropriate, exact Scene/action.
- Tests should assert both sides of the contract:
  - dependent UI actions are disabled while their input writer is pending
  - unrelated actions and other Stories remain enabled
  - direct queue calls are not refused because another job merely looks conflicting

## Known intent questions

This draft intentionally leaves only genuinely semantic choices open. Resolve them by asking:

> Would the user expect this action, if clicked now, to use the result of the pending operation?

If yes, disable it until the pending operation completes.
If no, keep it available.

Document each resolved case here rather than adding an implicit guard elsewhere.
