# WebCap

WebCap is a local-first media curation, captioning, dataset-configuration, and managed Diffusion Pipe training app.

It is intentionally file-based and direct: the media grid is the training selection, captions and set state live beside the media, destructive edits are explicit/reversible where expected, and failures are shown rather than silently worked around.

WebCap is built with Flask plus plain browser JavaScript. There is no database or hosted service.

## Major features

| Feature | What it does | Where to start |
| --- | --- | --- |
| **Browse and curate media** | Open local set folders; filter the visible scope; switch between a selected-item workflow and **Media Grid**; keep ratings, flags, tags, and review state with each item. | Choose a folder in the sidebar, use the filter bar or **Advanced filters**, then select an item or open **Media Grid**. |
| **Captions and annotation** | Edit `<media>.txt` sidecars with requirement/vocabulary groups, tags, caption templates, mappings, and set notes. The annotation helpers include tag copy/paste. | Select an item in Annotation and use the caption editor plus the **Groups** and **Tags** panels. Use **Focus Annotate** on the selected item, or press `F`, for repeated group-first annotation across the current scope. |
| **Review Set and dataset QA** | Inspect the current visible scope with a caption sheet, metadata, **Caption Report**, an inspectable balance wheel, **Prune Candidates**, and duplicate detection. Review findings can narrow the working scope. | Open **Review** from the sidebar. Use **Caption Report**, **Prune Candidates**, **Duplicates**, and **Focus set** to investigate a finding. |
| **Focus Sets and cross-folder sets** | A Focus Set temporarily narrows visible media for curation, review, or training. Built-in groups include media type, aspect ratio, image-resolution bands, scene complexity, prune candidates, and optional analysis-derived selections. **SuperSet Search** searches a folder and its subfolders, then materializes matches into a new set. | Choose a **Focus set** from the sidebar or grid. For a cross-folder result set, open **Advanced filters**, enable **SuperSet Search**, click **Search**, then choose **Create Set**. |
| **Media editing** | Crop images; clip videos, inspect decoded frames, and export a selected frame; rotate, flip, blur/remove backgrounds, deface, duplicate, prune, reset, and restore. **Convert FPS** is explicit, and WebP images can be converted losslessly to PNG while preserving the original. | Select a media item and use its preview/context actions; use **Clip** for the video clip and frame workflow. Expected reversible operations preserve source material under `originals/`. |
| **Training setup and capture** | Configure Wan2.2 T2V, Krea2 Raw, Wan2.1 T2V 14B, or MiniMax H3. **Run setup** exposes learning rate, rank, epochs, and dropout as normal run controls; overrides are captured into the run without rewriting the set-owned TOML. **Training Review** summarizes the bucket plan and **Adjust buckets** edits supported targets. | Open **Training**, choose the Base Model, set the run parameters, review/adjust buckets, and use **Advanced configuration** only when raw TOML editing is needed. |
| **Training runs and checkpoints** | Use the managed Training Queue or generate a manual WSL command; inspect progress, next-checkpoint ETA, logs, output, and **Training History**. Resume compatible checkpoints or start a fresh run from a saved LoRA/initializer. Training History is a lightweight metadata index rather than a filesystem-derived catalog. | In Training, use **Run setup** and **Training Queue**; select **Resume checkpoint** or **Fine-tune from saved LoRA** under **Starting point** when applicable. |
| **LoRA candidate analysis** | Review a recorded run's TensorBoard loss curves and suggested completed checkpoint epochs without changing run files. **Multiscale Loss Basins** is the primary detector; **Score Scalars · legacy baseline** remains available. Saved candidates can be copied to the configured Test root and removed again later. | In a run row with recorded output, choose **Analyze LoRA candidates**, then use the candidate actions to stage or remove Test copies. |
| **H3 calibration** | Test MiniMax H3 video bucket shapes on the configured training hardware and retain conclusive results. Verified safe ceilings affect only newly generated or reset H3 datasets; existing TOMLs and captured runs are left unchanged. | Open **App Settings** → **Training** → **H3 calibration**, choose an eligible source from the current folder, and select **Run calibration**. See [`docs/vram_bucket_calibration.md`](docs/vram_bucket_calibration.md). |
| **Test Bench** | Compare staged MiniMax H3 LoRAs against a shared prompt/settings baseline. Queue multiple Test sessions, include or exclude the base model, use wildcard prompts, revisit named/saved sessions and Recent Test Sets, switch between Grid and two-item Compare, open result folders, and rate generated items. | Choose MiniMax H3 as the Base Model, stage checkpoints from Training, then open **Test** from the permanent activity rail. |
| **App settings** | Configure the filesystem root, default caption template, optional local analysis, appearance, training runtime, Storyboard Director runtime, repeat-reference epochs, Copy-to-Test roots, enabled training models, diagnostics, and advanced JSON. | Open **App Settings** from the permanent activity rail. Use the **General**, **Training**, **Storyboard**, and **Advanced** tabs. |

