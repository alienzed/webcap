# Model Modules North Star

This document defines the intended architecture for adding, changing, and removing training models in WebCap. It is a forward-looking design target, not a description of the current implementation.

The goal is to make model support localized and explicit. Adding an ordinary model supported by Diffusion Pipe should primarily mean adding one model module and its TOML templates. It should not require teaching the queue, history, progress UI, preflight, bundle capture, or route layer about another model name.

## Starting assumptions

- Diffusion Pipe is the trainer. WebCap only supports models that the configured Diffusion Pipe checkout supports.
- WebCap owns a deliberate list of supported models. Model support is shipped with the app; it is not an arbitrary user-defined command system.
- A model is one independently trainable target. A training job trains exactly one model.
- High-noise and low-noise variants are different models, not stages of one run.
- Stages are not part of the target architecture.
- Legacy training profiles, queue records, captured bundles, filenames, and run-history formats do not require migration or compatibility support.
- Training state is workflow convenience, not sacred user data. A clean break is acceptable when implementing this architecture.

## Product outcome

The common training flow should be:

```text
select model
  -> select mode
  -> create or inspect model-owned TOMLs
  -> capture visible media and captions
  -> materialize one self-contained run bundle
  -> preflight one launch plan
  -> queue or run one job
  -> monitor one output
```

The Training UI should not know which models exist in advance. It renders the available models and their capabilities from the model registry.

The shared runner should not contain branches for model IDs. It executes a validated launch plan produced for the selected model.

## The modularity boundary

The boundary belongs immediately before behavior truly becomes model-specific.

WebCap's shared training core owns behavior that is the same for every model:

- selecting visible source media
- resolving captions and primer fallbacks
- capturing an immutable run bundle
- assigning output locations
- validating required files and TOML syntax
- managing the queue and one active process
- recording PID, action, log, result, and timing evidence
- pause, finish, cancel, and resume controls
- displaying logs, history, progress, GPU status, and failures
- opening output and captured-artifact folders

A model module owns the facts and policies that vary by model:

- identity and display metadata
- lifecycle and UI availability
- supported media kinds
- persistent TOML templates
- model-specific template variables
- video capture requirements such as target FPS
- dataset construction policy
- launch-plan policy
- resume behavior when it differs from the shared default
- progress interpretation when trainer output differs
- optional diagnostics or calibration tools

The shared core must call these policies through stable interfaces. It must not rediscover model behavior by comparing model IDs, config filenames, or TOML `type` values.

## Model module shape

A model module is an app-owned Python module with declarative metadata and, only when required, narrowly scoped policy functions. Modules live in one training-model package and are registered by one registry.

The declarative portion should be sufficient for most Diffusion Pipe models. Conceptually, a module describes:

```python
MODEL = {
    "id": "example_t2v",
    "label": "Example T2V",
    "lifecycle": "current",
    "mediaKinds": ("image", "video"),
    "videoFps": 24,
    "modes": ("poc", "normal", "quality"),
    "configTemplate": "example/config.{mode}.toml",
    "datasetTemplate": "example/dataset.{mode}.toml",
    "outputSlug": "example-t2v",
    "modelIdentityKeys": ("type", "diffusion_model"),
    "datasetPolicy": "standard_image_video",
    "launchPolicy": "diffusion_pipe_standard",
    "progressPolicy": "diffusion_pipe_epochs",
}
```

This is an illustrative contract, not a required final syntax. The important property is that static facts are data and exceptional behavior is selected explicitly through named policies.

### Required metadata

Every model must declare:

- a stable ID used within current app state
- a user-facing label
- its lifecycle
- supported media kinds
- supported modes
- the config and dataset templates for each mode
- its output slug
- the TOML keys that identify the selected base model
- its dataset, launch, and progress policies

The registry must validate these declarations loudly at startup or in a dedicated validation pass. Missing templates, duplicate IDs, unknown policies, invalid modes, and incomplete declarations are implementation errors.

