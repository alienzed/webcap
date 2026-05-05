import os
import sys
import json
from flask import Response, stream_with_context
import subprocess
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
import shutil

from .media_metadata import update_media_metadata
from .config import safe_join_fs_root, FS_ROOT, FS_DEBUG, fill_template_placeholders
from .caption_ops import _resolve_folder, list_media_files, load_caption_text, save_caption_text, serve_media_file
from .originals import MEDIA_ALL_EXTS, copy_media_to_originals

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

def resolve_python_executable():
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
    print("[fs_rename] Incoming data:", data)
    folder = data.get("folder", "").strip()
    old_name = data.get("oldFile") or data.get("old_name") or ""
    new_name = data.get("newFile") or data.get("new_name") or ""
    old_name = old_name.strip()
    new_name = new_name.strip()
    if not old_name or not new_name:
        print("[fs_rename] Missing required parameters:", folder, old_name, new_name)
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        old_path = folder_path / old_name
        new_path = folder_path / new_name
        print(f"[fs_rename] old_path={old_path}, new_path={new_path}")
        if not old_path.exists():
            print("[fs_rename] Source does not exist:", old_path)
            return jsonify({"error": "Source does not exist"}), 404
        if new_path.exists():
            print("[fs_rename] Target already exists:", new_path)
            return jsonify({"error": "Target already exists"}), 409
        # Folder renaming logic
        if old_path.is_dir():
            # Disallow reserved names
            if old_name in ("originals", ".", "..") or new_name in ("originals", ".", ".."):
                return jsonify({"error": "Invalid folder name"}), 400
            old_path.rename(new_path)
            print(f"[fs_rename] Renamed folder {old_path} -> {new_path}")
            return jsonify({"ok": True})
        # File renaming logic
        elif old_path.is_file():
            old_path.rename(new_path)
            print(f"[fs_rename] Renamed file {old_path} -> {new_path}")
            # Rename caption if present (sidecar .txt)
            old_caption = folder_path / (Path(old_name).stem + ".txt")
            new_caption = folder_path / (Path(new_name).stem + ".txt")
            print(f"[fs_rename] Caption rename check: old_caption={old_caption}, new_caption={new_caption}")
            if not old_caption.exists():
                print(f"[fs_rename] Caption file does not exist: {old_caption}")
            elif new_caption.exists():
                print(f"[fs_rename] Target caption already exists: {new_caption}")
            else:
                old_caption.rename(new_caption)
                print(f"[fs_rename] Renamed caption {old_caption} -> {new_caption}")

            # Update reviewedKeys in .webcap_state.json if present
            state_path = folder_path / ".webcap_state.json"
            if state_path.exists() and state_path.is_file():
                try:
                    with open(state_path, "r", encoding="utf-8") as f:
                        folder_state = json.load(f)
                    if (
                        isinstance(folder_state, dict)
                        and "reviewedKeys" in folder_state
                        and isinstance(folder_state["reviewedKeys"], list)
                    ):
                        changed = False
                        new_keys = []
                        for k in folder_state["reviewedKeys"]:
                            if k == old_name:
                                new_keys.append(new_name)
                                changed = True
                            else:
                                new_keys.append(k)
                        if changed:
                            folder_state["reviewedKeys"] = new_keys
                            with open(state_path, "w", encoding="utf-8") as f:
                                json.dump(folder_state, f, indent=2)
                            print(f"[fs_rename] Updated reviewedKeys in {state_path}")
                except Exception as e:
                    print(f"[fs_rename] Could not update reviewedKeys: {e}")
            return jsonify({"ok": True})
        else:
            print("[fs_rename] Source is neither file nor folder:", old_path)
            return jsonify({"error": "Source is neither file nor folder"}), 400
    except Exception as e:
        print("[fs_rename] ERROR:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/media/restore", methods=["POST"])
