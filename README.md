# WebCap

WebCap is a local-first media curation, captioning, dataset-configuration, and managed-training app.
It is built around explicit, reversible mutations, visible training selection, and fast iteration on modest working sets.

## What WebCap Does

- Browse working folders, filter media by caption, review, requirements, tag mismatch, ratings, flags, and aspect ratio.
- Edit captions alongside structured requirement groups, per-item tags, primer mappings, set notes, and review state.
- Review a visible subset for caption coverage, required phrases, balance, validation rules, duplicates, near-duplicates, and caption outliers.
- Build focused work queues from review output, filters, or recursive SuperSet searches, then materialize filtered results into new sets.
- Make reversible media edits including crop, clip, rotation, flip, blur/remove background, deface, duplicate, prune, and reset from preserved originals.
- Inspect profile/mode-specific Diffusion Pipe TOMLs, then capture the visible media and saved configuration into an immutable run bundle.
- Run managed Wan2.2 T2V, Krea2 Raw, Wan2.1 T2V 14B, and MiniMax H3 jobs with launch-scoped base36 output identities, model/stage output folders, a queue, per-run progress and checkpoint ETA, output logs, resume paths, diagnostics, history, GPU status, and optional TensorBoard; a manual WSL command remains available when preferred.
- Keep app state and per-set artifacts on disk. WebCap uses Python and the browser only—no database or hosted service is required.

## Requirements

- Python 3.10+
- `pip`
- `ffmpeg` and `ffprobe` in `PATH` for media metadata, transforms, and video features
- `deface` in `PATH` for defacing workflows and Face Focus analysis

Notes:
- `mediapipe` is installed from `requirements.txt`.
- The MediaPipe model assets used by selection analysis are already vendored under `tool/vendor/mediapipe/models/`.

## Install

1. Clone and enter the repo.

```bash
git clone https://github.com/alienzed/webcap.git
cd webcap
```

2. Install dependencies.

```bash
pip install -r requirements.txt
```

## Configure

Primary config file: `tool/config.json`

Minimum practical shape:

```json
{
  "filesystem": {
    "root": "C:/path/to/sets",
    "models": "C:/path/to/models"
  },
  "training": {
    "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
    "wsl_distribution": "Ubuntu",
    "conda_executable": "/home/user/miniconda3/bin/conda",
    "conda_environment": "training-env",
    "activate_script": "",
    "enabled_profiles": ["wan22_t2v", "krea2_raw", "wan21_t2v_14b", "minimax_h3"]
  },
  "analysis": {
    "enableFaceAnalysis": false,
    "enableMediaPipeAnalysis": false
  },
  "set_destinations": {
    "presets": [
      { "label": "Character", "path": "char" }
    ]
  },
  "vocabulary": {
    "terms": [],
    "groups": []
  },
  "requirements": {
    "items": [],
    "keywordsByItem": {}
  },
  "debug": false
}
```

Notes:
- `filesystem.root` is required.
- Training modes are `POC`, `Normal`, and `Quality`; each profile/mode owns persistent config and dataset TOMLs.
- `training.enabled_profiles` controls which models appear for new training runs. At least one must be enabled.
- Wan2.2 uses `config.wan22.{mode}.{hi|lo}.toml`; Krea2 Raw, Wan2.1, and MiniMax H3 use `config.{krea2|wan21|h3}.{mode}.toml`, each with a matching dataset file.
- `analysis.enableFaceAnalysis` enables Face Focus metadata available in `Review Set` analysis details.
- `analysis.enableMediaPipeAnalysis` enables selection-pose metadata and tag suggestions.
- `set_destinations.presets` powers destination shortcuts in `Create Set`.
- `vocabulary` is optional. Empty arrays are valid.
- `requirements` is the editable global requirement baseline. If it is missing or empty, WebCap re-primes shipped defaults.
- You can edit config in-app from `Settings`, including raw JSON.
- `Reset App` restores the shipped requirements baseline.

## Run

```bash
python -m tool.server.app
```

