import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

import tomllib

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import allocate_training_launch_group, output_dir_from_config, training_config_path
from .training_profiles import config_for_id


HISTORY_FILE_NAME = ".webcap_training.json"
HISTORY_VERSION = 3
RECENT_RUNS_FILE_NAME = "recent_runs.json"
RECENT_RUNS_VERSION = 1
_history_lock = threading.RLock()
_EPOCH_PATTERN = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_PATTERN = re.compile(r"^global_step(\d+)$", re.IGNORECASE)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_DATASET_CONFIG_PATTERN = re.compile(r"^\s*dataset\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$", re.MULTILINE)
_OUTPUT_GROUP_PATTERN = re.compile(r"^\d{3}-.+$")


def output_root_for_folder(folder_path, stage=""):
    return host_path_for_training_path(output_root_path_for_folder(folder_path, stage))


def output_root_path_for_folder(folder_path, stage=""):
    folder = Path(folder_path)
    stages = (stage,) if stage in ("hi", "lo", "krea2", "wan21", "h3") else ("hi", "lo", "krea2", "wan21", "h3")
    for candidate_stage in stages:
        configured = output_dir_from_config(folder, candidate_stage)
        if configured:
            return str(configured)
    return str(Path(app_config.FS_ROOT) / "output" / "runs" / folder.name)


def _wsl_distribution():
    training = app_config.config.get("training") if isinstance(app_config.config, dict) else {}
    return str(training.get("wsl_distribution") or "").strip() if isinstance(training, dict) else ""


def host_path_for_training_path(path):
    value = str(path or "").strip()
    if not value or os.name != "nt" or not value.startswith("/"):
        return Path(value)
    executable = shutil.which("wsl.exe") or shutil.which("wsl")
    if not executable:
        raise RuntimeError("wsl.exe was not found while resolving the configured training output path.")
    args = [executable]
    distribution = _wsl_distribution()
    if distribution:
        args.extend(["--distribution", distribution])
    args.extend(["--", "bash", "-lc", "wslpath -w " + shlex.quote(value)])
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
    except Exception as exc:
        raise RuntimeError("Could not resolve the configured training output path: " + str(exc)) from exc
    converted = (completed.stdout or "").strip()
    if completed.returncode != 0 or not converted:
        raise RuntimeError((completed.stderr or completed.stdout or "Could not resolve the configured training output path.").strip())
    return Path(converted)


def _training_path_for_entry(entry, host_root, training_root):
    path = Path(entry)
    root = Path(host_root)
    raw_root = str(training_root or "")
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        return str(path)
    if raw_root.startswith("/"):
        return str(PurePosixPath(raw_root) / PurePosixPath(relative))
    return str(path)


def _history_path(folder_path):
    return Path(folder_path) / HISTORY_FILE_NAME


def _recent_runs_path():
    return Path(app_config.FS_ROOT) / ".webcap_training" / RECENT_RUNS_FILE_NAME


def _folder_key(folder_path):
    folder = Path(folder_path).resolve()
    root = Path(app_config.FS_ROOT).resolve()
    return folder.relative_to(root).as_posix()


