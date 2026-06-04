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
    "mode": "normal",
    "write_selection_snapshot_comments": false
  },
  "vocabulary": {
    "terms": [],
    "groups": []
  },
  "requirements": {
    "items": [],
    "keywordsByItem": {}
  }
}
```

Notes:
- `filesystem.root` is required.
- Training mode supports `poc`, `normal`, and `quality`.
- `training.write_selection_snapshot_comments` controls whether Generate prepends the selection snapshot header into `dataset.hi.toml` and `dataset.lo.toml`.
- Training config filenames are fixed: `config.hi.toml` and `config.lo.toml`.
- You can edit config in-app via Settings.
- `vocabulary` is optional. Empty arrays are valid and result in no starter terms.
- `requirements` is the editable global requirement baseline. If it is missing or empty, WebCap re-primes the shipped defaults.
- `Reset App` in Settings restores the stock requirements baseline.

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
2. Filter/select the working subset (text filter + advanced filters).
3. Curate files (rename/prune/reset/restore/crop/transform/deface/clip).
4. Build captions with Requirements/Phrases/Tags/Metadata and the primer template.
5. Run Review Captions to inspect coverage/quality.
6. Run Prepare Dataset on the visible selection.
7. Run Generate.
8. Run Train to print command preview, then execute externally.

Practical loop:
- Use `Captionless` + `Incomplete` to focus work.
- Use `Review Captions` repeatedly during captioning, not only at the end.
- Keep Prepare scoped by filters when you want a partial batch.

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
- Preview overlay quick actions are contextual:
  - Images: `Crop`, `Deface`
  - Videos: `Clip`, `Deface`
  - Mutated media: `Reset` appears as a direct quick action.

### 3. Caption editor

- Captions are saved beside media as `.txt` files.
- Autosave runs while typing.
- `Ctrl+S` / `Cmd+S` performs explicit save.
- `F2` renames selected media (outside `originals`).

### 4. Filters and subset selection

Filter bar supports:
- Text filter:
  - Comma-separated terms are ANDed.
  - Prefix a term with `-` or `!` to exclude.
  - Matches filename, label, caption text, and item tags.
- Advanced filters:
  - Captionless
  - Reviewed
  - Unreviewed
  - Incomplete (requirement groups not fully satisfied; `n/a` counts complete)
  - Untagged
  - Stars (multi-select, includes `No Star`)
  - Flag color (multi-select, includes `No Flag`)
  - Invalid AR
  - Advanced Filters help (`i`) with in-app usage details.
- Clear All resets text + all advanced filters.
- SuperSet (cross-folder search):
  - Optional `Search recursively` checkbox expands scope to current folder + subfolders.
  - `Search` is the commit point; it disables itself until filters change.
  - SuperSet results are preview/validation-only and use a dedicated results list.
  - Use `Create Set From Results` to materialize a new set from all matched results.

Prepare uses the currently visible media rows as its selection source.
The filter summary row also shows folder-level rating progress as `Rated A/B` (`A` = items with rating > 0, `B` = total media items in current folder).

### 5. Review state

- Double-click media row toggles reviewed on/off.
- Reviewed state persists in folder state.
- `Reset Reviewed` clears all reviewed marks in the current folder.
- When a media item becomes fully complete, WebCap adds a green flag once as a visual cue; it does not keep recomputing or enforcing that flag.

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
- Aspect-ratio presets: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`
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
- Reorder requirements with a row-level up-arrow button (move up).
- Per-media checkbox state persists.
- Checklist completion can drive reviewed state.
- Settings modal lets you assign comma-separated keywords per requirement.
- Keyword matches highlight requirement rows while editing.
- Press `Enter` in keyword value fields to save and close modal.
- Group terms editor supports pinning terms to the global requirement baseline:
  - In `Edit requirement terms`, click the pin button to pin/unpin a term.
  - Pinned requirement terms are searchable in term add/search flows.
  - `Reset App` restores the shipped requirement baseline if the global list gets trimmed too far.

Phrases tab:
- Search/add quick phrases via `Add/search quick phrase...`.
- Click phrase to toggle in current caption:
  - If present: remove
  - If missing: insert at cursor
