import os
import json
from flask import Response, stream_with_context
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
import shutil

from .config import safe_join_fs_root, FS_ROOT, FS_DEBUG, fill_template_placeholders
from .caption_ops import _resolve_folder, list_media_files, load_caption_text, save_caption_text, serve_media_file
from .originals import MEDIA_ALL_EXTS, copy_media_to_originals
from .file_ops import duplicate_folder_response, duplicate_image_response, open_in_explorer_response, rename_response
from .media import media_crop_response, media_metadata_response, media_prune_response, media_reset_response, media_restore_response
from .run_ops import autoset_run_response, prepare_dataset_response, generate_dataset_config_response, train_run_response

os.umask(0o022)  # Ensure files/dirs are created with safe permissions

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

app = Flask(__name__, static_folder=None)

@app.route("/fs/folder_state/save", methods=["POST"])
def folder_state_save():
    data = request.get_json(silent=True) or {}

    rel_path = data.get("folder", "").strip()
    try:
        # print("[folder_state_save] Incoming data:", data)
        # Use the same folder resolution as captions
        folder_path = _resolve_folder(rel_path)
        state_path = folder_path / ".webcap_state.json"
        # print(f"[folder_state_save] Writing to: {state_path}")
        # Minimal patch: always include 'stats' and 'primer' fields
        state = dict(data.get("state", {}))
        # print("[folder_state_save] State before patch:", state)
        if "stats" not in state:
            state["stats"] = {"requiredPhrase": "", "phrases": "", "tokenRules": ""}
        if "primer" not in state:
            state["primer"] = {"template": "", "defaults": "", "mappings": ""}
        # print("[folder_state_save] State to be written:", state)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        # print("[folder_state_save] State written to file.")
        # Optionally, read back and print for verification
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                written = json.load(f)
            # print("[folder_state_save] State read back from file:", written)
        except Exception as e:
            print("[folder_state_save] Could not read back file:", e)
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            # print("[folder_state_save] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

