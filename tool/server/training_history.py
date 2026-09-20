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
from .training_config_files import output_dir_from_config, training_config_path
from .training_action import actions_root, managed_actions_for_folder, read_action
from .training_profiles import config_for_id, config_for_stage


HISTORY_VERSION = 4
RECENT_RUNS_FILE_NAME = "recent_runs.json"
RECENT_RUNS_VERSION = 2
JOB_RECORD_VERSION = 1
JOB_RECORD_FILE_NAME = "job.json"
_history_lock = threading.RLock()
_EPOCH_PATTERN = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_PATTERN = re.compile(r"^global_step(\d+)$", re.IGNORECASE)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_DATASET_CONFIG_PATTERN = re.compile(r"^\s*dataset\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$", re.MULTILINE)


def run_summary_from_capture(record_path, stage, captured_items=0):
    """Return a compact summary of the captured config actually used by a run."""
    root = Path(str(record_path or "").strip())
    selected_stage = str(stage or "").strip().lower()
    if not str(root) or not selected_stage:
        return {}
    try:
        config_name = config_for_id(selected_stage)["file"]
        parsed = tomllib.loads((root / config_name).read_text(encoding="utf-8"))
    except (KeyError, OSError, ValueError, tomllib.TOMLDecodeError):
        return {}
    summary = {}
    epochs = parsed.get("epochs")
    if isinstance(epochs, int) and epochs > 0:
        summary["epochs"] = epochs
    model = parsed.get("model") if isinstance(parsed.get("model"), dict) else {}
    shift = model.get("shift")
    if isinstance(shift, (int, float)):
        summary["shift"] = shift
    adapter = parsed.get("adapter") if isinstance(parsed.get("adapter"), dict) else {}
    dropout = adapter.get("dropout")
    if isinstance(dropout, (int, float)):
        summary["dropout"] = dropout
    optimizer = parsed.get("optimizer") if isinstance(parsed.get("optimizer"), dict) else {}
    learning_rate = optimizer.get("lr")
    if isinstance(learning_rate, (int, float)):
        summary["lr"] = learning_rate
    try:
        item_count = int(captured_items or 0)
    except (TypeError, ValueError):
        item_count = 0
    if item_count > 0:
        summary["capturedItems"] = item_count
    return summary


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


def _recent_runs_path():
    return Path(app_config.FS_ROOT) / ".webcap_training" / RECENT_RUNS_FILE_NAME


def _folder_key(folder_path):
    folder = Path(folder_path).resolve()
    root = Path(app_config.FS_ROOT).resolve()
    return folder.relative_to(root).as_posix()