Open:
- <http://127.0.0.1:5000/>

## UI Map

- Left workspace:
  - utility bar
  - folder and media browser
  - text and advanced filters
  - SuperSet search and Create Set actions
  - set tabs: `Config`, `Review`, `Train`
- Center editor:
  - caption editor or config-file editor
  - helper tabs: `Requirements`, `Tags`, `QA`, `Metadata`
  - annotate strip, status row, console toggle
- Right preview:
  - image/video preview
  - preview quick actions
  - review and selection reports
  - balance distribution wheel overlay when applicable

## End-to-End Workflow

1. Open a set folder.
2. Filter the visible working subset.
3. Use `Review Set` and its optional analysis details to triage candidates, weak items, and focus sets.
4. Curate files with rename, prune, reset, restore, duplicate, crop, blur background, remove background, rotate, flip, deface, and clip.
5. Build captions with requirements, tags, primer mappings, and set notes.
6. Use `QA` and `Review Set` to tighten consistency and coverage.
7. Open `Train`, choose a model and mode, then inspect or edit their config and dataset TOMLs.
8. Train or queue the currently visible subset; use the manual command only when you want an external handoff.

Practical loop:
- Use `Captionless`, `Incomplete`, ratings, and flags to focus work.
- Use `Review Set` for text QA; optional analysis details retain the lower-level curation signals.
- Filter or focus the grid when you want to train a partial batch.
- Use `Create Set` when filtered or recursive search results should become a new working set.

## Feature Guide

### 1. Utility bar and app shell

- Current-path button opens a path flyout for quick jumps.
- `Settings` opens app settings and advanced JSON editing.
- `Help` opens the current `README.md` in the preview pane.
- Theme toggle switches light/dark mode and persists in local storage.

### 2. Folder navigation and file list

- Click folders in the list to navigate.
- Use the floating up-arrow to move to the parent folder.
- Use refresh to rescan the current directory.
- The current-folder row has a context menu for:
  - Open in Explorer
  - Open Folder in VS Code
  - Deface the whole folder
  - Reset Reviewed
- Folder rows also support:
  - flag assignment
  - rename
  - duplicate folder
  - open in Explorer

### 3. Media selection and preview

- Click a media row to load preview, caption, tags, and metadata.
- Selection changes save the current caption first when needed.
- Preview quick actions are contextual:
  - images: `Crop`, `Deface`
  - videos: `Clip`, `Deface`
  - mutated media: `Reset`
  - more actions are available from the preview overflow menu
- Mouse wheel over the preview can move to previous/next visible media.

### 4. Filters, subset prep, and SuperSet search

Text filter:
- comma-separated terms are ANDed
- prefix a term with `-` or `!` to exclude
- matches filename, label, caption text, and item tags

Advanced filters:
- `Captionless`
- `Reviewed`
- `Unreviewed`
- `Incomplete`
- `Tag Mismatch`
- `Stars`, including `No Star`
- `Flag`, including `No Flag`
- `Invalid AR`

Subset behavior:
- `Clear All` resets text and advanced filters.
- The filter summary also shows folder-level rating progress as `Rated A/B`.
- Train always captures the currently visible media rows.
- The captured run bundle is independent of later filtering, caption edits, or set-file changes.

SuperSet search:
- `Include subfolders` arms recursive search.
- `Search` is the explicit commit point and stays disabled until filters change again.
- Results render in a dedicated read-only list, not the normal editable media list.
- SuperSet results support preview and validation, not caption editing.
- `Create Set` materializes the full matched result set into a brand-new set folder.

### 5. Review state, focus sets, ratings, and flags

- Double-click a media row toggles reviewed state.
- Reviewed state persists in `.webcap_state.json`.
- `Reset Reviewed` clears reviewed state for the current folder.
- Rating is per-item from `0..5` and can be set from the metadata panel or keyboard.
- Flags support red, green, blue, yellow, and orange.
- Review and selection reports can open focus sets:
  - the left list narrows to a report-defined subset
  - the banner lets you return to the report or exit the focus set

