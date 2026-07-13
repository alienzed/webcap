import json
import os
import time
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import output_dir_from_config


HISTORY_FILE_NAME = ".webcap_training.json"
HISTORY_VERSION = 2


def output_root_for_folder(folder_path, stage="hi"):
    folder = Path(folder_path)
    configured = output_dir_from_config(folder, stage)
    if configured:
        return configured
    return Path(app_config.FS_ROOT) / "output" / "runs" / folder.name


def output_roots_for_folder(folder_path):
    roots = []
    for stage in ("hi", "lo"):
        root = output_root_for_folder(folder_path, stage)
        if root not in roots:
            roots.append(root)
    return roots


def _history_path(folder_path):
    return Path(folder_path) / HISTORY_FILE_NAME


def _default_history(folder_path):
    return {
        "version": HISTORY_VERSION,
        "outputRoot": str(output_root_for_folder(folder_path)),
        "jobs": [],
        "runs": [],
    }


def read_history(folder_path):
    path = _history_path(folder_path)
    if not path.exists():
        return _default_history(folder_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_history(folder_path)
    if not isinstance(data, dict) or data.get("version") != HISTORY_VERSION:
        return _default_history(folder_path)
    data["outputRoot"] = str(output_root_for_folder(folder_path))
    if not isinstance(data.get("jobs"), list):
        data["jobs"] = []
    if not isinstance(data.get("runs"), list):
        data["runs"] = []
    return data


def _write_history(folder_path, data):
    path = _history_path(folder_path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    normalize_path_permissions(path)


def discover_runs(folder_path, stage=""):
    roots = [output_root_for_folder(folder_path, stage)] if stage in ("hi", "lo") else output_roots_for_folder(folder_path)
    runs = []
    seen = set()
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for entry in root.iterdir():
            if not entry.is_dir() or entry in seen:
                continue
            try:
                modified = entry.stat().st_mtime
                has_contents = any(entry.iterdir())
            except OSError:
                continue
            seen.add(entry)
            runs.append({
                "path": str(entry),
                "name": entry.name,
                "modifiedAt": modified,
                "checkpointAvailable": bool(has_contents),
            })
    return sorted(runs, key=lambda run: run["modifiedAt"], reverse=True)


def summarize_history(folder_path):
    history = read_history(folder_path)
    jobs = history.get("jobs") or []
    latest = jobs[-1] if jobs else None
    return {
        "status": str((latest or {}).get("status") or "never"),
        "updatedAt": (latest or {}).get("updatedAt") or (latest or {}).get("finishedAt") or (latest or {}).get("createdAt") or 0,
    }


def record_job(folder_path, job):
    history = read_history(folder_path)
    runs = discover_runs(folder_path, str(job.get("stages") or ""))
    record_fields = (
        "id", "folder", "stages", "resumeFromCheckpoint", "resumeStage", "status", "stage",
        "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "completionNote", "exitCode", "parentJobId",
        "outputRoot", "progress",
    )
    record = {field: job.get(field) for field in record_fields if field in job}
    record["runDirectories"] = runs
    existing = history["jobs"]
    for index, item in enumerate(existing):
        if str(item.get("id") or "") == str(record.get("id") or ""):
            existing[index] = record
            break
    else:
        existing.append(record)
    history["runs"] = runs
    _write_history(folder_path, history)
    return history


def history_payload(folder_path):
    history = read_history(folder_path)
    history["runs"] = discover_runs(folder_path)
    return history
