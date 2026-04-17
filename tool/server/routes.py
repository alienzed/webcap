# routes.py: All Flask route definitions
from flask import jsonify, request, send_from_directory
from pathlib import Path
from .config import FS_ROOT, FS_DEBUG, safe_join_fs_root
from .caption_ops import list_media_files, load_caption_text, save_caption_text, serve_media_file
import traceback

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

def register_routes(app):
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

    @app.route("/", methods=["GET"])
    def index():
        return send_from_directory(TOOL_DIR, "tool.html")

    @app.route("/favicon.ico", methods=["GET"])
    def favicon():
        return send_from_directory(TOOL_DIR, "favicon.ico")

    @app.route("/static/<path:filename>", methods=["GET"])
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