### 6. Caption editor and persistence

- Captions are saved beside media as `.txt` files.
- Autosave runs while typing.
- `Ctrl+S` / `Cmd+S` performs an explicit save.
- `F2` renames the selected media when rename is allowed.
- The same editor is reused for `.toml` config file editing from the `Train` tab.
- Config-file autosave and explicit save use separate config routes from caption saves.

### 7. Helper tabs under the editor

Requirements:
- add, remove, and reorder requirement groups per set
- assign comma-separated keyword terms per requirement
- mark groups reviewed
- mark groups `n/a` per media item
- edit per-group requirement terms from the group header
- pin requirement terms into the global config baseline
- toggle the floating annotate strip

Annotate strip:
- shows chips built from requirements and requirement keywords
- clicking a chip toggles that tag on the current media item
- stronger blue chips indicate common nearby terms missing on the current item
- right-click a chip to edit set-wide wrappers plus descriptor defaults and current-item overrides
- wrapper styling is set-wide, while descriptors carry forward as soft defaults and snapshot onto items when tags are added
- group controls support quick review toggles and term editing

Tags:
- search and add tags from the merged catalog
- copy tags from one item and paste/merge them into another
- sort tags with missing-in-caption tags first
- click a tag to insert it at the cursor or remove it from the caption
- remove a tag from the item with the adjacent `x`
- when MediaPipe selection analysis is enabled, the panel can show suggested coarse tags derived from pose metadata

QA:
- shows tag-driven set-composition signals for the current item
- `Similarity` warns when the current tag set starts to look too much like nearby items
- `Suggestions` proposes likely missing tags based on similar tagged neighbors
- file links can open the related focus set directly

Metadata:
- shows resolution, size, aspect, fps, duration, frames, and codec when available
- shows scene complexity when metadata has been generated
- shows rating controls
- shows requirement progress, reviewed progress, and tag-match progress
- highlights unsupported aspect ratios

### 8. Config tab (caption primer and set notes)

- `Caption Template` is the primary primer field.
- `Mappings` is always visible under the template:
  - manage rows with `Edit Mappings`
  - row fields: `Scope`, `Token`, `Key`, `Value`, `Enabled`
  - blank `Value` falls back to `Token`
  - custom mappings apply before requirement-derived defaults
  - multiple values for the same key append in order and dedupe
  - unresolved placeholders are removed
  - conditional punctuation and wrapper syntax are supported
- `Set Notes` stores per-set freeform notes.
- Primer application flow:
  - `Reapply` writes the current primer output into the selected item caption
  - `Undo Reapply` restores the previous caption
  - floating `Apply` writes the current editor text into the selected item caption; Shift+click continues to the next captionless item
  - captionless items live-update from primer edits only while the editor still matches primer-derived text

### 9. Review tab and reports

Review tab controls:
- `Required key phrase`
- `Balance Phrases`
- `Rules` via `Edit Rules`

Balance phrases:
- add and reorder phrases you want to track across the set
- click a balance phrase row to add that phrase as a tag to the current item
- balance phrases also drive the preview-side balance distribution wheel

Balance wheel overlay:
- appears over the preview when a media item is selected and balance phrases exist
- slices represent the current filtered distribution of configured phrases
- the current item's matching phrase slices are emphasized
- phrase matching uses caption text and item tags

Review Set report:
- runs on the current visible media subset
- shows scope and caption coverage, required phrase misses, phrase balance, validation failures, duplicate and similar captions, and caption-length outliers
- keeps Face Focus, Suggested Candidates, pose summaries, and full media metadata in collapsed `Analysis details`
- report rows are clickable and open focus sets; returning reruns the same Review Set report

### 10. Media and folder mutations

Media row context menu supports:
- flag assignment
- open containing folder
- copy tags / paste tags
- rename
- prune
- reset
- duplicate image
- crop
- blur background
- remove background
- rotate left 90 deg
- rotate right 90 deg
- flip vertical
- flip horizontal
- deface
- clip
- restore when browsing `originals`

