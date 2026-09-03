# WebCap

WebCap is a local-first media curation, captioning, dataset-configuration, and managed Diffusion Pipe training app.

It is intentionally file-based and direct: the media grid is the training selection, captions and set state live beside the media, destructive edits are explicit/reversible where expected, and failures are shown rather than silently worked around.

WebCap is built with Flask plus plain browser JavaScript. There is no database or hosted service.

## What WebCap does

### Curate and annotate media

- Browse local working sets and filter the visible media by caption text, requirements, review state, ratings, flags, tags, and aspect ratio.
- Edit caption sidecars directly beside the media.
- Use structured requirement groups, tags, caption templates/mappings, set notes, and review state to keep a set consistent.
- Build focus sets from reports and filters, run recursive SuperSet searches, and materialize matching items into new sets.
- Review caption coverage, required phrases, balance, validation rules, duplicates/similar captions, and caption-length outliers.
- Optionally generate Face Focus, scene-complexity, and MediaPipe selection-pose metadata.

### Make reversible media edits

WebCap supports crop, clip, rotate, flip, background blur/removal, deface, duplicate, prune, reset, and restore workflows.

Operations that are expected to be reversible preserve source material under `originals/`. Destructive actions require explicit user intent.

### Build and run Diffusion Pipe training

The visible media grid is the dataset source of truth.

For a selected training profile WebCap can:

- create the profile's missing persistent config/dataset TOMLs;
- let you inspect/edit those TOMLs directly;
- recalculate a dataset TOML from the current visible media when explicitly Reset;
- capture the visible media, latest captions, exact saved TOMLs, and launch plan into a run-owned bundle;
- run the captured job through the managed queue or generate a manual WSL command;
- show progress, checkpoint ETA, logs, GPU state, history, diagnostics, and TensorBoard controls;
- resume from discovered compatible checkpoints;
- initialize a new run from a saved LoRA or explicit initializer path.

Captured runs are independent of later edits to the source set.

### Calibrate MiniMax H3 video buckets

Training Settings includes explicit H3 video-bucket calibration.

The probe runs fixed single-shape training tests on the configured training hardware, persists conclusive per-shape results, and reuses them on later launches when total RAM, GPU model, and total VRAM still match.

Calibrated ceilings affect newly generated/reset H3 video datasets only:

- the highest tested-safe ceiling remains selectable;
- the automatic generated default keeps a two-rung safety margin below it where possible;
- existing dataset TOMLs and captured runs are never rewritten;
- calibration artifacts are retained for manual cleanup rather than deleted automatically.

See [`docs/vram_bucket_calibration.md`](docs/vram_bucket_calibration.md) for the calibration contract.

## Supported training profiles

Current profiles are app-owned and intentionally finite:

| Profile | Media | Persistent training files | Runs |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images + videos | `config.hi.toml`, `config.lo.toml`, `dataset.hi.toml`, `dataset.lo.toml` | High or Low |
| Krea2 Raw | Images only | `config.krea2.toml`, `dataset.train.toml` | Train |
| Wan2.1 T2V 14B | Images + videos | `config.wan21.toml`, `dataset.train.toml` | Train |
| MiniMax H3 | Images + videos | `config.h3.toml`, `dataset.train.toml` | Train |

The current UI uses one canonical setup per profile. Older POC / Normal / Quality setup variants are no longer separate user-facing configurations.

Wan bundle videos are normalized to 16 fps; MiniMax H3 bundle videos are normalized to 24 fps. Krea2 rejects video capture.

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
http://127.0.0.1:5000/
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

Each Train action reserves a logical run beneath its deterministic set root:

```text
<filesystem.root>/output/runs/<set-slug>--<set-path-hash>/<sequence>-<model>--<optional-name>/
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