def caption_restore():
    data = request.get_json(silent=True) or {}
    print("[caption_restore] Incoming data:", data)
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        print("[caption_restore] Missing required parameters:", folder, file_name)
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        from .originals import restore_original_media
        result = restore_original_media(folder_path, file_name)
        if result == "not_found":
            return jsonify({"error": "Original media not found in originals"}), 404
        if result == "exists":
            return jsonify({"error": "Media file already exists in set; restore will not overwrite."}), 409
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_restore] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    
# Reset media file to original from 'originals' folder
@app.route("/media/reset", methods=["POST"])
def caption_reset():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        from .originals import restore_original_media_video_only
        ok = restore_original_media_video_only(folder_path, file_name)
        if not ok:
            return jsonify({"error": "Original media not found in originals"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_reset] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/media/prune", methods=["POST"])
def caption_prune():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    file_name = data.get("media", "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        originals_path = folder_path / "originals"
        originals_path.mkdir(exist_ok=True)
        src_media = folder_path / file_name
        if not src_media.exists() or not src_media.is_file():
            return jsonify({"error": "Media file not found"}), 404

        # Determine destination name in originals, handle conflicts by hash and renaming
        def find_unique_name(base_name, ext, src_path, originals_path):
            candidate = originals_path / (base_name + ext)
            if not candidate.exists():
                return candidate.name
            # If exists and is identical, return original name
            from tool.server.originals import file_hash
            if file_hash(candidate) == file_hash(src_path):
                return candidate.name
            # Otherwise, find next available name
            i = 1
            while True:
                candidate = originals_path / (f"{base_name}-{i}{ext}")
                if not candidate.exists():
                    return candidate.name
                if file_hash(candidate) == file_hash(src_path):
                    return candidate.name
                i += 1

        base = Path(file_name).stem
        ext = Path(file_name).suffix
        # Find unique name for media in originals
        from tool.server.originals import file_hash
        dst_media_name = find_unique_name(base, ext, src_media, originals_path)
        dst_media = originals_path / dst_media_name


        # Ensure media is backed up in originals, then remove from set folder
        if dst_media.exists() and file_hash(dst_media) == file_hash(src_media):
            # Already present and identical, safe to delete from set folder
            src_media.unlink()
        else:
            # Move to originals (rename removes from set folder)
            src_media.rename(dst_media)

        # Always move/copy the latest caption to originals, using same base name as media
        src_caption = folder_path / (Path(file_name).stem + ".txt")
        dst_caption = originals_path / (Path(dst_media_name).stem + ".txt")
        if src_caption.exists():
            # Overwrite or create caption in originals
            with open(src_caption, "r", encoding="utf-8") as fsrc, open(dst_caption, "w", encoding="utf-8") as fdst:
                fdst.write(fsrc.read())
            try:
                os.chmod(dst_caption, 0o644)
            except Exception:
                pass
            src_caption.unlink()  # Remove from set folder

        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_prune] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

# Minimal streaming endpoint for autoset.py
@app.route("/fs/autoset_run", methods=["POST"])
def autoset_run():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    if not folder:
        return jsonify({"error": "Missing folder argument"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {folder}"}), 404
        # Use the same Python executable as the server
        python_exe = resolve_python_executable()
        autoset_path = str(ROOT / "tool" / "server" / "autoset.py")
        cmd = [python_exe, autoset_path, "--master", str(folder_path)]

        def copy_auto_to_hi_lo(current_folder):
            import shutil, os
            auto_path = os.path.join(current_folder, 'auto_dataset', 'dataset.auto.toml')
            hi_path = os.path.join(current_folder, 'dataset.hi.toml')
            lo_path = os.path.join(current_folder, 'dataset.lo.toml')
            try:
                if not os.path.exists(auto_path):
                    print(f"[autoset] {auto_path} not found, skipping hi/lo copy.")
                    return "dataset.auto.toml not found, skipping hi/lo copy."
                shutil.copyfile(auto_path, hi_path)
                os.chmod(hi_path, 0o644)
                shutil.copyfile(auto_path, lo_path)
                os.chmod(lo_path, 0o644)
                print(f"[autoset] Copied {auto_path} to {hi_path} and {lo_path}.")
                return "Copied dataset.auto.toml to hi/lo."
            except Exception as e:
                print(f"[autoset] Error copying auto.toml to hi/lo: {e}")
                return f"Error copying auto.toml to hi/lo: {e}"

        def generate():
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, universal_newlines=True)
                for line in proc.stdout:
                    yield line
                proc.stdout.close()
                proc.wait()
                # After autoset completes, attempt the copy
                msg = copy_auto_to_hi_lo(str(folder_path))
                yield f"[autoset] {msg}\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"
        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if FS_DEBUG:
            print("[autoset_run] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    

@app.route('/fs/duplicate_folder', methods=['POST'])
def duplicate_folder():
    data = request.get_json()
    src_rel = data.get('src')
    try:
        src_path = safe_join_fs_root(src_rel)
    except Exception as e:
        return jsonify({'error': f'Invalid source path: {e}'}), 400
    if not src_rel or not src_path.exists() or not src_path.is_dir():
        return jsonify({'error': 'Source folder does not exist'}), 400

    base = src_path.name
    parent = src_path.parent
    # Find a new folder name like "folder copy", "folder copy 2", etc.
    i = 1
    while True:
        if i == 1:
            dst_path = parent / f"{base} copy"
        else:
            dst_path = parent / f"{base} copy {i}"
        if not dst_path.exists():
            break
        i += 1

    shutil.copytree(str(src_path), str(dst_path))
    return jsonify({'success': True, 'dst': str(dst_path)})

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
    try:
        folder_path = safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        metadata_dict = update_media_metadata(folder_path)
        # Convert dict of {filename: metadata} to list of records for the frontend table
        metadata_list = []
        for filename, info in metadata_dict.items():
            record = {
                "file": filename,
                "resolution": info.get("resolution", "-"),
                "fps": f"{info['fps']:.2f}" if info.get("fps") else "-",
                "aspect": info.get("aspect_ratio", "-"),
                "size": f"{info['size'] / (1024*1024):.2f} MB" if info.get("size") else "-",
                "bitrate": f"{info['bitrate']} kbps" if info.get("bitrate") else "-",
                "codec": info.get("codec", "-"),
                "color": info.get("color_space", "-"),
                "duration": f"{info['duration']:.2f}s" if info.get("duration") else "-",
                "frames": info.get("frame_count", "-")
            }
            metadata_list.append(record)
        return jsonify(metadata_list)
    except Exception as e:
        if FS_DEBUG:
            print("[fs_media_metadata] ERROR:", e)
            traceback.print_exc()
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
    print("[open_in_explorer] Received rel_path:", rel_path)
    if not rel_path:
        print("[open_in_explorer] ERROR: Missing path")
        return jsonify({"error": "Missing path"}), 400
    try:
        abs_path = safe_join_fs_root(rel_path)
        print("[open_in_explorer] Resolved abs_path:", abs_path)
        if not abs_path.exists():
            print("[open_in_explorer] ERROR: Path does not exist:", abs_path)
            return jsonify({"error": "Path does not exist"}), 404
        # --- WSL/Windows-aware fallback ---
        def is_wsl():
            try:
                with open("/proc/version", "r") as f:
                    if "Microsoft" in f.read():
                        return True
            except Exception:
                pass
            return os.environ.get("WSLENV") is not None

        if abs_path.is_file():
            if sys.platform.startswith("win"):
                quoted = str(abs_path).replace('/', '\\')
                subprocess.Popen(["explorer", f"/select,{quoted}"])
            elif sys.platform.startswith("darwin"):
                subprocess.Popen(["open", "-R", str(abs_path)])
            elif is_wsl():
                # Open parent folder and select file in Windows Explorer from WSL
                # Use Windows path format
                win_path = str(abs_path).replace("/mnt/c/", "C:/").replace("/", "\\")
                parent = str(abs_path.parent).replace("/mnt/c/", "C:/").replace("/", "\\")
                # Try to select the file if possible
                subprocess.Popen(["powershell.exe", "/c", f'start explorer.exe /select,\"{win_path}\"']) 
            else:
                subprocess.Popen(["xdg-open", str(abs_path.parent)])
        else:
            if sys.platform.startswith("win"):
                os.startfile(str(abs_path))
            elif sys.platform.startswith("darwin"):
                subprocess.Popen(["open", str(abs_path)])
            elif is_wsl():
                # Open folder in Windows Explorer from WSL
                win_path = str(abs_path).replace("/mnt/c/", "C:/").replace("/", "\\")
                subprocess.Popen(["powershell.exe", "/c", f'start explorer.exe \"{win_path}\"'])
            else:
                subprocess.Popen(["xdg-open", str(abs_path)])
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[open_in_explorer] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
def maybe_create_config_files(folder_path):
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return
    templates = ["confighi.toml", "configlo.toml", "dataset.hi.toml", "dataset.lo.toml"]
    templates_dir = TOOL_DIR / "templates"
    for name in templates:
        dest = folder / name
        src = templates_dir / name
        if not dest.exists() and src.exists():
            # Read template as text
            with open(src, "r", encoding="utf-8") as f:
                template_text = f.read()
            # Fill placeholders using folder name as dataset
            filled_text = fill_template_placeholders(template_text, folder.name)
            # Write to destination
            with open(dest, "w", encoding="utf-8") as f:
                f.write(filled_text)
            try:
                os.chmod(dest, 0o644)
            except Exception:
                pass

if __name__ == "__main__":
    app.run(debug=True, port=5000)

