"""Durable metadata stored inside one trainer timestamp run folder."""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


MANIFEST_FILE_NAME = "webcap-run.json"
MANIFEST_VERSION = 1
_manifest_lock = threading.RLock()


def _manifest_path(run_dir):
    return Path(run_dir) / MANIFEST_FILE_NAME


def _validate_root(run_dir):
    root = Path(run_dir)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Trainer run directory is unavailable.")
    return root


def _validate_run_id(run_id):
    value = str(run_id or "").strip()
    parts = PurePosixPath(value).parts
    if not value or value.startswith("/") or "\\" in value or ".." in parts or len(parts) != 2:
        raise ValueError("Training run identity is invalid.")
    return value


def _read_unlocked(run_dir, run_id):
    root = _validate_root(run_dir)
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
        raise ValueError("Training run manifest identity does not match its recorded training experiment.")
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
        saved_stage = selected.get("savedStage")
        saved_destination = selected.get("savedDestination")
        saved_file_name = selected.get("savedFileName")
        if any(value is not None for value in (saved_stage, saved_destination, saved_file_name)):
            if not all(isinstance(value, str) and value.strip() for value in (saved_stage, saved_file_name)):
                raise ValueError("Training run manifest has invalid saved LoRA evidence.")
            destination = str(saved_destination or "").strip()
            if destination.startswith("/") or "\\" in destination or ".." in PurePosixPath(destination).parts:
                raise ValueError("Training run manifest has invalid saved LoRA destination evidence.")
            file_name = str(saved_file_name).strip()
            if Path(file_name).name != file_name or "/" in file_name or "\\" in file_name:
                raise ValueError("Training run manifest has invalid saved LoRA filename evidence.")
    return payload


def read_run_manifest(run_dir, run_id):
    with _manifest_lock:
        return dict(_read_unlocked(run_dir, run_id))


def selected_epoch(run_dir, run_id):
    with _manifest_lock:
        selected = _read_unlocked(run_dir, run_id).get("selected")
        return dict(selected) if isinstance(selected, dict) else None


def _write_unlocked(run_dir, payload):
    root = _validate_root(run_dir)
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


def select_epoch(run_dir, run_id, epoch, step, saved_stage=None, saved_destination=None, saved_file_name=None):
    identity = _validate_run_id(run_id)
    try:
        epoch_number = int(epoch)
        step_number = int(step)
    except (TypeError, ValueError) as exc:
        raise ValueError("Selected epoch and step must be whole numbers.") from exc
    if epoch_number <= 0 or step_number < 0:
        raise ValueError("Selected epoch and step must be non-negative whole numbers.")

    with _manifest_lock:
        payload = _read_unlocked(run_dir, identity)
        payload["selected"] = {
            "epoch": epoch_number,
            "step": step_number,
            "selectedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        if saved_stage is not None or saved_destination is not None or saved_file_name is not None:
            stage = str(saved_stage or "").strip().lower()
            destination = str(saved_destination or "").strip().replace("\\", "/").strip("/")
            file_name = str(saved_file_name or "").strip()
            if not stage or not file_name:
                raise ValueError("Saved LoRA evidence requires a stage and filename.")
            if destination.startswith("/") or ".." in PurePosixPath(destination).parts:
                raise ValueError("Saved LoRA destination evidence is invalid.")
            if Path(file_name).name != file_name or "/" in file_name or "\\" in file_name:
                raise ValueError("Saved LoRA filename evidence is invalid.")
            payload["selected"]["savedStage"] = stage
            payload["selected"]["savedDestination"] = destination
            payload["selected"]["savedFileName"] = file_name
        _write_unlocked(run_dir, payload)
        return dict(payload["selected"])


def record_archive_metadata(run_dir, run_id, metadata):
    identity = _validate_run_id(run_id)
    if not isinstance(metadata, dict):
        raise ValueError("Archive metadata must be an object.")
    with _manifest_lock:
        payload = _read_unlocked(run_dir, identity)
        payload["archive"] = dict(metadata)
        _write_unlocked(run_dir, payload)
        return dict(payload["archive"])


def clear_selected_epoch(run_dir, run_id):
    identity = _validate_run_id(run_id)
    with _manifest_lock:
        payload = _read_unlocked(run_dir, identity)
        if "selected" not in payload:
            return None
        payload.pop("selected", None)
        _write_unlocked(run_dir, payload)
        return None
