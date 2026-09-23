"""Durable run-owned metadata for one managed training action."""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


MANIFEST_FILE_NAME = "webcap-run.json"
MANIFEST_VERSION = 1
_manifest_lock = threading.RLock()


def _manifest_path(action_root):
    return Path(action_root) / MANIFEST_FILE_NAME


def _validate_root(action_root):
    root = Path(action_root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Training action directory is unavailable.")
    return root


def _validate_run_id(run_id):
    value = str(run_id or "").strip()
    parts = PurePosixPath(value).parts
    if not value or value.startswith("/") or "\\" in value or ".." in parts or len(parts) != 2:
        raise ValueError("Training run identity is invalid.")
    return value


def _read_unlocked(action_root, run_id):
    root = _validate_root(action_root)
    identity = _validate_run_id(run_id)
    path = _manifest_path(root)
    if not path.exists():
        return {"schemaVersion": MANIFEST_VERSION, "runId": identity}
    if not path.is_file() or path.is_symlink():
        raise ValueError("Training run manifest is not a regular file: " + str(path))
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read training run manifest; it was left unchanged: " + str(path)) from exc
    if not isinstance(payload, dict) or payload.get("schemaVersion") != MANIFEST_VERSION:
        raise ValueError("Unsupported training run manifest: " + str(path))
    recorded = str(payload.get("runId") or "").strip()
    if recorded != identity:
        raise ValueError("Training run manifest identity does not match its managed action.")
    selected = payload.get("selected")
    if selected is not None:
        if not isinstance(selected, dict):
            raise ValueError("Training run manifest has an invalid selected epoch.")
        try:
            epoch = int(selected.get("epoch"))
            step = int(selected.get("step"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Training run manifest has an invalid selected epoch.") from exc
        if epoch <= 0 or step < 0:
            raise ValueError("Training run manifest has an invalid selected epoch.")
    return payload


def read_run_manifest(action_root, run_id):
    with _manifest_lock:
        return dict(_read_unlocked(action_root, run_id))


def selected_epoch(action_root, run_id):
    with _manifest_lock:
        selected = _read_unlocked(action_root, run_id).get("selected")
        return dict(selected) if isinstance(selected, dict) else None


def _write_unlocked(action_root, payload):
    root = _validate_root(action_root)
    target = _manifest_path(root)
    temporary = target.with_name("." + target.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def select_epoch(action_root, run_id, epoch, step):
    identity = _validate_run_id(run_id)
    try:
        epoch_number = int(epoch)
        step_number = int(step)
    except (TypeError, ValueError) as exc:
        raise ValueError("Selected epoch and step must be whole numbers.") from exc
    if epoch_number <= 0 or step_number < 0:
        raise ValueError("Selected epoch and step must be non-negative whole numbers.")

    with _manifest_lock:
        payload = _read_unlocked(action_root, identity)
        payload["selected"] = {
            "epoch": epoch_number,
            "step": step_number,
            "selectedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        _write_unlocked(action_root, payload)
        return dict(payload["selected"])


def clear_selected_epoch(action_root, run_id):
    identity = _validate_run_id(run_id)
    with _manifest_lock:
        payload = _read_unlocked(action_root, identity)
        if "selected" not in payload:
            return None
        payload.pop("selected", None)
        _write_unlocked(action_root, payload)
        return None
