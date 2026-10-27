# Multi-trainer Training — implementation detail plan

**Status:** Proposed; planning only, no runtime changes made.
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

Current Diffusion Pipe behavior is not just a different CLI: **checkpoint save** writes <code>save_quit</code>, **resumable state** is a DeepSpeed directory referenced by <code>latest</code>, **exported LoRAs** live under <code>epochN/</code>, **loss** comes from TensorBoard, and **Resume** may write into the existing physical trainer-run directory. Those assumptions occur across runner, history, candidate analysis, archive and tests. Keep them intact behind the Diffusion Pipe case.

Verified upstream Fizgig H3 behavior:

- Three-step launch: cache VAE latents, cache text embeddings, then train; its dataset TOML uses <code>[general]</code> + <code>[[datasets]]</code> and explicit cache directories.
- <code>--family minimax</code>, <code>--dit</code>, <code>--vae</code>, <code>--text_encoder</code>, <code>--network_dim</code>, <code>--network_alpha</code>, <code>--learning_rate</code>, <code>--max_train_epochs</code>, and <code>--save_every_n_epochs</code> are CLI parameters.
- Numbered LoRA exports are <code>&lt;name&gt;-000065.safetensors</code>; the final export is <code>&lt;name&gt;.safetensors</code>. Resumable optimizer/state directories are distinct: <code>&lt;name&gt;-000065-state/</code>. Native Resume is <code>--resume &lt;state-dir&gt;</code>, with otherwise compatible original arguments.
- <code>.pause_requested</code> asks for an epoch-boundary save-and-exit. <code>.save_now</code> and <code>.sample_now</code> request on-demand actions. Step loss is <code>.fizgig_loss_&lt;name&gt;.jsonl</code>, records <code>s/e/l/lr</code>, rather than Diffusion Pipe's TensorBoard event contract.
- Fizgig supports EMA, precision/block-swap planning, frozen runtime training adapters and H3-specific <code>--family_option</code> values. The training adapter **is not included** in the exported LoRA.
- A frozen Fizgig **Context LoRA** is not automatically equivalent to Diffusion Pipe's trainable "initialize from saved LoRA." "LoRA dropout" is not the same feature as Fizgig's **caption dropout**. Fizgig H3 <code>shift</code> must not be assumed equivalent to Diffusion Pipe <code>image_shift</code> without a behavioral test.
- Fizgig upstream supports H3 photos/clips/audio and Krea2. WebCap's existing H3 profile captures images/video, not voice-only assets. Upstream support does **not** mean that complete WebCap workflow is integrated or verified.