### Lifecycle

The target lifecycle values are:

- `current`: available for new training setups and runs
- `deprecated`: intentionally retained for the moment but hidden from the normal new-run selector

Removal is deletion, not another lifecycle state. Because backward compatibility is not required, a model that no longer provides workflow value can be removed completely along with its templates and specialized policies.

App Settings may further hide current models for a particular installation. Settings control visibility; they do not define model behavior.

## Policies, not model-name branches

Policies are a small app-owned dispatch layer. A policy name selects a known implementation. It is not a command string, import path, or user-extensible hook.

For example:

```python
DATASET_POLICIES = {
    "image_only": build_image_only_dataset,
    "standard_image_video": build_standard_image_video_dataset,
    "h3_calibrated_video": build_h3_calibrated_video_dataset,
}

LAUNCH_POLICIES = {
    "diffusion_pipe_standard": build_standard_launch_plan,
    "diffusion_pipe_cache_then_train": build_cache_then_train_launch_plan,
}
```

This keeps unusual model behavior visible without scattering it through common code. If two models genuinely behave the same way, they select the same policy. If a model needs unique behavior, that behavior gets a dedicated policy with a narrow contract and focused tests.

Policy functions must return normalized, app-shaped results. The queue and UI must never consume raw policy-specific or Diffusion Pipe-specific structures.

## Dataset policy contract

The shared core supplies a normalized request containing the selected model, mode, captured manifest, media root, and resolved config paths. A dataset policy returns:

- the complete dataset TOML text
- a normalized training plan used for progress estimates
- visible informational messages and warnings
- a normalized summary of included and excluded media

The policy may choose buckets, repeats, frame counts, and media eligibility. It must not start training, mutate source media, allocate output directories, or manage the queue.

Media conversion belongs to bundle materialization. The model declaration may request a target FPS or other normalized capture requirement, but model policies must never modify the source set.

## Launch-plan contract

The shared core supplies resolved WSL paths, runtime settings, the captured config, output location, and optional resume checkpoint. The launch policy returns an ordered list of process steps:

```python
{
    "steps": [
        {
            "id": "train",
            "label": "Train",
            "argv": ["deepspeed", "--num_gpus=1", "train.py", "--deepspeed", "--config", "..."],
        }
    ]
}
```

A model that requires cache preparation can return `cache` followed by `train`. These are process steps inside one model job, not user-facing training stages and not separate model identities.

The shared runner executes the steps in order and owns:

- shell/script construction
- environment activation
- process evidence and exit handling
- requested stops between steps
- normalized log markers
- final job status

Launch policies construct arguments explicitly. Model modules must not contain arbitrary shell fragments. Shell composition and quoting remain centralized so model modularity does not create an arbitrary-code execution path.

## Resume contract

Resume belongs to the model's launch policy only where command construction differs. The shared core owns checkpoint selection, validation, queue behavior, and the association with the new job.

A standard model adds the configured Diffusion Pipe resume argument to its train step. A cache-then-train model may omit an already completed cache step when resuming. The runner should not know which model requires that behavior; it executes the returned plan.

## Progress contract

Progress is normalized per job:

```python
{
    "phase": "train",
    "epoch": 12,
    "epochs": 50,
    "step": 420,
    "steps": 1800,
    "fraction": 0.233,
}
```

The common UI renders normalized progress. A progress policy may interpret model- or trainer-specific log output, but model IDs and process-step names must not be enumerated in the UI.

Preparatory launch steps may expose a phase label such as `cache`; they do not create separate training jobs or stage-specific history records.

## Templates and generated files

Templates should be colocated by model so a model's supported surface is easy to inspect and remove:

```text
tool/server/training_models/
  registry.py
  policies/
  wan21.py
  krea2.py
  minimax_h3.py

tool/templates/training_models/
  wan21/
  krea2/
  minimax_h3/
```

