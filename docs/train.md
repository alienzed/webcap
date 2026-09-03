# Training

WebCap supports managed Diffusion Pipe training and an explicit manual WSL handoff. The media grid is the dataset source of truth; there is no separate prepared-dataset state.

The runner's ownership and recovery rules are defined in [training_runner_contract.md](training_runner_contract.md). See [training_profiles.md](training_profiles.md) for supported models and media requirements.

## Workflow

1. Select a model. The model choice is remembered per set.
2. Inspect or edit the setup's config and dataset TOMLs. Selecting the setup creates only missing files.
3. Use **Reset** only when intentionally restoring one training config or recalculating one dataset TOML from the visible media.
4. Filter or focus the media grid to the exact items to train.
5. Choose the run option and select **Train this set**, or generate a manual command.

## Workspace layout

Training keeps its numbered setup, queue, GPU status, and recent runs in the center workspace. The right-side artifact area has explicit **Items**, **Config**, and **Run Log** tabs:

- Items is the default set-level view. Its tiles open the selected media back in Annotation.
- Config opens the existing editable TOML surface, with compact file tabs for the setup's detected TOMLs. Switching files or away saves through the normal save path.
- Run Log shows an active or historical log without clearing the selected config. Polling is active only while that tab is visible.

The compact chevron in Items only collapses the tile overview; it does not alter the visible-media selection that will be captured.

Train saves the open TOML before capture. It then creates a run-owned bundle containing the visible media, latest captions, exact saved TOMLs, and training plan. For video-capable profiles, off-target video FPS is normalized only in that bundle; a failed conversion logs a warning and keeps an unchanged copy. The job enters the queue only after the bundle is complete.

Wan2.2 `HI -> LO` creates two jobs sharing one captured bundle. Every separate Train action creates a separate bundle.

## Queue and run controls

- `Train this set` starts when the runner is idle or adds the job behind active work.
- `Pause` interrupts the active job, keeps it first, and holds the queue until `Resume`.
- `Finish` intentionally ends the active job and allows queue processing to continue.
- Canceling a queued item removes that item only; it does not delete its captured bundle.
- Jobs expose captured files, output folders, logs, history, GPU status, diagnostics, and checkpoint resume. Recent Runs keeps compact rows and offers an expandable facts view for timing, progress, dataset, and output details.
- Managed Resume discovers only version-2 logical runs beneath the current set root and captures the current set again. Custom Resume is an explicit checkpoint directory; it creates a new logical run and never writes beside that source. H3 Resume includes the current capture's cache phase.
- The Training Queue header checks the configured local TensorBoard port and opens the existing TensorBoard UI in a new tab. It never starts TensorBoard automatically.

## Manual command handoff

`Generate & Copy Manual Command` uses the same bundle materializer as managed training, so the command is self-contained. It never starts a process.

Raw/custom dataset TOMLs remain usable through the manual command handoff. Managed Review buckets are captured only when they remain members of the current model policy.

## Training settings

Relevant `tool/config.json` fields include:

- `training.diffusion_pipe_wsl`: Diffusion Pipe working directory in WSL.
- `training.wsl_distribution`: optional explicit WSL distribution.
- `training.conda_executable` and `training.conda_environment`: optional managed Conda runtime pair.
- `training.activate_script`: optional activation script when Conda is not configured.
- `training.tensorboard_port`: local TensorBoard port (default `6006`). TensorBoard always reads the overall `FS_ROOT/output/runs` tree.
- `training.tensorboard_bruteforce_control`: defaults to `false`. When explicitly enabled in Training Settings, the header offers Start and Restart controls using the configured WSL and Conda/activation runtime. Restart only targets TensorBoard processes with the exact global runs logdir, but may replace a matching manually started instance. WebCap does not retain a PID or manage TensorBoard automatically; launch output goes to `.webcap_training/tensorboard.log`.
- `training.enabled_profiles`: models shown when creating new training runs. At least one profile must remain enabled.

Disabling a profile only hides it from new-run setup. Existing TOMLs, captured bundles, history, and Resume behavior remain untouched.

## Persisted training state

- `.webcap_training/queue.json` contains ordered scheduler work and live fields.
- `.webcap_training/recent_runs.json` is presentation history and never gates scheduling.
- Per-set `.webcap_training.json` stores set-local output-group metadata.
- Queue and Recent Runs are disposable convenience state. New action-owned captures, jobs, logs, and output live under `output/runs/<global-sequence>-<set-slug>--<hash>/<logical-run>/`.

The persistent set TOMLs remain the editable configuration interface. Only app-owned runtime paths are rewritten in captured copies.

For successful managed runs, WebCap records cumulative active training time: runner process time including startup, compilation, caching, checkpoints, and shutdown, while excluding queued and paused time. Explicit Resume inherits its parent run's total. Older history calculates a total lazily from complete timestamped log lineage when possible; incomplete legacy lineage intentionally has no displayed total.