def _write_json_atomic(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(target.parent)
    tmp = target.with_name("." + target.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
        normalize_path_permissions(target)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _local_metadata(data=None):
    payload = {"version": HISTORY_VERSION}
    output_group = str((data or {}).get("outputGroup") or "").strip()
    if output_group:
        payload["outputGroup"] = output_group
    return payload


def _migrate_legacy_histories():
    """Move legacy per-set job rows into the central Recent Runs index once."""
    root = Path(app_config.FS_ROOT)
    jobs_by_key = {}
    local_metadata = []
    if root.is_dir():
        for path in root.rglob(HISTORY_FILE_NAME):
            if ".webcap_training" in path.parts or "auto_dataset" in path.parts:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                app_config.debug_print("[training_history] Left unreadable legacy metadata unchanged:", path)
                continue
            if not isinstance(data, dict) or data.get("version") not in (HISTORY_VERSION, 4):
                app_config.debug_print("[training_history] Left unsupported legacy metadata unchanged:", path)
                continue
            try:
                folder = path.parent.relative_to(root).as_posix()
            except ValueError:
                continue
            for job in data.get("jobs") or []:
                if not isinstance(job, dict) or job.get("status") == "cancelled":
                    continue
                item = dict(job)
                item["folder"] = folder
                job_id = str(item.get("id") or "").strip()
                if not job_id:
                    continue
                key = (folder, job_id)
                existing = jobs_by_key.get(key)
                item_time = float(item.get("finishedAt") or item.get("startedAt") or item.get("createdAt") or 0)
                existing_time = float((existing or {}).get("finishedAt") or (existing or {}).get("startedAt") or (existing or {}).get("createdAt") or 0)
                if existing is None or item_time >= existing_time:
                    jobs_by_key[key] = item
            local_metadata.append((path.parent, _local_metadata(data)))
    jobs = sorted(
        jobs_by_key.values(),
        key=lambda job: float(job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0),
        reverse=True,
    )
    payload = {"version": RECENT_RUNS_VERSION, "jobs": jobs}
    _write_json_atomic(_recent_runs_path(), payload)
    for folder, metadata in local_metadata:
        try:
            _write_json_atomic(_history_path(folder), metadata)
        except OSError as exc:
            app_config.debug_print("[training_history] Could not compact legacy set metadata:", folder, exc)
    return payload


def _read_recent_runs():
    path = _recent_runs_path()
    if not path.exists():
        return _migrate_legacy_histories()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read Recent Runs; it was left unchanged: " + str(path)) from exc
    if not isinstance(data, dict) or data.get("version") != RECENT_RUNS_VERSION or not isinstance(data.get("jobs"), list):
        raise ValueError("Recent Runs is invalid; it was left unchanged: " + str(path))
    return data


def _write_recent_runs(data):
    payload = {
        "version": RECENT_RUNS_VERSION,
        "jobs": list((data or {}).get("jobs") or []),
    }
    _write_json_atomic(_recent_runs_path(), payload)


def _configured_epochs(folder_path, stage):
    try:
        text = (Path(folder_path) / ("config." + stage + ".toml")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def config_sha256(path):
    """Return the byte-exact identity Diffusion Pipe preserves in run output."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _parsed_config(path):
    try:
        return tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError):
        return None


def _model_identity(config, keys):
    model = config.get("model") if isinstance(config, dict) else None
    if not isinstance(model, dict):
        return None
    identity = {}
    for key in keys:
        value = model.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        identity[key] = value.strip()
    return identity


def _epochs_from_parsed_config(config):
    try:
        value = int(config.get("epochs") or 0)
    except (AttributeError, TypeError, ValueError):
        return 0
    return max(0, value)


def _saved_config_for_candidate(run_dir, config_meta, wanted_identity):
    preferred = Path(run_dir) / config_meta["file"]
    paths = [preferred] if preferred.is_file() else []
    paths.extend(path for path in sorted(Path(run_dir).glob("config*.toml")) if path not in paths)
    for path in paths:
        parsed = _parsed_config(path)
        if parsed is None:
            continue
        identity = _model_identity(parsed, config_meta["modelIdentityKeys"])
        if identity == wanted_identity:
            return path, parsed
    return None, None


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


def _resume_artifacts(entry):
    """Return the DeepSpeed latest marker only when it names a real checkpoint."""
    directory = Path(entry)
    latest = directory / "latest"
    if not latest.is_file():
        return []
    try:
        tag = latest.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return []
    if not _STEP_PATTERN.match(tag) or not (directory / tag).is_dir():
        return []
    return [latest]


def _default_history(folder_path):
    result = {
        "version": HISTORY_VERSION,
        "outputRoot": str(output_root_for_folder(folder_path)),
        "jobs": [],
        "runs": [],
    }
    result.update(_local_metadata(_read_history_index(folder_path)))
    return result


def read_history(folder_path):
    folder = Path(folder_path)
    folder_key = _folder_key(folder)
    with _history_lock:
        recent = _read_recent_runs()
        result = _default_history(folder)
        result["jobs"] = [
            dict(job) for job in recent["jobs"]
            if isinstance(job, dict) and str(job.get("folder") or "") == folder_key
        ]
        return result


def _write_history(folder_path, data):
    _write_json_atomic(_history_path(folder_path), _local_metadata(data))


def _read_history_index(folder_path):
    """Read optional set-local metadata without resolving any configured paths."""
    path = _history_path(folder_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": HISTORY_VERSION}
    if not isinstance(data, dict) or data.get("version") != HISTORY_VERSION:
        return {"version": HISTORY_VERSION}
    return _local_metadata(data)


def _recorded_output_group(folder_path):
    history = _read_history_index(folder_path)
    group_name = str(history.get("outputGroup") or "").strip()
    if not group_name or Path(group_name).name != group_name or not _OUTPUT_GROUP_PATTERN.match(group_name):
        return None
    candidate = Path(app_config.FS_ROOT) / "output" / "runs" / group_name
    return candidate if candidate.is_dir() else None


def _output_group_activity(group):
    """Return the newest trainer-created run activity under one set group."""
    newest = 0.0
    try:
        model_dirs = [path for path in group.iterdir() if path.is_dir() and path.name != ".webcap"]
    except OSError:
        return newest
    for model_dir in model_dirs:
        try:
            run_dirs = [path for path in model_dir.iterdir() if path.is_dir()]
        except OSError:
            continue
        for run_dir in run_dirs:
            latest = run_dir / "latest"
            try:
                configs = list(run_dir.glob("config*.toml"))
            except OSError:
                continue
            if not latest.is_file() and not configs:
                continue
            try:
                newest = max(newest, latest.stat().st_mtime if latest.is_file() else run_dir.stat().st_mtime)
            except OSError:
                continue
    return newest


def _adopt_existing_output_group(folder_path):
    root = Path(app_config.FS_ROOT) / "output" / "runs"
    if not root.is_dir():
        return None
    suffix = "-" + Path(folder_path).name
    try:
        candidates = [
            path for path in root.iterdir()
            if path.is_dir() and path.name.endswith(suffix) and _OUTPUT_GROUP_PATTERN.match(path.name)
        ]
    except OSError:
        return None
    if not candidates:
        return None
    return max(candidates, key=lambda path: (_output_group_activity(path), path.name))


def training_output_group_for_folder(folder_path, create=False):
    """Return the set's optional managed output group, allocating only on request."""
    folder = Path(folder_path)
    group = _recorded_output_group(folder) or _adopt_existing_output_group(folder)
    if group is None and create:
        group = allocate_training_launch_group(folder)
    if group is None:
        return None
    history = _read_history_index(folder)
    if history.get("outputGroup") != group.name:
        history["outputGroup"] = group.name
        try:
            _write_history(folder, history)
        except OSError as exc:
            app_config.debug_print("[training_history] Could not remember output group for", folder, ":", exc)
    return group


def discover_runs(folder_path, stage=""):
    folder = Path(folder_path)
    if not folder.is_dir():
        return []
    if stage not in ("hi", "lo", "krea2", "wan21", "h3"):
        combined = []
        for item in ("hi", "lo", "krea2", "wan21", "h3"):
            if training_config_path(folder, item).is_file():
                combined.extend(discover_runs(folder, item))
        return sorted(combined, key=lambda run: run["modifiedAt"], reverse=True)
    stages = (stage,)
    runs = []
    for candidate_stage in stages:
        source_config = training_config_path(folder, candidate_stage)
        parsed_source = _parsed_config(source_config)
        if parsed_source is None:
            continue
        config_meta = config_for_id(candidate_stage)
        wanted_identity = _model_identity(parsed_source, config_meta["modelIdentityKeys"])
        if wanted_identity is None:
            continue
        try:
            source_hash = config_sha256(source_config)
            output_group = training_output_group_for_folder(folder)
            if output_group is not None:
                root = output_group / config_meta["outputSlug"]
                training_root = str(root)
            else:
                training_root = output_root_path_for_folder(folder, candidate_stage)
                root = output_root_for_folder(folder, candidate_stage)
        except (OSError, RuntimeError) as exc:
            app_config.debug_print("[training_history] Could not resolve", candidate_stage, "output root", "for", folder, ":", exc)
            raise
        if not root.is_dir():
            app_config.debug_print("[training_history] No", candidate_stage, "output root to scan:", root)
            continue
        try:
            app_config.debug_print("[training_history] Scanning", root, "for resumable", candidate_stage, "runs.")
            latest_markers = list(root.rglob("latest"))
        except OSError as exc:
            app_config.debug_print("[training_history] Could not scan", root, ":", exc)
            raise
        for latest in latest_markers:
            entry = latest.parent
            if ".webcap" in entry.parts or not _resume_artifacts(entry):
                continue
            saved_config, parsed_saved = _saved_config_for_candidate(entry, config_meta, wanted_identity)
            if saved_config is None:
                app_config.debug_print("[training_history] Skipping", entry, ": no matching", candidate_stage, "model config.")
                continue
            try:
                modified = entry.stat().st_mtime
                checkpoint_tag = latest.read_text(encoding="utf-8").strip().splitlines()[0].strip()
            except (OSError, IndexError):
                continue
            expected_epochs = _epochs_from_parsed_config(parsed_saved)
            completed, highest_epoch, highest_step = _run_artifact_state(entry, expected_epochs)
            training_path = _training_path_for_entry(entry, root, training_root)
            runs.append({
                "path": training_path,
                "runPath": training_path,
                "name": entry.name,
                "setName": _set_name_from_run_config(entry, folder.name),
                "stage": candidate_stage,
                "candidateFor": candidate_stage,
                "modelLabel": config_meta["label"],
                "matchType": "exact" if config_sha256(saved_config) == source_hash else "compatible",
                "configHash": config_sha256(saved_config),
                "modifiedAt": modified,
                "checkpointAvailable": True,
                "checkpointName": "latest",
                "checkpointTag": checkpoint_tag,
                "completed": completed,
                "epoch": highest_epoch or None,
                "steps": highest_step or None,
                "expectedEpochs": expected_epochs or None,
            })
    app_config.debug_print("[training_history] Found", len(runs), "resumable run(s) for", folder, "stage", stage or "all")
    return sorted(runs, key=lambda run: run["modifiedAt"], reverse=True)


def validate_resumable_run_for_path(folder_path, stage, run_path):
    """Validate the exact checkpoint path recorded for an automatic resume."""
    raw_path = str(run_path or "").strip()
    if not raw_path:
        raise ValueError("A resume directory is required.")
    directory = host_path_for_training_path(raw_path)
    if not directory.is_dir():
        raise ValueError("Recorded resume directory is unavailable: " + raw_path)
    resume_artifacts = _resume_artifacts(directory)
    if not resume_artifacts:
        raise ValueError("Recorded resume directory has no valid latest DeepSpeed checkpoint: " + raw_path)
    point = resume_point_from_directory(folder_path, stage, raw_path)
    return {"path": raw_path, "runPath": raw_path, "stage": stage, **point}


def discovered_run_output_path(folder_path, stage, run_path):
    """Resolve one currently discovered same-model run for an Explorer action."""
    raw_path = str(run_path or "").strip()
    if not raw_path:
        raise ValueError("A training run directory is required.")
    match = next(
        (run for run in discover_runs(folder_path, str(stage or "")) if str(run.get("path") or "") == raw_path),
        None,
    )
    if match is None:
        raise ValueError("Training run is not a current same-model candidate: " + raw_path)
    directory = host_path_for_training_path(raw_path)
    if not directory.is_dir():
        raise FileNotFoundError("Training run directory is unavailable: " + raw_path)
    return directory


def resume_point_for_path(folder_path, stage, run_path):
    raw_path = str(run_path or "").strip()
    if not raw_path:
        return {}
    try:
        point = resume_point_from_directory(folder_path, stage, raw_path)
    except (OSError, RuntimeError):
        return {}
    if not point.get("checkpointAvailable"):
        return {}
    return {key: point.get(key) for key in ("checkpointTag", "epoch", "step", "expectedEpochs", "completed")}


def resume_point_from_directory(folder_path, stage, run_path):
    """Read current resume progress directly from a job-owned run directory."""
    raw_path = str(run_path or "").strip()
    if not raw_path:
        return {}
    directory = host_path_for_training_path(raw_path)
    if not directory.is_dir():
        raise FileNotFoundError("Resume directory is unavailable: " + raw_path)
    expected_epochs = _configured_epochs(folder_path, stage)
    completed, highest_epoch, highest_step = _run_artifact_state(directory, expected_epochs)
    resume_artifacts = _resume_artifacts(directory)
    checkpoint_tag = ""
    if resume_artifacts:
        checkpoint_tag = resume_artifacts[0].read_text(encoding="utf-8").strip().splitlines()[0].strip()
    return {
        "checkpointAvailable": bool(resume_artifacts),
        "checkpointTag": checkpoint_tag,
        "epoch": highest_epoch or None,
        "step": highest_step or None,
        "expectedEpochs": expected_epochs or None,
        "completed": completed,
    }


def summarize_history(folder_path):
    history = read_history(folder_path)
    jobs = history.get("jobs") or []
    latest = max(
        jobs,
        key=lambda job: float(job.get("updatedAt") or job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0),
        default=None,
    )
    return {
        "status": str((latest or {}).get("status") or "never"),
        "updatedAt": (latest or {}).get("updatedAt") or (latest or {}).get("finishedAt") or (latest or {}).get("createdAt") or 0,
    }


def record_job(folder_path, job):
    folder = Path(folder_path)
    folder_key = _folder_key(folder)
    runs = discover_runs(folder, str(job.get("stages") or ""))
    record_fields = (
        "id", "folder", "stages", "profileId", "profileLabel", "mode", "runId", "actionRunId", "datasetTarget", "modelLabel", "bundlePath", "bundleSummary", "capturedItemCount", "resumeFromCheckpoint", "resumeStage", "resumePoint", "outputRunPath", "status", "stage",
        "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "completionNote", "exitCode", "failureScope", "failureExcerpt", "preflight", "parentJobId", "activeTrainingSeconds", "activeTrainingTimingComplete",
        "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence", "launchGroupRoot", "progress", "model", "input", "artifactDir", "artifactSummary",
    )
    record = {field: job.get(field) for field in record_fields if field in job}
    record["folder"] = folder_key
    for field in ("error", "completionNote"):
        if isinstance(record.get(field), str):
            record[field] = record[field][:1000]
    if isinstance(record.get("failureExcerpt"), str):
        record["failureExcerpt"] = record["failureExcerpt"][-8192:]
    if isinstance(record.get("model"), dict):
        record["model"] = {
            "label": str(record["model"].get("label") or "")[:160],
            "source": str(record["model"].get("source") or "")[:512],
        }
    latest_run = runs[0] if runs else {}
    record["artifactSummary"] = {
        "runCount": len(runs), "latestName": latest_run.get("name", ""),
        "checkpointAvailable": bool(latest_run.get("checkpointAvailable")),
        "checkpointTag": latest_run.get("checkpointTag", ""),
        "epoch": latest_run.get("epoch"), "steps": latest_run.get("steps"),
    }
    with _history_lock:
        recent = _read_recent_runs()
        existing = recent["jobs"]
        for index, item in enumerate(existing):
            if (
                str(item.get("id") or "") == str(record.get("id") or "")
                and str(item.get("folder") or "") == folder_key
            ):
                existing[index] = record
                break
        else:
            existing.append(record)
        existing.sort(
            key=lambda item: float(item.get("finishedAt") or item.get("startedAt") or item.get("createdAt") or 0),
            reverse=True,
        )
        _write_recent_runs(recent)
    history = read_history(folder)
    history["runs"] = runs
    return history


def history_payload(folder_path):
    history = read_history(folder_path)
    history["runs"] = discover_runs(folder_path)
    history["resumeDefaults"] = {}
    return history


def _history_job_view(job):
    item = dict(job)
    raw_output = str(item.get("outputRunPath") or item.get("effectiveOutputDir") or item.get("outputRoot") or "").strip()
    try:
        output_path = host_path_for_training_path(raw_output) if raw_output else None
        item["outputAvailable"] = bool(output_path) and output_path.is_dir()
    except (OSError, ValueError):
        output_path = None
        item["outputAvailable"] = False
    summary = item.get("artifactSummary") if isinstance(item.get("artifactSummary"), dict) else {}
    if output_path and not str(summary.get("checkpointTag") or "").strip():
        try:
            checkpoint_tag = (output_path / "latest").read_text(encoding="utf-8").strip().splitlines()[0].strip()
        except (OSError, IndexError):
            checkpoint_tag = ""
        if checkpoint_tag:
            summary = dict(summary)
            summary["checkpointTag"] = checkpoint_tag
            item["artifactSummary"] = summary
    raw_log = str(item.get("logPath") or "").strip()
    if raw_log:
        log_path = Path(raw_log)
    else:
        artifact_dir = str(item.get("artifactDir") or "").strip()
        log_path = Path(artifact_dir) / "run.log" if artifact_dir else None
    item["logAvailable"] = bool(log_path) and log_path.is_file()
    raw_bundle = str(item.get("bundlePath") or "").strip()
    item["bundleAvailable"] = bool(raw_bundle) and Path(raw_bundle).is_dir()
    folder = str(item.get("folder") or "").strip()
    try:
        item["sourceAvailable"] = bool(folder) and app_config.safe_join_fs_root(folder).is_dir()
    except ValueError:
        item["sourceAvailable"] = False
    return item


def all_history_payload(query="", folder=""):
    """Return persisted history rows; presentation filtering happens in the browser."""
    del query
    folder_text = str(folder or "").strip().replace("\\", "/").strip("/")
    with _history_lock:
        recent = _read_recent_runs()
        jobs = [
            _history_job_view(job) for job in recent["jobs"]
            if isinstance(job, dict)
            and job.get("status") != "cancelled"
            and (not folder_text or str(job.get("folder") or "") == folder_text)
        ]
    return {"version": HISTORY_VERSION, "jobs": jobs}


def history_job_output_path(folder_path, job_id):
    wanted = str(job_id or "").strip()
    job = next((item for item in read_history(folder_path).get("jobs", []) if str(item.get("id") or "") == wanted), None)
    if not job or not str(job.get("outputRoot") or "").strip():
        raise ValueError("Training history entry has no effective output directory.")
    return Path(job["outputRoot"])


def clear_history(folder_path=None):
    """Clear indexes only; job bundles and trainer artifacts are deliberately untouched."""
    folder_key = _folder_key(folder_path) if folder_path else ""
    with _history_lock:
        recent = _read_recent_runs()
        original = recent["jobs"]
        retained = [
            job for job in original
            if folder_key and str(job.get("folder") or "") != folder_key
        ]
        cleared = len(original) - len(retained)
        recent["jobs"] = retained
        _write_recent_runs(recent)
        return cleared


def clear_history_job(folder_path, job_id):
    """Remove one history index entry without touching its logs or training artifacts."""
    folder_key = _folder_key(folder_path)
    wanted_id = str(job_id or "").strip()
    if not wanted_id:
        return False
    with _history_lock:
        recent = _read_recent_runs()
        original = recent["jobs"]
        retained = [
            job for job in original
            if not (
                str(job.get("id") or "") == wanted_id
                and str(job.get("folder") or "") == folder_key
            )
        ]
        if len(retained) == len(original):
            return False
        recent["jobs"] = retained
        _write_recent_runs(recent)
        return True


def completed_stages(folder_path, include_discovered_runs=True):
    """Return completed stages, optionally avoiding an expensive output-tree scan."""
    folder = Path(folder_path)
    stages = [stage for stage in ("hi", "lo", "krea2", "wan21", "h3") if (folder / ("config." + stage + ".toml")).is_file()]
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
    if include_discovered_runs:
        for stage in stages:
            if any(run.get("completed") for run in discover_runs(folder, stage)):
                completed.add(stage)
    return stages, completed
