import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import time
from pathlib import Path, PurePosixPath

import tomllib

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import allocate_training_launch_group, output_dir_from_config, training_config_path
from .training_profiles import config_for_id


HISTORY_FILE_NAME = ".webcap_training.json"
HISTORY_VERSION = 3
_EPOCH_PATTERN = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_PATTERN = re.compile(r"^global_step(\d+)$", re.IGNORECASE)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_DATASET_CONFIG_PATTERN = re.compile(r"^\s*dataset\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$", re.MULTILINE)
_OUTPUT_GROUP_PATTERN = re.compile(r"^\d{3}-.+$")


def output_root_for_folder(folder_path, stage=""):
    return host_path_for_training_path(output_root_path_for_folder(folder_path, stage))


def output_root_path_for_folder(folder_path, stage=""):
    folder = Path(folder_path)
    stages = (stage,) if stage in ("hi", "lo", "krea2", "wan21") else ("hi", "lo", "krea2", "wan21")
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


def _read_history_index(folder_path):
    """Read optional set-local metadata without resolving any configured paths."""
    path = _history_path(folder_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": HISTORY_VERSION, "jobs": [], "runs": []}
    if not isinstance(data, dict) or data.get("version") != HISTORY_VERSION:
        return {"version": HISTORY_VERSION, "jobs": [], "runs": []}
    if not isinstance(data.get("jobs"), list):
        data["jobs"] = []
    if not isinstance(data.get("runs"), list):
        data["runs"] = []
    return data


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
    if stage not in ("hi", "lo", "krea2", "wan21"):
        combined = []
        for item in ("hi", "lo", "krea2", "wan21"):
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
    latest = jobs[-1] if jobs else None
    return {
        "status": str((latest or {}).get("status") or "never"),
        "updatedAt": (latest or {}).get("updatedAt") or (latest or {}).get("finishedAt") or (latest or {}).get("createdAt") or 0,
    }


def record_job(folder_path, job):
    history = read_history(folder_path)
    runs = discover_runs(folder_path, str(job.get("stages") or ""))
    record_fields = (
        "id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel", "resumeFromCheckpoint", "resumeStage", "resumePoint", "outputRunPath", "status", "stage",
        "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "completionNote", "exitCode", "failureScope", "failureExcerpt", "preflight", "parentJobId",
        "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence", "launchGroupRoot", "progress", "model", "input", "artifactDir", "artifactSummary",
    )
    record = {field: job.get(field) for field in record_fields if field in job}
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
    history["resumeDefaults"] = {}
    return history


def all_history_payload(query="", folder=""):
    """Return persisted history rows; presentation filtering happens in the browser."""
    root = Path(app_config.FS_ROOT)
    jobs = []
    for path in root.rglob(HISTORY_FILE_NAME):
        if ".webcap_training" in path.parts or "auto_dataset" in path.parts:
            continue
        set_folder = path.parent
        try:
            relative = str(set_folder.relative_to(root)).replace("\\", "/")
        except ValueError:
            continue
        history = read_history(set_folder)
        for job in history.get("jobs") or []:
            if not isinstance(job, dict):
                continue
            if job.get("status") == "cancelled":
                continue
            item = dict(job)
            item["folder"] = relative
            jobs.append(item)
    jobs.sort(key=lambda job: float(job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0), reverse=True)
    return {"version": HISTORY_VERSION, "jobs": jobs}


def history_job_output_path(folder_path, job_id):
    wanted = str(job_id or "").strip()
    job = next((item for item in read_history(folder_path).get("jobs", []) if str(item.get("id") or "") == wanted), None)
    if not job or not str(job.get("outputRoot") or "").strip():
        raise ValueError("Training history entry has no effective output directory.")
    return Path(job["outputRoot"])


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


def completed_stages(folder_path, include_discovered_runs=True):
    """Return completed stages, optionally avoiding an expensive output-tree scan."""
    folder = Path(folder_path)
    stages = [stage for stage in ("hi", "lo", "krea2", "wan21") if (folder / ("config." + stage + ".toml")).is_file()]
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
