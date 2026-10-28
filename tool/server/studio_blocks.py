"""User-authored Studio Blocks: an independent, durable local library."""
import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone

from flask import jsonify, request
from . import config as app_config

_LOCK = threading.RLock()
_TYPES = {"idea", "guidance"}
_MAX_CONTENT = 30000

def _path():
    return app_config.app_state_root() / "studio_blocks.json"

def _load():
    path = _path()
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("blocks"), list):
        raise RuntimeError("Studio Blocks library has an invalid format.")
    return data["blocks"]

def _save(blocks):
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".studio-blocks-", suffix=".tmp", delete=False) as stream:
            tmp = stream.name
            json.dump({"version": 1, "blocks": blocks}, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)

def _validated(payload):
    if not isinstance(payload, dict):
        raise ValueError("A Studio Block must be an object.")
    kind, title, content = payload.get("type"), payload.get("title"), payload.get("content")
    if kind not in _TYPES or not isinstance(title, str) or not isinstance(content, str):
        raise ValueError("Studio Block needs a type, title, and content.")
    title = title.strip()
    if not title or len(title) > 120 or not content.strip() or len(content) > _MAX_CONTENT:
        raise ValueError("Studio Block title must be 1–120 characters and content 1–30000 characters.")
    return {"type": kind, "title": title, "content": content}

def register_routes(app):
    @app.route("/fs/studio-blocks", methods=["GET", "POST"])
    def studio_blocks_collection():
        try:
            with _LOCK:
                blocks = _load()
                if request.method == "GET":
                    return jsonify({"blocks": blocks})
                data = _validated(request.get_json(silent=True))
                now = datetime.now(timezone.utc).isoformat()
                item = dict(data, id=uuid.uuid4().hex, revision=1, createdAt=now, updatedAt=now)
                blocks.append(item)
                _save(blocks)
                return jsonify({"block": item}), 201
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception:
            app.logger.exception("Studio Blocks collection failed")
            return jsonify({"error": "Studio Blocks operation failed; check server logs."}), 500

    @app.route("/fs/studio-blocks/<block_id>", methods=["PUT", "DELETE"])
    def studio_blocks_item(block_id):
        try:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict) or type(payload.get("revision")) is not int:
                raise ValueError("Expected Studio Block revision is required.")
            with _LOCK:
                blocks = _load()
                item = next((b for b in blocks if b.get("id") == block_id), None)
                if item is None:
                    return jsonify({"error": "Studio Block not found."}), 404
                if item.get("revision") != payload["revision"]:
                    return jsonify({"error": "Studio Block changed. Reload it before applying your edit."}), 409
                if request.method == "DELETE":
                    blocks.remove(item)
                    _save(blocks)
                    return jsonify({"ok": True})
                data = _validated(payload)
                updated = dict(item, **data, revision=item["revision"] + 1,
                               updatedAt=datetime.now(timezone.utc).isoformat())
                blocks[blocks.index(item)] = updated
                _save(blocks)
                return jsonify({"block": updated})
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception:
            app.logger.exception("Studio Blocks update failed")
            return jsonify({"error": "Studio Blocks operation failed; check server logs."}), 500
