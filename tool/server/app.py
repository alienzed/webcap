
import os
import sys
import json
from flask import Response, stream_with_context
import subprocess
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

from .fs_utils import safe_join_fs_root, FS_ROOT, FS_DEBUG
from .caption_ops import _resolve_folder, list_media_files, load_caption_text, save_caption_text, serve_media_file

os.umask(0o022)  # Ensure files/dirs are created with safe permissions

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

app = Flask(__name__, static_folder=None)

@app.route("/fs/folder_state/load", methods=["GET"])
def folder_state_load():
    rel_path = request.args.get("folder", "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path)
        state_path = folder_path / ".webcap_state.json"
        if not state_path.exists() or not state_path.is_file():
            return jsonify({})
        with open(state_path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as e:
        if FS_DEBUG:
            print("[folder_state_load] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/fs/folder_state/save", methods=["POST"])
def folder_state_save():
    data = request.get_json(silent=True) or {}

    rel_path = data.get("folder", "").strip()
    try:
        print("[folder_state_save] Incoming data:", data)
        # Use the same folder resolution as captions
        folder_path = _resolve_folder(rel_path)
        state_path = folder_path / ".webcap_state.json"
        print(f"[folder_state_save] Writing to: {state_path}")
        # Minimal patch: always include 'stats' and 'primer' fields
        state = dict(data.get("state", {}))
        print("[folder_state_save] State before patch:", state)
        if "stats" not in state:
            state["stats"] = {"requiredPhrase": "", "phrases": "", "tokenRules": ""}
        if "primer" not in state:
            state["primer"] = {"template": "", "defaults": "", "mappings": ""}
        print("[folder_state_save] State to be written:", state)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        print("[folder_state_save] State written to file.")
        # Optionally, read back and print for verification
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                written = json.load(f)
            print("[folder_state_save] State read back from file:", written)
        except Exception as e:
            print("[folder_state_save] Could not read back file:", e)
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[folder_state_save] ERROR:", e)
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

# Additional endpoints for renaming and restoring files
@app.route("/fs/rename", methods=["POST"])
def fs_rename():
    data = request.get_json(silent=True) or {}
    print("[fs_rename] Incoming data:", data)
    folder = data.get("folder", "").strip()
    # Accept both camelCase and snake_case keys for compatibility
    old_file = data.get("oldFile") or data.get("old_name") or ""
    new_file = data.get("newFile") or data.get("new_name") or ""
    old_file = old_file.strip()
    new_file = new_file.strip()
    if not folder or not old_file or not new_file:
        print("[fs_rename] Missing required parameters:", folder, old_file, new_file)
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        print(f"[fs_rename] folder_path={folder_path}")
        old_path = folder_path / old_file
        new_path = folder_path / new_file
        print(f"[fs_rename] old_path={old_path}, new_path={new_path}")
        # Rename media file
        if not old_path.exists() or not old_path.is_file():
            print("[fs_rename] Original file does not exist:", old_path)
            return jsonify({"error": "Original file does not exist"}), 404
        if new_path.exists():
            print("[fs_rename] Target file already exists:", new_path)
            return jsonify({"error": "Target file already exists"}), 409
        old_path.rename(new_path)
        print(f"[fs_rename] Renamed {old_path} -> {new_path}")
        # Rename caption if present
        old_caption = folder_path / (Path(old_file).stem + ".txt")
        new_caption = folder_path / (Path(new_file).stem + ".txt")
        print(f"[fs_rename] old_caption={old_caption}, new_caption={new_caption}")
        if old_caption.exists() and not new_caption.exists():
            old_caption.rename(new_caption)
            print(f"[fs_rename] Renamed caption {old_caption} -> {new_caption}")
        return jsonify({"ok": True})
    except Exception as e:
        print("[fs_rename] ERROR:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/caption/restore", methods=["POST"])
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
        originals_path = folder_path / "originals"
        src_media = originals_path / file_name
        dst_media = folder_path / file_name
        if not src_media.exists() or not src_media.is_file():
            return jsonify({"error": "Original media not found in originals"}), 404
        # Move media file back to set folder (overwrite if present)
        if dst_media.exists():
            dst_media.unlink()
        src_media.rename(dst_media)
        try:
            os.chmod(dst_media, 0o644)
        except Exception:
            pass
        # Restore caption if present (overwrite if present)
        src_caption = originals_path / (Path(file_name).stem + ".txt")
        dst_caption = folder_path / (Path(file_name).stem + ".txt")
        if src_caption.exists():
            if dst_caption.exists():
                dst_caption.unlink()
            with open(src_caption, "r", encoding="utf-8") as fsrc, open(dst_caption, "w", encoding="utf-8") as fdst:
                fdst.write(fsrc.read())
            try:
                os.chmod(dst_caption, 0o644)
            except Exception:
                pass
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_restore] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    
# Reset media file to original from 'originals' folder
@app.route("/caption/reset", methods=["POST"])
def caption_reset():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        from .originals_utils import restore_original_media
        ok = restore_original_media(folder_path, file_name)
        if not ok:
            return jsonify({"error": "Original media not found in originals"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_reset] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.route("/caption/prune", methods=["POST"])
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
        dst_media = originals_path / file_name
        # Move media file to originals if not already present
        if not src_media.exists() or not src_media.is_file():
            return jsonify({"error": "Media file not found"}), 404
        if not dst_media.exists():
            src_media.rename(dst_media)
        else:
            src_media.unlink()  # Remove from set folder, keep original
        # Always overwrite caption in originals
        src_caption = folder_path / (Path(file_name).stem + ".txt")
        dst_caption = originals_path / (Path(file_name).stem + ".txt")
        if src_caption.exists():
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

# Rename a folder (not files)
@app.route("/fs/rename_folder", methods=["POST"])
def fs_rename_folder():
    data = request.get_json(silent=True) or {}
    parent = data.get("parent", "").strip()
    old_name = data.get("oldName", "").strip()
    new_name = data.get("newName", "").strip()
    if not old_name or not new_name:
        return jsonify({"error": "Missing required parameters"}), 400
    if old_name in ("originals", ".", "..") or new_name in ("originals", ".", ".."):
        return jsonify({"error": "Invalid folder name"}), 400
    try:
        parent_path = safe_join_fs_root(parent)
        src = parent_path / old_name
        dst = parent_path / new_name
        if not src.exists() or not src.is_dir():
            return jsonify({"error": "Source folder does not exist"}), 404
        if dst.exists():
            return jsonify({"error": "Target folder already exists"}), 409
        src.rename(dst)
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[fs_rename_folder] ERROR:", e)
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
        autoset_path = str(ROOT / "scripts" / "autoset.py")
        cmd = [python_exe, autoset_path, "--master", str(folder_path)]
        def generate():
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, universal_newlines=True)
                for line in proc.stdout:
                    yield line
                proc.stdout.close()
                proc.wait()
            except Exception as e:
                yield f"[ERROR] {e}\n"
        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if FS_DEBUG:
            print("[autoset_run] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    
if __name__ == "__main__":
    app.run(debug=True, port=5000)
