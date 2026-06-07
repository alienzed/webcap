import os
import json
from flask import Response, stream_with_context
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
import shutil

from . import config as app_config
from .caption_ops import _resolve_folder, list_media_files, load_caption_text, save_caption_text, serve_media_file
from .originals import copy_media_to_originals, media_mutation_status_by_hash, is_transient_media_name
from .file_ops import duplicate_folder_response, duplicate_image_response, open_in_explorer_response, open_in_vscode_response, rename_response
from .media import media_crop_response, media_flip_horizontal_response, media_image_transform_response, media_metadata_response, media_prune_response, media_reset_response, media_restore_response
from .video_clip_ops import clip_video_response, get_clip_job_status
from .run_ops import autoset_run_response, prepare_dataset_response, generate_dataset_config_response, train_run_response
from .smart_set import create_set_from_results_response, smart_set_materialize_response, superset_search_response
from .training_config_files import ensure_training_config_files

os.umask(0o022)  # Ensure files/dirs are created with safe permissions

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

app = Flask(__name__, static_folder=None)

# Alias kept for readability in route handlers.
safe_join_fs_root = app_config.safe_join_fs_root

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
            app_config.debug_print("[folder_state_save] Could not read back file:", e)
        return jsonify({"ok": True})
    except Exception as e:
        if app_config.FS_DEBUG:
            # print("[folder_state_save] ERROR:", e)
            app_config.debug_traceback()
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
        if app_config.FS_DEBUG:
            # print("[fs_read] ERROR:", e)
            app_config.debug_traceback()
        return ("", 400)

@app.route("/fs/root", methods=["GET"])
def fs_root():
    return jsonify({"root": str(app_config.FS_ROOT)})


