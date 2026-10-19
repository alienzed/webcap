"""Durable Set-owned training reference choices, independent of Test sessions."""
import json
import os
import threading
from pathlib import Path

from .caption_ops import _resolve_folder
from .epoch_reference import verified_reference

_lock = threading.RLock()
_FILENAME = "training_references.json"


def _path(folder):
    root = _resolve_folder(folder)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Training reference Set is unavailable.")
    path = root / _FILENAME
    if path.is_symlink():
        raise ValueError("Training reference state must not be a symlink.")
    return path


def _read(path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("selections"), list):
        raise ValueError("Invalid saved training references.")
    result = {}
    for row in data["selections"]:
        if not isinstance(row, dict) or any(not isinstance(row.get(k), str) or not row[k] for k in ("runId", "group", "term", "media")):
            raise ValueError("Invalid saved training reference entry.")
        result[(row["runId"], row["group"], row["term"])] = {k: row[k] for k in ("runId", "group", "term", "media")}
    return result


def _write(path, values):
    from .epoch_test_bench import _atomic_write_json
    _atomic_write_json(path, {"version": 1, "selections": list(values.values())})


def command(folder, operation, criteria):
    path = _path(folder)
    if operation == "reference_selection_list":
        with _lock:
            rows = list(_read(path).values())
        return {"selections": rows}
    if operation not in {"reference_selection_save", "reference_selection_remove"}:
        raise ValueError("Unsupported reference selection operation.")
    fields = ("runId", "group", "term")
    values = {k: criteria.get(k) for k in fields}
    if any(not isinstance(v, str) or not v.strip() for v in values.values()):
        raise ValueError("A training run, group and tag are required.")
    key = tuple(values[k] for k in fields)
    if operation == "reference_selection_save":
        media = criteria.get("media")
        if not isinstance(media, str) or not media.strip():
            raise ValueError("Select a reference image.")
        verified_reference(folder, values["group"], values["term"], media, values["runId"])
    with _lock:
        selections = _read(path)
        if operation == "reference_selection_save":
            selections[key] = {**values, "media": media}
        else:
            selections.pop(key, None)
        _write(path, selections)
    return {"saved": True}
