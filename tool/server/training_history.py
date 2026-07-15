import json
import os
import re
import time
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import output_dir_from_config


HISTORY_FILE_NAME = ".webcap_training.json"
HISTORY_VERSION = 3
_EPOCH_PATTERN = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_PATTERN = re.compile(r"^global_step(\d+)$", re.IGNORECASE)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_RUN_STAGE_PATTERN = re.compile(r"(?:^|[-_.])(hi|lo)(?:$|[-_.])", re.IGNORECASE)
_DATASET_CONFIG_PATTERN = re.compile(r"^\s*dataset\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$", re.MULTILINE)


def output_root_for_folder(folder_path, stage="hi"):
    folder = Path(folder_path)
    configured = output_dir_from_config(folder, stage) if stage in ("hi", "lo") else None
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


def _configured_epochs(folder_path, stage):
    try:
        text = (Path(folder_path) / ("config." + stage + ".toml")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def _stage_from_run_name(name):
    matches = _RUN_STAGE_PATTERN.findall(str(name or ""))
    return matches[-1].lower() if matches else ""


def _set_name_from_run_config(entry, fallback_name):
    for config_path in sorted(Path(entry).glob("*.toml")):
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue
        match = _DATASET_CONFIG_PATTERN.search(config_text)
        if not match:
            continue
        dataset_path = match.group(1).strip().replace("\\", "/")
        set_name = Path(dataset_path).parent.name
        if set_name and set_name != ".":
            return set_name
    return str(fallback_name or "")


def _run_artifact_state(entry, expected_epochs):
    highest_epoch = 0
    highest_step = 0
    try:
        children = list(entry.iterdir())
    except OSError:
        return False, 0, 0
    for child in children:
        epoch = _EPOCH_PATTERN.match(child.name)
        step = _STEP_PATTERN.match(child.name)
        if epoch:
            highest_epoch = max(highest_epoch, int(epoch.group(1)))
        if step:
            highest_step = max(highest_step, int(step.group(1)))
    completed = bool(expected_epochs and highest_epoch >= expected_epochs)
    return completed, highest_epoch, highest_step


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
    if not isinstance(data, dict) or data.get("version") not in (2, HISTORY_VERSION):
        return _default_history(folder_path)
    data["version"] = HISTORY_VERSION
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
        root_stages = [name for name in ("hi", "lo") if output_root_for_folder(folder_path, name) == root]
        root_stage = root_stages[0] if len(root_stages) == 1 else ""
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
            entry_stage = root_stage or _stage_from_run_name(entry.name)
            if stage in ("hi", "lo") and entry_stage != stage:
                continue
            expected_epochs = _configured_epochs(folder_path, entry_stage) if entry_stage else 0
            completed, highest_epoch, highest_step = _run_artifact_state(entry, expected_epochs)
            runs.append({
                "path": str(entry),
                "name": entry.name,
                "setName": _set_name_from_run_config(entry, Path(folder_path).name),
                "stage": entry_stage,
                "modifiedAt": modified,
                "checkpointAvailable": bool(has_contents),
                "completed": completed,
                "epoch": highest_epoch or None,
                "steps": highest_step or None,
                "expectedEpochs": expected_epochs or None,
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
        "id", "folder", "stages", "modelLabel", "resumeFromCheckpoint", "resumeStage", "status", "stage",
        "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "completionNote", "exitCode", "parentJobId",
        "outputRoot", "progress", "profile", "model", "input", "artifactDir", "artifactSummary",
    )
    record = {field: job.get(field) for field in record_fields if field in job}
    for field in ("error", "completionNote"):
        if isinstance(record.get(field), str):
            record[field] = record[field][:1000]
    if isinstance(record.get("model"), dict):
        record["model"] = {
            "label": str(record["model"].get("label") or "")[:160],
            "source": str(record["model"].get("source") or "")[:512],
        }
    latest_run = runs[0] if runs else {}
    record["artifactSummary"] = {
        "runCount": len(runs), "latestName": latest_run.get("name", ""),
        "checkpointAvailable": bool(latest_run.get("checkpointAvailable")),
        "epoch": latest_run.get("epoch"), "steps": latest_run.get("steps"),
    }
    existing = history["jobs"]
    for index, item in enumerate(existing):
        if str(item.get("id") or "") == str(record.get("id") or ""):
            existing[index] = record
            break
    else:
        existing.append(record)
    # Discovery data can be large. It is response-only, never persisted in the index.
    history["runs"] = []
    _write_history(folder_path, history)
    history["runs"] = runs
    return history


def history_payload(folder_path):
    history = read_history(folder_path)
    history["runs"] = discover_runs(folder_path)
    return history


def all_history_payload(query="", folder=""):
    """Aggregate the intentionally small, folder-local history indexes."""
    root = Path(app_config.FS_ROOT)
    wanted_folder = str(folder or "").replace("\\", "/").strip("/")
    needle = str(query or "").strip().lower()
    jobs = []
    for path in root.rglob(HISTORY_FILE_NAME):
        if ".webcap_training" in path.parts or "auto_dataset" in path.parts:
            continue
        set_folder = path.parent
        try:
            relative = str(set_folder.relative_to(root)).replace("\\", "/")
        except ValueError:
            continue
        if wanted_folder and relative != wanted_folder:
            continue
        history = read_history(set_folder)
        for job in history.get("jobs") or []:
            if not isinstance(job, dict):
                continue
            if needle:
                model = job.get("model") if isinstance(job.get("model"), dict) else {}
                haystack = " ".join(str(value or "") for value in (
                    relative, job.get("folder"), job.get("profile"), job.get("stages"), job.get("status"),
                    job.get("modelLabel"), model.get("label"), model.get("source"),
                )).lower()
                if needle not in haystack:
                    continue
            item = dict(job)
            item["folder"] = relative
            recorded_input = item.get("input") if isinstance(item.get("input"), dict) else {}
            try:
                from .training_runner import _input_evidence
                current_input = _input_evidence(set_folder)
                item["input"] = dict(recorded_input)
                item["input"]["comparison"] = "matches" if recorded_input.get("fingerprint") == current_input.get("fingerprint") and recorded_input.get("configFingerprint") == current_input.get("configFingerprint") else "changed"
            except Exception:
                if recorded_input:
                    item["input"] = dict(recorded_input)
                    item["input"]["comparison"] = "unavailable"
            jobs.append(item)
    jobs.sort(key=lambda job: float(job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0), reverse=True)
    return {"version": HISTORY_VERSION, "jobs": jobs, "query": query, "folder": wanted_folder}


def clear_history(folder_path=None):
    """Clear indexes only; job bundles and trainer artifacts are deliberately untouched."""
    root = Path(app_config.FS_ROOT)
    paths = [_history_path(folder_path)] if folder_path else list(root.rglob(HISTORY_FILE_NAME))
    cleared = 0
    for path in paths:
        try:
            if path.exists():
                path.unlink()
                cleared += 1
        except OSError:
            continue
    return cleared


def clear_history_job(folder_path, job_id):
    """Remove one history index entry without touching its logs or training artifacts."""
    history = read_history(folder_path)
    wanted_id = str(job_id or "").strip()
    if not wanted_id:
        return False
    original = history.get("jobs") or []
    retained = [job for job in original if str(job.get("id") or "") != wanted_id]
    if len(retained) == len(original):
        return False
    history["jobs"] = retained
    _write_history(folder_path, history)
    return True


def completed_stages(folder_path):
    folder = Path(folder_path)
    stages = [stage for stage in ("hi", "lo") if (folder / ("config." + stage + ".toml")).is_file()]
    history = read_history(folder)
    completed = set()
    for job in history.get("jobs") or []:
        if job.get("status") not in ("completed", "finished_early"):
            continue
        stage = str(job.get("stages") or "")
        if stage == "both":
            completed.update(stages)
        elif stage in stages:
            completed.add(stage)
    for stage in stages:
        if any(run.get("completed") for run in discover_runs(folder, stage)):
            completed.add(stage)
    return stages, completed
