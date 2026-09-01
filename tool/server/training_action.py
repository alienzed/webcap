"""Visible, self-contained ownership for one training action.

This module deliberately knows only the managed action tree.  It never scans
legacy run groups and it never accepts a caller supplied filesystem path as an
action identity.
"""

import hashlib
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

from . import config as app_config


ACTION_VERSION = 1
_ACTION_NAME = re.compile(r"^\d{3,}-.+")
_SLUG_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")
_TRIM_PUNCTUATION = ".-_"
_action_lock = threading.RLock()


def actions_root():
    return Path(app_config.FS_ROOT) / "output" / "runs"


def normalize_run_name(value):
    name = str(value or "").strip()
    if len(name) > 80:
        name = name[:80].rstrip()
    slug = _SLUG_UNSAFE.sub("-", name).strip(_TRIM_PUNCTUATION)[:48].strip(_TRIM_PUNCTUATION)
    if name and not slug:
        raise ValueError("Run name must contain at least one letter or number usable in a folder name.")
    return name, slug


def _folder_slug(folder_path):
    slug = _SLUG_UNSAFE.sub("-", Path(folder_path).name).strip(_TRIM_PUNCTUATION)[:80].strip(_TRIM_PUNCTUATION)
    if not slug:
        raise ValueError("The set folder name cannot be used for a training action directory.")
    return slug


def _relative_folder(folder_path):
    root = Path(app_config.FS_ROOT).resolve()
    return Path(folder_path).resolve().relative_to(root).as_posix()


def _atomic_write(path, payload):
    target = Path(path)
    tmp = target.with_name("." + target.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _manifest_path(action_path):
    return Path(action_path) / "action.json"


def _validate_relpath(value, label):
    path = Path(str(value or ""))
    if not value or path.is_absolute() or ".." in path.parts:
        raise ValueError("Action manifest has an unsafe " + label + " path.")
    return path


def read_action(action_id):
    name = str(action_id or "").strip()
    if Path(name).name != name or not _ACTION_NAME.match(name):
        raise ValueError("Training action ID is invalid.")
    root = actions_root()
    path = root / name
    if not path.is_dir() or path.is_symlink():
        raise ValueError("Training action is unavailable: " + name)
    try:
        data = json.loads(_manifest_path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Training action manifest is unavailable: " + name) from exc
    if not isinstance(data, dict) or data.get("version") != ACTION_VERSION or data.get("actionId") != name:
        raise ValueError("Training action manifest is invalid: " + name)
    if not isinstance(data.get("jobs"), dict) or not isinstance(data.get("outputs"), dict):
        raise ValueError("Training action manifest has invalid job/output records: " + name)
    return path, data


def action_paths(action_id):
    root, data = read_action(action_id)
    captures = root / "captures"
    if not captures.is_dir() or captures.is_symlink():
        raise FileNotFoundError("Training action captures are unavailable.")
    return root, captures, captures, data


def allocate_action(folder_path, profile, mode, stages, run_name=""):
    """Create an empty, visible action parent using mkdir as the allocation lock."""
    run_name, run_slug = normalize_run_name(run_name)
    root = actions_root()
    root.mkdir(parents=True, exist_ok=True)
    set_slug = _folder_slug(folder_path)
    with _action_lock:
        highest = 0
        try:
            children = list(root.iterdir())
        except OSError as exc:
            raise RuntimeError("Could not inspect the training actions root.") from exc
        for child in children:
            match = re.match(r"^(\d+)-", child.name)
            if match and child.is_dir() and not child.is_symlink():
                highest = max(highest, int(match.group(1)))
        for sequence in range(highest + 1, highest + 10000):
            model_slug = _SLUG_UNSAFE.sub("-", str(profile.get("slug") or profile.get("id") or "model")).strip(_TRIM_PUNCTUATION)
            action_id = str(sequence).zfill(max(3, len(str(sequence)))) + "-" + set_slug + "--" + model_slug
            if run_slug:
                action_id += "--" + run_slug
            action = root / action_id
            try:
                action.mkdir()
            except FileExistsError:
                continue
            (action / "captures").mkdir()
            (action / "jobs").mkdir()
            (action / "output").mkdir()
            payload = {
                "version": ACTION_VERSION,
                "actionId": action_id,
                "runName": run_name,
                "folder": _relative_folder(folder_path),
                "profileId": str(profile.get("id") or ""),
                "profileLabel": str(profile.get("label") or ""),
                "mode": str(mode or "normal"),
                "requestedStages": list(stages),
                "createdAt": time.time(),
                "captures": [],
                "jobs": {stage: [] for stage in stages},
                "outputs": {stage: [] for stage in stages},
            }
            _atomic_write(_manifest_path(action), payload)
            return action, payload
    raise RuntimeError("Could not allocate a unique training action directory.")


def update_action(action_id, mutate):
    with _action_lock:
        root, data = read_action(action_id)
        mutate(data)
        _atomic_write(_manifest_path(root), data)
        return root, data


def fingerprint_files(paths):
    digest = hashlib.sha256()
    for path in sorted((Path(item) for item in paths), key=lambda item: str(item)):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return "sha256:" + digest.hexdigest()


def managed_action_children():
    root = actions_root()
    if not root.is_dir():
        return []
    rows = []
    for path in root.iterdir():
        if not path.is_dir() or path.is_symlink() or not _ACTION_NAME.match(path.name):
            continue
        try:
            action, data = read_action(path.name)
        except ValueError:
            continue
        rows.append((action, data))
    return rows
