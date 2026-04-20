# WebCap

Media caption editing and review with side-by-side preview, robust file-based state, and atomic backend operations.

---

## Requirements

- Python 3.10+
- pip (Python package manager)
- [ffmpeg](https://ffmpeg.org/) (must be in your PATH)
- [deface](https://github.com/alienzed/deface) (optional, for video anonymization; must be in your PATH)

## Installation

1. **Clone this repository**
   ```bash
   git clone https://github.com/alienzed/webcap.git
   cd webcap
   ```
2. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```
3. **(Optional) Install system dependencies**
   - [ffmpeg](https://ffmpeg.org/download.html): Download and add to your PATH.
   - [deface](https://github.com/alienzed/deface): Install and add to your PATH if you want to use the deface feature.

## Configuration

- Edit `tool/config.json` to set your filesystem root and other options.
  - Example:
    ```json
    {
      "filesystem": {
        "root": "C:/path/to/your/media"
      }
    }
    ```

## Running the App

1. **Start the backend server:**
   ```bash
   python -m tool.server.app
   ```
2. **Open your browser to:**
   [http://127.0.0.1:5000/](http://127.0.0.1:5000/)

---

## Usage

### Basic Workflow
1. **Choose a folder** (via the UI or by typing a path) to load media files.
2. **Select a media file** from the left list.
3. **Edit the caption** in the center pane. Captions autosave to `.txt` files next to the media.
4. **Preview** the media and caption in the right pane.
5. **Mark files as reviewed** by double-clicking them in the list (turns green). Reviewed state is saved and persists.
6. **Stats and Primer**: Edit stats and primer fields at the top; changes are auto-saved.
7. **Prune, Restore, Deface**: Use context menus for advanced file operations. All destructive actions are atomic and safe.

### Features
- **Atomic backend:** All state and file operations are atomic and fail loudly—no silent errors or fallbacks.
- **File-based state:** All state is stored in `.webcap_state.json` in each folder. No database required.
- **Reviewed state:** Mark/unmark files as reviewed; state is always in sync with real files.
- **Stats/Primer:** Edit and auto-save stats and primer fields for each folder.
- **Prune/Restore/Deface:** Safely prune, restore, or anonymize media files with one click.
- **No modules, no async/await:** All frontend code is global, explicit, and synchronous for maximum predictability.

### Project Structure
- `tool/tool.html` — Main UI HTML
- `tool/js/` — All frontend JavaScript (global, non-modular)
- `tool/server/` — Python Flask backend
- `tool/config.json` — Filesystem root and config
- `tool/css/` — CSS (Bootstrap and custom styles)
- `templates/` — TOML templates for config and dataset

---

## Troubleshooting

- **No media appears:**
  - Check your `tool/config.json` filesystem root path.
  - Ensure your media files are in a supported format (`.mp4`, `.webm`, `.ogg`, images).
- **State not saving:**
  - Make sure you see network requests to `/fs/folder_state/save` after edits.
  - Check for errors in the browser console and backend terminal.
- **Deface/prune/restore not working:**
  - Ensure `deface` and `ffmpeg` are installed and in your PATH.
  - Check backend logs for error messages.
- **Fail loudly:**
  - The app is designed to crash on missing dependencies or logic errors. Fix the root cause and reload.

## FAQ

**Q: Can I use this on a network drive or external disk?**
A: Yes, as long as the path is set correctly in `tool/config.json` and the server has access.

**Q: Where is my data stored?**
A: All state is stored in `.webcap_state.json` in each folder. Captions are plain `.txt` files next to media.

**Q: How do I reset or clear state?**
A: Delete the `.webcap_state.json` file in the folder. The app will recreate it as needed.

---

## License

MIT License. See LICENSE file for details.
