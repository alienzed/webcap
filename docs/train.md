# Training

WebCap supports managed Diffusion Pipe training and an explicit manual WSL handoff. The media grid is the dataset source of truth; there is no separate prepared-dataset state.

The runner's ownership and recovery rules are defined in [training_runner_contract.md](training_runner_contract.md). See [training_profiles.md](training_profiles.md) for supported models and media requirements.

## Workflow

1. Open **Training** from the permanent activity rail and select the **Base Model** in the application header. The model choice is remembered per set.
2. Set the normal run parameters in **Run setup**: learning rate, rank, epochs, and dropout. These start from the current model template.
3. Review the generated bucket plan and use **Adjust buckets** when the managed dataset needs a different supported target.
4. Use **Advanced configuration** for raw config/dataset TOML edits. Selecting the setup creates only missing files; **Reset** is the explicit way to restore one training config or regenerate one dataset TOML from the visible media.
5. Filter or focus the media grid to the exact items to train.
6. Choose Fresh, Resume, or Fine-tune from saved LoRA and select **Train**, or generate a manual command.

## Workspace layout

Training keeps Run setup, the Training Queue, Training History, and run artifacts in the center workspace. The permanent shell keeps workload state, GPU utilization/VRAM, and free disk space visible across activities so leaving Training does not hide system state. The right-side artifact area has explicit **Items**, **Config**, and **Run Log** tabs:

- Items is the default set-level view. Its tiles open the selected media back in Annotation.
- Config opens the existing editable TOML surface, with compact file tabs for the setup's detected TOMLs. Switching files or away saves through the normal save path.
- Run Log shows an active or historical log without clearing the selected config. Polling is active only while that tab is visible.

The compact chevron in Items only collapses the tile overview; it does not alter the visible-media selection that will be captured.

Train saves any open TOML before capture. It then creates a run-owned bundle containing the visible media, latest captions, saved TOMLs, training plan, and the Run setup overrides selected for that action. Capture materializes source media byte-for-byte; it does not currently normalize video FPS. The job enters the queue only after the bundle is complete. The proposed advanced, per-run model-native FPS option is documented in [training_profiles.md](training_profiles.md).

Wan2.2 High and Low are independent run choices. Every separate Train action creates its own captured action evidence.

## Queue and run controls

- **Train** starts when the runner is idle or adds the job behind active work.
- **Pause** interrupts the active job, keeps it first, and holds the queue until **Resume**.
- **Finish** intentionally ends the active job and allows queue processing to continue.
- Canceling a queued item removes that item only; it does not delete its captured bundle.
- Jobs expose captured files, output folders, logs, progress, next-checkpoint ETA, diagnostics, and checkpoint Resume.
- **Training History** is a lightweight metadata index in `.webcap_training/recent_runs.json`. Only recorded history rows appear; filesystem artifacts enrich those known rows with availability/actions but do not invent history.
- Managed Resume discovers compatible current-set logical runs; Custom Resume accepts an explicit checkpoint directory and creates a new logical run without writing beside the source. H3 Resume includes the current capture's cache phase.
- Resume applies the selected Run setup learning rate as `force_constant_lr` in the captured config so the chosen LR is effective after checkpoint restore.
- Test Generations has its own FIFO/session flow and GPU reservation. Test jobs are not Training Queue jobs and do not appear in Training History.

## Candidate selection and finalization roadmap

Candidate Analysis currently provides analyzer suggestions, saved-epoch inspection, curve review, and explicit Test-folder staging. It does **not** yet persist a human-selected final/release epoch.

The planned lifecycle is **Suggested candidate -> Saved/Tested epoch -> Selected epoch -> Finalize training -> Archived experiment**. The Selected-epoch contract lives in [webcap-lora-valley-candidate-detection.md](webcap-lora-valley-candidate-detection.md); archive/finalization ownership lives in [storage_manager_plan.md](storage_manager_plan.md).

The durable selection/experiment record should live inside the trainer timestamp run folder in `webcap-run.json`, because that exact folder is what survives into the user's archive. The selection records epoch/step knowledge independently of checkpoint retention; the long-term archive may keep only TensorBoard logs plus this JSON after epoch/checkpoint cleanup. It should not live in Set state or `.webcap_training/recent_runs.json`. Training History remains a lightweight recent-work index, while finalized experiment metadata should travel with the archived run.

## Manual command handoff

`Generate & Copy Manual Command` uses the same bundle materializer as managed training, so the command is self-contained. It never starts a process.

Raw/custom dataset TOMLs remain usable through the manual command handoff. Managed Review buckets are captured only when they remain members of the current model policy.

## Training settings

Relevant `tool/config.json` fields include:

- `training.diffusion_pipe_wsl`: Diffusion Pipe working directory in WSL.
- `training.wsl_distribution`: optional explicit WSL distribution.
- `training.conda_executable` and `training.conda_environment`: optional managed Conda runtime pair.
- `training.activate_script`: optional activation script when Conda is not configured.
- `training.repeat_reference_epochs`: fixed planning epoch count used when solving generated dataset repeats; default 90.
- `training.test_copy_roots` and `training.test_copy_subfolder`: destinations used when staging saved candidate LoRAs into the Test Bench.
- `training.enabled_profiles`: models shown when creating new training runs. At least one profile must remain enabled.

Disabling a profile only hides it from new-run setup. Existing TOMLs, captured bundles, history, and Resume behavior remain untouched.

## Persisted training state

- `.webcap_training/queue.json` contains ordered scheduler work and live fields.
- `.webcap_training/recent_runs.json` is the lightweight Training History metadata index and never gates scheduling.
- Queue and Training History metadata are convenience state. History rows remain useful even when their recorded output/log paths are later unavailable; existing files are checked only to enrich actions and availability. New action-owned captures, jobs, logs, and output live under `output/runs/<global-sequence>-<set-slug>--<hash>/<logical-run>/`.

The persistent set TOMLs remain the editable baseline. Learning rate, rank, epochs, and dropout selected in Run setup are written only into the captured config for that action; app-owned runtime paths are rewritten there as well.

Generated dataset repeats are intentionally decoupled from the run's selected Epochs value. Repeat counts are solved against `training.repeat_reference_epochs` (90 by default); the actual run epochs still drive the captured config and estimated total work.

For successful managed runs, WebCap records cumulative active training time: runner process time including startup, compilation, caching, checkpoints, and shutdown, while excluding queued and paused time. Explicit Resume inherits its parent run's total. Older history calculates a total lazily from complete timestamped log lineage when possible; incomplete legacy lineage intentionally has no displayed total.
