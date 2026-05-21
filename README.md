# WebCap

WebCap is a local-first media curation and captioning app for training-set workflows.
It is built for explicit, reversible mutations and fast dataset iteration.

## Requirements

- Python 3.10+
- `pip`
- `ffmpeg` and `ffprobe` in `PATH` (required for media metadata and video features)
- `deface` in `PATH` (optional, only needed if you use Deface)

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

Minimum shape:

```json
{
  "filesystem": {
    "root": "C:/path/to/sets",
    "models": "C:/path/to/models"
  },
  "debug": false,
  "training": {
    "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
    "activate_script": "dp-clean/bin/activate",
    "mode": "normal"
  }
}
```

Notes:
- `filesystem.root` is required.
- Training mode supports `poc` and `normal`.
- Training config filenames are fixed: `config.hi.toml` and `config.lo.toml`.
- You can edit config in-app via Settings.

## Run

```bash
python -m tool.server.app
```

Open:
- <http://127.0.0.1:5000/>

## UI Map

- Left panel: folder/media browser, filters, review/train/config sidebars.
- Center panel: caption/config editor and console panel.
- Right panel: media preview and review reports.

## End-to-End Workflow

1. Open a dataset folder.
2. Filter/select the working subset.
3. Curate files (rename/prune/reset/restore/crop/transform/deface/clip).
4. Write captions and use Requirements/Phrases/Tags/Metadata helpers.
5. Run Review Captions to inspect coverage/quality.
6. Run Prepare Dataset.
7. Run Generate.
8. Run Train to print command preview, then execute externally.

## Feature Guide

### 1. Folder navigation

- Click folders in the left list to navigate.
- Use the floating up-arrow to go up one directory.
- Use the utility path button to open a path flyout and jump to any segment.
- Right-click current folder row for actions:
  - Open in Explorer
  - Open Folder in VS Code
  - Run Autoset (Legacy)
  - Generate Dataset Configs
  - Deface (entire folder)
  - Reset Reviewed

### 2. Media selection and preview

- Click a media row to load preview and caption.
- Selection change saves current caption first (when needed), then switches.
- Selected media status and metadata update live.

### 3. Caption editor

- Captions are saved beside media as `.txt` files.
- Autosave runs while typing.
- `Ctrl+S` / `Cmd+S` performs explicit save.
- `F2` renames selected media (outside `originals`).

### 4. Filters and subset selection

Filter bar supports:
- Text filter
- Advanced filters:
  - Captionless
  - Reviewed
  - Stars (`> N`)
  - Flag color
  - Invalid AR
- Clear All resets text + all advanced filters.

Prepare uses the currently visible media rows as its selection source.

### 5. Review state

- Double-click media row toggles reviewed on/off.
- Reviewed state persists in folder state.
- `Reset Reviewed` clears all reviewed marks in the current folder.

### 6. Context-menu media operations

Right-click media item for:
- Flag assignment
- Open Containing Folder
- Rename
- Prune
- Reset
- Duplicate Image (images)
- Crop (images)
- Rotate Left 90 deg (images)
- Rotate Right 90 deg (images)
- Flip Vertical (images)
- Flip Horizontal (images and videos)
- Deface
- Clip (videos in `src_videos` only)

Safety behavior:
- Destructive operations require confirmation.
- Originals are backed up for reversible workflows.

### 7. Crop modal (images)

Crop features:
- Aspect-ratio presets: `1:1`, `4:3`, `16:9`, `9:16`
- Soft magnet snap toward an 8px grid while adjusting
- Finalized crop snapped/clamped to safe bounds
- Arbitrary angle rotation:
  - Angle slider (`-180..180`)
  - Numeric angle input
  - Reset button

Apply writes the rendered rotated crop output in place.

### 8. Video clip flow

- `Clip...` appears for video files under `src_videos`.
- Modal supports:
  - Playback/scrubbing
  - Start time and duration
  - Output file name
  - Crop This Frame (fixed ratio crop via crop modal)
- Export writes clip into the set and refreshes metadata/list state.

### 9. Caption helper panel

Tabs:
- Requirements
- Phrases
- Tags
- Metadata

Requirements tab:
- Add/remove requirements per set.
- Per-media checkbox state persists.
- Checklist completion can drive reviewed state.
- Settings modal lets you assign comma-separated keywords per requirement.
- Keyword matches highlight requirement rows while editing.
- Press `Enter` in keyword value fields to save and close modal.

Phrases tab:
- Add/remove reusable phrases.
- Click phrase to toggle in current caption:
  - If present: remove
  - If missing: insert at cursor