## Supported training profiles

Current profiles are app-owned and intentionally finite:

| Profile | Media | Persistent training files | Runs |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images + videos | `config.hi.toml`, `config.lo.toml`, `dataset.hi.toml`, `dataset.lo.toml` | High or Low |
| Krea2 Raw | Images only | `config.krea2.toml`, `dataset.krea2.toml` | Train |
| Wan2.1 T2V 14B | Images + videos | `config.wan21.toml`, `dataset.train.toml` | Train |
| MiniMax H3 | Images + videos | `config.h3.toml`, `dataset.train.toml` | Train |

The current UI uses one canonical setup per profile; it has no training-mode variants.

Captured videos currently remain byte-for-byte source copies. A future advanced, default-off option may normalize only isolated run media to Wan 16 fps or MiniMax H3 24 fps; it will not alter source-set media. Krea2 rejects video capture.

Profiles can be hidden from new-run selection in App Settings without deleting their existing TOMLs, captured runs, or history.

See [`docs/training_profiles.md`](docs/training_profiles.md) and [`docs/train.md`](docs/train.md) for the operational detail.

## Application shell and reload location

WebCap uses a permanent application shell:

- the left activity rail switches major activities such as Prep, Training, and Test and also owns Console, Settings, Help, and immersive-mode access;
- the top header shows current folder/set context, the single editable **Base Model** selector where relevant, workspace identity, and persistent workload/system status: **Idle / Training / Testing**, GPU utilization/VRAM, and free disk space;
- transient application status appears as a floating bottom-left shell message;
- the multiline application console is a separate shell surface and is not the same thing as a Training run log.

Durable navigation location is reflected in the URL hash. Refreshing a route such as `#/training?folder=my/set&scope=set`, `#/test?folder=my/set`, or `#/grid?folder=my/set` restores the folder and major workspace after the folder finishes loading. Transient state such as open modals, local tabs, Focus cursor/group, console visibility, and immersive mode is intentionally not encoded in the URL.

## Requirements

### Core app

- Python 3.10+
- `pip`
- `ffmpeg` and `ffprobe` available in `PATH`

Python dependencies are listed in [`requirements.txt`](requirements.txt), including Flask, Pillow, deface, MediaPipe, rembg, and ONNX Runtime.

### Managed training

Managed Diffusion Pipe training is designed around the configured WSL training environment and requires:

- a working WSL distribution;
- a Diffusion Pipe checkout/path inside WSL;
- either the configured Conda executable/environment or activation script;
- the model/checkpoint paths expected by the selected TOMLs.

GPU training requirements are otherwise owned by Diffusion Pipe/the selected model environment rather than installed by WebCap.

H3 calibration additionally requires working NVIDIA telemetry (`nvidia-smi`) in the training environment.

### MiniMax H3 Test Bench

The current Test Bench expects a reachable local ComfyUI API using the shipped MiniMax H3 workflow template. On the current Windows/WSL topology WebCap can bridge to Windows ComfyUI through `curl.exe`; the Test Bench otherwise uses the local ComfyUI HTTP API directly.

## Install

```bash
git clone https://github.com/alienzed/webcap.git
cd webcap
pip install -r requirements.txt
```

Copy the example configuration and edit it for the local machine:

```bash
cp tool/config.example.json tool/config.json
```

