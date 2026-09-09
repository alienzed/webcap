# WebCap

WebCap is a local-first media curation, captioning, dataset-configuration, and managed Diffusion Pipe training app.

It is intentionally file-based and direct: the media grid is the training selection, captions and set state live beside the media, destructive edits are explicit/reversible where expected, and failures are shown rather than silently worked around.

WebCap is built with Flask plus plain browser JavaScript. There is no database or hosted service.

## Major features

| Feature | What it does | Where to start |
| --- | --- | --- |
| **Browse and curate media** | Open local set folders; filter the visible scope; switch between a selected-item workflow and **Media Grid**; keep ratings, flags, tags, and review state with each item. | Choose a folder in the sidebar, use the filter bar or **Advanced filters**, then select an item or open **Media Grid**. |
| **Captions and annotation** | Edit `<media>.txt` sidecars with requirement/vocabulary groups, tags, caption templates, mappings, and set notes. The annotation helpers include tag copy/paste. | Select an item in Annotation and use the caption editor plus the **Groups** and **Tags** panels. Use **Focus Annotate** on the selected item, or press `F`, for repeated group-first annotation across the current scope. |
| **Review Set and dataset QA** | Inspect the current visible scope with a caption sheet, coverage, required-phrase, balance, and rule checks, metadata, and **Prune Candidates**. Review findings can narrow the working scope. | Open **Review** from the sidebar. Use **Caption Report**, **Prune Candidates**, and the **Focus set** control to investigate a finding. |
| **Focus Sets and cross-folder sets** | A Focus Set temporarily narrows the visible media for curation, review, or training. **SuperSet Search** searches a folder and its subfolders, then materializes matches into a new set. | Choose a **Focus set** from the sidebar or grid. For a cross-folder result set, open **Advanced filters**, enable **SuperSet Search**, click **Search**, then choose **Create Set**. |
| **Media editing** | Crop images; clip videos, inspect decoded frames, and export a selected frame; rotate, flip, blur/remove backgrounds, deface, duplicate, prune, reset, and restore. **Convert FPS** is explicit and overwrites the selected video after confirmation. | Select a media item and use its preview/context actions; use **Clip** for the video clip and frame workflow. Expected reversible operations preserve source material under `originals/`. |
| **Training setup and capture** | Configure Wan2.2 T2V, Krea2 Raw, Wan2.1 T2V 14B, or MiniMax H3 using persistent config/dataset TOMLs. **Training Review** summarizes the bucket plan and **Adjust buckets** edits supported targets. Train captures the current visible media, latest captions, saved TOMLs, and plan into a run-owned bundle. | Open **Train** from the sidebar or utility bar, choose a model and run setup, inspect the TOMLs under **Advanced configuration**, then use **Adjust buckets** or **Train**. |
| **Training runs and checkpoints** | Use the managed queue or generate a manual WSL command; inspect progress, checkpoint ETA, GPU status, logs, history, and TensorBoard. Resume compatible checkpoints or start a fresh run from a saved LoRA/initializer. | In Training, use the run setup and queue controls; select **Resume checkpoint** or **Fine-tune from saved LoRA** under **Starting point** when applicable. |
| **LoRA candidate analysis** | Review a recorded run's TensorBoard loss curves and suggested completed checkpoint epochs without changing run files. **Multiscale Loss Basins** is the primary detector; **Score Scalars · legacy baseline** is available for comparison. | In a run row with recorded output, choose the chart action labeled **Analyze LoRA candidates** to open **LoRA Candidates**. |
| **H3 calibration** | Test MiniMax H3 video bucket shapes on the configured training hardware and retain conclusive results. Verified safe ceilings affect only newly generated or reset H3 datasets; existing TOMLs and captured runs are left unchanged. | Open **App Settings** → **Training** → **H3 calibration**, choose an eligible source from the current folder, and select **Run calibration**. See [`docs/vram_bucket_calibration.md`](docs/vram_bucket_calibration.md). |
| **App settings** | Configure the filesystem root, default caption template, optional local analysis, appearance, training runtime, TensorBoard behavior, enabled training models, diagnostics, and advanced JSON. | Open **App Settings** from the utility bar. Use the **General**, **Training**, and **Advanced** tabs. |

## Supported training profiles

Current profiles are app-owned and intentionally finite:

| Profile | Media | Persistent training files | Runs |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images + videos | `config.hi.toml`, `config.lo.toml`, `dataset.hi.toml`, `dataset.lo.toml` | High or Low |
| Krea2 Raw | Images only | `config.krea2.toml`, `dataset.train.toml` | Train |
| Wan2.1 T2V 14B | Images + videos | `config.wan21.toml`, `dataset.train.toml` | Train |
| MiniMax H3 | Images + videos | `config.h3.toml`, `dataset.train.toml` | Train |

The current UI uses one canonical setup per profile; it has no training-mode variants.

Captured videos currently remain byte-for-byte source copies. A future advanced, default-off option may normalize only isolated run media to Wan 16 fps or MiniMax H3 24 fps; it will not alter source-set media. Krea2 rejects video capture.

Profiles can be hidden from new-run selection in App Settings without deleting their existing TOMLs, captured runs, or history.

See [`docs/training_profiles.md`](docs/training_profiles.md) and [`docs/train.md`](docs/train.md) for the operational detail.

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
- `training.enabled_profiles` — models offered for new training runs; at least one must remain enabled.
- `training.tensorboard_port` — TensorBoard port, default `6006`.
- `training.tensorboard_bruteforce_control` — opt-in WebCap Start/Restart controls for the configured global TensorBoard process.
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
5. Open Training and choose the model profile/run.
6. Inspect or edit the profile's persistent TOMLs.
7. Reset the dataset TOML only when you deliberately want it recalculated from the current visible media.
8. Train/queue the visible selection, or generate a manual WSL command.
9. Inspect run progress/logs/history and resume a discovered checkpoint when needed.

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

Only app-owned runtime paths are rewritten in the captured TOMLs. User-authored training settings remain part of the launch evidence.

The persistent TOMLs in the source set remain the editable interface for future runs.

## Resume and initialization

WebCap distinguishes three starting points for a new managed run:

- **Fresh** — start from the configured base model.
- **Resume** — choose a current-set managed checkpoint or enter an explicit custom checkpoint directory.
- **Initializer** — start a new run using saved LoRA weights or an explicit initializer file/folder.

Managed Resume stays in its logical run but captures the current set again. Custom Resume reads the explicit external checkpoint and writes its new capture, job, and output beneath a newly allocated logical run. H3 Resume runs the current capture's cache phase before training.

## File/state model

Important per-set artifacts include:

```text
<media>.txt            caption sidecar
.webcap_state.json     per-set/per-item working state
media_metadata.json    cached metadata/analysis
originals/             reversible mutation backing store
config.*.toml          persistent training configs
dataset.*.toml         persistent generated/editable datasets
.webcap_training.json  set-local training output metadata
```

Global training state lives beneath:

```text
<filesystem.root>/.webcap_training/
```

This includes queue/history/runtime support files and H3 probe artifacts. These are operational files, not a database.

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