def _write_json_atomic(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
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


def _read_recent_runs():
    path = _recent_runs_path()
    if not path.exists():
        return {"version": RECENT_RUNS_VERSION, "jobs": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read Recent Runs; it was left unchanged: " + str(path)) from exc
    if not isinstance(data, dict) or data.get("version") not in (1, RECENT_RUNS_VERSION) or not isinstance(data.get("jobs"), list):
        raise ValueError("Unsupported Recent Runs state. Rename FS_ROOT/.webcap_training for the action-layout reset; it was left unchanged: " + str(path))
    # Version 2 made the persisted job records richer without changing their
    # container shape. Read the established version-1 index in place and let
    # the next ordinary write upgrade it atomically.
    data["version"] = RECENT_RUNS_VERSION
    return data


def _job_record_fields():
    return (
        "id", "folder", "stages", "profileId", "profileLabel", "mode", "runId", "actionRunId", "datasetTarget",
        "modelLabel", "actionId", "actionPath", "runName", "recordPath", "inputPath", "bundleSummary",
        "capturedItemCount", "runSummary", "resumeFromCheckpoint", "resumeStage", "resumePoint", "resumeActionId",
        "resumeOutputId", "outputRunPath", "status", "stage", "createdAt", "startedAt", "finishedAt", "updatedAt",
        "error", "completionNote", "exitCode", "failureScope", "failureExcerpt", "preflight", "parentJobId",
        "activeTrainingSeconds", "activeTrainingTimingComplete", "outputRoot", "effectiveOutputDir", "outputSlug",
        "sequence", "progress", "model", "input", "artifactDir", "artifactSummary",
    )


def _normalized_job_record(folder_path, job):
    record = {field: job.get(field) for field in _job_record_fields() if field in job}
    record["folder"] = _folder_key(folder_path)
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
    if not isinstance(record.get("runSummary"), dict) or not record.get("runSummary"):
        record["runSummary"] = run_summary_from_capture(
            record.get("recordPath") or record.get("inputPath"),
            record.get("stages"),
            record.get("capturedItemCount"),
        )
    record["artifactSummary"] = dict(record.get("artifactSummary") or {})
    return record


def _job_record_path(job):
    artifact_dir = str((job or {}).get("artifactDir") or (job or {}).get("artifactPath") or "").strip()
    job_id = str((job or {}).get("id") or "").strip()
    if not artifact_dir or not job_id:
        return None
    directory = Path(artifact_dir)
    try:
        resolved_root = actions_root().resolve()
        resolved_directory = directory.resolve()
    except OSError:
        return None
    if resolved_root not in resolved_directory.parents:
        return None
    if resolved_directory.name != job_id or resolved_directory.parent.name != "jobs":
        return None
    return directory / JOB_RECORD_FILE_NAME


def _write_job_record(folder_path, job):
    record = _normalized_job_record(folder_path, job)
    path = _job_record_path(record)
    if path is None:
        raise ValueError("Training job has no managed artifact directory.")
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise FileNotFoundError("Training job artifact directory is unavailable: " + str(path.parent))
    _write_json_atomic(path, {"version": JOB_RECORD_VERSION, "job": record})
    return record


def _read_job_record(path):
    record_path = Path(path)
    try:
        payload = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Training job record is unreadable: " + str(record_path)) from exc
    if not isinstance(payload, dict) or payload.get("version") != JOB_RECORD_VERSION or not isinstance(payload.get("job"), dict):
        raise ValueError("Training job record is invalid: " + str(record_path))
    return dict(payload["job"])


def _managed_job_record_paths():
    root = actions_root()
    if not root.is_dir():
        return []
    paths = []
    seen = set()
    for pattern in ("*/jobs/*/" + JOB_RECORD_FILE_NAME, "*/*/jobs/*/" + JOB_RECORD_FILE_NAME):
        for path in root.glob(pattern):
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if resolved in seen or not path.is_file() or path.is_symlink() or path.parent.is_symlink():
                continue
            seen.add(resolved)
            paths.append(path)
    return paths


def _job_records(folder_key=""):
    jobs = []
    for record_path in _managed_job_record_paths():
        job = _read_job_record(record_path)
        if folder_key and str(job.get("folder") or "") != folder_key:
            continue
        jobs.append(job)
    return jobs

def _legacy_jobs(folder_key=""):
    try:
        recent = _read_recent_runs()
    except ValueError as exc:
        app_config.debug_print("[training_history] Ignoring unreadable legacy Recent Runs index:", exc)
        return []
    return [
        dict(job) for job in recent["jobs"]
        if isinstance(job, dict)
        and (not folder_key or str(job.get("folder") or "") == folder_key)
    ]


def _migrate_legacy_job(folder_path, job):
    path = _job_record_path(job)
    if path is None or not path.parent.is_dir() or path.parent.is_symlink():
        return False
    if path.exists():
        return True
    _write_job_record(folder_path, job)
    return True


def _merge_folder_and_legacy_jobs(folder_path):
    folder_key = _folder_key(folder_path)
    jobs = _job_records(folder_key)
    by_id = {str(job.get("id") or ""): job for job in jobs if str(job.get("id") or "")}
    for legacy in _legacy_jobs(folder_key):
        job_id = str(legacy.get("id") or "")
        if job_id and job_id in by_id:
            continue
        try:
            migrated = _migrate_legacy_job(folder_path, legacy)
        except (OSError, ValueError):
            migrated = False
        if migrated:
            record_path = _job_record_path(legacy)
            if record_path and record_path.is_file():
                record = _read_job_record(record_path)
                jobs.append(record)
                if job_id:
                    by_id[job_id] = record
    jobs.sort(
        key=lambda item: float(item.get("finishedAt") or item.get("startedAt") or item.get("createdAt") or 0),
        reverse=True,
    )
    return jobs


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
    if not latest.is_file() or latest.is_symlink():
        return []
    try:
        tag = latest.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return []
    checkpoint = directory / tag
    if not _STEP_PATTERN.match(tag) or not checkpoint.is_dir() or checkpoint.is_symlink():
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
    folder = Path(folder_path)
    with _history_lock:
        result = _default_history(folder)
        result["jobs"] = _merge_folder_and_legacy_jobs(folder)
        return result


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
    source_config = training_config_path(folder, stage)
    parsed_source = _parsed_config(source_config)
    if parsed_source is None:
        return []
    config_meta = config_for_id(stage)
    wanted_identity = _model_identity(parsed_source, config_meta["modelIdentityKeys"])
    if wanted_identity is None:
        return []
    source_hash = config_sha256(source_config)
    runs = []
    for action_root, action in managed_actions_for_folder(folder):
        if str(action.get("folder") or "") != _folder_key(folder) or stage not in action.get("requestedStages", ()):
            continue
        try:
            branch = action_root / "output"
            if not branch.is_dir() or branch.is_symlink():
                continue
            for entry in branch.iterdir():
                if not entry.is_dir() or entry.is_symlink() or not _resume_artifacts(entry):
                    continue
                saved_config, parsed_saved = _saved_config_for_candidate(entry, config_meta, wanted_identity)
                if saved_config is None:
                    app_config.debug_print("[training_history] Skipping", entry, ": no matching", stage, "model config.")
                    continue
                try:
                    modified = entry.stat().st_mtime
                    checkpoint_tag = (entry / "latest").read_text(encoding="utf-8").strip().splitlines()[0].strip()
                    saved_hash = config_sha256(saved_config)
                except (OSError, IndexError):
                    continue
                expected_epochs = _epochs_from_parsed_config(parsed_saved)
                completed, highest_epoch, highest_step = _run_artifact_state(entry, expected_epochs)
                training_path = str(entry)
                runs.append({
                    "path": training_path, "runPath": training_path, "name": entry.name,
                    "setName": _set_name_from_run_config(entry, folder.name), "stage": stage,
                    "candidateFor": stage, "modelLabel": config_meta["label"],
                    "matchType": "exact" if saved_hash == source_hash else "compatible",
                    "configHash": saved_hash, "modifiedAt": modified,
                    "checkpointAvailable": True, "checkpointName": "latest", "checkpointTag": checkpoint_tag,
                    "completed": completed, "epoch": highest_epoch or None, "steps": highest_step or None,
                    "expectedEpochs": expected_epochs or None,
                    "resumeActionId": str(action.get("actionId") or ""),
                    "resumeOutputId": entry.relative_to(action_root).as_posix(),
                    "runName": str(action.get("runName") or ""),
                    "logicalRun": action_root.name,
                })
        except OSError as exc:
            app_config.debug_print("[training_history] Could not scan", action_root, ":", exc)
            raise
    app_config.debug_print("[training_history] Found", len(runs), "resumable run(s) for", folder, "stage", stage or "all")
    return sorted(runs, key=lambda run: run["modifiedAt"], reverse=True)


def resolve_managed_resume(folder_path, action_id, output_id, stage):
    """Resolve the opaque action/output pair; no raw checkpoint paths enter managed launch."""
    folder = Path(folder_path)
    root, action = read_action(action_id)
    if str(action.get("folder") or "") != _folder_key(folder):
        raise ValueError("The selected training action belongs to another set.")
    selected_stage = str(stage or "").strip().lower()
    if selected_stage not in action.get("requestedStages", ()):
        raise ValueError("The selected stage is not part of that training action.")
    output = PurePosixPath(str(output_id or ""))
    if not output_id or output.is_absolute() or ".." in output.parts or len(output.parts) != 2 or output.parts[0] != "output":
        raise ValueError("Managed training output ID is invalid.")
    run_dir = root.joinpath(*output.parts)
    if not run_dir.is_dir() or run_dir.is_symlink():
        raise ValueError("The selected managed checkpoint is unavailable or no longer valid.")
    validated = validate_resumable_run_for_path(folder, selected_stage, str(run_dir))
    return {"actionRoot": root, "action": action, "runPath": Path(validated["runPath"]), "stage": selected_stage, "point": validated}


def validate_resumable_run_for_path(folder_path, stage, run_path):
    """Validate one explicit trainer-run directory without managed discovery."""
    raw_path = str(run_path or "").strip()
    if not raw_path:
        raise ValueError("A resume directory is required.")
    directory = host_path_for_training_path(raw_path)
    if not directory.is_dir():
        raise ValueError("Recorded resume directory is unavailable: " + raw_path)
    resume_artifacts = _resume_artifacts(directory)
    if not resume_artifacts:
        raise ValueError("Recorded resume directory has no valid latest DeepSpeed checkpoint: " + raw_path)
    source_config = training_config_path(folder_path, stage)
    parsed_source = _parsed_config(source_config)
    if parsed_source is None:
        raise ValueError("Current training config is unreadable: " + str(source_config))
    config_meta = config_for_id(stage)
    wanted_identity = _model_identity(parsed_source, config_meta["modelIdentityKeys"])
    if wanted_identity is None:
        raise ValueError("Current training config has no valid model identity.")
    saved_config, parsed_saved = _saved_config_for_candidate(directory, config_meta, wanted_identity)
    if saved_config is None:
        raise ValueError("Resume directory has no readable compatible saved config: " + raw_path)
    point = resume_point_from_directory(folder_path, stage, raw_path)
    return {"path": raw_path, "runPath": raw_path, "stage": stage,
            "matchType": "exact" if config_sha256(saved_config) == config_sha256(source_config) else "compatible", **point}


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
    with _history_lock:
        return _write_job_record(folder, job)


def remove_job_record(job):
    path = _job_record_path(job)
    if path is None:
        return False
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    return True

def history_payload(folder_path):
    history = read_history(folder_path)
    # This is an explicit resume picker, not startup recovery. It discovers
    # compatible checkpoints from disk only when the user opens history.
    history["runs"] = discover_runs(folder_path)
    history["resumeDefaults"] = {}
    return history


def _history_job_view(job):
    item = dict(job)
    if not isinstance(item.get("runSummary"), dict) or not item.get("runSummary"):
        item["runSummary"] = run_summary_from_capture(
            item.get("recordPath") or item.get("inputPath"),
            item.get("stages"),
            item.get("capturedItemCount"),
        )
    raw_output = str(item.get("outputRunPath") or item.get("effectiveOutputDir") or item.get("outputRoot") or "").strip()
    raw_candidate = str(item.get("outputRunPath") or item.get("resumeFromCheckpoint") or "").strip()
    try:
        output_path = host_path_for_training_path(raw_output) if raw_output else None
        item["outputAvailable"] = bool(output_path) and output_path.is_dir()
    except (OSError, ValueError):
        output_path = None
        item["outputAvailable"] = False
    try:
        candidate_path = host_path_for_training_path(raw_candidate) if raw_candidate else None
        item["candidateRunAvailable"] = bool(candidate_path) and candidate_path.is_dir()
    except (OSError, ValueError):
        item["candidateRunAvailable"] = False
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
    raw_action = str(item.get("actionPath") or "").strip()
    item["actionAvailable"] = bool(raw_action) and Path(raw_action).is_dir()
    folder = str(item.get("folder") or "").strip()
    try:
        item["sourceAvailable"] = bool(folder) and app_config.safe_join_fs_root(folder).is_dir()
    except ValueError:
        item["sourceAvailable"] = False
    return item


def all_history_payload(query="", folder=""):
    """Return Training History projected from managed action/job folders."""
    del query
    folder_text = str(folder or "").strip().replace("\\", "/").strip("/")
    with _history_lock:
        jobs = _job_records(folder_text)
        known = {str(job.get("id") or "") for job in jobs if str(job.get("id") or "")}
        for legacy in _legacy_jobs(folder_text):
            job_id = str(legacy.get("id") or "")
            if job_id and job_id in known:
                continue
            source_folder = str(legacy.get("folder") or "").strip()
            migrated = False
            if source_folder:
                try:
                    source_path = app_config.safe_join_fs_root(source_folder)
                    migrated = _migrate_legacy_job(source_path, legacy)
                except (OSError, ValueError):
                    migrated = False
            if migrated:
                record_path = _job_record_path(legacy)
                if record_path and record_path.is_file():
                    record = _read_job_record(record_path)
                    jobs.append(record)
                    if job_id:
                        known.add(job_id)
        jobs = [
            _history_job_view(job) for job in jobs
            if job.get("status") != "cancelled"
            and (not folder_text or str(job.get("folder") or "") == folder_text)
        ]
        jobs.sort(
            key=lambda item: float(item.get("finishedAt") or item.get("startedAt") or item.get("createdAt") or 0),
            reverse=True,
        )
    return {"version": HISTORY_VERSION, "jobs": jobs}


def history_job_output_path(folder_path, job_id):
    wanted = str(job_id or "").strip()
    job = next((item for item in read_history(folder_path).get("jobs", []) if str(item.get("id") or "") == wanted), None)
    if not job or not str(job.get("outputRoot") or "").strip():
        raise ValueError("Training history entry has no effective output directory.")
    return Path(job["outputRoot"])


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
        if stage in stages:
            completed.add(stage)
    if include_discovered_runs:
        for stage in stages:
            if any(run.get("completed") for run in discover_runs(folder, stage)):
                completed.add(stage)
    return stages, completed
