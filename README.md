# WebCap

- Media caption editing with side-by-side preview

## Requirements
- Python 3.10+
- pip
- deface
- ffmpeg

## Run
1. Open a terminal in this project folder.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the server:
   ```bash
   python -m tool.server.app
   ```
4. Open your browser to:
   ```
   http://127.0.0.1:5000/
   ```

## Basic use
1. Click the mode switch button to enter Caption mode.
2. Use **Choose Folder** (Chromium browsers) or type an absolute path and click **Open Path**.
3. Select media from the left list.
4. Edit plain-text caption in the center pane.
5. Caption autosaves to a matching `.txt` file beside the selected media.
6. Media previews in the right pane.

## Project layout
- `templates/default/` - the page template copied for new pages
- `tool/tool.html` - UI shell
- `tool/js/` - frontend modules
- `tool/server/` - backend modules
- `tool/bootstrap.min.css` - local CSS used by preview and generated pages

## Notes
- Supported video types: `.mp4`, `.webm`, `.ogg`
- Caption mode supports images and videos.
- Duplicate video names are silently renamed (`file_1.mp4`, etc.)
- Search matches page folder name, first `<h1>`, and optional `<meta name="tags" content="...">`
- Generated pages are plain HTML files. Open them directly if you want.
