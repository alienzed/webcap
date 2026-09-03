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
from pathlib import Path, PurePosixPath

from . import config as app_config


ACTION_VERSION = 2
_ACTION_NAME = re.compile(r"^\d{3,}-[A-Za-z0-9._-]+$")
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
    slug = _SLUG_UNSAFE.sub("-", Path(folder_path).name.lower()).strip(_TRIM_PUNCTUATION)[:48].strip(_TRIM_PUNCTUATION)
    if not slug:
        raise ValueError("The set folder name cannot be used for a training action directory.")
    return slug


def _relative_folder(folder_path):
    root = Path(app_config.FS_ROOT).resolve()
    return Path(folder_path).resolve().relative_to(root).as_posix()


def set_root_name(folder_path):
    relative = _relative_folder(folder_path)
    digest = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:12]
    return _folder_slug(folder_path) + "--" + digest


def set_root_for_folder(folder_path):
    """Find the existing prefixed root for a set without mutating the tree."""
    identity = set_root_name(folder_path)
    try:
        with os.scandir(actions_root()) as entries:
            names = [entry.name for entry in entries if entry.is_dir(follow_symlinks=False)]
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise RuntimeError("Could not inspect the training actions root.") from exc
    matches = [
        actions_root() / name for name in names
        if re.fullmatch(r"\d+-" + re.escape(identity), name)
    ]
    if len(matches) > 1:
        raise RuntimeError("Multiple training set roots claim the same set identity: " + identity)
    return matches[0] if matches else None


def _allocate_set_root(folder_path):
    identity = set_root_name(folder_path)
    root = actions_root()
    root.mkdir(parents=True, exist_ok=True)
    while True:
        existing = set_root_for_folder(folder_path)
        if existing is not None:
            return existing
        try:
            with os.scandir(root) as entries:
                names = [entry.name for entry in entries if entry.is_dir(follow_symlinks=False)]
        except OSError as exc:
            raise RuntimeError("Could not inspect the training actions root.") from exc
        highest = max((int(match.group(1)) for name in names
                       for match in [re.match(r"^(\d+)-", name)] if match), default=0)
        sequence = highest + 1
        name = str(sequence).zfill(max(3, len(str(sequence)))) + "-" + identity
        try:
            (root / name).mkdir()
        except FileExistsError:
            continue
        return root / name


def action_id_for_root(action_root):
    try:
        return Path(action_root).resolve().relative_to(actions_root().resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("Training action is outside the managed actions root.") from exc


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
    parts = PurePosixPath(name).parts
    if not name or name.startswith("/") or "\\" in name or ".." in parts or len(parts) != 2 or not _ACTION_NAME.match(parts[1]):
        raise ValueError("Training action ID is invalid.")
    root = actions_root()
    path = root.joinpath(*parts)
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
    with _action_lock:
        set_root = _allocate_set_root(folder_path)
        highest = 0
        try:
            children = list(set_root.iterdir())
        except OSError as exc:
            raise RuntimeError("Could not inspect the training actions root.") from exc
        for child in children:
            match = re.match(r"^(\d+)-", child.name)
            if match and child.is_dir() and not child.is_symlink():
                highest = max(highest, int(match.group(1)))
        for sequence in range(highest + 1, highest + 10000):
            model_slug = _SLUG_UNSAFE.sub("-", str(profile.get("slug") or profile.get("id") or "model")).strip(_TRIM_PUNCTUATION)
            logical_name = str(sequence).zfill(max(3, len(str(sequence)))) + "-" + model_slug
            if run_slug:
                logical_name += "--" + run_slug
            action_id = (PurePosixPath(set_root.name) / logical_name).as_posix()
            action = set_root / logical_name
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


def managed_actions_for_folder(folder_path):
    root = set_root_for_folder(folder_path)
    if root is None:
        return []
    rows = []
    for path in root.iterdir():
        if not path.is_dir() or path.is_symlink() or not _ACTION_NAME.match(path.name):
            continue
        try:
            action, data = read_action((PurePosixPath(root.name) / path.name).as_posix())
        except ValueError as exc:
            raise ValueError("Managed training action is invalid: " + str(path)) from exc
        rows.append((action, data))
    return rows
