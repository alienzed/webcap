## Training

WebCap supports managed training alongside a retained manual WSL handoff. Open `Train` from a set to prepare its data, inspect generated configuration files, and manage the shared queue.

## Readiness

`Ready to train` means the set has both stage configs, both generated dataset configs, and a valid prepared-data manifest with non-empty prepared captions.

It also checks for incomplete annotation work: an item with assigned tags but no source caption is partial. When at least three such items make up at least 15% of the set's touched items (tagged or captioned), the folder instead shows `Caption review needed (N of M)`. Untouched, uncaptioned items are ignored so intentional exclusions do not block a set.

## Managed workflow

1. Use `Prepare Dataset` to rebuild `auto_dataset` from the current visible subset.
2. Use `Generate Configs` to write `dataset.hi.toml` and `dataset.lo.toml`, then inspect or edit `config.hi.toml` and `config.lo.toml` if needed.
3. Choose HI → LO, HI-only, or LO-only. Optionally select a prior run or enter a custom checkpoint path and choose the stage to resume.
4. Select `Train this set`. It starts when the runner is idle or queues behind active work. HI → LO is represented as two independent jobs.
5. Use the Training workspace to follow progress, GPU status, logs, recent runs, queue order, and attention prompts.

- `Pause` holds the current stage and queue for an explicit resume. `Finish` intentionally ends the stage while preserving its output and continuing the queue.
- Queued jobs can be moved, removed, or resumed after a hold. After an app restart, WebCap holds queued work rather than launching it automatically.
- `Run Diagnostics` performs the fuller WSL, runtime, launcher, and CUDA check. Normal managed launches use lighter prerequisites.
- New generated configs use `<filesystem.root>/output/sets/<three-character-base36-sequence>-<set-name>/`. The active stage config's `output_dir` remains authoritative for run discovery and resume.
- TensorBoard can be started, stopped, and opened from the training workspace when it is available in the configured runtime.

## Manual command handoff

`Print & Copy Manual Command` posts to `/fs/train_run`, prints the resolved command, shows it inline, and copies it to the clipboard. It never launches training itself.

For manual HI → LO, the handoff remains one chained command. HI-only and LO-only produce one command each.

```
NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG> ; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>
```

## Config settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: expected working directory in WSL.
- `training.wsl_distribution`: optional explicit WSL distribution; leave blank to use the Windows default.
- `training.conda_executable` and `training.conda_environment`: optional pair for managed Conda runtime commands. WebCap uses `conda run` in its child processes and does not alter the user's WSL shell or environment.
- `training.activate_script`: optional WSL virtual-environment activation script used only when no Conda runtime is configured, for example `/home/user/diffusion-pipe/.venv/bin/activate`.
- `training.tensorboard_port`: local port used by the TensorBoard controls.
- Training config filenames are fixed to `config.hi.toml` and `config.lo.toml` in each set folder.

## Notes

- Manual handoff is explicit: copy the displayed command and run it in WSL yourself.
- Managed training is the preferred way to sequence HI and LO through the queue.
- Missing config/dataset files are auto-generated where possible before preview output.
