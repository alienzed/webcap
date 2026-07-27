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

- `Train this set` starts immediately only when the queue is empty. Otherwise it appends behind the existing first job without starting a waiting queue.
- `Pause` interrupts the verified active runner and leaves that job first. `Resume` retries it from its latest valid checkpoint, or restarts the stage when no checkpoint exists.
- `Finish` intentionally ends the active job and immediately allows the next queue item to start. The clock control can schedule Finish after a saved epoch.
- Canceling a queued item removes that item only; it does not stop the active job.
- A temporarily unavailable set folder leaves its job and job bundle intact. The queue shows the unavailable source and waits for explicit cancellation or a later launch attempt.
- The queue exposes ordering, effective launch/stage output paths, output-folder actions, output logs, recent history, GPU status, and checkpoint-resume controls. Queued resume jobs show the checkpoint tag and artifact-derived epoch/step progress. The in-app output view opens at the recent log tail; use **Reveal log file** to inspect the complete `run.log` in Explorer.
- Any unexpected launch, trainer, or runner-disappearance failure leaves that same job first and waits for explicit Resume. Starting WebCap may reconnect to the exact recorded first runner, but never launches dormant work. Inconclusive runner inspection remains visible and blocks action until the process can be confirmed.
- Explicit resume paths are user intent: WebCap requires a real DeepSpeed checkpoint but does not reject it because saved set/stage metadata differs. Current LR, epochs, buckets, captions, and generated TOML fingerprints never gate resume.
- Resume progress is live filesystem state, not a queue-time snapshot: WebCap rereads `latest`, `global_step*`, and `epoch*` artifacts from the job's output.
- Terminal jobs leave the queue after completion or Finish. Recent Runs is compact, best-effort convenience history in the queue snapshot; missing set or output paths affect only their own row and never delay handoff.
- Clearing Recent Runs or canceling queued work removes its exact WebCap-owned launch bundle. Trainer outputs, checkpoints, set configs, media, captions, and tags are never deleted.
- `.webcap_training/queue.json` contains only ordered launch intent and compact Recent Runs. A set's `.webcap_training.json` contains only its remembered `outputGroup`.
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

The generated TOML remains the configuration interface. Each new job reserves `<base36>-<set>/<profile-stage>/`; at launch or retry, WebCap copies the current stage config into the small job bundle and applies the reserved `output_dir`. The source TOML remains unchanged. HI → LO shares one prefix across its two independent jobs. WebCap does not provide arbitrary custom launch commands or global template editing.