# Read file contents (for captions, config, etc.)
@app.route("/fs/read", methods=["GET"])
def fs_read():
    rel_path = request.args.get("path", "").strip()
    try:
        abs_path = safe_join_fs_root(rel_path)
        if not abs_path.exists() or not abs_path.is_file():
            return ("", 404)
        with open(abs_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        if FS_DEBUG:
            # print("[fs_read] ERROR:", e)
            traceback.print_exc()
        return ("", 400)

@app.route("/fs/root", methods=["GET"])
def fs_root():
    return jsonify({"root": str(FS_ROOT)})

@app.route("/")
def index():
    return send_from_directory(TOOL_DIR, "tool.html")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(TOOL_DIR, "favicon.ico")

@app.route("/static/<path:filename>")
def static_files(filename):
    if filename.startswith("js/"):
        return send_from_directory(JS_DIR, filename[3:])
    if filename.startswith("css/"):
        return send_from_directory(CSS_DIR, filename[4:])
    if filename.startswith("templates/"):
        return send_from_directory(TEMPLATES_DIR, filename[10:])
    return send_from_directory(TOOL_DIR, filename)

@app.route("/caption/load", methods=["GET"])
def caption_load_route():
    folder = request.args.get("folder", "")
    media = request.args.get("media", "")
    try:
        return jsonify(load_caption_text(folder, media))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

@app.route("/caption/save", methods=["POST"])
def caption_save_route():
    data = request.get_json(silent=True) or {}
    # print("[BACKEND][SAVE] Incoming payload to /caption/save:", json.dumps(data, ensure_ascii=False))
    try:
        return jsonify(save_caption_text(
            data.get("folder", ""),
            data.get("media", ""),
            data.get("text", "")
        ))
    except Exception as exc:
        # print("[BACKEND][SAVE] ERROR in /caption/save:", exc)
        return jsonify({"error": str(exc)}), 400

@app.route("/caption/media", methods=["GET"])
def caption_media_route():
    folder = request.args.get("folder", "")
    media = request.args.get("media", "")
    try:
        return serve_media_file(folder, media)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

# Additional endpoints for renaming and restoring files
@app.route("/fs/rename", methods=["POST"])
def fs_rename():
    data = request.get_json(silent=True) or {}
    return rename_response(data)

@app.route("/media/restore", methods=["POST"])
def caption_restore():
    data = request.get_json(silent=True) or {}
    return media_restore_response(data)
    
# Reset media file to original from 'originals' folder
@app.route("/media/reset", methods=["POST"])
def caption_reset():
    data = request.get_json(silent=True) or {}
    return media_reset_response(data)

@app.route("/media/crop", methods=["POST"])
def media_crop():
    data = request.get_json(silent=True) or {}
    return media_crop_response(data)

@app.route("/media/prune", methods=["POST"])
def caption_prune():
    data = request.get_json(silent=True) or {}
    return media_prune_response(data)

# Minimal streaming endpoint for autoset.py
@app.route("/fs/autoset_run", methods=["POST"])
def autoset_run():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    return autoset_run_response(folder)

@app.route("/fs/prepare_dataset", methods=["POST"])
def prepare_dataset_route():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    return prepare_dataset_response(folder)

@app.route("/fs/generate_dataset_config", methods=["POST"])
def generate_dataset_config_route():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    return generate_dataset_config_response(folder)


@app.route("/fs/train_run", methods=["POST"])
def train_run_route():
    data = request.get_json(silent=True) or {}
    folder = (data.get("folder") or "").strip()
    return train_run_response(folder)
    

@app.route('/fs/duplicate_folder', methods=['POST'])
def duplicate_folder(): 
    data = request.get_json()
    src_rel = data.get('src')
    return duplicate_folder_response(src_rel)


@app.route('/fs/duplicate_image', methods=['POST'])
def duplicate_image():
    data = request.get_json(silent=True) or {}
    src_rel = (data.get('src') or '').strip()
    return duplicate_image_response(src_rel)

# Unified deface endpoint
@app.route('/fs/deface', methods=['POST'])
def deface():
    """
    Unified deface endpoint: accepts a file or folder, ensures originals backup by hash, runs deface with --output to overwrite input.
    POST JSON: {"file": <file_rel> } or {"folder": <folder_rel>}
    Optional: "thresh" (default 0.4)
    """
    import subprocess
    from pathlib import Path
    from tool.server.originals import ensure_original_by_hash, ensure_originals_folder

    data = request.get_json()
    file_rel = data.get('file')
    folder_rel = data.get('folder')
    thresh = str(data.get('thresh', '0.4')).strip()
    if not (file_rel or folder_rel):
        return jsonify({'error': 'Missing file or folder'}), 400

    deface_path = shutil.which('deface')
    if not deface_path:
        return Response('[ERROR] deface executable not found in PATH or venv.\n', mimetype='text/plain'), 500

    # Helper to deface a single file
    def deface_one(file_path, thresh):
        file_path = Path(file_path)
        folder_path = file_path.parent
        originals_dir = ensure_originals_folder(folder_path)
        # Ensure backup by hash
        ensure_original_by_hash(file_path, originals_dir)
        # Run deface with --output to overwrite input
        deface_cmd = [deface_path, '-t', thresh, '--mask-scale', '1', str(file_path), '--output', str(file_path)]
        yield f'[DEFACE] Command: {deface_cmd}\n'
        yield f'[DEFACE] CWD: {os.getcwd()}\n'
        yield f'[DEFACE] PATH: {os.environ.get("PATH", "")}\n'
        # Optionally log more env vars if needed
        proc = subprocess.Popen(deface_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            yield line
        proc.wait()
        if proc.returncode == 0:
            yield f'[SUCCESS] Defaced {file_path.name}\n'
        else:
            yield f'[FAIL] Deface failed for {file_path.name}\n'

    deface_exts = {
        '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
    }

    def generate():
        if file_rel:
            file_path = safe_join_fs_root(file_rel)
            yield from deface_one(file_path, thresh)
        elif folder_rel:
            folder_path = safe_join_fs_root(folder_rel)
            for fname in sorted(os.listdir(folder_path)):
                ext = Path(fname).suffix.lower()
                if ext not in deface_exts:
                    continue
                file_path = os.path.join(folder_path, fname)
                yield from deface_one(file_path, thresh)

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route("/fs/describe", methods=["GET"])
def fs_describe():
    """
    Unified endpoint: returns all folders, files (with metadata), and folder state for a directory.
    No filtering; frontend decides what to display.
    """
    rel_path = request.args.get("path", "").strip()

    try:
        dir_path = safe_join_fs_root(rel_path)
        if not dir_path.exists() or not dir_path.is_dir():
            return jsonify({"error": f"Directory does not exist: {rel_path}"}), 404
        maybe_create_config_files(dir_path)
        copy_media_to_originals(dir_path)

        # List folders and files (with metadata)
        entries = []
        for entry in sorted(dir_path.iterdir(), key=lambda e: e.name.lower()):
            meta = {
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
                "extension": entry.suffix.lower() if entry.is_file() else "",
                "size": entry.stat().st_size if entry.is_file() else None,
            }
            entries.append(meta)

        # Media/caption: include full caption text for each media file
        from .originals import MEDIA_ALL_EXTS
        from .caption_ops import _caption_name_for_media
        captions = {}
        for meta in entries:
            if meta["type"] == "file" and meta["extension"] in MEDIA_ALL_EXTS:
                caption_name = _caption_name_for_media(meta["name"])
                caption_path = dir_path / caption_name
                if caption_path.exists():
                    try:
                        text = caption_path.read_text(encoding="utf-8")
                    except Exception as e:
                        text = f"[ERROR: {e}]"
                else:
                    text = None
                captions[meta["name"]] = {"text": text}

        # Folder state (reviewed, stats, primer, etc.)
        state_path = dir_path / ".webcap_state.json"
        folder_state = {}
        if state_path.exists() and state_path.is_file():
            try:
                with open(state_path, "r", encoding="utf-8") as f:
                    folder_state = json.load(f)
            except Exception as e:
                folder_state = {"error": str(e)}
        # Strict: fail loudly if reviewedKeys is missing or malformed
        if not isinstance(folder_state, dict):
            folder_state = {"error": ".webcap_state.json is not a dict"}
        elif "reviewedKeys" not in folder_state:
            folder_state["error"] = "Missing reviewedKeys in .webcap_state.json"
        elif not isinstance(folder_state["reviewedKeys"], list):
            folder_state["error"] = "reviewedKeys is not a list in .webcap_state.json"

        return jsonify({
            "folders": [e for e in entries if e["type"] == "dir"],
            "files": [e for e in entries if e["type"] == "file"],
            "captions": captions,  # {media file name: {text: ...}}
            "folder_state": folder_state  # full .webcap_state.json
        })
    except Exception as e:
        if FS_DEBUG:
            print("[fs_describe] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

 # Media metadata endpoint
@app.route("/fs/media_metadata", methods=["GET"])
def fs_media_metadata():
    rel_path = request.args.get("folder", "").strip()
    return media_metadata_response(rel_path)
    
from .config import list_toml_files, read_toml_file, save_toml_file
# --- Config file API ---
@app.route("/fs/list_config", methods=["GET"])
def list_config():
    folder = request.args.get("folder", "").strip()
    try:
        files = list_toml_files(folder)
        return jsonify({"files": files})
    except Exception as e:
        if FS_DEBUG:
            print("[list_config] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/fs/read_config", methods=["GET"])
def read_config():
    folder = request.args.get("folder", "").strip()
    filename = request.args.get("file", "").strip()
    try:
        text = read_toml_file(folder, filename)
        return Response(text, mimetype="text/plain")
    except Exception as e:
        if FS_DEBUG:
            print("[read_config] ERROR:", e)
            traceback.print_exc()
        return Response("", status=400)

@app.route("/fs/save_config", methods=["POST"])
def save_config():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    filename = data.get("file", "").strip()
    text = data.get("text", "")
    try:
        save_toml_file(folder, filename, text)
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[save_config] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    
@app.route("/fs/open_in_explorer", methods=["POST"])
def open_in_explorer():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    return open_in_explorer_response(rel_path)
    
def maybe_create_config_files(folder_path):
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return
    templates = ["config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"]
    templates_dir = TOOL_DIR / "templates"
    for name in templates:
        dest = folder / name
        src = templates_dir / name
        if not dest.exists() and src.exists():
            try:
                dataset_rel = folder.relative_to(FS_ROOT).as_posix()
            except Exception:
                dataset_rel = folder.name
            # Read template as text
            with open(src, "r", encoding="utf-8") as f:
                template_text = f.read()
            # Fill placeholders using folder path relative to FS root as dataset
            # so nested dataset folders keep their full structure.
            filled_text = fill_template_placeholders(template_text, dataset_rel)
            # Write to destination
            with open(dest, "w", encoding="utf-8") as f:
                f.write(filled_text)
            try:
                os.chmod(dest, 0o644)
            except Exception:
                pass

if __name__ == "__main__":
    app.run(debug=True, port=5000)
