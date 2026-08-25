# LoRA Initializer Runs

## Purpose

Allow a new managed training run to initialize its LoRA weights from a user-supplied, compatible prior LoRA directory. This is not checkpoint resume: the new run starts with fresh optimizer, dataloader, and progress state.

The feature is intentionally a practical path picker, not an artifact registry. The user is responsible for placing compatible initializers in a known location and naming their folders meaningfully.

## Training Setting

Add one optional training-runtime setting: **LoRA initializer folder**.

- It is a directory visible to the configured training WSL runtime.
- Its direct child directories are the candidates shown in WebCap's initializer dropdown.
- Each candidate is expected to be a Diffusion Pipe saved-LoRA directory suitable for `adapter.init_from_existing`.
- WebCap must treat the folder as read-only. It does not import, move, copy, or rename initializers.
- An empty or unavailable setting leaves the dropdown empty but does not block a manually entered path.

Example layout:

```text
/mnt/training/loras/initializers/
  character-v3/
  style-base/
```

## Run UI

The existing custom checkpoint-path area becomes a source selector with two mutually exclusive modes:

1. **Resume checkpoint** (default)
2. **Initialize from LoRA**

### Resume checkpoint

- Preserve the current set-run dropdown and custom checkpoint-path escape hatch.
- Continue to pass `--resume_from_checkpoint` and retain all existing resume validation and history behavior.

### Initialize from LoRA

- Show the direct child directories of the configured LoRA initializer folder, labeled by directory name.
- Permit a manual initializer-directory path as an escape hatch.
- Do not send `--resume_from_checkpoint`.
- Start a new run/output identity; it is not linked to or resumed from an earlier managed job.
- For a two-stage HI/LO run, show **Apply initializer to** and require exactly one target stage. A single initializer must never silently be applied to both configs.

Changing modes clears the inactive source value before validation and queueing. The backend must also reject a request containing both a checkpoint-resume path and an initializer path.

## Managed Job And Config Behavior

Add a distinct job field, such as `initFromExisting`, plus an explicit target stage such as `initStage`.

When materializing the immutable job bundle:

- Preserve the source path and mode in job/history metadata for visibility.
- Modify only the captured config for `initStage` to set `adapter.init_from_existing` to the selected path.
- Do not modify the set's editable config file.
- The new runner script is otherwise an ordinary fresh training launch.

The configuration writer must make this targeted TOML change explicitly and fail loudly if the selected profile/config does not have a compatible `[adapter]` table. It must not add arbitrary command-line options or execute user-supplied text.

## Validation

Before queueing, validate only what WebCap can establish safely:

- the selected stage is valid for the chosen run;
- exactly one source mode is present;
- an initializer path is non-empty when Initialize is selected;
- a picker-provided path remains inside the configured initializer folder;
- the path resolves to an accessible directory in the training runtime where practical.

Compatibility of model family, adapter architecture, rank, and target modules is ultimately the user's responsibility. Surface a clear trainer error if Diffusion Pipe rejects the initializer.

## Out of Scope

- No general filesystem browser.
- No automatic conversion, merging, provenance inference, or LoRA metadata registry.
- No support for a bare `.safetensors` path under this feature; that is a different merge-adapter workflow.
- No simultaneous resume and initialization.
- No changes to Finish, Pause, or existing checkpoint-resume recovery behavior.

## Acceptance Criteria

- With Resume selected, current behavior and commands are unchanged.
- With Initialize selected, a new managed job captures an initializer path and applies it to exactly one captured stage config.
- The output path is a new run, not the initializer's directory.
- The set config remains unchanged.
- The queued-job UI clearly identifies an initializer run and its selected stage.
- Invalid/mixed requests fail visibly before a runner starts.
