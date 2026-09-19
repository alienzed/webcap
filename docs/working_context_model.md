# Working Context Model

**Status:** Phase 24 contract. This defines semantics only; it does not move model state or the visible model selector.

## Purpose

The permanent shell needs one unambiguous definition of "what I am working with" before model selection can move out of Training.

The shell context has two kinds of identity:

1. **Working context** — mutable context used by the next model-sensitive operation.
2. **Artifact identity** — immutable context recorded by an existing run, checkpoint, or Test session.

Those must never be conflated.

## Working context

The authoritative working context is conceptually:

```text
folder: current set/folder, or no set in a global context
modelProfileId: model/profile selected for the next model-sensitive operation
```

### Folder / set

- `state.folder` remains the current source of truth.
- Prep, Review, Grid, Focus, and set Training reflect that folder.
- Global Training may operate without a selected set.
- A future ad-hoc Test source may also have no set; that does not change model ownership.

### Working model

The working model means:

> The model selected for the next model-sensitive operation.

It is **not** the model of whatever historical artifact happens to be open.

After Phase 25:

- `workingContextState.modelProfileId` is the authoritative working model/profile selection.
- `getWorkingModelProfileId()` and `setWorkingModelProfileId()` own access to that state.
- selection is still persisted per folder with `webcap.trainingProfile.<folder>`.
- Training consumes the shared state through `getSelectedTrainingModelProfile()`.
- Training mode remains separate state persisted with `webcap.trainingMode.<folder>`.
- Phase 26 moves the single real editable selector to `#app-header-model-profile-select`.
- Training continues to consume the same shared working-model state; there is no Training-local duplicate selector.

Phase 25 changed state ownership; Phase 26 changes selector placement only.

## Artifact identity

Historical artifacts retain immutable model identity from the artifact itself.

Examples:

- Training jobs/runs use their recorded `profileId`, model label/model metadata, stage, and captured run data.
- Resume actions must continue using the historical job's recorded `profileId`, not the current working model.
- Test sessions/results keep their recorded model. The current H3 Test backend already records `model: "h3"` in prepared/running session data.
- Opening an old H3 run or H3 Test session while the working model is Krea2 must still display that artifact as H3.

Changing the working model must never rewrite or visually relabel historical artifacts.

## Surface rules

### Prep

- Folder/set context is active.
- Working model may be unset or retained in the background.
- Prep does not require model selection merely to browse or annotate.

### Set Training

- Folder/set context is active.
- The working model controls the next setup/train operation.
- Existing per-folder profile persistence continues until the dedicated ownership migration.

### Global Training

- No set is required.
- The working model still represents the next model-sensitive operation.
- Historical queue/history entries continue to show their own recorded model identities.

### Test

- A new Test operation should ultimately consume the working model when Test supports multiple models.
- Existing H3-only Test behavior remains H3 and unchanged in this phase.
- Existing Test sessions remain labeled by their recorded model, regardless of the current working model.

### Historical artifact views

- Artifact model identity is local to the artifact view.
- The shell may simultaneously show a different working model.
- That difference is valid and expected.

## Invariants

1. There is one editable working-model source of truth.
2. Folder/set identity and model identity are separate values.
3. Historical artifact model identity is immutable.
4. Opening an artifact never changes the working model unless an explicit user action requests that change.
5. Changing the working model never changes historical artifact identity.
6. A no-set/global context is valid and must not invent a folder.
7. Phase 24 does not move the selector, change persistence, or generalize Test inference.

## Current-to-target ownership

| Concept | Current owner | Contract semantics |
| --- | --- | --- |
| Current folder/set | `state.folder` | unchanged authoritative folder context |
| Working model/profile | `workingContextState.modelProfileId` | authoritative next-operation model; Training consumes it |
| Training mode | `trainingWorkspaceState.selectedMode` | separate from model identity |
| Training artifact model | recorded job/run fields | immutable artifact identity |
| Test artifact model | recorded Test session/status model | immutable artifact identity |
| Visible model selector | Permanent app header | single editable selector bound to shared working-model state |

## Decision

The shell's future Model control will represent **working model**, not "model of the thing currently on screen."

Historical runs and sessions must continue to carry and display their own immutable model identity beside that shell context.
