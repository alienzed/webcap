# Multi-trainer Training — implementation detail plan

**Status:** Code-audited proposal; planning only. WebCap `main` and upstream Fizgig source reviewed 2026-10-27; verify the installed training-machine revision before implementing.
**Target:** WebCap, initially Diffusion Pipe + Fizgig for MiniMax H3.
**Updated:** 2026-10-27.
**Primary contracts:** [AGENTS.md](AGENTS.md), [Training Runner Contract](docs/training_runner_contract.md), [GPU Coordination](docs/gpu_coordination_invariants.md), [Filesystem State](docs/filesystem_state_contract.md).

## 1. Decision and desired result

**One WebCap Training workflow with two trainer implementations.** The user continues to work in the same Run Setup, Set review, Queue/Activity, History, Candidate Analysis, Test Generations, Manual Screening, Campaigns, and archive/delete flows. The trainer is a selected property of a run, not a second workspace or queue.

Implement the smallest common contract proven by Diffusion Pipe and Fizgig:

1. **Capability declaration** (static JSON, model-aware) tells the UI what is available and the backend what it must validate.
2. **Captured input translation and command construction** belong to the selected trainer.
3. **Progress and saved-artifact discovery** normalize trainer evidence for existing WebCap surfaces.
4. **Pause, Finish, Resume, and Continue** use the trainer's actual supported mechanisms, preserving meaningful differences.
5. **Selection, Test staging, Archive, and Delete** operate on normalized artifact records, not hardcoded trainer directory names.

**Protect Diffusion Pipe:** its current code paths and semantics remain the default. Initially route existing jobs through their current functions; extract a narrow dispatch seam only when Fizgig requires it. No broad rewrite, generic plugin loader, service framework, new queue/lane/lock, database, new global filesystem root, or silent fallback between trainers. Capability configuration contains **declarations**, not executable command templates.

The long-term aim is trainer independence at the WebCap workflow level, **not** pretending every trainer has interchangeable optimization algorithms, LoRA types, data semantics, or checkpoint internals.

## 2. Verified starting point and ownership

| Concern | Current WebCap code / observed contract | Required seam |
| --- | --- | --- |
| Profiles and model stages | <code>tool/server/training_profiles.py</code> defines Wan2.2 HI/LO, Krea2, Wan2.1 and H3; <code>tool/server/training_setup.py</code> creates model TOMLs | Trainer/model capability lookup; no second profile registry |
| User Run Setup | <code>tool/tool.html</code>, <code>tool/js/training_review.js</code>, <code>tool/js/training_runner_ui.js</code> | Small trainer selector, capability-bound controls; existing form retained |
| Settings | <code>tool/js/app_settings.js</code>, <code>tool/server/config.py</code> | Fizgig path/runtime + per-model default; validate and preserve existing settings |
| Set selection and reviewed buckets | <code>tool/server/training_review.py</code>, <code>tool/server/training_bundle.py</code> | Reuse the exact captured media/captions/plan, emit trainer-native dataset configuration |
| Config and launch | <code>tool/server/training_config_files.py</code>, <code>training_commands.py</code>, <code>training_runtime.py</code>, <code>training_preflight.py</code> | Fizgig argument builder, cache stages and targeted diagnostics |
| Queue/runner | <code>tool/server/training_runner.py</code> with app routes in <code>tool/server/app.py</code> | Keep same queue/job identity, wrapper, PID verification, result and GPU ownership |
| Progress | <code>tool/server/training_progress.py</code> parses Diffusion Pipe log patterns | Fizgig progress adapter from its epoch log and step-loss JSONL |
| History/resume | <code>tool/server/training_history.py</code> expects <code>latest</code> + <code>global_stepN/</code> | Resolve trainer-specific resume states without treating exports as states |
| Candidate Analysis | <code>tool/server/training_candidates.py</code> expects TensorBoard scalars and <code>epochN/</code> exports | Normalize Fizgig JSONL and flat numbered exports |
| Selection and Test | <code>training_runner.py</code>, <code>training_run_manifest.py</code>, <code>training_test_paths.py</code>, <code>epoch_test_bench.py</code>, <code>epoch_finder.py</code> | Resolve normalized exported LoRA paths; preserve Test filename/provenance rules |
| Lifecycle cleanup | <code>training_archive.py</code>, <code>training_run_delete.py</code> | Trainer-aware retained files; exact run ownership, no cross-run cleanup |

### 2.1 Code-audit findings that change the plan

- **API/metadata plumbing:** `tool/js/training_runner_ui.js` (`getManagedTrainingOptions`, `validateTrainingRunner`, `startManagedTraining`) → `tool/server/app.py` (`/fs/training_runner/validate`, `/start`) → `training_runner.validate_response/start_response` → `_new_job`. None currently receives a trainer choice. Thread `trainerId` through both paths, action/capture/job metadata, `_public_job`, `training_history.record_job`'s explicit whitelist, and History Continue in `training_history_ui.js`. Persist per-run choice independently of later Settings changes.
- **Runner and preflight:** `training_runner._build_runner_script` hardcodes DeepSpeed, optionally one DP H3 `--cache_only` phase, and the proven shell/PID/log/result wrapper. `training_preflight.py` requires DeepSpeed/`train.py`, and `training_runtime.py` has a DP-only cwd/activation. Preserve wrapper; branch commands, phases and checks. Fizgig needs separate latent and text cache phases.
- **Different path roles:** `_new_job` sets `outputRunPath = resumeFromCheckpoint`; correct for current DP Resume (run folder), **incorrect for Fizgig** (nested `-state/` directory). `outputRunPath` must always mean the **physical native output run directory**. Keep the Fizgig state-to-resume path separately and update affected history, continuation, PID/recovery, Candidate, Archive and Delete readers.
- **History isn't presentation-only:** `training_history.discover_runs` checks the DP editable model config plus `latest`/`global_stepN/`; `training_candidates` requires two TensorBoard streams and `epochN/` exported LoRAs. `epoch_finder`, `training_archive`, Test staging and selected-epoch metadata consume the same assumptions. Integrate their *reader seams*, not just the launcher.
- **Capture owner exists:** `training_bundle.materialize_training_bundle` already snapshots selected media, captions, inspected config, Review subsets and generated plan under the action's `captures/`. `training_action.allocate_action` owns `captures/`, `jobs/`, `output/`. Do not recapture the Set, invent a second snapshot, or introduce a new global cache root.
- **Ostris behavior changed:** DP's `apply_h3_training_method("ostris")` now selects a **premerged Ostris-v3 H3 checkpoint** and clears `cfg`/`merge_adapters`; it is **not** runtime-merged. The DP Image option is another premerged base. Fizgig `--training_adapter` is a *frozen runtime adapter* and is a different choice.
- **Settings are re-read at launch:** `training_runner._launch_job` currently reads `_training_settings()` when dequeuing. For new jobs, snapshot the effective trainer executable, Python environment, WSL distro, cwd and model/adapter identity on queue admission; a Settings change must not mutate queued intent. Preserve old DP jobs.
- **Fizgig Resume fidelity:** `_load_state` restores optimizer/EMA/RNG when compatible but can use a **fresh optimizer** for mismatched optimizer/architecture. WebCap must not describe that as an equivalent full-state resume. Fizgig's `training/resume_lr.py` supports a user-selected LR change (recent upstream); verify the installed version and actual optimizer/scheduler behavior.

