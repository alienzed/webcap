"""Durable Assistant conversations. No Story/Scene ownership or live context binding."""

import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config


_LOCK = threading.RLock()
_ID = re.compile(r"^[0-9]{8}T[0-9]{6}\.[0-9]{6}Z-[0-9a-f]{8}$")
_MODES = {"chat", "storyboard"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _root():
    return app_config.app_state_root() / "director_chats"


def _path(chat_id):
    if not isinstance(chat_id, str) or not _ID.fullmatch(chat_id):
        raise ValueError("Invalid Assistant conversation ID.")
    return _root() / chat_id / "conversation.json"


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".conversation-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _read(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise FileNotFoundError("Assistant conversation does not exist.") from None
    if not isinstance(data, dict):
        raise RuntimeError("Assistant conversation is not a JSON object: " + str(path))
    return data


def _active_path():
    return _root() / "active.json"


def _active():
    path = _active_path()
    if not path.exists():
        return {}
    data = _read(path)
    return {mode: chat_id for mode, chat_id in data.items()
            if mode in _MODES and isinstance(chat_id, str) and _ID.fullmatch(chat_id)}


def _set_active(mode, chat_id):
    active = _active()
    if chat_id is None:
        active.pop(mode, None)
    else:
        active[mode] = chat_id
    _write(_active_path(), active)


def _validate_messages(messages):
    if not isinstance(messages, list):
        raise ValueError("Assistant conversation messages must be an array.")
    result = []
    for item in messages:
        if (not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}
                or not isinstance(item.get("content"), str)):
            raise ValueError("Assistant conversation contains an invalid message.")
        result.append({"role": item["role"], "content": item["content"]})
    return result


def _validate_attachments(attachments):
    if not isinstance(attachments, dict):
        raise ValueError("Assistant attachments must be an object.")
    result = {}
    for key, value in attachments.items():
        if (not isinstance(key, str) or not isinstance(value, dict)
                or ("key" in value and value["key"] != key) or not isinstance(value.get("label"), str)
                or not isinstance(value.get("content"), str)):
            raise ValueError("Assistant conversation contains an invalid attachment.")
        result[key] = {"key": key, "label": value["label"], "content": value["content"]}
    return result


def _summary(chat):
    return {key: chat[key] for key in ("id", "mode", "title", "createdAt", "updatedAt", "revision")}


def list_chats():
    with _LOCK:
        root = _root()
        chats = []
        if root.exists():
            for folder in root.iterdir():
                if folder.is_dir() and _ID.fullmatch(folder.name):
                    chat = _read(folder / "conversation.json")
                    chats.append(_summary(chat))
        chats.sort(key=lambda chat: chat["updatedAt"], reverse=True)
        return {"chats": chats, "activeByMode": _active()}


def create_chat(mode):
    if mode not in _MODES:
        raise ValueError("Assistant conversation mode must be Chat or Storyboard.")
    with _LOCK:
        chat_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + "-" + uuid.uuid4().hex[:8]
        now = _now()
        chat = {"id": chat_id, "mode": mode, "title": "New chat", "createdAt": now,
                "updatedAt": now, "revision": 0, "messages": [], "draft": "", "attachments": {}}
        _write(_path(chat_id), chat)
        _set_active(mode, chat_id)
        return chat


def open_chat(chat_id, *, activate=True):
    with _LOCK:
        chat = _read(_path(chat_id))
        if activate:
            _set_active(chat["mode"], chat_id)
        return chat


def save_chat(chat_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Assistant conversation update must be an object.")
    with _LOCK:
        path = _path(chat_id)
        chat = _read(path)
        expected = payload.get("expectedRevision")
        if isinstance(expected, bool) or not isinstance(expected, int) or expected != chat["revision"]:
            raise RuntimeError("Assistant conversation changed elsewhere. Reload it before editing; current text was not overwritten.")
        title = payload.get("title")
        draft = payload.get("draft")
        if not isinstance(title, str) or not title.strip() or not isinstance(draft, str):
            raise ValueError("Assistant conversation requires a title and draft text.")
        chat.update(title=title.strip(), draft=draft,
                    messages=_validate_messages(payload.get("messages")),
                    attachments=_validate_attachments(payload.get("attachments", {})),
                    revision=chat["revision"] + 1, updatedAt=_now())
        _write(path, chat)
        return chat


def delete_chat(chat_id):
    with _LOCK:
        path = _path(chat_id)
        chat = _read(path)
        path.unlink()
        path.parent.rmdir()
        if _active().get(chat["mode"]) == chat_id:
            _set_active(chat["mode"], None)
        return chat_id