The exact directories may change, but the registry must be the only index of supported models. There must not be a second manually maintained list of valid template filenames.

Persistent setup filenames should include the model ID and mode. Captured bundles retain the exact materialized TOMLs used for their run. Filenames are implementation details derived by the model module, not identifiers used to infer behavior elsewhere.

## UI contract

The backend exposes normalized model metadata for current models. The Training UI uses it to render:

- the model selector
- supported modes
- media capability guidance
- the expected configuration files
- any model-specific informational note

There are no stage buttons. `Train this set` always creates one model job.

The UI may show the ordered process phase reported by a running job, such as `Preparing cache` or `Training`, but phases are status, not choices presented as separate models or runs.

## State and history

New queue and history records should store the model ID, mode, normalized job status, captured bundle path, output path, and normalized progress. They should not store a global `stages` field.

Process-step evidence may be recorded inside the job when it is useful for diagnostics, but the job remains the unit of queueing, history, resume, and user intent.

The implementation may replace existing queue and history schemas outright. It does not need to read or migrate older stage-based records.

## Adding a routine model

For a model that uses existing policies, adding support should require only:

1. Confirm that the supported Diffusion Pipe version can train it.
2. Add the model module and declarative metadata.
3. Add its mode-specific config and dataset templates.
4. Register the module.
5. Add contract tests covering registry validation, setup generation, bundle materialization, launch-plan arguments, and media eligibility.

No changes should be required in the generic runner, routes, queue, history, progress UI, or Training workspace.

If those common files must learn the new model ID, the modularity boundary has failed.

## Adding exceptional behavior

When a model cannot use an existing policy:

1. Identify the smallest behavior that is genuinely different.
2. Add or extend one narrowly scoped policy interface.
3. Keep model constants and calculations within the model module or its policy helper.
4. Return the same normalized dataset, launch-plan, or progress shape as existing policies.
5. Add focused tests for the exception and shared contract tests proving the common core remains model-agnostic.

An exception should not trigger a generalized plugin framework. A small explicit dispatch table is the intended extension mechanism.

## Removing a model

Removing a model should be complete and unsurprising:

1. Remove it from the registry.
2. Delete its module and templates.
3. Delete any policy used only by that model.
4. Delete its model-specific tests and settings option.

The rest of the training system should remain unchanged. Existing local queue or history state may be cleared rather than migrated.

## Architectural acceptance criteria

The North Star is reached when all of the following are true:

- One model selection creates one job and one output identity.
- There is no training-stage concept in new UI, API payloads, queue state, history, progress, or runner code.
- Supported model IDs are declared in exactly one registry.
- Static model facts live in model modules rather than common workflow code.
- Common training code does not branch on a model ID.
- Template validity is derived from and validated against the registry.
- The UI renders model choices and capabilities from backend metadata.
- Dataset, launch, and progress exceptions are isolated behind small normalized policy contracts.
- Launch plans use explicit arguments and cannot introduce arbitrary user-supplied commands.
- A routine Diffusion Pipe model can be added without editing common runner or UI logic.
- A model can be removed without retaining compatibility code.

## Suggested implementation order

This architecture does not need to be implemented all at once. When the work begins, the safest order is:

1. Define and validate the new model-module contract.
2. Split Wan2.2 high-noise and low-noise into independent model declarations, or remove them if they no longer provide value.
3. Generate the model and mode UI entirely from registry metadata; remove stage controls.
4. Normalize dataset policy selection and remove model-ID branches from dataset generation.
5. Introduce normalized launch plans and make the shared runner execute them.
6. Replace stage-based queue, resume, progress, and history state with one-model job state.
7. Colocate templates by model and remove duplicate template indexes.
8. Delete obsolete profiles, legacy paths, and compatibility code.

Each step should preserve WebCap's core behavior: explicit Train intent, immutable captured inputs, visible failures, portable files, and a disposable convenience queue around an independently useful Diffusion Pipe command.