DP's `save_quit`, `latest`, `global_stepN/`, `epochN/` and TensorBoard code remain unchanged as the Diffusion Pipe branch. The new logic must represent Fizgig's own native command, state and artifact contracts.

Source-reviewed upstream Fizgig H3 behavior (installed training-machine revision still needs checking):

- Three-step launch: cache VAE latents, cache text embeddings, then train; its dataset TOML uses <code>[general]</code> + <code>[[datasets]]</code> and explicit cache directories.
- <code>--family minimax</code>, <code>--dit</code>, <code>--vae</code>, <code>--text_encoder</code>, <code>--network_dim</code>, <code>--network_alpha</code>, <code>--learning_rate</code>, <code>--max_train_epochs</code>, and <code>--save_every_n_epochs</code> are CLI parameters.
- Numbered LoRA exports are <code>&lt;name&gt;-000065.safetensors</code>; the final export is <code>&lt;name&gt;.safetensors</code>. Resumable optimizer/state directories are distinct: <code>&lt;name&gt;-000065-state/</code>. Native Resume is <code>--resume &lt;state-dir&gt;</code>, with otherwise compatible original arguments.
- <code>.pause_requested</code> asks for an epoch-boundary save-and-exit. <code>.save_now</code> and <code>.sample_now</code> request on-demand actions. Step loss is <code>.fizgig_loss_&lt;name&gt;.jsonl</code>, records <code>s/e/l/lr</code>, rather than Diffusion Pipe's TensorBoard event contract.
- Fizgig supports EMA, precision/block-swap planning, frozen runtime training adapters and H3-specific <code>--family_option</code> values. The training adapter **is not included** in the exported LoRA.
- A frozen Fizgig **Context LoRA** is **not** equivalent to Diffusion Pipe's trainable "initialize from saved LoRA." "LoRA dropout" is not Fizgig's **caption dropout**. Fizgig H3 `shift` must not be assumed equivalent to Diffusion Pipe `image_shift` without a behavioral test.
- Recent Fizgig code supports changing LR on Resume via `training/resume_lr.py` (v8.8.3 release notes). Conversely, optimizer/architecture mismatch can cause a **weights-only continuation with fresh optimizer moments** rather than a complete stateful Resume.
- Fizgig upstream supports H3 photos/clips/audio and Krea2. WebCap's existing H3 profile captures images/video, not voice-only assets. Upstream support does **not** mean that complete WebCap workflow is integrated or verified.

