# WebCap

WebCap is a local-first media curation and captioning tool for training-set workflows.
It focuses on fast iteration, explicit mutations, and reversible file operations.

## Requirements

- Python 3.10+
- `pip`
- `ffmpeg` in `PATH` (required for metadata and media tooling)
- `deface` in `PATH` (optional, only needed if you use deface actions)

## Install

1. Clone and enter the repo.

```bash
git clone https://github.com/alienzed/webcap.git
cd webcap
```

2. Install Python dependencies.

```bash
pip install -r requirements.txt
```

## Configure

Primary config file: `tool/config.json`

Minimum required shape:

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
    "config_hi": "config.hi.toml",
    "config_lo": "config.lo.toml"
  }
}
```

Notes:
- `filesystem.root` is required.
- Training values are used by command preview in the Training tab.
- You can also edit these settings from the in-app Settings modal.

## Run

```bash
python -m tool.server.app
```

Open:
- http://127.0.0.1:5000/

## Workflow Overview

1. Open a set folder.
2. Curate files (rename/prune/reset/restore/crop/deface as needed).
3. Write and refine captions while previewing media.
4. Review captions and metadata.
5. Run dataset prep and generate config artifacts.
6. Preview concrete HI/LO training commands.
7. Execute training externally.

## Mini How-To: Core Features

### 1. Browse folders and select media

1. Use the left panel to navigate folders.
2. Click a media file to load preview and caption.
3. Use `ArrowUp` / `ArrowDown` to move between media items when focus is not in an input/textarea.

### 2. Edit captions

1. Select a media file.
2. Edit text in the center editor.
3. Autosave writes a `.txt` beside the media file.
4. `Ctrl+S` / `Cmd+S` triggers explicit save from the editor.

### 3. Mark reviewed state

1. Double-click a media row to toggle reviewed on/off.
2. Reviewed state persists in `.webcap_state.json` for that folder.
3. To clear all reviewed state in current folder: right-click current folder row, then choose `Reset Reviewed`.

### 4. File operations (safe and explicit)

Right-click a media item for operations:
- `Rename`
- `Prune` (moves media to `originals` with collision-safe naming)
- `Reset` (overwrite current file with original backup)
- `Restore` (from `originals` view)
- `Duplicate Image`
- `Crop...`
- `Deface...`

Right-click a folder for operations:
- `Rename Folder`
- `Duplicate Folder`
- `Open in Explorer`

### 5. Deface media

Per file:
1. Right-click media file.
2. Choose `Deface...`.
3. Enter threshold (`0.0` to `1.0`, default `0.4`).

Per folder:
1. Right-click current folder row.
2. Choose `Deface`.

Behavior:
- Originals are backed up before overwrite.
- Output streams to console panel.

### 6. Review captions and metadata

1. Use `Review Captions` / review pane actions.
2. Review output appears in the right preview pane.
3. Metadata is served from `media_metadata.json` (auto-updated by backend as files change).

### 7. Training prep hub

In the Training tab:

1. `Prepare Dataset` to run dataset preparation pipeline.
2. `Generate Dataset Configs` to (re)generate config artifacts for the set.
3. `Train` to print resolved HI/LO training commands (preview only).

Important:
- Training command execution is currently disabled in-app.
- WebCap prints concrete commands so you can run them externally.

### 8. Legacy autoset

Use when needed for older flow compatibility:

1. Right-click current folder row.
2. Choose `Run Autoset (Legacy)`.

This streams legacy autoset output to the console panel.

### 9. App settings and runtime reload

Utility bar buttons (top-left area):
- Home/path button: shows current folder path in tooltip.
- Gear button: open App Settings modal.
- Reboot button: reload runtime config from `tool/config.json`.
- `?` button: load this README into preview pane.

Settings modal flow:
1. Open settings (`gear`).
2. Edit fields or advanced JSON.
3. Click `Save` to write file.
4. Click `Save + Reboot` (or utility reboot) to apply runtime changes immediately.

## State and Artifacts

- Folder state: `.webcap_state.json`
- Captions: adjacent `.txt` files per media file
- Metadata cache/report: `media_metadata.json`
- Originals backup folder: `originals/`
- Generated configs use templates from `tool/templates/`

## Backend Endpoints (high level)

- Config/runtime: `/app/config`, `/app/reboot`, `/app/help_readme`
- Folder/media: `/fs/describe`, `/caption/load`, `/caption/save`, `/caption/media`
- Mutations: `/media/prune`, `/media/reset`, `/media/restore`, `/media/crop`, `/fs/deface`
- Training prep: `/fs/prepare_dataset`, `/fs/generate_dataset_config`, `/fs/train_run`, `/fs/autoset_run`

## Tests

Current test files:
- `tests/test_dataset_config.py`
- `tests/test_file_ops_routes.py`
- `tests/test_prune_restore.py`

Quick run examples:

```bash
python tests/test_prune_restore.py
python tests/test_file_ops_routes.py
python tests/test_dataset_config.py
```

## Troubleshooting

### No media appears

- Verify `filesystem.root` in `tool/config.json`.
- Ensure files are supported media extensions.
- Check backend terminal for path or permission errors.

### Settings saved but not applied

- Use `Save + Reboot` in settings modal, or click utility reboot button.

### Training preview has warnings

- Check `training.diffusion_pipe_wsl`, `training.config_hi`, `training.config_lo` in config.
- Ensure config files exist in the selected folder.

### Deface fails

- Ensure `deface` executable is installed and visible in `PATH`.
- Confirm ffmpeg/ffprobe tooling is available.

## Project Structure

- `tool/tool.html`: main UI layout
- `tool/js/`: frontend scripts (global, feature-split)
- `tool/css/`: styles
- `tool/server/`: Flask backend and file operations
- `tool/templates/`: dataset/config templates
- `docs/`: feature specs and workflow notes
- `tests/`: backend validation scripts

## License

MIT. See `LICENSE` if present in your distribution.