On Windows, the equivalent is simply to copy `tool\config.example.json` to `tool\config.json`.

`tool/config.json` is intentionally ignored by Git.

## Configuration

The main configuration file is:

```text
tool/config.json
```

Start from [`tool/config.example.json`](tool/config.example.json). The important sections are:

- `filesystem.root` — root containing the working sets and WebCap `output/` tree; required.
- `filesystem.models` — optional model-root convenience path.
- `training.diffusion_pipe_wsl` — Diffusion Pipe working directory inside WSL.
- `training.wsl_distribution` — optional explicit WSL distribution.
- `training.conda_executable` / `training.conda_environment` — optional Conda runtime pair.
- `training.activate_script` — alternative activation script when Conda is not configured.
- `training.repeat_reference_epochs` — fixed epoch count used when solving generated dataset repeats; default `90` and intentionally independent of a run's selected Epochs value.
- `training.test_copy_roots` / `training.test_copy_subfolder` — per-model destination roots and optional subfolder for staging LoRAs into the Test Bench.
- `training.enabled_profiles` — models offered for new training runs; at least one must remain enabled.
- `storyboard.director.mode` — `local` for WebCap-managed llama.cpp or `remote` for an OpenAI-compatible server.
- `storyboard.director.endpoint` — remote API base (for example `http://host:11434/v1`) when Director mode is `remote`.
- `storyboard.director.llama_server` — optional explicit llama.cpp `llama-server` executable path used in local mode; configure this in **App Settings → Storyboard** when it is not on `PATH`.
- `storyboard.director.port` / `context_size` / `max_tokens` — Director runtime limits; local defaults are `8189`, `8192`, and `4096`, while `max_tokens` also applies to remote requests.
- `analysis.enableFaceAnalysis` — optional Face Focus metadata.
- `analysis.enableMediaPipeAnalysis` — optional selection-pose metadata/suggestions.
- `primer.template` — default caption template.
- `set_destinations.presets` — Create Set destination shortcuts.
- `requirements` / `vocabulary` — global annotation baseline/catalog data.

App Settings exposes the normal settings UI plus advanced raw JSON editing.

## Run

```bash
python -m tool.server.app
```

Then open:

```text
http://127.0.0.1:4200/
```

## Core workflow

1. Open a set folder.
2. Filter/focus the visible media to the working subset.
3. Curate media and build captions with requirements, tags, and mappings.
4. Use Review Set / QA to tighten coverage and consistency.
5. Open Training and choose the Base Model/run.
6. Set learning rate, rank, epochs, and dropout in **Run setup**; use **Advanced configuration** for lower-level TOML editing.
7. Review the generated bucket plan and use **Adjust buckets** when needed. Reset a dataset TOML only when you deliberately want it recalculated from the current visible media.
8. Train/queue the visible selection, or generate a manual WSL command.
9. Inspect queue progress, checkpoint ETA, logs, Training History, candidates, and Resume options as needed.

The important rule is simple: **what is visible when Train is requested is what gets captured for that run.**

## Training capture and output

Each Train action reserves a logical run beneath its stable numbered set root. The slug/hash identity is deterministic; its numeric prefix is allocated once when the set first receives managed training output:

```text
<filesystem.root>/output/runs/<global-sequence>-<set-slug>--<set-path-hash>/<sequence>-<model>--<optional-name>/
```

The run owns its captured evidence:

```text
captures/  captured media, captions, manifest, TOMLs, plan, and cache
jobs/      runner, log, PID, action, and result evidence
output/    Diffusion Pipe trainer runs
```

Only app-owned runtime paths are rewritten automatically in captured TOMLs. The normal Run Setup controls for learning rate, rank, epochs, and dropout are applied to the captured config only; they do not rewrite the persistent set TOML. The persistent TOMLs therefore remain the editable baseline for future runs.

Generated dataset repeats are solved independently from the selected run Epochs value. `training.repeat_reference_epochs` (default `90`) supplies the fixed planning horizon used to choose repeat counts; the run's actual Epochs value is still used for progress/step estimates.

## Resume and initialization

