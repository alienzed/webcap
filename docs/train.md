# Training

WebCap supports managed Diffusion Pipe training and an explicit manual WSL handoff. The media grid is the dataset source of truth; there is no separate prepared-dataset state.

The runner's ownership and recovery rules are defined in [training_runner_contract.md](training_runner_contract.md). See [training_profiles.md](training_profiles.md) for supported models and media requirements.

## Workflow

1. Select a model and `POC`, `Normal`, or `Quality` mode. The model choice is remembered per set.
2. Inspect or edit the setup's config and dataset TOMLs. Selecting the setup creates only missing files.
3. Use **Reset** only when intentionally restoring one training config or recalculating one dataset TOML from the visible media.
4. Filter or focus the media grid to the exact items to train.
5. Choose the run option and select **Train this set**, or generate a manual command.

Train saves the open TOML before capture. It then creates a run-owned bundle containing the visible media, latest captions, exact saved TOMLs, and training plan. The job enters the queue only after the bundle is complete.

Wan2.2 `HI -> LO` creates two jobs sharing one captured bundle. Every separate Train action creates a separate bundle.

## Queue and run controls

- `Train this set` starts when the runner is idle or adds the job behind active work.
- `Pause` interrupts the active job, keeps it first, and holds the queue until `Resume`.
- `Finish` intentionally ends the active job and allows queue processing to continue.
- Canceling a queued item removes that item only; it does not delete its captured bundle.
- Jobs expose captured files, output folders, logs, history, GPU status, diagnostics, and checkpoint resume.
- Managed Resume reuses the original bundle and cache and fails visibly if the bundle is missing.
- TensorBoard controls use the configured training runtime.

## Manual command handoff

`Generate & Copy Manual Command` uses the same bundle materializer as managed training, so the command is self-contained. It never starts a process.

## Training settings

Relevant `tool/config.json` fields include:

- `training.diffusion_pipe_wsl`: Diffusion Pipe working directory in WSL.
- `training.wsl_distribution`: optional explicit WSL distribution.
- `training.conda_executable` and `training.conda_environment`: optional managed Conda runtime pair.
- `training.activate_script`: optional activation script when Conda is not configured.
- `training.tensorboard_port`: local port for TensorBoard controls.
- `training.enabled_profiles`: models shown when creating new training runs. At least one profile must remain enabled.

Disabling a profile only hides it from new-run setup. Existing TOMLs, captured bundles, history, and Resume behavior remain untouched.

## Persisted training state

- `.webcap_training/queue.json` contains ordered scheduler work and live fields.
- `.webcap_training/recent_runs.json` is presentation history and never gates scheduling.
- Per-set `.webcap_training.json` stores set-local output-group metadata.
- Captured datasets live under `<numbered-run>/.webcap/datasets/<profile>-<mode>-<unique-id>/` and remain until the numbered run folder is deleted.

The persistent set TOMLs remain the editable configuration interface. Only app-owned runtime paths are rewritten in captured copies.