References: [Fizgig CLI](https://github.com/shootthesound/Fizgig/blob/main/docs/CLI.md), [Fizgig H3 driver](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/minimax/driver.py), [Fizgig step log](https://github.com/shootthesound/Fizgig/blob/main/src/fizgig/training/step_log.py).

## 3. Capability manifest: exhaustive and enforceable

### 3.1 Representation

Add a small versioned, repo-shipped <code>tool/server/training_capabilities.json</code> and a validation/lookup helper (<code>tool/server/training_capabilities.py</code>). It is explicitly justified by two real trainers with divergent options; it is **not** an extensible plugin framework.

- One stable feature ID per user-visible Training option or operation; also declare essential implicit backend features (caching, output discovery, progress, lifecycle). Enumerate the capability IDs once in the validator, not in independent frontend/backend copies.
- **Trainer × model/stage** lookup, not just trainer-wide booleans. Support status: <code>native</code>, <code>translated</code>, <code>unavailable</code>, or <code>unverified</code>. Only the first two enable operations. A supported feature declares allowed type/range/values and, if different, its user-facing label/help text. <code>unavailable</code>/<code>unverified</code> include a short reason.
- Distinguish **shared WebCap features** (run name, set selection, queue reorder, etc.) from **trainer-dependent features** and **model-dependent features**. Shared features remain in the coverage inventory even when they need no CLI argument.
- Publish the selected manifest subset through the existing Training setup/validation response or one lightweight route. The UI disables/hides unsupported features *with an accessible explanation*; do not introduce more persistent UI state.
- The backend validates selected feature IDs, values, model, and trainer against the **same manifest** when queuing. An unknown capability or unsupported non-default selection is a visible error. Never silently drop or reinterpret a requested option.
- Store the selected <code>trainerId</code>, manifest schema/version, resolved effective settings, training variant and executable/model path identities with the **captured run/job**. Later Settings changes must not silently change a queued job's command. An absent trainer field in pre-existing jobs means the existing Diffusion Pipe implementation; no migration or alternate run discovery is needed.
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

### 3.2 Coverage rules (non-negotiable)

A coverage test must enumerate **every**: (a) current Run Setup input/preset/starting-point action, (b) Training model/stage/selection/review/advanced-config operation, (c) queue and history action, (d) saved-artifact and Evaluation/Archive/Delete operation, and (e) backend per-run setting accepted at <code>start_response</code>. It checks that every trainer/model has an explicit status for each relevant ID. New controls without a manifest entry fail CI. New manifest features without a validator/renderer/implementation mapping also fail CI.

Do not confuse this with documenting every Fizgig CLI flag in the WebCap UI. Fizgig-only options not yet offered belong in a **separately documented future-feature inventory**, and do not become silently configurable via raw command strings. The exhaustive promise applies to **the entire WebCap-offered feature surface**, not unsupported hypothetical trainers.

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
| <code>h3.method.ostris</code> | D, model merge adapter | T; Fizgig frozen <code>--training_adapter</code> has different placement/semantics |
| <code>h3.method.image</code> | D, **premerged base checkpoint** | T; Fizgig runtime adapter and fused base are distinct variants; require explicit model choice |
| <code>h3.image_adapter_legacy</code> (currently hidden) | D legacy/capture behavior | U in UI; declare explicitly so hidden inputs cannot leak into Fizgig |
| <code>run.start.fresh</code> | D | F |
| <code>run.start.resume_managed</code> | D | F with **state-dir** validation and run lineage |
| <code>run.start.resume_custom</code> | D | F with validated state dir and exact trainer/model identity |
| <code>run.start.initializer</code> (saved/custom LoRA) | D | U until a **trainable initialization** equivalent is verified; frozen Context LoRA is different |
| <code>run.continue_history</code> | D | F after history integration; raise total epoch ceiling explicitly |
| <code>run.resume.lr_override</code> | D, <code>force_constant_lr</code> | T; optimizer/scheduler restoration and LR override must be tested |
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
| <code>candidate.loss_analysis</code> / stable regions | D, TensorBoard step + epoch streams | T, aggregate Fizgig JSONL into equivalent normalized evidence |
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

### 4.2 Captured run identity

Stay under the current logical run's <code>captures/</code>, <code>jobs/</code> and <code>output/</code> ownership. Do not create a new global <code>.webcap*</code> root or persist a parallel checkpoint database.

For Fizgig's image-only MVP, write into the captured action:

~~~text
captures/<capture-id>/
  media/                        # Existing WebCap snapshot; captions next to images
  dataset.h3.toml               # Existing DP/Set capture left unchanged
  config.h3.toml                # Existing DP/Set capture left unchanged
  fizgig_dataset.toml           # Generated, native Fizgig dataset + cache paths
  fizgig_run.json               # Human-inspectable resolved CLI settings/model identities
  summary.json, ...             # Existing manifest/review evidence
  fizgig_cache/                 # Capture-local latents/text cache
jobs/<job-id>/
  runner.sh, pid, run.log, result.json, action ...
output/
  <fizgig-run-identity>/
    <name>-000005.safetensors
    <name>-000005-state/
    <name>.safetensors
    .fizgig_loss_<name>.jsonl
    ...
~~~

Exact subdirectory naming may use the existing logical run's output slug; capture and output identity must be unambiguous, especially across Resume and older-state branches. Do not create or modify the source Set's new trainer TOMLs implicitly. Existing editable <code>config.h3.toml</code> remains Diffusion Pipe-specific; a Fizgig run shows its generated effective settings rather than claiming that editing unsupported DP TOML keys changes Fizgig training.

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

1. Capture media/captions once through <code>training_bundle.py</code>, then **translate from captured review evidence**, not from a second read of mutable Set media. Preserve selected items, caption text, distinct reviewed groups, effective repeat weights and supported buckets.
2. For Fizgig construct native <code>[general]</code>/<code>[[datasets]]</code> using exact captured directories and dedicated capture cache paths. Validate image count and exposure/repeat intent against the WebCap review summary. For unsupported DP-only TOML constructs or bucket semantics, show the discrepancy before queueing; do not silently discard them.
3. Cache latents, then text, then train as one **user-initiated** queued job with visible phases. Reuse only caches proven valid against captured image/caption fingerprints and model/encoder/transform settings. If text changes, refresh text cache; if images or encoding inputs change, refresh the appropriate caches. Do not launch background cache work merely because the Training workspace opens.
4. Explicitly differentiate photo, clip and voice cache needs. Start with H3 photos, then separately validate temporal buckets, frame rate, optional audio VAE and clip-still settings before marking video/audio supported.
5. Use only known model files and paths from configured model root/explicit Fizgig settings. Verify actual files at launch. Never switch automatically from INT8 to a different base variant or re-enable a frozen training adapter because it happened to be used in an earlier manual run.

### 5.2 Variant and parameter semantics

- **Do not merge training methods by label.** DP's <code>cfg=4</code>, DP's merged Ostris adapter, DP's premerged image checkpoint, and Fizgig's frozen runtime adapter are distinct implementations. Represent them as explicit available variants/choices under the selected trainer.
- The initial Fizgig default is the normal configured base with **runtime adapter off** unless selected. Captured metadata must show base/adapter paths, adapter type and strength. A Resume inherits those exact values and rejects conflicts.
- Fizgig <code>caption_dropout</code> is separate from WebCap <code>adapterDropout</code>. Disable the latter for Fizgig until a genuine LoRA dropout implementation is proven; provide a clearly labeled native caption-dropout control if desired.
- Require behavioral checks before mapping H3 image shift/noise distribution, DP CFG training, LoRA initialization, or forced resume LR. If no equivalent exists, show a concise unsupported explanation rather than a fake mapping.
- Do not silently apply current DP Character/Clothing preset's unsupported fields to Fizgig. Define tested trainer-specific preset values or keep Custom as the initial supported mode.
- Persist every effective optimizer/training flag in the captured run summary. Show meaningful parameters in History without mislabeling EMA as dropout or runtime frozen adapters as fused checkpoints.

### 5.3 Pause, Finish, Resume, and recovery

**Semantics are user-facing outcomes, not command name parity.**

| Operation | Diffusion Pipe (unchanged) | Fizgig target |
| --- | --- | --- |
| Pause | Existing <code>save_quit</code> and validated <code>latest</code> checkpoint | Write <code>.pause_requested</code>, await epoch boundary and newly verified state directory, then hold queue |
| Resume | <code>--resume_from_checkpoint</code> from DeepSpeed run with compatible config | <code>--resume &lt;state-dir&gt;</code> with compatible frozen flags and recorded cache/model identity |
| Finish | Existing save-and-quit, then advance queue | Must stop cleanly **and make the last actually exported LoRA explicit**; do not assert a new export at the stopping epoch unless evidence proves it |
| Continue History | Transfer recorded capture/history safely to a new queued job | Restore native state; extend <code>max_train_epochs</code> when continuing a completed state |
| Older-point rewind | DP candidate revision in same trainer directory | Use an isolated Fizgig output branch/revision to preserve earlier exported files and JSONL |
| Cancel queued | Forget queued intent, preserve files | Same shared contract |

**Known Fizgig gap:** an epoch-boundary Pause can write the resumable state without forcing a numbered LoRA export when the epoch is outside the configured save cadence. Therefore **Pause success is not proof of a newly testable export**. Before enabling Fizgig Finish/Finish-after-epoch, prove a reliable native final-export action (or implement and test a narrow upstream change); otherwise declare Finish unavailable, leave Pause functional, and tell the user exactly why. Do not silently use an older export while labeling it as the latest.

**Recovery:** the existing PID/script/result record is authoritative for live process identity. Fizgig may exit with code 0 for its requested Pause, which must not be mistaken for completed target epochs. Record requested action and verify native state evidence. Missing/ambiguous runtime evidence must surface as an operation failure or recoverable queue state, never indefinite GPU ownership. Startup never auto-resumes a paused queue. Keep existing exact process verification and shared GPU FIFO semantics.

On native Resume, use the original recorded flags/models/dataset cache that the state expects. Do not assume a newly captured different Set input is compatible with Fizgig state restoration; validate on a representative run. A Resume from a pruned state is unavailable even if the corresponding LoRA export exists. If user explicitly chooses an older state, never overwrite another branch's exports or step-loss curve.

### 5.4 Analysis and generated artifacts

- Convert Fizgig JSONL <code>s/e/l/lr</code> into the existing normalized step-loss and completed-epoch analysis inputs; test epoch boundaries, moving averages, partial/truncated records, Resume branch filtering, and missing metrics. Keep DP TensorBoard decoding untouched.
- Timestamps and time-to-selected metrics are not necessarily present in Fizgig's loss JSONL. Use only authoritative log/job timestamps where available; otherwise display an unavailable metric rather than inventing it.
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