- `Tag` button assigns that phrase as a tag to the current media item.
- Up-arrow button reorders quick phrases up one slot.
- `X` button removes a quick phrase from the active list.
- `Annotate` toggle in helper-header actions shows/hides the floating Annotate Strip.
- Annotate Strip groups come from Requirements + requirement keywords.
- Clicking an annotate chip toggles that tag on the current media item.
- Group header pencil button opens per-group requirement-term editor.
- Group header checkmark button marks that requirement reviewed for the current item.
- `n/a` chip lets you mark a group not applicable for the current media item.
- Hover highlighting is supported for phrase/requirement matches.

Tags tab:
- Search/add tags via `Add/search tag...`.
- Shows per-media assigned tags.
- Tags missing from the current caption are highlighted using strict token matching with punctuation normalization and plural allowances.
- Clicking a tag toggles it in the caption (insert at cursor if missing, remove if present).
- Tag list is sorted with missing tags first, then present tags, each alphabetical.

Metadata tab:
- Per-media star rating (1..5).
- Key metadata fields (resolution, AR, fps, duration, frames, codec, size).
- Unsupported AR values are highlighted.

### 9.1 Config tab (caption primer)

- `Caption Template` is the primary primer field.
- `Mappings` is always visible under `Caption Template`:
  - Open `Edit Mappings` to manage rows.
  - Row fields: `Scope` (`file` or `tag`), `Token`, `Key`, `Value (optional)`, `Enabled`.
  - If `Value` is blank, `Token` is used as the value.
  - Custom mapping rows are applied before requirement-derived defaults.
  - Multiple matches for the same key are appended in order (comma-separated, deduped).
  - Unresolved placeholders are removed.
  - Conditional punctuation is supported in placeholders (examples: `{view,}`, `{,view}`, `{ (view) }`).
  - Conditional phrase wrappers are supported:
    - `{view| against }` => append phrase after resolved `view`
    - `{ in |location| setting}` => add prefix/suffix around resolved `location`
- `Set Notes` is available as a separate freeform notes field.
- Primer application UX:
  - `Reapply` writes current primer output into the caption for the selected item.
  - `Undo Reapply` restores the previous caption for that item.
  - Floating `Apply Primer` appears when caption is missing and primer text is currently in effect.
  - While editing `Caption Template`, captionless items live-update only if the editor still matches primer-derived text (safe no-overwrite behavior).

### 9.2 Review tab

- `Required key phrase`: set one phrase that must appear in each caption.
- `Balance Phrases`:
  - Add phrases to track caption variety/coverage across the set (free text or catalog suggestion).
  - Click the `i` button for usage help in the preview panel.
  - Clicking a balance phrase row adds that phrase as a tag to the current media item.
- `Rules`:
  - Always visible in Review (no accordion).
  - Open `Edit Rules` to configure file/caption trigger rules used by Validation Failures in review reports.

### 10. Keyboard shortcuts

Global shortcuts (when not typing in input/textarea/select):
- `ArrowUp` / `ArrowDown`: previous/next visible media
- `Delete`: prune selected media (outside `originals`)
- `0..5`: set rating (`0` clears)
- `G`, `Y`, `O`, `B`, `R`: set flag color (green/yellow/orange/blue/red)

Editor shortcuts:
- `Ctrl+S` / `Cmd+S`: save caption or current config file
- `F2`: rename selected media (when editor is not focused)

Preview navigation:
- Mouse wheel over preview can move previous/next media (cooldown applied to avoid rapid accidental jumps).

### 11. Review reports

`Review Captions` builds a report in preview pane with:
- Summary stats
- Missing required phrase
- Phrase balance
- Validation failures from structured review rules
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
- Prepare includes a missing-caption preflight when needed:
  - Shows missing total
  - Shows primer-fallback count (in-memory)
  - Shows still-empty count
  - Prompts Continue/Cancel
- Generate reads prep manifest and writes dataset/config outputs.
- If prep manifest is missing, Generate auto-runs Prepare once, then retries Generate.
- Train prints resolved command preview to console (does not run training jobs).
- Create Set From Results copies per-item state and now carries the source `primer` block (`template`, mappings, related primer fields) into the destination set state.

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
- Training paths (`diffusion_pipe_wsl`, `activate_script`)
- Selection snapshot comments toggle
- Training mode (`poc` / `normal` / `quality`)
- Debug mode
- Advanced JSON editing
- Reset App for restoring the stock requirements baseline
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
