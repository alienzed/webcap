# Training

WebCap supports managed Diffusion Pipe training and an explicit manual WSL handoff. Open `Train` from a set, choose a training profile, prepare the selected media, generate its files, then preview, run, or queue the profile's valid run option.

See [training_profiles.md](training_profiles.md) for the supported models, files, media requirements, and output-root behavior.

## Workflow

1. Select a model profile. The choice is remembered per set as a convenience and controls the available run options.
2. Use `Prepare Dataset` to rebuild `auto_dataset/` from the currently visible subset.
3. Choose a Dataset target (`POC`, `Normal`, or `Quality`) and use `Generate Configs`. It creates missing config TOML files for the selected profile and writes the selected profile's dataset TOML and training plan.
4. Open any generated TOML from Configuration Files to inspect or edit it. The editor's **Close** control saves and returns to Training Items. Use **Reset** only when you intentionally want to replace one config from its template.
5. Choose the available run option, optionally select a prior run or enter a custom checkpoint path, then select `Train this set`.

For Wan2.2, `HI -> LO` creates two independent queued jobs. HI and LO are distinct models and each job reports its own progress. Krea2 Raw and Wan2.1 each create one job.

## Queue and run controls

- `Train this set` starts when the runner is idle or adds the job behind active work.
- `Pause` holds the active job and queue until explicitly resumed.
- `Finish` intentionally ends the active job and allows queue processing to continue.
- Canceling a queued item removes that item only; it does not stop the active job.
- The queue exposes ordering, output logs, recent history, GPU status, and checkpoint-resume controls. The in-app output view opens at the recent log tail; use **Reveal log file** to inspect the complete `run.log` in Explorer.
- Progress is per job. When trainer timing is available, the UI shows completion ETA and the estimated time to the next configured checkpoint.
- `Run Diagnostics` performs the fuller WSL, runtime, launcher, and CUDA checks. Normal launches use the lighter required checks.
- TensorBoard can be started, stopped, and opened from the Training workspace when it is available in the configured runtime.

## Manual command handoff

`Generate & Copy Manual Command` resolves and copies the selected profile/run command but never starts a process. Wan2.2 HI -> LO previews two standard DeepSpeed commands; each single-stage profile/run previews one.

## Training settings

Relevant `tool/config.json` fields include:

- `training.diffusion_pipe_wsl`: Diffusion Pipe working directory in WSL.
- `training.wsl_distribution`: optional explicit WSL distribution.
- `training.conda_executable` and `training.conda_environment`: optional managed Conda runtime pair. WebCap uses `conda run` for its child process and does not alter the user's interactive shell.
- `training.activate_script`: optional WSL environment activation script when Conda is not configured.
- `training.tensorboard_port`: local port for TensorBoard controls.
- `training.write_selection_snapshot_comments`: adds the prep snapshot header to generated dataset TOML.

The generated TOML remains the configuration interface. WebCap does not provide arbitrary custom launch commands or global template editing.