References: [Fizgig CLI](https://github.com/shootthesound/Fizgig/blob/main/docs/CLI.md), [Fizgig H3 driver](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/minimax/driver.py), [Fizgig step log](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/training/step_log.py), [Fizgig state loader](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/families/train.py), [Fizgig Resume LR](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/training/resume_lr.py).

## 3. Capability manifest: exhaustive and enforceable

### 3.1 Representation

Add a small versioned, repo-shipped <code>tool/server/training_capabilities.json</code> and a validation/lookup helper (<code>tool/server/training_capabilities.py</code>). It is explicitly justified by two real trainers with divergent options; it is **not** an extensible plugin framework.

- One stable feature ID per **trainer-sensitive** Run Setup field, accepted backend setting or lifecycle/evaluation operation. Keep shared trainer-independent WebCap actions (e.g. queue reorder, run name) in one small inventory instead of duplicating them for every trainer/model. Canonical IDs live in a small Python validator; the frontend consumes the resolved capability payload.
- Trainer × model/stage lookup (with compact model overrides). Status: `native`, `translated`, `unavailable`, `unverified`; only the first two enable operations **after integration tests pass**. Declare type/range/allowed values, relevant defaults, and a concise reason for unsupported features. Don't confuse upstream support with delivered WebCap behavior.
- Distinguish **shared WebCap features** (run name, set selection, queue reorder, etc.) from **trainer-dependent features** and **model-dependent features**. Shared features remain in the coverage inventory even when they need no CLI argument.
- Publish the selected manifest subset through the existing Training setup/validation response or one lightweight route. The UI disables/hides unsupported features *with an accessible explanation*; do not introduce more persistent UI state.
- Backend validation checks trainer/model and **every submitted trainer-dependent value** both during preflight **and** queue admission. The frontend **omits** disabled/inapplicable controls from new-run requests instead of submitting hidden stale defaults. Explicit unsupported fields fail visibly rather than being silently dropped. Leave old DP Resume/Continue payloads intact.
- Store `trainerId`, capability schema/version, effective run settings, model/adapter identity and selected runtime with the captured action/job and persisted History/public views. Keep physical `outputRunPath` distinct from selected native resume-state path. Later Settings changes must not modify queued commands. Old jobs without `trainerId` continue as DP; no migration.
- Keep actual CLI arg ordering, TOML materialization, parsers and filesystem actions in Python. The manifest cannot specify arbitrary shell commands, code, extensions, or filesystem paths.

Illustrative shape only (Phase 1 must produce the full manifest):

~~~json
{
  "schemaVersion": 1,
  "trainers": {
    "diffusion_pipe": {
      "models": {"minimax_h3": "native", "krea2_raw": "native", "wan21_t2v_14b": "native", "wan22_t2v": "native"},
      "features": {
        "run.learning_rate": {"status": "native"},
        "run.lora_dropout": {"status": "native"},
        "run.ema": {"status": "unavailable", "reason": "Not exposed or verified in current WebCap Diffusion Pipe training"}
      }
    },
    "fizgig": {
      "models": {
        "minimax_h3": "native",
        "krea2_raw": "unverified",
        "wan21_t2v_14b": "unavailable",
        "wan22_t2v": "unavailable"
      },
      "features": {
        "run.learning_rate": {"status": "native"},
        "run.lora_dropout": {"status": "unavailable", "reason": "No verified equivalent to LoRA module dropout"},
        "run.caption_dropout": {"status": "native", "min": 0, "max": 1},
        "run.ema": {"status": "native", "min": 0, "max": 0.9999},
        "h3.focused_photo_blocks": {"status": "translated"},
        "lifecycle.finish": {"status": "unverified", "reason": "Must guarantee an export for the actual stopping epoch"}
      }
    }
  }
}
~~~

The implementation may use model overrides rather than repeat each feature per stage; keep the shipped format small and inspectable. Do not expose a declared "native" feature in WebCap until its execution and lifecycle tests pass. The sample above does not imply enabled MVP support for every Fizgig feature.

### 3.2 Exhaustive coverage without a generic framework

Inventory **every WebCap-offered Training feature**, not every possible upstream trainer flag: current Run Setup fields, presets, starting points, profile/stage and reviewed data options; every accepted `config_settings`, initializer, resume and runtime key in the validate/start route; queue/History/Continue operations; Candidate Analysis, Test staging, Screening/Campaigns, selected epoch, Archive and Delete. Record trainer-dependent entries with a feature ID, applicable model/stage, DP and Fizgig support status, implementation/validation owner and focused test. Record shared actions once.

Build a focused coverage test from the **audited code-owned map of training controls and backend request keys**; new controls/accepted fields require an explicit capability/handler entry and unsupported submissions fail visibly. Don't implement brittle scraping of every DOM node, gigantic per-model copies of shared actions, dynamic command-plugin systems, or a policy engine. Fizgig-only options not yet exposed by WebCap belong in an inert future-feature list.

The tables below are the **initial audit seed**, not an automatically complete or already-implemented matrix. Phase 0 must reconcile missing controls and actual backend fields before Phase 1 adds any selection UI.

### 3.3 Initial feature inventory — Run Setup and model options

Legend: **D** = currently available through WebCap+Diffusion Pipe; **F** = upstream Fizgig mechanism verified (WebCap integration still needed); **T** = requires semantic translation/behavior verification; **U** = unavailable, not equivalent, or not proven. **S** = WebCap-owned behavior to preserve unchanged. This is the mandatory audit seed; Phase 1 reconciles it mechanically against source code.

| Feature ID / current UI | Diffusion Pipe | Fizgig / required decision |
| --- | --- | --- |
| <code>model.profile</code> Wan2.2 HI/LO | D | U; no Fizgig Wan family in target integration |
| <code>model.profile</code> Wan2.1 | D | U |
| <code>model.profile</code> Krea2 | D | F upstream, **not enabled** until separately tested |
| <code>model.profile</code> MiniMax H3 | D | F; first implemented model |
| <code>run.name</code> | S | S |
| <code>run.preset</code> Custom / Character / Clothing | S | S, but per-trainer values must be valid; do not copy unsupported dropout |
| <code>run.learning_rate</code> | D | F, <code>--learning_rate</code> |
| <code>run.rank</code> (currently 16/32) | D | F, <code>--network_dim</code> and explicit alpha policy |
| <code>run.epochs</code> (currently 1–999) | D | F, <code>--max_train_epochs</code> |
| <code>run.lora_dropout</code> | D, LoRA adapter dropout | U; **caption dropout is not its replacement** |
| <code>h3.image_shift</code> | D, config <code>image_shift</code> | T; Fizgig <code>shift</code> selects a sigma density, equivalence unverified |
| <code>h3.focused_blocks</code> | D, module exclusions (20–49) | T; <code>photo_blocks=20-49</code> is an effective backward-cut window, not necessarily identical |
| <code>h3.method.cfg</code> | D, config <code>cfg=4</code> | U until proved; do not silently choose low-noise or another mode |
| `h3.method.ostris` | D, **premerged Ostris-v3 checkpoint** (not runtime merge) | T; Fizgig frozen runtime `--training_adapter` is not equivalent |
| <code>h3.method.image</code> | D, **premerged base checkpoint** | T; Fizgig runtime adapter and fused base are distinct variants; require explicit model choice |
| <code>h3.image_adapter_legacy</code> (currently hidden) | D legacy/capture behavior | U in UI; declare explicitly so hidden inputs cannot leak into Fizgig |
| <code>run.start.fresh</code> | D | F |
| <code>run.start.resume_managed</code> | D | F with **state-dir** validation and run lineage |
| <code>run.start.resume_custom</code> | D | F with validated state dir and exact trainer/model identity |
| <code>run.start.initializer</code> (saved/custom LoRA) | D | U until a **trainable initialization** equivalent is verified; frozen Context LoRA is different |
| <code>run.continue_history</code> | D | F after history integration; raise total epoch ceiling explicitly |
| `run.resume.lr_override` | D, `force_constant_lr` | **F** in current Fizgig source (`resume_lr.py`, v8.8.3+); test installed runtime and scheduler |
| <code>run.resume.rewind</code> / candidate revision | D, older <code>global_step</code> | T; older Fizgig state must branch output instead of overwriting existing exports/curve |
| <code>run.resume.adapter_inheritance</code> | D, checkpoint-locked selection | F principle; record and validate Fizgig frozen adapter/base/EMA settings too |
| <code>run.save_frequency</code> (from TOML) | D | F; native <code>--save_every_n_epochs</code> |
| <code>run.advanced_config</code> (raw TOMLs) | D | U as direct passthrough; show generated effective Fizgig config and explicit supported overrides only |
| <code>run.manual_command</code> | D | F after same capture/command builder is integrated |
| <code>run.diagnostics</code> | D | F after Fizgig-specific path/Python/model/cache probes |

### 3.4 Initial feature inventory — data, caching, parameters

| Feature ID | Diffusion Pipe | Fizgig / condition |
| --- | --- | --- |
| <code>data.visible_set_selection</code> and selected media | S | S, reuse exact reviewed capture |
| <code>data.caption_sidecars</code> and primer fallbacks | D | F, captured <code>.txt</code> beside media |
| <code>data.review_adjust_buckets</code> | D | T, validate mapping rather than discard bucket choices |
| <code>data.aspect_ratio_bucketing</code> | D | F with **different bucket computation**, verify effective shapes |
| <code>data.image_resolution</code> and upscaling policy | D | F, native area target / no-upscale settings |
| <code>data.repeats</code>, multiple reviewed subsets / role weights | D | T, translate exposure weights and number of steps; reject unsupported exact plans |
| <code>data.direct_custom_dataset_toml</code> | D | U as-is; DP syntax cannot be passed to Fizgig |
| <code>data.image_inputs</code> | D | F, H3 image MVP |
| <code>data.video_inputs</code> | D (model-dependent) | F upstream H3; out of image MVP until video cache + fps/frames tested |
| <code>data.audio_only_inputs</code> | Not offered by WebCap H3 profile | F upstream, separate capture/UI scope; not implicit support |
| <code>data.video_still_training</code> | H3 role-dependent | F via <code>clip_still</code>/<code>clip_still_as_photo</code>, requires explicit cache/config pair |
| <code>data.existing_capture_reuse</code> | D | T; cache reuse only with matching captured input/encoder identity |
| <code>cache.latents</code> | D, managed DP cache | F, explicit Fizgig stage 1 |
| <code>cache.text</code> | D, managed DP cache | F, explicit Fizgig stage 2 |
| <code>cache.invalidations</code> | D, DP cache rules | T, caption edits invalidate text; image edits invalidate both |
| <code>run.optimizer</code>, scheduler, precision (advanced config) | D via DP TOML | F via Fizgig CLI, but no parity presumed for every algorithm |
| <code>run.alpha</code>, accumulation, seed, gradient clipping (advanced) | D/config-specific | F upstream; compare allowed values and document defaults |
| <code>run.ema</code> | Not offered by WebCap DP | F, native <code>--ema_decay</code>; new explicit Fizgig option |
| <code>run.caption_dropout</code> | Not offered by WebCap DP | F, <code>--family_option caption_dropout=...</code>; requires unconditional text cache |
| <code>run.low_noise_mix</code> / high-noise LR | Not offered by WebCap DP | F, <code>lownoise_pct</code>/<code>highnoise_lr_pct</code> |
| <code>run.precision_auto</code> / block swap | DP-specific TOML/runtime | F, <code>--precision auto --blocks_to_swap -1</code> |
| <code>run.training_adapter_runtime</code> | DP merging, variant-dependent | F, **frozen** at explicit strength; not saved into LoRA |

### 3.5 Initial feature inventory — management, evidence, and downstream use

| Feature ID | Diffusion Pipe | Fizgig / condition |
| --- | --- | --- |
| <code>queue.enqueue</code>, FIFO, reorder, paused queue, restart reconciliation | S | S; one existing queue/GPU lane |
| <code>queue.cancel_unstarted</code> | S | S, never delete trainer output |
| <code>lifecycle.pause</code> | D, <code>save_quit</code>, current step | F, <code>.pause_requested</code>, epoch boundary; different latency |
| <code>lifecycle.resume_queue</code> | D | F after state verification; no automatic restart on boot |
| <code>lifecycle.finish</code> and scheduled Finish | D | T; must provide truthful last exported epoch and not claim a missing final LoRA |
| <code>runtime.process_recovery</code> (PID/result evidence) | D | S runner identity, F subprocess; verify completion vs pause exit |
| <code>runtime.progress</code> (phase, epoch/step, ETA, LR, loss) | D | F from log/JSONL; no fabricated checkpoint ETA |
| <code>runtime.log</code>, reveal log, Console errors | S | S |
| <code>history.list</code>, scope and actions | D | S once Fizgig evidence is normalized |
| <code>history.remove_record_only</code> | D | S, preserve all artifacts |
| <code>history.checkpoint_picker</code> | D, DeepSpeed | F, list available native **state** dirs only |
| <code>candidate.saved_epochs</code> | D, <code>epochN/</code> | F, flat numbered files; distinguish final alias and step snapshots |
| `candidate.loss_analysis` / stable regions | D, TensorBoard step+epoch streams with wall time | T; Fizgig JSONL lacks wall time. No invented timestamps; only compatible step/epoch evidence and available metrics |
| <code>candidate.select_epoch</code>, persist/reselect/clear | D | S using normalized exported artifact + existing manifest |
| <code>candidate.copy_one</code>, <code>candidate.copy_all</code>, remove | D | S after path-normalized discovery and sidecar provenance |
| <code>candidate.save_and_select</code> | D | S after export/path validation |
| <code>evaluation.prompt_tests</code>, ratings, model profiles | D for staged LoRAs | S; existing Test source can use ordinary Fizgig <code>.safetensors</code> |
| <code>evaluation.manual_screening</code> | D on managed saved epochs | T; must expose Fizgig managed checkpoints to source picker |
| <code>evaluation.campaigns</code> from runs or staged files | D | T direct-run source; staged-file mode remains valid |
| <code>evaluation.insights</code> / analytics | D | T, only display metrics supported by available evidence |
| <code>lifecycle.finalize_archive</code> / retained epochs | D with DP layout | T, direct Fizgig exports/state/logs need their own exact retention policy |
| <code>lifecycle.delete_run</code>, provenance-scoped Test cleanup | D | T, protect unrelated files and active/queued references |
| <code>model.exported_lora</code> | D | F, standard <code>.safetensors</code>; verify H3 ComfyUI load once |
| <code>model.resumable_state</code> | D | F, **not** the same file as exported LoRA |
| <code>model.frozen_adapter_lineage</code> | DP merged/premerged source | F; store frozen-runtime adapter identity and strength in provenance |

### 3.6 Future Fizgig capabilities: inventory without premature UI

Record as **upstream present, WebCap not yet integrated** (with per-family qualifiers) rather than presenting them as usable: LoKR, adaptive LR, EMA presets, extra scheduler/optimizer choices, per-image loss/LR, masked training, differential output preservation (DOP), full-model fine-tuning, reference distillation, video TREAD, audio-weight controls, clip stills, custom train-block spans, preview sampling/speed LoRA, helpers, on-demand Save/Sample, and richer precision/planner tuning. Do not add knobs just because Fizgig has flags. Prioritize only options with a concrete WebCap workflow and tested effect. No silent mapping of DP options into superficially similar Fizgig options.

## 4. Normalized interfaces and filesystem

### 4.1 Narrow dispatch, not a general plugin system

Add a small, explicit trainer dispatch helper (proposed <code>tool/server/training_backends.py</code>) and a Fizgig-specific implementation (<code>tool/server/training_fizgig.py</code>). Keep Diffusion Pipe's current implementations in place; when a seam is needed, the Diffusion Pipe branch calls the existing function. Do not relocate large working sections just for symmetry.

Trainer-specific operations actually required:

- <code>validate_and_capture(job, reviewed_capture)</code>: verify supported selected settings, produce native captured config and immutable launch parameters.
- <code>command_phases(job)</code>: return ordered cache/train commands with clear phase labels for the existing runner wrapper.
- <code>read_progress(job)</code>: normalize authoritative trainer progress and failure evidence.
- <code>discover_artifacts(job_or_run)</code>: direct, bounded discovery of exported LoRAs **and** resume states.
- <code>request_pause_or_finish(job)</code>, <code>validate_resume(job, state)</code>: implement native actions without changing shared queue ownership.
- <code>read_loss_evidence(run)</code>: feed Candidate Analysis normalized step/epoch series, or explicitly report evidence not available.

These may be plain functions and explicit dispatch; do not introduce abstract base classes, dynamic loaders, dependency injection or generic lifecycle registries.

### 4.2 Captured run identity and independent path roles

Reuse `training_action.allocate_action` and its existing `captures/`, `jobs/`, `output/` ownership. `training_bundle.materialize_training_bundle` already creates one captured media/caption snapshot, inspected DP TOMLs and review plan. Keep them unchanged; never repurpose the Set's editable `config.h3.toml` as a Fizgig config.

For Fizgig image-only MVP, add only a **generated** `fizgig_dataset.toml` beside existing captured artifacts and a capture-local derived cache directory. Record effective command settings, trainer/version and base/adapter identity in existing action/job and capture summary structures; avoid an unnecessary second `fizgig_run.json` state copy.

~~~text
<logical-training-action>/
  captures/<capture-id>/
    media/...                    # immutable copied items and .txt captions
    config.h3.toml, dataset.h3.toml, summary.json, ...
    fizgig_dataset.toml          # native dataset generated for this captured run
    fizgig_cache/                # cache of this one capture (derived)
  jobs/<job-id>/
    runner.sh, pid, run.log, result.json, action ...
  output/<native-run>/
    <name>-000065.safetensors    # tested/exported LoRA
    <name>-000065-state/         # optimizer/EMA/RNG state for Resume
    <name>.safetensors           # final alias, not a separate epoch
    .fizgig_loss_<name>.jsonl
~~~

**Distinct identities:** `actionPath` owns the logical experiment; `outputRunPath` names the physical trainer output directory used for History, Test provenance, Archive and Delete; the native `resumeStatePath` (proposed explicit job field) names the `-state/` directory passed to Fizgig `--resume`. DP retains its current `resumeFromCheckpoint` = output-run-directory behavior. This separation is mandatory at `_new_job`, job serialization and every consumer; **never treat a nested state directory as the trainer run**.

Action-owned cache is the simplest first implementation. Check actual WSL versus mounted-Windows IO performance on the training machine before changing placement. A different cache root is future work only with explicit ownership and cleanup—not a new background cache service or globally indexed reuse system.

### 4.3 One normalized checkpoint record

Represent outputs on the WebCap side using an on-demand, read-only shape; do **not** materialize an additional durable index:

~~~json
{
  "trainerId": "fizgig",
  "runPath": "/absolute/owned/run/output/path",
  "epoch": 65,
  "step": 1885,
  "export": {"path": "/.../name-000065.safetensors", "available": true},
  "resume": {"path": "/.../name-000065-state", "available": true},
  "source": {"base": "recorded", "adapter": "recorded"},
  "selected": false
}
~~~

**Export and Resume availability are independent.** A valid <code>.safetensors</code> is testable even if its optimizer state was pruned; a saved state may resume even if no matching LoRA was exported at that epoch. The final unnumbered Fizgig export is a named alias of the completed epoch, **not an extra candidate**. Ignore transient <code>-stepNNN.safetensors</code> as epoch checkpoints unless explicitly exposed as a separate manual export type.

Resolve from the selected run's recorded directory, never broad-scan the models filesystem or infer a different set's output. Keep existing <code>webcap-run.json</code> selected-epoch ownership, Test sidecars, and candidate revision semantics; adapt source-path resolution, not duplicate them.

## 5. Correctness-sensitive semantics

### 5.1 Dataset and caching

1. Capture selected Set media and latest caption sidecars **once** through the current `training_bundle.py` path, including reviewed groups and fallbacks. Translate only from the captured media, not a second mutable Set scan. Verify input names, count and caption contents against the capture in tests.
2. Translate the selected *captured* image stanzas to Fizgig `[general]`/`[[datasets]]` with dedicated cache paths. DP Review can express fixed bucket shapes, multiple image buckets, direct/custom TOML stanzas and weighted repeats; Fizgig buckets by target area with different semantics. Test input membership and effective exposures. Show actual bucket differences; warn where visually/materially relevant. Refuse a **specific launch** only if required files or essential weighting cannot be represented; do not silently train a different selected input set.
3. Run **latent cache → text cache → train** as phases of one user-triggered queued job, with visible phase/progress/failures. No automatic scan/cache on opening the workspace. Derived cache belongs to its captured action, not to a second copy of the Set.
4. History Continue/Resume reuses its recorded original capture and valid cache. Verify how the installed Fizgig version rebuilds missing cache. Do not add cross-run cache-sharing, fingerprint indexes or a second capture snapshot in the MVP.
5. First enable **H3 still images**. Selected unsupported video/audio is a visible configuration issue, not silently omitted. Add video/voice only after separately verifying capture, frames/FPS, audio VAE, optional clip stills, temporal roles and inference compatibility.

### 5.2 Variant and parameter semantics

- **Do not merge training methods by label.** DP's `cfg=4`, **premerged Ostris-v3 checkpoint**, premerged Image checkpoint, and Fizgig's frozen runtime adapter are distinct implementations. Represent explicit available variants/choices under the selected trainer.
- The initial Fizgig default is the normal configured base with **runtime adapter off** unless selected. Captured metadata must show base/adapter paths, adapter type and strength. A Resume inherits those exact values and rejects conflicts.
- Fizgig <code>caption_dropout</code> is separate from WebCap <code>adapterDropout</code>. Disable the latter for Fizgig until a genuine LoRA dropout implementation is proven; provide a clearly labeled native caption-dropout control if desired.
- Require behavioral checks before mapping H3 image shift/noise distribution, DP CFG training, LoRA initialization, or forced resume LR. If no equivalent exists, show a concise unsupported explanation rather than a fake mapping.
- Do not silently apply current DP Character/Clothing preset's unsupported fields to Fizgig. Define tested trainer-specific preset values or keep Custom as the initial supported mode.
- Persist every effective optimizer/training flag in the captured run summary. Show meaningful parameters in History without mislabeling EMA as dropout or runtime frozen adapters as fused checkpoints.

### 5.3 Pause, Finish, Resume and recovery

The common API describes **outcomes**, not identical command switches.

| Operation | Diffusion Pipe (unchanged) | Fizgig implementation |
| --- | --- | --- |
| Pause | `save_quit` and verified DeepSpeed `latest`; current-step timing | Touch `.pause_requested` inside the **known physical output run**; await epoch-boundary save of `name-NNNNNN-state/`; verify state, then keep queue paused |
| Resume | `--resume_from_checkpoint <physical-run>` (optionally saved `global_step`) | `--resume <native-state-dir>`; use separately recorded physical `outputRunPath` and original model/capture settings |
| Finish | Current DP save-then-advance queue | Request native stop after current epoch, verify resumable state, advance queue and report **latest actually exported LoRA epoch** independently of stop epoch |
| Continue History | Transfer captured ownership and allow total-epoch extension | Reuse captured Fizgig input, matching state, and explicitly extend `--max_train_epochs` if necessary |
| Rewind | Existing DP candidate revision in same run directory | Isolate Fizgig output **branch/revision** when resuming an older state; preserve original exports and JSONL |
| Queued cancel | Forget queued intent, leave output | Same shared WebCap behavior |

**Important semantic difference:** Fizgig may save a **resumable state at epoch E** on Pause/Finish without exporting an epoch-E `.safetensors` when its export cadence skips E. Don't claim an unsaved candidate or label the older exported epoch as E. A truthful Finish can stop/advance while clearly showing: `Finished at epoch E · Latest exported LoRA epoch L`. A guarantee to export at E would be a separate capability requiring a proven native mechanism, not a reason to block basic Finish.

**Resume fidelity:** Fizgig states contain `training_state.json`, `lora.safetensors`, `optimizer.pt`, and optionally `ema.pt`/`rng.pt`. Its loader can silently use **fresh optimizer moments** if optimization type/architecture is incompatible. For WebCap's **full-state Resume**, verify trainer/architecture, base and adapter identity, rank, LoRA type, optimizer, EMA and captured dataset before starting; show a deliberate weights-only continuation as a **different action**, never a hidden fallback. Current upstream supports LR adjustment through `resume_lr.py`; test the installed version/scheduler behavior and record the effective LR.

**Runner proof and restart:** Existing exact PID/script/result evidence owns the managed runtime and shared GPU lane. Fizgig's requested Pause can exit **code 0**; use the recorded action and newly verified state to distinguish requested Pause/Finish from natural completion. Preserve action intent before process exit. Don't use a zero exit code alone as a completed-run signal. On WebCap restart reconcile only positively verified live processes; never auto-unpause or hold GPU indefinitely on uncertain evidence.

**Path and revision plumbing:** Explicitly update `_new_job`, `_launch_job`, History discovery and Continue, checkpointed-stop, Candidate provenance and Archive/Delete to distinguish `actionPath`, `outputRunPath` and `resumeStatePath`. DP's `_rewrite_resume_latest` mutates its `latest` marker and is **not applicable to Fizgig**. Fizgig rewrites its own loss JSONL on Resume, so older-state rewind must use a distinct output branch rather than altering original candidate evidence.

### 5.4 Analysis and generated artifacts

- Convert Fizgig JSONL <code>s/e/l/lr</code> into the existing normalized step-loss and completed-epoch analysis inputs; test epoch boundaries, moving averages, partial/truncated records, Resume branch filtering, and missing metrics. Keep DP TensorBoard decoding untouched.
- Fizgig's step-loss JSONL has **no wall-time field**. Use only trustworthy job/log timestamps when available; omit time-to-selected and timestamp-dependent metrics rather than inventing them.
- Discover Fizgig numbered LoRAs with a bounded filename parser inside the recorded run; resolve their source for current Training Candidate double-click, Copy to Test, Save/Select, model profiles, Campaigns and Manual Screening. The general Test-folder mechanism already accepts directly staged <code>.safetensors</code>, but managed-run analysis currently does not.
- Preserve the one-Set Test root, source provenance sidecars and names such as <code>&lt;run&gt;__epoch65.safetensors</code>. It must be possible to select/test a Fizgig checkpoint without manual copying.
- **Archive:** retain exact selected/explicit extra exported LoRAs, associated chosen lineage/evidence, and required metadata; never use DP <code>epochN/</code> and <code>global_stepN/</code> pruning assumptions on Fizgig. Preview exact deletions before proceeding.
- **Delete Run / Remove from History:** keep the distinction. Remove-from-History is metadata-only; Delete targets only the exact owned action/output and provenance-verified optional staged copies. Running/queued references protect active work; historical references do not invent new locks.

## 6. Implementation phases and safety gates

Each phase is a self-contained, reviewable change with focused tests. Keep Diffusion Pipe runnable throughout. Do not combine architecture, UI redesign, and runtime behavior in one large PR.

### Phase 0 — Audit, support proof and frozen Diffusion Pipe baseline (no runtime change)

**Tasks**

- Enumerate all Training Run Setup DOM controls and operations (<code>training_review.js</code>, <code>training_runner_ui.js</code>, <code>training_history_ui.js</code>, <code>training_candidates.js</code>, <code>tool.html</code>), accepted backend keys, captured TOML options, model stages, Test/Campaign/Archive actions.
- Reconcile Sections 3.3–3.5 against current source and explicitly add any missing feature IDs. For each combination record current WebCap support, native trainer support, semantics and whether MVP integration has been verified.
- Snapshot the effective Diffusion Pipe behavior: launch and manual commands, config rewrite, H3 method selection and focused blocks, cache, Queue/Resume/Finish, progress, output layout, candidate analyzer, Test provenance and archive/delete.
- Probe Fizgig CLI and representative states/logs on the **training machine** (the development machine is not authoritative for live training). Especially verify save/finish export, resume path and preserved model settings, LoRA loading in H3 inference, and H3 image dataset translation.
- Declare the exact Phase 3 Fizgig photo feature subset; show gaps as unavailable rather than promising untested parity.

**Gate:** source-backed complete inventory; baseline tests passing unchanged; representative sample Fizgig file layout and loss JSONL recorded as test fixtures. No launcher modification until this gate passes.

### Phase 1 — Capability declaration and UI contract (behavior-preserving)

**Touch:** new <code>training_capabilities.json</code> + small validator, <code>app.py</code> response/route, <code>app_settings.js</code>, <code>training_review.js</code>, <code>tool.html</code>, focused tests.

**Tasks**

- Introduce versioned trainer/model/feature matrix, validate full coverage and native option constraints, and return the chosen capability subset with Run Setup state.
- Add Fizgig installation path, Python executable/venv path and optional explicit missing model paths in **Settings**; default trainer stored there; narrow per-run trainer selector in Run Setup, H3 only initially.
- Keep control hierarchy calm. Make unsupported controls disabled with short reason, not giant explanatory panels. Choosing a trainer refreshes only dependent fields and does not overwrite unrelated drafts.
- Ensure backend rejects any unsupported option even if submitted directly. Existing runs with no <code>trainerId</code> continue as Diffusion Pipe without migration.

**Gate:** DOM/control-to-manifest and request-validation coverage tests pass; all existing DP controls and defaults unchanged; no Fizgig button queues work yet.

### Phase 2 — Capture, native configuration and command generation

**Touch:** <code>training_bundle.py</code>, <code>training_config_files.py</code> only at necessary shared seams, <code>training_runtime.py</code>, <code>training_preflight.py</code>, a small trainer dispatch helper, new <code>training_fizgig.py</code>, <code>training_runner.py</code> launch seam.

**Tasks**

- Add a Fizgig H3 **image-only** capture translator from the existing reviewed bundle, generate native dataset TOML and resolved run JSON inside the action; do not mutate the persistent Set config.
- Build explicit cache-latents, cache-text and training argv using the configured Fizgig Python; map only verified controls. Ensure model files/adapter state are declared and paths are correctly quoted/converted for WSL. No raw user-supplied shell fragment.
- Preserve existing queue admission, GPU ownership, frozen captures, manual command, status and log ownership. Capture trainer and effective parameters before the external process starts.
- Verify that parameter changes do not accidentally trigger DP config rewrites in Fizgig mode, and that existing DP command snapshots remain byte-equivalent where practical.
- Provide Fizgig-specific diagnostics; do not require DeepSpeed/<code>train.py</code> for Fizgig, and do not require Fizgig for DP.

**Gate:** dry-run exact generated CLI equals a manually proven reference on the training machine; dataset item/caption/weight counts checked; DP tests green; one explicitly user-launched small Fizgig training succeeds.

### Phase 3 — Progress, pause, resume and history

**Touch:** <code>training_progress.py</code>, <code>training_runner.py</code>, <code>training_history.py</code>, <code>training_runtime.py</code>, History/queue UI only for exposed status.

**Tasks**

- Show actual phases (cache latents, cache text, train), epochs/steps/loss/LR, elapsed and anchored ETA via Fizgig log/JSONL. Cache stages can be indeterminate where no reliable count exists.
- Discover native resume-state directories directly, distinguish them from LoRA exports; surface state availability in History/picker.
- Implement epoch-boundary Pause with <code>.pause_requested</code>, confirm state creation, preserve queue pause. Respect code-0 requested exits and runtime PID proof on restart.
- Implement Resume/Continue and epoch extension from recorded native state. Test state pruning and model/adapter inheritance. Treat an older-state resume as an isolated output branch.
- Validate a true final-export guarantee before enabling Fizgig Finish and scheduled Finish. Do not claim equivalence from a graceful exit alone.

**Gate:** real Pause → restarted WebCap → explicit Resume → completed training passes without lost optimizer state, changed adapter flags, orphan GPU reservation or overwritten outputs; DP Pause/Finish/Resume/Continue tests stay green.

### Phase 4 — First-class saved epochs and Evaluation

**Touch:** <code>training_candidates.py</code>, <code>training_runner.py</code> candidate path functions, <code>training_run_manifest.py</code> if required (prefer no schema change), <code>epoch_finder.py</code>, <code>epoch_test_bench.py</code>, candidate UI only for source/status.

**Tasks**

- Normalize Fizgig numbered exports, final alias, distinct resume states, loss series and epoch selection into the current candidate shape. Keep existing DP TensorBoard and <code>epochN/</code> path.
- Make Copy One/All, double-click Test staging, Save/Select, stable-region analysis and a durable Selected Epoch work with recorded Fizgig run identity.
- Expose Fizgig managed saved exports in Manual Screening and Campaigns without making users copy files manually; existing staged-file source remains valid.
- Preserve Test session provenance, per-LoRA ratings, comparison source, model profile metadata and revision-safe filenames.

**Gate:** same generated prompt/seed test works for 2+ Fizgig epochs with distinct candidate provenance; removal of one staged candidate leaves others untouched; DP candidate/Screening/Campaign tests pass.

### Phase 5 — Archive/delete and broader parity

**Touch:** <code>training_archive.py</code>, <code>training_run_delete.py</code>, archive metrics and exact affected UI.

**Tasks**

- Extend retention and permanent deletion by normalized artifact kind and recorded run ownership; show precise preview; never apply DP glob rules to Fizgig flat exports and <code>-state/</code> directories.
- Ensure Remove from History remains metadata-only; queued/running work and distinct histories are preserved. Archive preserves selected LoRA and enough derived evidence for the current Insights surface, or plainly marks unsupported metrics.
- Separately validate H3 videos, sound/voice only when WebCap captures those media, reviewed repeats, clip-still/audiovae cache, and compatible inference. Then enable declared features one at a time. Treat Fizgig Krea2 as a separate later model adapter test, not part of the initial H3 delivery.
- Consider native optional EMA, caption dropout, low-noise mix, optimizer and precision controls in small later PRs; keep exact manifest statuses up to date.

**Gate:** complete end-to-end H3 photo workflow and intact DP archive/delete regression suite; no data loss in forced-error/retry tests; explicit user-confirmed live acceptance.

## 7. Required regression and acceptance coverage

Use existing focused tests as baseline, including:

- <code>tests/test_training_commands.py</code>, <code>test_training_runtime.py</code>, <code>test_training_preflight.py</code>, <code>test_training_profiles.py</code>, <code>test_h3_training_method.py</code>, <code>test_training_review_contract.py</code>, <code>test_training_review_ui_contract.py</code>.
- <code>tests/test_training_stabilization.py</code>, <code>test_training_progress.py</code>, <code>test_training_resume_discovery.py</code>, <code>test_training_continue_epoch_extension.py</code>, <code>test_training_history_unlink.py</code>, <code>test_training_history_ui_contract.py</code>.
- <code>tests/test_training_candidates.py</code>, <code>test_training_candidates_ui_contract.py</code>, <code>test_epoch_finder.py</code>, <code>test_epoch_finder_multirun.py</code>, <code>test_epoch_test_bench.py</code>, <code>test_training_archive_metrics.py</code>, <code>test_training_run_delete.py</code>, <code>test_gpu_prep.py</code>.

Add focused tests, e.g. <code>test_training_capabilities.py</code>, <code>test_training_fizgig_command.py</code>, <code>test_training_fizgig_cache.py</code>, <code>test_training_fizgig_progress.py</code>, <code>test_training_fizgig_resume.py</code>, <code>test_training_fizgig_candidates.py</code>, <code>test_training_fizgig_cleanup.py</code> and one frontend capability/control coverage test. Prefer injected fake process and temporary action roots over actual GPU in CI.

**Minimum acceptance matrix:**

1. Diffusion Pipe: unchanged commands/configs, H3 CFG/Ostris/image variants, focus toggle, manual command, new/resume/rewind, paused/continued queue, finish, History, Analysis, Copy to Test, Archive and Delete.
2. Capability coverage: every offered control/operation declared for each enabled trainer/model, checked in both frontend and backend; unsupported setting never executes or silently disappears.
3. Fizgig: image capture count and caption hashes equal selected Set, native buckets/repeats documented, cache output unambiguous, valid model/adapter paths, no implicit adapter.
4. Fizgig: cache/train phases and real progress, cold/restart recovery, user-invoked Pause with exact state, Resume preserving state/config, finish/complete evidence, no duplicate run artifacts.
5. Fizgig: select epochs 40/50/55/60/65/70 when present, compare in Test/Screening/Campaigns, durable human selection, archive retained exports and history-only removal, safe exact Delete.
6. Cross-trainer: two queued jobs of different trainers honor the existing single Training lane/FIFO and global GPU coordination; no extra reservation mechanism; changing Settings after enqueue does not retroactively change job behavior.
7. Fault injection: missing executable/model, failed cache stage, corrupt or pruned state, malformed loss line, missing export, disk-full save, blocked archive path and lost runner PID all surface useful errors and leave unrelated work usable.

Run focused tests at each phase, then the relevant full suite and the repository's existing CI checks. Audit diffs against <code>AGENTS.md</code> and the authoritative current runtime contracts before merge. On the actual training machine, deliberately verify one short end-to-end run; **do not use development-machine configuration or stale historical output as proof of live training state**.

## 8. Concrete proof points / stop conditions

These are the only issues that should interrupt implementation for a product decision; ordinary differences should be resolved by the explicit capability mapping.

1. **Finish parity:** Does current Fizgig reliably export a testable LoRA at the epoch where user requests Finish, even outside the save cadence? Current source indicates Pause may only write state. If not, decide between a narrow tested upstream enhancement and temporarily disabling Fizgig Finish with an explicit explanation.
2. **LoRA initialization parity:** Verify whether Fizgig can initialize *trainable weights* from an existing H3 LoRA. A frozen Context LoRA must not masquerade as "Fine-tune from saved LoRA."
3. **DP image-shift / CFG equivalence:** Verify with actual trainer code/test, not matching names. If no equivalent, explicitly unavailable in Fizgig mode.
4. **Video/repeats parity:** If a reviewed Set requests data weighting or temporal buckets Fizgig cannot faithfully express, stop that **specific launch** with a useful supported-options explanation. Do not silently train a different dataset.
5. **Historical/state branches:** If Fizgig Resume from an older state cannot be safely directed into an isolated output branch, postpone older-point rewind; never overwrite an existing evaluation candidate.

Everything else should proceed in the smallest reviewable phase with unsupported capabilities declared as such.

## 9. Definition of done

- Training configuration is **model-aware and trainer-aware**; one declared, tested capability source controls UI and backend validation, without duplicating unsupported lists.
- H3 images can be trained on Fizgig **entirely from WebCap**, including captured Set input, caching, progress, manual command, pause/resume, history, saved epoch discovery and Evaluation, with clear honest support for Finish.
- Existing Diffusion Pipe runs, queued intent, checkpoint resumes, model variants, Test copies and history/archiving behave exactly as before. The selected trainer is stored with every new job and never guessed from a filename.
- Both trainers produce the **same WebCap-visible concepts** (run, progress, exported LoRA, resumable state, selected epoch) while preserving any real timing, optimization and file-format differences.
- All supported feature rows have tests; all unsupported or unverified rows are visible and do not silently execute. No new queues, hidden state, automatic scan/cache jobs, generic framework or broad filesystem migrations.

**Next implementation action:** Phase 0 inventory and regression fixtures, followed by Phase 1 manifest/UI binding. Do not jump straight to replacing <code>training_commands.py</code> with a giant trainer switch.