@app.route("/fs/path_exists", methods=["GET"])
def fs_path_exists():
    rel_path = request.args.get("path", "")
    try:
        abs_path = safe_join_fs_root(rel_path)
        return jsonify(
            {
                "ok": True,
                "exists": bool(abs_path.exists()),
                "is_dir": bool(abs_path.exists() and abs_path.is_dir()),
                "is_file": bool(abs_path.exists() and abs_path.is_file()),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/")
def index():
    tool_html_path = TOOL_DIR / "tool.html"
    video_clip_modal_path = TEMPLATES_DIR / "video_clip_modal.html"
    html = tool_html_path.read_text(encoding="utf-8")
    video_clip_modal = video_clip_modal_path.read_text(encoding="utf-8")
    return Response(html.replace("<!-- VIDEO_CLIP_MODAL -->", video_clip_modal), mimetype="text/html")

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


@app.route("/app/config", methods=["GET"])
def app_config_get():
    try:
        # Return the on-disk config so the settings modal always reflects the
        # latest saved values, even before runtime reboot/reload.
        return jsonify(app_config.load_config_from_disk())
    except Exception:
        # Fallback to runtime snapshot if disk read fails for any reason.
        return jsonify(app_config.get_config_snapshot())


@app.route("/app/config", methods=["POST"])
def app_config_save():
    data = request.get_json(silent=True)
    try:
        saved = app_config.save_config_to_disk(data)
        return jsonify({"ok": True, "config": saved})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/reset_app", methods=["POST"])
def app_reset_app():
    try:
        current = app_config.load_config_from_disk()
        current["requirements"] = app_config.load_default_requirements_block()
        saved = app_config.save_config_to_disk(current)
        loaded = app_config.reload_runtime_config()
        return jsonify({
            "ok": True,
            "message": "App requirements reset to defaults.",
            "config": loaded or saved,
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/reboot", methods=["POST"])
def app_reboot():
    try:
        loaded = app_config.reload_runtime_config()
        return jsonify({
            "ok": True,
            "message": "Runtime configuration reloaded.",
            "config": loaded,
        })
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/help_readme", methods=["GET"])
def app_help_readme():
    readme_path = ROOT / "README.md"
    if not readme_path.exists() or not readme_path.is_file():
        return Response("README.md not found.\n", status=404, mimetype="text/plain")
    text = readme_path.read_text(encoding="utf-8")
    return Response(text, mimetype="text/plain")

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

@app.route("/media/flip_horizontal", methods=["POST"])
def media_flip_horizontal():
    data = request.get_json(silent=True) or {}
    return media_flip_horizontal_response(data)

@app.route("/media/image_transform", methods=["POST"])
def media_image_transform():
    data = request.get_json(silent=True) or {}
    return media_image_transform_response(data)

@app.route("/media/prune", methods=["POST"])
def caption_prune():
    data = request.get_json(silent=True) or {}
    return media_prune_response(data)


@app.route("/media/video_clip", methods=["POST"])
def media_video_clip():
    data = request.get_json(silent=True) or {}
    return clip_video_response(data)


@app.route("/media/video_clip_status", methods=["GET"])
def media_video_clip_status():
    job_id = request.args.get("jobId", "").strip()
    try:
        job = get_clip_job_status(job_id)
        if not job:
            return jsonify({"error": "Clip job not found"}), 404
        return jsonify({"ok": True, "job": job})
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[media_video_clip_status] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400

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
    selected_media = data.get("selected_media")
    selection_criteria = data.get("selection_criteria")
    total_media_count = data.get("total_media_count")
    return prepare_dataset_response(folder, selected_media, selection_criteria, total_media_count)

@app.route("/fs/generate_dataset_config", methods=["POST"])
def generate_dataset_config_route():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    try:
        folder_path = safe_join_fs_root(folder)
        if folder_path.exists() and folder_path.is_dir():
            ensure_training_config_files(folder_path)
    except Exception:
        # Let downstream route handler return canonical error responses.
        pass
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


@app.route("/fs/smart_set_materialize", methods=["POST"])
def smart_set_materialize_route():
    data = request.get_json(silent=True) or {}
    return smart_set_materialize_response(data)


@app.route("/fs/create_set_from_results", methods=["POST"])
def create_set_from_results_route():
    data = request.get_json(silent=True) or {}
    return create_set_from_results_response(data)


@app.route("/fs/superset_search", methods=["POST"])
def superset_search_route():
    data = request.get_json(silent=True) or {}
    return superset_search_response(data)

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
        copy_media_to_originals(dir_path)

        # List folders and files (with metadata)
        entries = []
        for entry in sorted(dir_path.iterdir(), key=lambda e: e.name.lower()):
            if entry.is_file() and is_transient_media_name(entry.name):
                continue
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
        if app_config.FS_DEBUG:
            app_config.debug_print("[fs_describe] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400

 # Media metadata endpoint
@app.route("/fs/media_metadata", methods=["GET"])
def fs_media_metadata():
    rel_path = request.args.get("folder", "").strip()
    include_face_focus = request.args.get("face_focus", "").strip().lower() in {"1", "true", "yes"}
    return media_metadata_response(rel_path, include_face_focus=include_face_focus)


@app.route("/fs/mutation_status", methods=["GET"])
def fs_mutation_status():
    rel_path = request.args.get("folder", "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        status_by_media = media_mutation_status_by_hash(folder_path)
        return jsonify({
            "ok": True,
            "folder": rel_path,
            "status_by_media": status_by_media
        })
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[fs_mutation_status] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
    
from .config import list_toml_files, read_toml_file, save_toml_file
# --- Config file API ---
@app.route("/fs/list_config", methods=["GET"])
def list_config():
    folder = request.args.get("folder", "").strip()
    try:
        files = list_toml_files(folder)
        return jsonify({"files": files})
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[list_config] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400

@app.route("/fs/read_config", methods=["GET"])
def read_config():
    folder = request.args.get("folder", "").strip()
    filename = request.args.get("file", "").strip()
    try:
        text = read_toml_file(folder, filename)
        return Response(text, mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[read_config] ERROR:", e)
            app_config.debug_traceback()
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
        if app_config.FS_DEBUG:
            app_config.debug_print("[save_config] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
    
@app.route("/fs/open_in_explorer", methods=["POST"])
def open_in_explorer():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    return open_in_explorer_response(rel_path)

@app.route("/fs/open_in_vscode", methods=["POST"])
def open_in_vscode():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    return open_in_vscode_response(rel_path)
    
if __name__ == "__main__":
    app.run(debug=True, port=5000)