- Copy button copies phrase to clipboard.
- Hover highlighting is supported for phrase/requirement matches.

Tags tab:
- Add/remove per-media tags.
- Clicking a tag applies it as filter text.

Metadata tab:
- Per-media star rating (1..5).
- Key metadata fields (resolution, AR, fps, duration, frames, codec, size).
- Unsupported AR values are highlighted.

### 10. Keyboard shortcuts

Global shortcuts (when not typing in input/textarea/select):
- `ArrowUp` / `ArrowDown`: previous/next visible media
- `Delete`: prune selected media (outside `originals`)
- `0..5`: set rating (`0` clears)
- `G`, `Y`, `O`, `B`, `R`: set flag color (green/yellow/orange/blue/red)

Editor shortcuts:
- `Ctrl+S` / `Cmd+S`: save caption or current config file
- `F2`: rename selected media (when editor is not focused)

### 11. Review reports

`Review Captions` builds a report in preview pane with:
- Summary stats
- Missing required phrase
- Phrase balance
- Validation failures from token rules
- Duplicate captions
- Similar captions (80%+)
- Caption length insights and outliers
- Top/rare token summaries
- Media metadata table (with optional AR grouping)

Report links can focus the working set to matching files.

### 12. Training tab

Training panel includes:
- Prepare Dataset
- Generate
- Train

Behavior:
- Prepare processes selected/visible subset and writes `auto_dataset/prep_manifest.json`.
- Generate reads prep manifest and writes dataset/config outputs.
- If prep manifest is missing, Generate auto-runs Prepare once, then retries Generate.
- Train prints resolved command preview to console (does not run training jobs).

### 13. Config file editing in-app

- Training panel lists config files grouped by High Noise / Low Noise.
- Clicking a config file opens it in center editor.
- Opening a config file closes the status console panel.
- `Ctrl+S` / `Cmd+S` saves config via `/fs/save_config`.

### 14. Utility bar and app settings

Utility buttons:
- Path/home button: current-path flyout and jump navigation
- Settings: open app settings modal
- Reboot: reload runtime config from disk
- Help: load README into preview pane

Settings modal supports:
- Filesystem root/models paths
- Training paths and config filenames
- Training mode (`poc` / `normal`)
- Debug mode
- Advanced JSON editing
- Save or Save + Reboot

## Data and Artifacts

Per set folder:
- Captions: `<media>.txt`
- Folder state: `.webcap_state.json`
- Metadata cache: `media_metadata.json`
- Backups: `originals/`
- Prepared dataset outputs: `auto_dataset/`
  - Includes `prep_manifest.json`

## API Endpoints (high level)

- App/config: `/app/config`, `/app/reboot`, `/app/help_readme`
- File system: `/fs/describe`, `/fs/read`, `/fs/list_config`, `/fs/read_config`, `/fs/save_config`, `/fs/rename`, `/fs/open_in_explorer`, `/fs/open_in_vscode`
- Captions/media: `/caption/load`, `/caption/save`, `/caption/media`, `/fs/media_metadata`
- Mutations: `/media/prune`, `/media/reset`, `/media/restore`, `/media/crop`, `/media/image_transform`, `/media/flip_horizontal`, `/media/video_clip`, `/fs/deface`
- Training flow: `/fs/prepare_dataset`, `/fs/generate_dataset_config`, `/fs/train_run`, `/fs/autoset_run`

## Tests

Current test files:
- `tests/test_dataset_config.py`
- `tests/test_file_ops_routes.py`
- `tests/test_prune_restore.py`

Quick runs:

```bash
python tests/test_prune_restore.py
python tests/test_file_ops_routes.py
python tests/test_dataset_config.py
```

## Troubleshooting

### No media appears

- Check `filesystem.root` in config.
- Confirm supported media file extensions.
- Check backend terminal for path/permission errors.

### Generate fails quickly

- Ensure folder has media and captions.
- Run Prepare first, or let Generate auto-prepare if manifest is missing.
- Inspect console output for prep/generate error details.

### Config changes not taking effect

- Use Save + Reboot in Settings, or click utility Reboot.

### Deface fails

- Verify `deface` is installed and in `PATH`.
- Verify ffmpeg/ffprobe are available.

## Project Structure

- `tool/tool.html`: app shell and modal markup
- `tool/js/`: frontend logic
- `tool/css/`: styles
- `tool/server/`: Flask routes and backend operations
- `tool/templates/`: generated config templates
- `docs/`: design notes and specs
- `tests/`: test scripts

## License

MIT. See `LICENSE` if present in your distribution.
