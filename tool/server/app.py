import sys
import os
import json
import threading
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
import shutil

# Load config from tool/config.json
CONFIG_PATH = Path(__file__).resolve().parents[1] / 'config.json'
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)
FS_ROOT = Path(config['filesystem']['root'])
FS_DEBUG = config.get('debug', False)

def safe_join_fs_root(rel_path):
    rel_path = rel_path.strip().replace('..', '').replace('\\', '/').replace('//', '/')
    if rel_path.startswith('/'):
        rel_path = rel_path[1:]
    abs_path = (FS_ROOT / rel_path).resolve()
    return abs_path


ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

print(f"[webcap] FS_ROOT set to: {FS_ROOT}")
print(f"[webcap] FS_DEBUG set to: {FS_DEBUG}")

from .caption_ops import list_media_files, load_caption_text, save_caption_text, serve_media_file

app = Flask(__name__, static_folder=None)

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
            print("[fs_read] ERROR:", e)
            traceback.print_exc()
        return ("", 400)

@app.route("/fs/root", methods=["GET"])
def fs_root():
    return jsonify({"root": str(FS_ROOT)})


@app.route("/fs/list", methods=["GET"])
def fs_list():
    rel_path = request.args.get("path", "").strip()
    try:
        dir_path = safe_join_fs_root(rel_path)
        if not dir_path.exists() or not dir_path.is_dir():
            if FS_DEBUG:
                print(f"[fs_list] Searching in {FS_ROOT}")
                print(f"[fs_list] Requested {rel_path} -> {dir_path} (NOT FOUND)")
            return jsonify({"error": f"Directory does not exist: {rel_path}"}), 404
        # Originals and config file management: only if valid set folder
        try:
            from .originals_utils import MEDIA_EXTS, copy_media_to_originals, is_blacklisted
            def is_set_folder(path):
                name = path.name.lower()
                if name == 'originals' or 'trash' in name or 'prune' in name:
                    return False
                if is_blacklisted(name):
                    return False
                # Must contain at least one media or caption file
                for entry in path.iterdir():
                    if entry.is_file() and (entry.suffix.lower() in MEDIA_EXTS or entry.suffix.lower() == '.txt'):
                        return True
                return False

            if is_set_folder(dir_path):
                copy_media_to_originals(str(dir_path))
                # Config file creation
                from pathlib import Path
                import shutil
                templates = {
                    'configlo.toml': 'configlo.toml',
                    'confighi.toml': 'confighi.toml',
                    'dataset.lo.toml': 'dataset.lo.toml',
                    'dataset.hi.toml': 'dataset.hi.toml',
                }
                for fname, tname in templates.items():
                    fpath = dir_path / fname
                    if not fpath.exists():
                        tpath = TEMPLATES_DIR / tname
                        if tpath.exists():
                            text = tpath.read_text(encoding='utf-8')
                            # For configlo/confighi, substitute dataset path
                            if fname == 'configlo.toml':
                                text = re.sub(r'^(dataset\s*=\s*).*$','dataset = "dataset.lo.toml"', text, flags=re.MULTILINE)
                            elif fname == 'confighi.toml':
                                text = re.sub(r'^(dataset\s*=\s*).*$','dataset = "dataset.hi.toml"', text, flags=re.MULTILINE)
                            fpath.write_text(text, encoding='utf-8')
        except Exception as oe:
            if FS_DEBUG:
                print(f"[fs_list] WARNING: Could not update originals/configs: {oe}")
        entries = []
        for entry in sorted(dir_path.iterdir(), key=lambda e: e.name.lower()):
            if entry.is_dir():
                entries.append({"name": entry.name, "type": "dir"})
            elif entry.is_file():
                entries.append({"name": entry.name, "type": "file"})
        return jsonify({
            "folders": [e["name"] for e in entries if e["type"] == "dir"],
            "files": [e["name"] for e in entries if e["type"] == "file"]
        })
    except Exception as e:
        if FS_DEBUG:
            print("[fs_list] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

def resolve_python_executable():
    venv_windows = ROOT / ".venv" / "Scripts" / "python.exe"
    if venv_windows.exists():
        return str(venv_windows)
    venv_posix = ROOT / ".venv" / "bin" / "python"
    if venv_posix.exists():
        return str(venv_posix)
    return sys.executable

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

@app.route("/caption/list", methods=["GET"])
def caption_list_route():
    folder = request.args.get("folder", "")
    try:
        files = list_media_files(folder)
        return jsonify({"files": files})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

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
    try:
        return jsonify(save_caption_text(
            data.get("folder", ""),
            data.get("media", ""),
            data.get("text", "")
        ))
    except Exception as exc:
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

if __name__ == "__main__":
    app.run(debug=True, port=5000)
