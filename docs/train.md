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
- `Pause Queue` disables automatic handoff without interrupting the active job.
- `Finish` intentionally ends the active job and allows queue processing to continue.
- Canceling a queued item removes that item only; it does not stop the active job.
- A temporarily unavailable set folder leaves its job and job bundle intact. The queue shows the unavailable source and waits for explicit cancellation or a later launch attempt.
- The queue exposes ordering, effective launch/stage output paths, output-folder actions, output logs, recent history, GPU status, and checkpoint-resume controls. Queued resume jobs show the checkpoint tag and artifact-derived epoch/step progress. The in-app output view opens at the recent log tail; use **Reveal log file** to inspect the complete `run.log` in Explorer.
- Any ordinary job failure is recorded loudly and the queue continues. Queue-wide holds are reserved for runner-control uncertainty, explicit user pause, restart confirmation, or invalid queue state. Starting WebCap may rediscover a verified live runner, but never launches dormant queued work until the user explicitly starts or resumes the queue. Failed history retains structured preflight checks and at most an 8 KB trainer-log excerpt; the complete `run.log` remains the authoritative log. Lifecycle timing failures are shown as invariant errors rather than formatted as plausible durations.
- Explicit resume paths are user intent: WebCap requires a real DeepSpeed checkpoint but does not reject it because saved set/stage metadata differs. Current LR, epochs, buckets, captions, and generated TOML fingerprints never gate resume.
- Queued resume progress is live filesystem state, not a queue-time snapshot: each status refresh rereads `latest`, `global_step*`, and `epoch*` artifacts from the recorded resume directory.
- Terminal jobs leave the live scheduler independently of Recent Runs. A history-write failure is logged loudly but never blocks the queue or its next job.
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

## Persisted training state

- `.webcap_training/queue.json` contains only ordered scheduler work and the explicit live fields needed to render and control it.
- Each job bundle under the reserved output group contains its launch config, runner script, PID, requested action, log, and atomic terminal result.
- `.webcap_training/recent_runs.json` is the compact global Recent Runs index. It is presentation history and never gates scheduling.
- Per-set `.webcap_training.json` stores only set-local output-group metadata. Existing per-set job history is migrated once when the central index is first created, then WebCap reads Recent Runs directly without rescanning every set.

The runner observer starts with WebCap, so progress and terminal handoff continue even when the Training workspace is closed. Restart recovery still requires explicit confirmation before dormant queued work can launch.

The generated TOML remains the configuration interface. Each new launch reserves `<base36>-<set>/<profile-stage>/` and executes a launch-owned snapshot with that effective `output_dir`; the source TOML remains unchanged. HI → LO shares one prefix across its two independent jobs. Resume keeps the existing output. WebCap does not provide arbitrary custom launch commands or global template editing.