WebCap distinguishes three starting points for a new managed run:

- **Fresh** — start from the configured base model.
- **Resume** — choose a current-set managed checkpoint or enter an explicit custom checkpoint directory.
- **Initializer** — start a new run using saved LoRA weights or an explicit initializer file/folder.

Managed Resume stays in its logical run but captures the current set again. Custom Resume reads the explicit external checkpoint and writes its new capture, job, and output beneath a newly allocated logical run. H3 Resume runs the current capture's cache phase before training. When Resume is used, the selected Run Setup learning rate is also written as `force_constant_lr` in the captured config so Diffusion Pipe does not silently continue with the checkpoint's prior scheduler value.

## File/state model

Important per-set artifacts include:

```text
<media>.txt            caption sidecar
.webcap_state.json     per-set/per-item working state
media_metadata.json    cached metadata/analysis
originals/             reversible mutation backing store
config.*.toml          persistent training configs
dataset.*.toml         persistent generated/editable datasets
```

Global training state lives beneath:

```text
<filesystem.root>/.webcap_training/
```

This includes `queue.json`, lightweight `recent_runs.json` Training History metadata, runtime support files, and H3 probe artifacts. Training History rows are created only from recorded history metadata; existing output/log paths merely enrich known rows with availability and actions. These are operational files, not a database.

## Safety and behavior

WebCap intentionally favors explicit operations and visible failures:

- media mutations are explicit and reversible where the workflow expects reversibility;
- selecting a training profile creates only missing persistent TOMLs;
- Reset is destructive to the selected config/dataset file and is therefore explicit;
- queued/running jobs use their captured bundle rather than live set contents;
- missing captions, broken paths, invalid config, missing captured bundles, and training-environment failures are surfaced rather than silently substituted;
- WebCap does not automatically delete captured runs, H3 calibration artifacts, or source-set data.

The repository working contract is documented in [`AGENTS.md`](AGENTS.md).

## Useful keyboard shortcuts

When the relevant field/modal is not consuming the key:

- `ArrowUp` / `ArrowDown` — previous / next visible media.
- `0`…`5` — clear or set rating.
- `Delete` — prune selected media outside `originals`.
- `C` — crop the selected image.
- `D` — deface the selected media.
- `R` — reset the selected media from its preserved original.
- `F2` — rename selected media when allowed.
- `Ctrl+S` / `Cmd+S` — explicitly save the open caption/config file.

## Testing

The regression suite lives under `tests/`.

With `pytest` installed:

```bash
python -m pytest
```

Training-machine behavior cannot be established from the development machine alone. Real Diffusion Pipe/GPU failures should be diagnosed from the actual training-machine logs/telemetry.

## Documentation

The documentation directory intentionally contains both current references and planning/history notes.

Start with [`docs/README.md`](docs/README.md) for the map.

Current operational references include:

- [`docs/spec.md`](docs/spec.md) — shipped architecture/workflow contract.
- [`docs/train.md`](docs/train.md) — capture, queue, logs, Resume, and manual handoff.
- [`docs/training_profiles.md`](docs/training_profiles.md) — supported model profiles and persistent files.
- [`docs/training_review.md`](docs/training_review.md) — training review/bucket controls.
- [`docs/dataset_config.md`](docs/dataset_config.md) — generated dataset behavior.
- [`docs/repeat_targeting.md`](docs/repeat_targeting.md) — fixed-reference repeat planning versus actual run epochs.
- [`docs/app_settings.md`](docs/app_settings.md) — current Settings surface and persistence behavior.
- [`docs/vram_bucket_calibration.md`](docs/vram_bucket_calibration.md) — H3 calibration and calibrated ceilings.

When a planning document conflicts with current code/current-behavior docs, current code wins.

## Project structure

```text
tool/tool.html        app shell / markup
tool/js/              classic frontend JavaScript
tool/css/             styles
tool/server/          Flask routes and backend logic
tool/templates/       app-owned training templates
tool/vendor/          vendored frontend/model assets
scripts/              training/calibration helpers
docs/                 current references + design/history notes
tests/                regression tests
```

## License

MIT. See [`LICENSE`](LICENSE).
