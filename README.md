# WebCap

WebCap is a local-first media curation, captioning, and dataset-prep app for training-set workflows.
It is built around explicit, reversible mutations, visible subset prep, and fast iteration on modest working sets.

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
    "activate_script": "dp-clean/bin/activate",
    "mode": "normal",
    "write_selection_snapshot_comments": false
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
- Training mode supports `poc`, `normal`, and `quality`.
- `training.write_selection_snapshot_comments` controls whether Generate writes the prep snapshot header into `dataset.hi.toml` and `dataset.lo.toml`.
- Training config filenames are fixed: `config.hi.toml` and `config.lo.toml`.
- `analysis.enableFaceAnalysis` enables Face Focus metadata used by `Review Selections`.
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
3. Use `Review Selections` to triage candidates, weak items, and focus sets.
4. Curate files with rename, prune, reset, restore, duplicate, crop, rotate, flip, deface, and clip.
5. Build captions with requirements, tags, primer mappings, and set notes.
6. Use `QA` and `Review Captions` to tighten consistency and coverage.
7. Run `Prepare Dataset` on the current visible subset.
8. Run `Generate`.
9. Run `Train` to print the resolved command preview, then execute externally.

Practical loop:
- Use `Captionless`, `Incomplete`, ratings, and flags to focus work.
- Use `Review Selections` for curation and `Review Captions` for text QA.
- Keep Prepare scoped with filters when you want a partial batch.
- Use `Create Set` when filtered or recursive search results should become a new working set.

## Feature Guide

### 1. Utility bar and app shell

- Current-path button opens a path flyout for quick jumps.
- `Settings` opens app settings and advanced JSON editing.
- `Reboot` reloads config from disk.
- `Help` opens the current `README.md` in the preview pane.
- Theme toggle switches light/dark mode and persists in local storage.

### 2. Folder navigation and file list

- Click folders in the list to navigate.
- Use the floating up-arrow to move to the parent folder.
- Use refresh to rescan the current directory.
- The current-folder row has a context menu for:
  - Open in Explorer
  - Open Folder in VS Code
  - Generate Dataset Configs
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
- `Prepare Dataset` always uses the currently visible media rows.
- If the visible subset is smaller than the full folder, Prepare asks for confirmation and records the subset snapshot in `auto_dataset/prep_manifest.json`.

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
  - floating `Apply Primer` appears for captionless items when primer text is active
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

Review Captions report:
- runs on the current visible media subset
- shows summary stats
- missing required phrase
- phrase balance counts
- validation failures from structured review rules
- duplicate captions
- similar captions
- caption length insights and outliers
- top and rare token summaries
- media metadata table

### 10. Review Selections report

`Review Selections` is the curation-oriented companion to `Review Captions`.
It runs on the current visible subset and helps build inspection focus sets.

Current panels:
- filtered subset summary
- Face Focus buckets when Face Focus analysis is enabled
- suggested candidate groups
- MediaPipe selection-pose summaries when MediaPipe analysis is enabled:
  - face direction
  - expression
  - body orientation
  - pose class
  - arm position

Behavior:
- panel rows are clickable and open focus sets
- the report stays separate from caption QA
- suggested candidate groups are conservative, metadata-based shortlist views, not auto-decisions

### 11. Media and folder mutations

Media row context menu supports:
- flag assignment
- open containing folder
- copy tags / paste tags
- rename
- prune
- reset
- duplicate image
- crop
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

### 13. Train tab and dataset generation

Train tab includes:
- config file list for `config.hi.toml` and `config.lo.toml`
- `Prepare Dataset`
- `Generate`
- `Train`

Behavior:
- opening a config file loads it into the center editor
- `Prepare Dataset` rebuilds `auto_dataset` from the current visible subset
- Prepare blocks on zero visible rows
- Prepare performs missing-caption preflight and reports missing, primer-fallback, and still-empty counts
- `Generate` reads `prep_manifest.json` and writes dataset outputs
- if the prep manifest is missing, Generate auto-runs Prepare once and retries
- `Train` prints the resolved command preview to the console but does not run training jobs

### 14. App settings

Settings support:
- filesystem root and models paths
- training paths
- selection snapshot comment toggle
- training mode
- Face Focus analysis toggle
- MediaPipe selection analysis toggle
- debug mode
- advanced JSON editing
- `Save`, `Save + Reboot`, and `Reset App`

### 15. Keyboard shortcuts

Global shortcuts when not typing in an input:
- `ArrowUp` / `ArrowDown`: previous or next visible media
- `Delete`: prune selected media outside `originals`
- `0..5`: clear or set rating
- `G`, `Y`, `O`, `B`, `R`: set flag color

Editor and rename:
- `Ctrl+S` / `Cmd+S`: save caption or open config file
- `F2`: rename selected media when the editor is not focused

## Data and Artifacts

Per set folder:
- captions: `<media>.txt`
- folder state: `.webcap_state.json`
- metadata cache: `media_metadata.json`
- originals backup: `originals/`
- prepared dataset outputs: `auto_dataset/`
- prep manifest: `auto_dataset/prep_manifest.json`

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
- `/fs/prepare_dataset`
- `/fs/generate_dataset_config`
- `/fs/train_run`

## Tests

Current test files:
- `tests/test_config_templates.py`
- `tests/test_dataset_config.py`
- `tests/test_file_ops_routes.py`
- `tests/test_filtered_selection_snapshot.py`
- `tests/test_prune_restore.py`

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

### Review Selections shows no analysis data

- Enable the relevant analysis toggle in `Settings`.
- For Face Focus, verify `deface` is installed and in `PATH`.
- For MediaPipe selection analysis, verify the vendored model files exist under `tool/vendor/mediapipe/models/`.

### Generate fails quickly

- Ensure the folder has media and captions.
- Run Prepare first, or let Generate auto-prepare if the manifest is missing.
- Inspect console output for prep or generate errors.

### Config edits do not seem to apply

- Use `Save + Reboot` in Settings, or click utility `Reboot`.

### Deface fails

- Verify `deface` is installed and in `PATH`.
- Verify `ffmpeg` and `ffprobe` are available.

## Project Structure

- `tool/tool.html`: app shell and modal markup
- `tool/js/`: frontend logic
- `tool/css/`: styles
- `tool/server/`: Flask routes and backend operations
- `tool/templates/`: generated config templates
- `tool/vendor/`: vendored frontend and model assets
- `docs/`: design notes and specs
- `tests/`: regression tests

## License

MIT. See `LICENSE` if present in your distribution.