Safety behavior:
- destructive actions require confirmation
- originals are backed up for reversible workflows
- reset restores media from `originals` while leaving captions intact

### 12. Crop modal and video clip flow

Crop modal:
- aspect-ratio presets: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`
- soft magnet snap toward an 8px grid
- safe bounds clamping on apply
- arbitrary angle rotation with slider, numeric input, and reset

Video clip flow:
- available for video files
- supports playback, scrubbing, start time, duration, and output filename
- supports `Crop This Frame` before export
- exports the clip into the set and refreshes list and metadata state

### 13. Train tab and run capture

Train tab includes:
- model/profile selection: Wan2.2 T2V, Krea2 Raw, Wan2.1 T2V 14B, or MiniMax H3
- POC, Normal, or Quality mode selection
- profile/mode-specific config and dataset TOMLs
- managed runs for the selected profile's available run option
- optional checkpoint resume, a manual command preview, and full diagnostics
- training queue, GPU status, output console, recent-run history, and TensorBoard controls

Behavior:
- opening a config file loads it into the center editor; Close saves and returns to Training Items
- selecting a model/mode creates only its missing TOMLs; existing edited files are preserved
- **Reset** intentionally replaces one training config from its template/Normal source or recalculates one dataset TOML from the visible media
- Train saves the open TOML and captures the visible media, latest captions, exact inspected TOMLs, and run plan under the numbered output folder
- each Train action owns a separate bundle and cache; Wan2.2 HI and LO from one action share that bundle
- Krea2 Raw requires image-only media; Wan2.1, Wan2.2, and MiniMax H3 accept images and videos
- Video timing uses the model's native timebase (16 fps for Wan, 24 fps for MiniMax H3). Wan Normal/Quality use 37f temporal plus 13f detail; H3 Normal/Quality use 68f temporal plus 17f detail. POC uses one temporal role (33f for Wan, 34f for H3).
- Every generated image or temporal stanza has one explicit bucket and points directly to its captured AR folder. Only the marked video-detail cohort is materialized under `media/video_detail`; no image or general video classes are made.
- zero visible media and missing required captions or TOML paths fail visibly
- `Train this set` starts immediately when idle or adds the selected run behind current work; Wan2.2 HI -> LO queues independent HI and LO jobs
- active jobs expose per-run progress, completion ETA, next-checkpoint ETA, effective output identity/folder, logs, queue-pause/finish controls, explicit queue start/resume, and resume-from-checkpoint controls; queued resumes show checkpoint-derived progress
- the output view starts at the recent log tail; `Reveal log file` selects the complete managed log in Explorer
- `Generate & Copy Manual Command` reserves a launch output and captured bundle but remains a non-process-launching WSL handoff, while `Run Diagnostics` runs the fuller environment check
- TensorBoard can be started, stopped, and opened from the training workspace when available

See [docs/train.md](docs/train.md) and [docs/training_profiles.md](docs/training_profiles.md) for the operational reference.

### 14. App settings

Settings support:
- filesystem root and models paths
- training paths
- enabled training models
- TensorBoard port
- Face Focus analysis toggle
- MediaPipe selection analysis toggle
- debug mode
- advanced JSON editing
- `Save`, `Save + Reboot`, and `Reset App`

### 15. Keyboard shortcuts

Global shortcuts when not typing in an input:
- `ArrowUp` / `ArrowDown`: previous or next visible media
- `Delete`: prune selected media outside `originals`
- `C`: open Crop for the selected image
- `D`: deface the selected media with the default threshold
- `R`: reset the selected media to its original version, with confirmation
- `0..5`: clear or set rating

Editor and rename:
- `Ctrl+S` / `Cmd+S`: save caption or open config file
- `F2`: rename selected media when the editor is not focused

## Data and Artifacts

Per set folder:
- captions: `<media>.txt`
- folder state: `.webcap_state.json`
- metadata cache: `media_metadata.json`
- originals backup: `originals/`
- persistent profile/mode config and dataset TOMLs

Per numbered run folder:
- immutable captured media, captions, TOMLs, plan, and Diffusion Pipe cache under `.webcap/datasets/`

## API Endpoints

App and config:
- `/`
- `/app/config`
- `/app/reset_app`
- `/app/reboot`
- `/app/help_readme`

Folder state and file system:
- `/fs/folder_state/save`
- `/fs/read`
- `/fs/root`
- `/fs/path_exists`
- `/fs/describe`
- `/fs/rename`
- `/fs/open_in_explorer`
- `/fs/open_in_vscode`

Captions, metadata, and config files:
- `/caption/load`
- `/caption/save`
- `/caption/media`
- `/fs/media_metadata`
- `/fs/list_config`
- `/fs/read_config`
- `/fs/save_config`

Media mutation and restore:
- `/media/prune`
- `/media/reset`
- `/media/restore`
- `/media/crop`
- `/media/blur_background`
- `/media/remove_background`
- `/media/image_transform`
- `/media/flip_horizontal`
- `/media/video_clip`
- `/media/video_clip_status`
- `/fs/deface`
- `/fs/duplicate_image`
- `/fs/duplicate_folder`

Selection, review, and dataset flow:
- `/fs/superset_search`
- `/fs/create_set_from_results`
- `/fs/smart_set_materialize`
- `/fs/training_profiles`
- `/fs/training_setup`
- `/fs/train_run`
- `/fs/training_runner/validate`
- `/fs/training_runner/start`
- `/fs/training_runner/status`
- `/fs/training_runner/recover`
- `/fs/training_runner/gpu`
- `/fs/training_runner/log`
- `/fs/training_runner/open_log`
- `/fs/training_runner/stop`
- `/fs/training_runner/reorder`
- `/fs/training_runner/resume_queue`
- `/fs/training_history`
- `/fs/training_history/all`
- `/fs/training_history/clear`
- `/fs/training_history/job/clear`
- `/fs/tensorboard/status`
- `/fs/tensorboard/start`
- `/fs/tensorboard/stop`

## Tests

Current test files:
- `tests/test_config_templates.py`
- `tests/test_dataset_config.py`
- `tests/test_file_ops_routes.py`
- `tests/test_filtered_selection_snapshot.py`
- `tests/test_prune_restore.py`
- `tests/test_training_runner_runtime.py`
- `tests/test_training_profiles.py`
- `tests/test_training_history.py`
- `tests/test_training_tensorboard.py`

Example runs:

```bash
python -m pytest tests/test_config_templates.py
python -m pytest tests/test_dataset_config.py
python -m pytest tests/test_file_ops_routes.py
python -m pytest tests/test_filtered_selection_snapshot.py
python -m pytest tests/test_prune_restore.py
```

## Troubleshooting

### No media appears

- Check `filesystem.root` in config.
- Confirm the folder contains supported media extensions.
- Check backend terminal output for path or permission failures.

### Review Set analysis details show no data

- Enable the relevant analysis toggle in `Settings`.
- For Face Focus, verify `deface` is installed and in `PATH`.
- For MediaPipe selection analysis, verify the vendored model files exist under `tool/vendor/mediapipe/models/`.

### Training capture fails quickly

- Ensure the visible grid contains supported media and that captions or primer fallbacks are available.
- Inspect the selected config and dataset TOMLs for required model, dataset, media, and output paths.
- Inspect the visible failure or console output for the exact capture/preflight error.

### Config edits do not seem to apply

- Use `Save + Reboot` in Settings.

### Deface fails

- Verify `deface` is installed and in `PATH`.
- Verify `ffmpeg` and `ffprobe` are available.

## Project Structure

- `tool/tool.html`: app shell and modal markup
- `tool/js/`: frontend logic
- `tool/css/`: styles
- `tool/server/`: Flask routes and backend operations
- `tool/templates/`: model/mode training config templates
- `tool/vendor/`: vendored frontend and model assets
- `docs/`: design notes and specs
- `tests/`: regression tests

## License

MIT. See `LICENSE` if present in your distribution.
