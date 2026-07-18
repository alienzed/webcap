import json
import logging
import math
import os
import re
import csv
import hashlib
import shlex
import shutil
import subprocess
import threading
import time
import tomllib
import uuid
from pathlib import Path, PurePosixPath

from . import config as app_config
from .caption_ops import _caption_name_for_media
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .permissions import normalize_path_permissions
from .training_commands import build_training_command_plan, build_training_launcher_probe
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME, KREA2_CONFIG_NAME, WAN21_CONFIG_NAME, allocate_training_launch_group, output_dir_from_config, with_output_dir
from .training_profiles import KREA2_PROFILE_ID, WAN21_PROFILE_ID, config_for_stage, profile_run
from .dataset_config import repeat_targets_for_mode
from .training_history import completed_stages, config_sha256, discover_runs, validate_resumable_run_for_path, resume_point_for_path, resume_point_from_directory, host_path_for_training_path, output_root_for_folder, record_job, clear_history_job
from .training_runtime import (
    build_runtime_command,
    build_training_launcher,
    has_complete_conda_runtime,
    has_conda_runtime,
    training_runtime_settings,
)


RUNNER_DIR_NAME = ".webcap_training"
STATE_FILE_NAME = "queue.json"
JOB_DIR_NAME = "jobs"
ACTIVE_STATUSES = {"starting", "running", "stopping", "unconfirmed"}
QUEUE_STATUSES = {"queued", "paused", "interrupted"}
HISTORY_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted"}
TERMINAL_STATUSES = HISTORY_STATUSES | {"paused", "interrupted", "cancelled"}
_lock = threading.Lock()
_monitor_lock = threading.Lock()
_monitor_thread = None
_startup_reconciled = False
_history_signatures = {}
_state_file_seen = None
_persisted_managed_job_ids = set()
_logger = logging.getLogger(__name__)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_CHECKPOINT_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*checkpoint_every_n_epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_LOG_EPOCH_PATTERN = re.compile(r"Started new epoch:\s*(\d+)", re.IGNORECASE)
_LOG_STEP_PATTERN = re.compile(r"\bstep=(\d+)", re.IGNORECASE)
_LOG_ITER_TIME_PATTERN = re.compile(r"\biter time \(s\):\s*(\d+(?:\.\d+)?)", re.IGNORECASE)
ETA_MIN_SAMPLES = 3
ETA_SAMPLE_WINDOW = 8
PARTIAL_CAPTION_REVIEW_MIN_ITEMS = 3
PARTIAL_CAPTION_REVIEW_MIN_RATIO = 0.15


def _runtime_root():
    return Path(app_config.FS_ROOT) / RUNNER_DIR_NAME


def _state_path():
    return _runtime_root() / STATE_FILE_NAME


def _jobs_root():
    return _runtime_root() / JOB_DIR_NAME


def _ensure_runtime_dirs():
    _jobs_root().mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(_runtime_root())
    normalize_path_permissions(_jobs_root())


def _default_state():
    return {"version": 3, "activeJobId": "", "jobs": [], "queuePaused": False, "queuePauseReason": ""}


class TrainingStateError(RuntimeError):
    pass


def _state_job_ids(state, path):
    jobs = state.get("jobs") if isinstance(state, dict) else None
    if not isinstance(jobs, list):
        raise TrainingStateError("Existing training queue jobs are invalid; the state was left unchanged: " + str(path))
    job_ids = []
    for job in jobs:
        job_id = str(job.get("id") or "") if isinstance(job, dict) else ""
        if not job_id:
            raise TrainingStateError("Existing training queue contains a job without an ID; the state was left unchanged: " + str(path))
        job_ids.append(job_id)
    if len(job_ids) != len(set(job_ids)):
        raise TrainingStateError("Existing training queue contains duplicate job IDs; the state was left unchanged: " + str(path))
    return set(job_ids)


def _managed_job_ids(state):
    return {
        str(job["id"])
        for job in state.get("jobs", [])
        if str(job.get("status") or "") in ACTIVE_STATUSES | QUEUE_STATUSES
    }


def _read_state():
    global _state_file_seen, _persisted_managed_job_ids
    _ensure_runtime_dirs()
    path = _state_path()
    if not path.exists():
        if _state_file_seen == path:
            raise TrainingStateError("Training queue state disappeared while WebCap was running: " + str(path))
        return _default_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TrainingStateError("Could not read the existing training queue state; it was left unchanged: " + str(path)) from exc
    if not isinstance(parsed, dict):
        raise TrainingStateError("Existing training queue state is not a JSON object; it was left unchanged: " + str(path))
    if parsed.get("version") != 3:
        raise TrainingStateError("Unsupported training queue state version; it was left unchanged: " + str(path))
    parsed.setdefault("activeJobId", "")
    parsed.setdefault("jobs", [])
    parsed.setdefault("queuePaused", False)
    parsed.setdefault("queuePauseReason", "")
    job_ids = _state_job_ids(parsed, path)
    missing_job_ids = _persisted_managed_job_ids - job_ids if _state_file_seen == path else set()
    if missing_job_ids:
        raise TrainingStateError(
            "Existing training queue state dropped managed jobs; it was left unchanged: "
            + ", ".join(sorted(missing_job_ids))
        )
    _persisted_managed_job_ids = _managed_job_ids(parsed)
    _state_file_seen = path
    return parsed


def _write_state(state):
    global _state_file_seen, _persisted_managed_job_ids
    _ensure_runtime_dirs()
    path = _state_path()
    job_ids = _state_job_ids(state, path)
    missing_job_ids = _persisted_managed_job_ids - job_ids if _state_file_seen == path else set()
    if missing_job_ids:
        raise TrainingStateError(
            "Refusing to remove managed training jobs from queue state: " + ", ".join(sorted(missing_job_ids))
        )
    tmp = path.with_name("." + path.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
    normalize_path_permissions(path)
    _state_file_seen = path
    _persisted_managed_job_ids = _managed_job_ids(state)


def recover_state_response():
    """Archive an unreadable queue state and start a fresh, empty queue."""
    global _state_file_seen, _persisted_managed_job_ids
    with _lock:
        _ensure_runtime_dirs()
        path = _state_path()
        archived_path = None
        if path.exists():
            archived_path = path.with_name(
                "queue.recovery." + time.strftime("%Y%m%d_%H%M%S") + "." + uuid.uuid4().hex + ".json"
            )
            os.replace(path, archived_path)
            normalize_path_permissions(archived_path)
        _state_file_seen = None
        _persisted_managed_job_ids = set()
        state = _default_state()
        _write_state(state)
        return {
            "ok": True,
            "archivedState": str(archived_path) if archived_path else "",
            "activeJobId": "",
            "queuePaused": False,
            "queuePauseReason": "",
            "jobs": [],
        }, 200


def _sync_job_history(job):
    if job.get("historyHidden") or job.get("status") not in HISTORY_STATUSES:
        return
    folder = str(job.get("folder") or "").strip()
    if not folder:
        return
    signature = json.dumps({
        "status": job.get("status"), "stage": job.get("stage"), "updatedAt": job.get("updatedAt"),
        "finishedAt": job.get("finishedAt"), "error": job.get("error"), "exitCode": job.get("exitCode"),
    }, sort_keys=True)
    if _history_signatures.get(job.get("id")) == signature:
        return
    record_job(app_config.safe_join_fs_root(folder), job)
    _history_signatures[job.get("id")] = signature


def _sync_histories(state):
    for job in state.get("jobs", []):
        _sync_job_history(job)


def _apply_restart_hold(state):
    global _startup_reconciled
    if _startup_reconciled:
        return
    _startup_reconciled = True
    if state.get("queuePaused"):
        return
    jobs = state.get("jobs", [])
    has_queued_work = any(job.get("status") == "queued" for job in jobs)
    has_active_work = any(job.get("status") in ACTIVE_STATUSES for job in jobs)
    if has_queued_work and not has_active_work:
        state["queuePaused"] = True
        state["queuePauseReason"] = "Queue held after WebCap restarted."


def _job_dir(job):
    """Job-owned artifacts live beside trainer output, not in the queue state area."""
    if isinstance(job, dict) and job.get("artifactPath"):
        return Path(job["artifactPath"])
    job_id = job.get("id") if isinstance(job, dict) else job
    return _jobs_root() / str(job_id)


def _job_action_path(job):
    return _job_dir(job) / "action"


def _artifact_root(folder_path, stage):
    root = output_root_for_folder(folder_path, stage if stage in ("hi", "lo", "krea2", "wan21") else "hi")
    return root / ".webcap" / "jobs"


def _find_job(state, job_id):
    for job in state.get("jobs", []):
        if str(job.get("id") or "") == str(job_id or ""):
            return job
    return None


def _wsl_executable():
    return shutil.which("wsl.exe") or shutil.which("wsl")


def _uses_native_wsl_shell():
    return os.name != "nt"


def _run_wsl(command, timeout=20, distribution=""):
    if _uses_native_wsl_shell():
        args = ["bash", "-lc", command]
    else:
        executable = _wsl_executable()
        if not executable:
            return 127, "", "wsl.exe was not found on PATH."
        args = [executable]
        if distribution:
            args.extend(["--distribution", distribution])
        args.extend(["--", "bash", "-lc", command])
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return completed.returncode, completed.stdout or "", completed.stderr or ""
    except subprocess.TimeoutExpired as exc:
        return 124, exc.stdout or "", "Timed out: " + str(exc)
    except Exception as exc:
        return 1, "", str(exc)


def _to_wsl_path(path, distribution=""):
    value = str(path)
    if value.startswith("/"):
        return value
    code, stdout, stderr = _run_wsl("wslpath -a " + shlex.quote(value), timeout=10, distribution=distribution)
    value = (stdout or "").strip()
    if code != 0 or not value:
        raise RuntimeError((stderr or stdout or "wslpath failed").strip())
    return value


def _repair_training_set_permissions(folder_path, distribution=""):
    """Restore WSL read/write access to a selected training set before it is used."""
    try:
        wsl_folder = _to_wsl_path(folder_path, distribution)
    except Exception as exc:
        return "Could not resolve the training set path in WSL: " + str(exc)
    quoted_folder = shlex.quote(wsl_folder)
    command = (
        "chmod 775 -- " + quoted_folder
        + " && find " + quoted_folder + " -type d -exec chmod 775 {} +"
        + " && find " + quoted_folder + " -type f -exec chmod 664 {} +"
    )
    code, stdout, stderr = _run_wsl(command, timeout=120, distribution=distribution)
    if code == 0:
        return ""
    detail = (stderr or stdout).strip() or ("exit " + str(code))
    return "Could not restore training-set permissions: " + detail


def _training_settings():
    config = app_config.config if isinstance(app_config.config, dict) else {}
    training = config.get("training") if isinstance(config.get("training"), dict) else {}
    return training_runtime_settings(training)


def _resolve_folder(folder):
    value = str(folder or "").strip()
    if not value:
        raise ValueError("Missing folder argument")
    path = app_config.safe_join_fs_root(value)
    if not path.exists() or not path.is_dir():
        raise ValueError("Folder does not exist: " + value)
    return value, path


def _resolve_artifacts(folder, folder_path, stages="both"):
    paths = {
        "hiConfig": folder_path / HI_CONFIG_NAME,
        "loConfig": folder_path / LO_CONFIG_NAME,
        "krea2Config": folder_path / KREA2_CONFIG_NAME,
        "wan21Config": folder_path / WAN21_CONFIG_NAME,
        "hiDataset": folder_path / "dataset.hi.toml",
        "loDataset": folder_path / "dataset.lo.toml",
        "trainDataset": folder_path / "dataset.train.toml",
        "manifest": folder_path / "auto_dataset" / "prep_manifest.json",
    }
    if stages == "krea2":
        required = ("krea2Config", "trainDataset", "manifest")
    elif stages == "wan21":
        required = ("wan21Config", "trainDataset", "manifest")
    elif stages == "hi":
        required = ("hiConfig", "hiDataset", "manifest")
    elif stages == "lo":
        required = ("loConfig", "loDataset", "manifest")
    else:
        required = (
        "hiConfig", "loConfig", "hiDataset", "loDataset", "manifest"
        )
    missing = [name for name in required if not paths[name].exists() or not paths[name].is_file()]
    return paths, missing


def _prepared_dataset_is_ready(folder_path):
    folder = Path(folder_path)
    manifest_path = folder / "auto_dataset" / "prep_manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(manifest, dict):
        return False
    rows = []
    for key in ("images", "videos"):
        values = manifest.get(key)
        if not isinstance(values, list):
            return False
        rows.extend(values)
    if not rows:
        return False
    dataset_root = manifest_path.parent
    for row in rows:
        if not isinstance(row, dict):
            return False
        prepared_path = str(row.get("prepared_path") or "").strip()
        if not prepared_path or not row.get("caption"):
            return False
        caption_path = (dataset_root / prepared_path).with_suffix(".txt")
        try:
            if not caption_path.is_file() or not caption_path.read_text(encoding="utf-8").strip():
                return False
        except OSError:
            return False
    return True


def _partial_annotation_caption_counts(folder_path):
    folder = Path(folder_path)
    try:
        state = json.loads((folder / ".webcap_state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0, 0
    tags_by_media = state.get("caption_tags_by_media") if isinstance(state, dict) else {}
    if not isinstance(tags_by_media, dict):
        return 0, 0

    partial_count = 0
    touched_count = 0
    for media_path in folder.iterdir():
        if (
            not media_path.is_file()
            or media_path.suffix.lower() not in MEDIA_ALL_EXTS
            or is_transient_media_name(media_path.name)
        ):
            continue
        tags = tags_by_media.get(media_path.name)
        tags = [str(tag).strip() for tag in tags] if isinstance(tags, list) else []
        tags = [tag for tag in tags if tag]
        try:
            caption = (folder / _caption_name_for_media(media_path.name)).read_text(encoding="utf-8").strip()
        except OSError:
            caption = ""
        if tags or caption:
            touched_count += 1
        if tags and not caption:
            partial_count += 1
    return partial_count, touched_count


def _needs_partial_annotation_caption_review(folder_path):
    partial_count, touched_count = _partial_annotation_caption_counts(folder_path)
    if not touched_count or partial_count < PARTIAL_CAPTION_REVIEW_MIN_ITEMS:
        return False, partial_count, touched_count
    return partial_count / touched_count >= PARTIAL_CAPTION_REVIEW_MIN_RATIO, partial_count, touched_count


def _activation_prefix(settings):
    if has_conda_runtime(settings):
        return ""
    activate = settings["activate"]
    if not activate:
        return ""
    return "source " + shlex.quote(activate) + " && "


def _make_check(check_id, severity, ok, message, details=""):
    return {
        "id": check_id,
        "severity": severity,
        "ok": bool(ok),
        "message": message,
        "details": str(details or "").strip(),
    }


def _wsl_check(check_id, severity, settings, command, message):
    cwd = settings["cwd"]
    shell = "cd " + shlex.quote(cwd) + " && " + _activation_prefix(settings) + command
    code, stdout, stderr = _run_wsl(shell, distribution=settings["wslDistribution"])
    details = (stdout + stderr).strip()
    return _make_check(check_id, severity, code == 0, message if code == 0 else message + " (exit " + str(code) + ")", details)


def _parse_nvidia_smi_csv(text, fields):
    rows = []
    for values in csv.reader((text or "").splitlines()):
        if len(values) != len(fields):
            continue
        rows.append({field: value.strip() for field, value in zip(fields, values)})
    return rows


def _gpu_snapshot():
    settings = _training_settings()
    distribution = settings.get("wslDistribution") or ""
    gpu_fields = ("index", "name", "utilization", "memoryUsed", "memoryTotal", "temperature", "powerDraw")
    gpu_command = "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits"
    code, stdout, stderr = _run_wsl(gpu_command, timeout=5, distribution=distribution)
    if code != 0:
        return {
            "available": False,
            "gpus": [],
            "processes": [],
            "error": (stderr or stdout or "nvidia-smi failed (exit " + str(code) + ")").strip(),
            "checkedAt": time.time(),
        }
    process_fields = ("pid", "name", "memoryUsed")
    process_command = "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits"
    process_code, process_stdout, process_stderr = _run_wsl(process_command, timeout=5, distribution=distribution)
    return {
        "available": True,
        "gpus": _parse_nvidia_smi_csv(stdout, gpu_fields),
        "processes": _parse_nvidia_smi_csv(process_stdout, process_fields) if process_code == 0 else [],
        "processError": (process_stderr or "").strip() if process_code != 0 else "",
        "checkedAt": time.time(),
    }


def _build_preflight(folder, stages="both"):
    folder_value, folder_path = _resolve_folder(folder)
    artifacts, missing = _resolve_artifacts(folder_value, folder_path, stages)
    settings = _training_settings()
    checks = []
    checks.append(_make_check("set_folder_exists", "blocker", True, "Set folder is available.", str(folder_path)))
    checks.append(_make_check("training_artifacts", "blocker", not missing,
                              "Training artifacts are available." if not missing else "Missing: " + ", ".join(missing),
                              ""))
    shell_available = bool(shutil.which("bash")) if _uses_native_wsl_shell() else bool(_wsl_executable())
    checks.append(_make_check(
        "wsl_available",
        "blocker",
        shell_available,
        "Current WSL shell is available." if _uses_native_wsl_shell() and shell_available else
        "WSL is available." if shell_available else "wsl.exe was not found on PATH.",
    ))
    checks.append(_make_check("training_cwd", "blocker", bool(settings["cwd"]),
                              "Diffusion Pipe WSL path is configured." if settings["cwd"] else "Set training.diffusion_pipe_wsl in App Settings."))
    if stages == "krea2":
        try:
            manifest = json.loads((folder_path / "auto_dataset" / "prep_manifest.json").read_text(encoding="utf-8"))
            image_only = not bool(manifest.get("videos"))
        except (OSError, ValueError, AttributeError):
            image_only = False
        checks.append(_make_check(
            "krea2_image_only", "blocker", image_only,
            "Krea2 Raw input is image-only." if image_only else "Krea2 Raw requires image-only prepared media.",
        ))
    if not all(item["ok"] for item in checks if item["severity"] == "blocker"):
        return folder_value, folder_path, artifacts, settings, checks

    checks.append(_wsl_check("cwd_exists", "blocker", settings, "test -d .", "Training working directory is available."))
    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(_make_check(
            "conda_runtime",
            "blocker",
            False,
            "Conda runtime needs both the executable path and environment name.",
        ))
        return folder_value, folder_path, artifacts, settings, checks
    if has_complete_conda_runtime(settings):
        checks.append(_wsl_check(
            "conda_executable",
            "blocker",
            settings,
            "test -x " + shlex.quote(settings["condaExecutable"]),
            "Conda executable is available.",
        ))
    elif settings["activate"]:
        checks.append(_wsl_check("activate_script", "blocker", settings,
                                 "test -f " + shlex.quote(settings["activate"]),
                                 "Activation script is available."))
    else:
        checks.append(_make_check("activate_script", "warning", True, "No activation script configured; using the WSL shell environment."))
    if has_complete_conda_runtime(settings) and not checks[-1]["ok"]:
        return folder_value, folder_path, artifacts, settings, checks
    checks.append(_wsl_check(
        "python_available",
        "blocker",
        settings,
        build_runtime_command(settings, "python --version"),
        "Python is available.",
    ))
    checks.append(_wsl_check(
        "deepspeed_available",
        "blocker",
        settings,
        build_training_launcher_probe(build_training_launcher(settings)),
        "DeepSpeed launcher is available.",
    ))
    checks.append(_wsl_check("train_py_present", "blocker", settings, "test -f train.py", "train.py is available."))
    checks.append(_wsl_check(
        "torch_cuda_visible", "blocker", settings,
        build_runtime_command(settings, "python -c " + shlex.quote("import torch; raise SystemExit(0 if torch.cuda.is_available() and torch.cuda.device_count() else 1)")),
        "CUDA is visible to PyTorch.",
    ))
    checks.append(_wsl_check("nvidia_smi", "warning", settings, "nvidia-smi", "nvidia-smi is available."))
    return folder_value, folder_path, artifacts, settings, checks


def _build_launch_preflight(folder, stages="both"):
    folder_value, folder_path = _resolve_folder(folder)
    artifacts, missing = _resolve_artifacts(folder_value, folder_path, stages)
    settings = _training_settings()
    shell_available = bool(shutil.which("bash")) if _uses_native_wsl_shell() else bool(_wsl_executable())
    checks = [
        _make_check("set_folder_exists", "blocker", True, "Set folder is available.", str(folder_path)),
        _make_check("training_artifacts", "blocker", not missing,
                    "Training artifacts are available." if not missing else "Missing: " + ", ".join(missing)),
        _make_check("wsl_available", "blocker", shell_available,
                    "Current WSL shell is available." if _uses_native_wsl_shell() and shell_available else
                    "WSL is available." if shell_available else "wsl.exe was not found on PATH."),
        _make_check("training_cwd", "blocker", bool(settings["cwd"]),
                    "Diffusion Pipe WSL path is configured." if settings["cwd"] else "Set training.diffusion_pipe_wsl in App Settings."),
    ]
    toml_keys = (
        ("krea2Config", "trainDataset") if stages == "krea2" else
        ("wan21Config", "trainDataset") if stages == "wan21" else
        ("hiConfig", "hiDataset") if stages == "hi" else
        ("loConfig", "loDataset") if stages == "lo" else
        ("hiConfig", "loConfig", "hiDataset", "loDataset")
    )
    toml_errors = []
    for key in toml_keys:
        path = artifacts[key]
        if not path.is_file():
            continue
        try:
            tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as exc:
            toml_errors.append(path.name + ": " + str(exc))
    checks.append(_make_check(
        "training_toml", "blocker", not toml_errors,
        "Training TOML is valid." if not toml_errors else "Training TOML could not be parsed.",
        "; ".join(toml_errors),
    ))
    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(_make_check("conda_runtime", "blocker", False,
                                  "Conda runtime needs both the executable path and environment name."))
    return folder_value, folder_path, artifacts, settings, checks


def _preflight_payload(folder, stages="both"):
    folder_value, folder_path, artifacts, settings, checks = _build_preflight(folder, stages)
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    warnings = [item for item in checks if item["severity"] == "warning" and not item["ok"]]
    return {
        "ok": not blockers,
        "folder": folder_value,
        "checks": checks,
        "summary": {"blockers": len(blockers), "warnings": len(warnings)},
        "settings": settings,
        "artifacts": {key: str(value) for key, value in artifacts.items()},
        "folderPath": str(folder_path),
    }


def _file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _input_evidence(folder_path, stages="both"):
    folder = Path(folder_path)
    manifest_path = folder / "auto_dataset" / "prep_manifest.json"
    digest = hashlib.sha256()
    count = 0
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    rows = (manifest.get("images") or []) + (manifest.get("videos") or []) if isinstance(manifest, dict) else []
    for row in sorted((item for item in rows if isinstance(item, dict)), key=lambda item: str(item.get("prepared_path") or item.get("file") or "")):
        prepared = str(row.get("prepared_path") or "")
        name = str(row.get("file") or prepared)
        if not prepared:
            continue
        count += 1
        digest.update(name.encode("utf-8"))
        caption = folder / "auto_dataset" / prepared
        caption = caption.with_suffix(".txt")
        try:
            digest.update(caption.read_bytes())
        except OSError:
            digest.update(b"<missing-caption>")
    config_names = (KREA2_CONFIG_NAME, "dataset.train.toml", "auto_dataset/training_plan.json") if stages == "krea2" else (WAN21_CONFIG_NAME, "dataset.train.toml", "auto_dataset/training_plan.json") if stages == "wan21" else (
        HI_CONFIG_NAME, LO_CONFIG_NAME, "dataset.hi.toml", "dataset.lo.toml", "auto_dataset/training_plan.json"
    )
    config_paths = [folder / name for name in config_names]
    config_digest = hashlib.sha256()
    for path in config_paths:
        config_digest.update(path.name.encode("utf-8"))
        try:
            config_digest.update(path.read_bytes())
        except OSError:
            config_digest.update(b"<missing>")
    return {"count": count, "fingerprint": "sha256:" + digest.hexdigest(), "configFingerprint": "sha256:" + config_digest.hexdigest()}


def _training_profile(folder_path):
    try:
        plan = json.loads((Path(folder_path) / "auto_dataset" / "training_plan.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        plan = {}
    mode = str(plan.get("mode") or "").lower() if isinstance(plan, dict) else ""
    return mode if mode in ("poc", "normal", "quality") else "unknown"


def _model_identity(artifacts, profile_id="wan22_t2v", stage="hi"):
    source = ""
    pattern = re.compile(r"^\s*(?:model|model_path|checkpoint|base_model|ckpt_path|diffusion_model|transformer_path)\s*=\s*[\"']?([^\"'\n#]+)", re.MULTILINE | re.IGNORECASE)
    key = str(stage) + "Config"
    try:
        match = pattern.search(Path(artifacts[key]).read_text(encoding="utf-8"))
    except (KeyError, OSError):
        match = None
    if match:
        source = match.group(1).strip()
    source_name = Path(source).name if source else ""
    if source_name.lower().endswith((".safetensors", ".ckpt", ".pt")):
        source_name = Path(source_name).stem
    selected_profile, _ = profile_run(profile_id, None, stage)
    label = selected_profile["label"]
    return {"label": label, "source": source}


def _read_config_positive_int(path, key, fallback=0):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return int(fallback)
    match = re.search(r"^\s*" + re.escape(key) + r"\s*=\s*(\d+)\s*(?:#.*)?$", text, re.MULTILINE)
    return max(1, int(match.group(1))) if match else int(fallback)


def _plan_run_steps(progress_plan, snapshot):
    """Translate generated sample exposures into the trainer's visible batch steps."""
    if not isinstance(progress_plan, dict):
        return progress_plan
    planned = {}
    for stage_name, stage_plan in progress_plan.items():
        stage = dict(stage_plan) if isinstance(stage_plan, dict) else {}
        exposures = int(stage.get("estimatedSteps") or 0)
        has_generated_shape = exposures > 0 and int(stage.get("epochs") or 0) > 0
        if has_generated_shape:
            micro_batch = _read_config_positive_int(snapshot.get(stage_name), "micro_batch_size_per_gpu", 1)
            stage["sampleExposures"] = exposures
            stage["microBatchSize"] = micro_batch
            stage["estimatedSteps"] = int(math.ceil(float(exposures) / float(micro_batch)))
        planned[stage_name] = stage
    return planned


def _copy_snapshot(job_dir, artifacts, folder_path, stages, effective_output_dir):
    snapshot = {}
    config_files = (("krea2", KREA2_CONFIG_NAME),) if stages == "krea2" else (("wan21", WAN21_CONFIG_NAME),) if stages == "wan21" else ((stages, HI_CONFIG_NAME if stages == "hi" else LO_CONFIG_NAME),) if stages in ("hi", "lo") else (("hi", HI_CONFIG_NAME), ("lo", LO_CONFIG_NAME))
    for key, filename in config_files:
        source = artifacts[key + "Config"]
        target = job_dir / filename
        shutil.copy2(source, target)
        normalize_path_permissions(target)
        snapshot[key] = str(target)
    dataset_files = ("dataset.train.toml", "auto_dataset/training_plan.json") if stages in ("krea2", "wan21") else (
        ("dataset." + stages + ".toml", "auto_dataset/training_plan.json") if stages in ("hi", "lo") else
        ("dataset.hi.toml", "dataset.lo.toml", "auto_dataset/training_plan.json")
    )
    for filename in dataset_files:
        source = Path(folder_path) / filename
        if not source.is_file():
            continue
        target = job_dir / Path(filename).name
        shutil.copy2(source, target)
        normalize_path_permissions(target)
        snapshot[Path(filename).stem.replace(".", "_")] = str(target)
    return snapshot


def _read_training_plan(folder_path):
    path = Path(folder_path) / "auto_dataset" / "training_plan.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    stages = parsed.get("stages") if isinstance(parsed, dict) else None
    return stages if isinstance(stages, dict) else {}


def _default_progress_plan():
    hi_steps, lo_steps = repeat_targets_for_mode("normal")
    return {
        "hi": {"estimatedSteps": hi_steps},
        "lo": {"estimatedSteps": lo_steps},
    }


def _normalize_training_stages(stages):
    value = str(stages or "both").strip().lower()
    if value not in ("hi", "lo", "both", "krea2", "wan21"):
        raise ValueError("Training stage must be hi, lo, both, krea2, or wan21.")
    return value


def _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage):
    if not str(resume_from_checkpoint or "").strip():
        return ""
    if stages in ("hi", "lo", "krea2", "wan21"):
        return stages
    value = str(resume_stage or "lo").strip().lower()
    if value not in ("hi", "lo"):
        raise ValueError("Resume stage must be hi or lo.")
    return value


def _build_runner_script(job, settings, artifacts, job_dir):
    stages = _normalize_training_stages(job.get("stages"))
    if stages in ("krea2", "wan21"):
        config_key = "krea2" if stages == "krea2" else "wan21"
        artifact_key = config_key + "Config"
        use_snapshot = bool(job.get("snapshot", {}).get(config_key))
        config_path = Path(job["snapshot"][config_key]) if use_snapshot else artifacts[artifact_key]
        hi_path = config_path
        lo_path = config_path
    else:
        snapshot = job.get("snapshot", {})
        use_snapshot = bool(snapshot.get("hi") or snapshot.get("lo"))
        hi_path = Path(snapshot.get("hi") or snapshot.get("lo")) if use_snapshot else artifacts["hiConfig"]
        lo_path = Path(snapshot.get("lo") or snapshot.get("hi")) if use_snapshot else artifacts["loConfig"]
    distribution = settings["wslDistribution"]
    hi_wsl = _to_wsl_path(hi_path, distribution)
    lo_wsl = _to_wsl_path(lo_path, distribution)
    resume_stage = _normalize_resume_stage(stages, job.get("resumeFromCheckpoint"), job.get("resumeStage"))
    resume_path = str(job.get("resumeFromCheckpoint") or "").strip()
    if resume_path and not resume_path.startswith("/"):
        resume_path = _to_wsl_path(resume_path, distribution)
    command_plan = build_training_command_plan(
        hi_wsl,
        lo_wsl,
        build_training_launcher(settings),
        resume_path,
        resume_stage,
    )
    result_wsl = _to_wsl_path(job_dir / "result.json", distribution)
    pid_wsl = _to_wsl_path(job_dir / "pid", distribution)
    action_wsl = _to_wsl_path(_job_action_path(job), distribution)
    lines = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        "PID_FILE=" + shlex.quote(pid_wsl),
        "RESULT_FILE=" + shlex.quote(result_wsl),
        "ACTION_FILE=" + shlex.quote(action_wsl),
        "echo $$ > \"$PID_FILE\"",
        "write_result() { printf '{\\\"status\\\":\\\"%s\\\",\\\"exitCode\\\":%s,\\\"finishedAt\\\":%s}\\n' \"$1\" \"$2\" \"$(date +%s)\" > \"$RESULT_FILE\"; }",
        "finish_requested_stop() { case \"$(cat \"$ACTION_FILE\" 2>/dev/null || true)\" in pause|finish|stop) echo '[webcap] requested stop'; write_result stopped 130; exit 130 ;; esac; }",
        "trap 'echo [webcap] stopped; write_result stopped 130; exit 130' INT TERM",
        "cd " + shlex.quote(settings["cwd"]) + " || { echo '[webcap] training working directory is unavailable'; write_result failed 1; exit 1; }",
    ]
    if settings["activate"] and not has_conda_runtime(settings):
        lines.append("source " + shlex.quote(settings["activate"]) + " || { echo '[webcap] training activation failed'; write_result failed 1; exit 1; }")
    if resume_stage:
        lines.append("printf '%s\\n' " + shlex.quote(
            "[webcap] resume stage=" + resume_stage + " checkpoint=" + str(job.get("resumeFromCheckpoint") or "")
        ))
    if stages in ("hi", "both"):
        lines.extend([
            "echo '[webcap] stage=hi'",
            "printf '%s\\n' " + shlex.quote("[webcap] command hi: " + command_plan["hiCommand"]),
            command_plan["hiCommand"],
            "HI_CODE=$?",
            "finish_requested_stop",
            "if [ \"$HI_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
            "if [ \"$HI_CODE\" -ne 0 ]; then echo '[webcap] HI failed'; write_result failed \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
        ])
    if stages in ("lo", "both"):
        lines.extend([
            "echo '[webcap] stage=lo'",
            "printf '%s\\n' " + shlex.quote("[webcap] command lo: " + command_plan["loCommand"]),
            command_plan["loCommand"],
            "LO_CODE=$?",
            "finish_requested_stop",
            "if [ \"$LO_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
            "if [ \"$LO_CODE\" -ne 0 ]; then echo '[webcap] LO failed'; write_result failed \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
        ])
    if stages in ("krea2", "wan21"):
        stage_title = "Krea2" if stages == "krea2" else "Wan2.1"
        stage_code = "KREA2" if stages == "krea2" else "WAN21"
        lines.extend([
            "echo '[webcap] stage=" + stages + "'",
            "printf '%s\\n' " + shlex.quote("[webcap] command " + stages + ": " + command_plan["loCommand"]),
            command_plan["loCommand"],
            stage_code + "_CODE=$?",
            "finish_requested_stop",
            "if [ \"$" + stage_code + "_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$" + stage_code + "_CODE\"; exit \"$" + stage_code + "_CODE\"; fi",
            "if [ \"$" + stage_code + "_CODE\" -ne 0 ]; then echo '[webcap] " + stage_title + " failed'; write_result failed \"$" + stage_code + "_CODE\"; exit \"$" + stage_code + "_CODE\"; fi",
        ])
    lines.extend(["echo '[webcap] completed'", "write_result completed 0"])
    script = "\n".join(lines) + "\n"
    return script, {"hi": hi_wsl, "lo": lo_wsl, "krea2": lo_wsl if stages == "krea2" else "", "wan21": lo_wsl if stages == "wan21" else "", "usedSnapshot": use_snapshot}


def _write_runner_script(job, settings, artifacts):
    job_dir = _job_dir(job)
    script, resolved = _build_runner_script(job, settings, artifacts, job_dir)
    path = job_dir / "runner.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    normalize_path_permissions(path)
    job["runnerScript"] = str(path)
    job["resolvedConfigs"] = resolved
    return path


def _launch_job(job, folder_path):
    launch_time = time.time()
    if not job.get("startedAt"):
        job["startedAt"] = launch_time
    job["updatedAt"] = launch_time
    job["status"] = "starting"
    job["stage"] = "launch"
    if job.get("parentJobId") and str(job.get("resumeFromCheckpoint") or "").strip():
        try:
            validate_resumable_run_for_path(
                folder_path,
                str(job.get("resumeStage") or job.get("stages") or ""),
                job["resumeFromCheckpoint"],
            )
        except ValueError as exc:
            job["status"] = "failed"
            job["stage"] = "resume"
            job["failureScope"] = "job"
            job["error"] = "Resume invariant failed: " + str(exc)
            job["finishedAt"] = time.time()
            return False
    settings = _training_settings()
    try:
        last_repair = float(job.get("permissionsRepairedAt") or 0)
    except (TypeError, ValueError):
        last_repair = 0
    if time.time() - last_repair >= 60:
        permission_error = _repair_training_set_permissions(folder_path, settings["wslDistribution"])
        if permission_error:
            job["status"] = "failed"
            job["stage"] = "permissions"
            job["error"] = permission_error
            job["finishedAt"] = time.time()
            return False
        job["permissionsRepairedAt"] = time.time()
    stages = job.get("stages") or "both"
    _, _, artifacts, settings, checks = (
        _build_launch_preflight(job["folder"], stages)
    )
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    job["preflight"] = {"checks": checks, "blockers": len(blockers)}
    if blockers:
        job["status"] = "failed"
        job["stage"] = "launch"
        job_local_checks = {"set_folder_exists", "training_artifacts", "training_toml"}
        job["failureScope"] = "job" if all(item.get("id") in job_local_checks for item in blockers) else "system"
        blocker_messages = []
        for item in blockers:
            text = str(item.get("message") or item.get("id") or "Preflight blocker").strip()
            details = str(item.get("details") or "").strip()
            blocker_messages.append(text + ((" — " + details) if details else ""))
        job["error"] = "Preflight failed: " + "; ".join(blocker_messages)
        job["finishedAt"] = time.time()
        return False
    job_dir = _job_dir(job)
    result_path = job_dir / "result.json"
    if result_path.exists():
        result_path.unlink()
    action_path = _job_action_path(job)
    if action_path.exists():
        action_path.unlink()
    script_path = _write_runner_script(job, settings, artifacts)
    script_wsl = _to_wsl_path(script_path, settings["wslDistribution"])
    log_path = job_dir / "run.log"
    log_wsl = _to_wsl_path(log_path, settings["wslDistribution"])
    launch = "setsid bash " + shlex.quote(script_wsl) + " > " + shlex.quote(log_wsl) + " 2>&1 < /dev/null & echo $!"
    code, stdout, stderr = _run_wsl(launch, timeout=15, distribution=settings["wslDistribution"])
    pid = (stdout or "").strip().splitlines()[-1] if (stdout or "").strip() else ""
    if code != 0 or not pid.isdigit():
        job["status"] = "failed"
        job["stage"] = "launch"
        job["error"] = (stderr or stdout).strip() or "Could not launch the managed training runner (exit " + str(code) + ")."
        job["finishedAt"] = time.time()
        return False
    job.update({
        "status": "starting",
        "stage": "starting",
        "pid": int(pid),
        "updatedAt": time.time(),
        "logPath": str(log_path),
        "error": "",
    })
    return True


def _read_result(job):
    path = _job_dir(job) / "result.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _read_config_epochs(path):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def _read_config_checkpoint_interval(path):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _CHECKPOINT_EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def _read_log_tail(path, byte_count=4096):
    try:
        with Path(path).open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - byte_count))
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _recent_seconds_per_step(log_text, stage):
    marker = "[webcap] stage=" + str(stage or "").lower()
    stage_log = str(log_text or "")
    marker_index = stage_log.lower().rfind(marker)
    if marker_index >= 0:
        stage_log = stage_log[marker_index:]
    samples = [float(value) for value in _LOG_ITER_TIME_PATTERN.findall(stage_log)[-ETA_SAMPLE_WINDOW:]]
    samples = [value for value in samples if value > 0]
    if len(samples) < ETA_MIN_SAMPLES:
        return None
    return sum(samples) / len(samples)


def _sync_job_progress(job, log_text):
    stage = str(job.get("stage") or "").lower()
    if stage not in ("hi", "lo", "krea2", "wan21"):
        job.pop("progress", None)
        return

    snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
    current_epochs = _read_config_epochs(snapshot.get(stage, ""))
    checkpoint_every_epochs = _read_config_checkpoint_interval(snapshot.get(stage, ""))
    if not current_epochs:
        job.pop("progress", None)
        return

    previous = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    previous_epoch = previous.get("epoch") if previous.get("stage") == stage else None
    epoch_matches = _LOG_EPOCH_PATTERN.findall(log_text or "")
    step_matches = _LOG_STEP_PATTERN.findall(log_text or "")
    epoch = int(epoch_matches[-1]) if epoch_matches else previous_epoch
    step = int(step_matches[-1]) if step_matches else previous.get("step")
    plan = job.get("progressPlan") if isinstance(job.get("progressPlan"), dict) else {}
    stage_plan = plan.get(stage) if isinstance(plan.get(stage), dict) else {}
    planned_steps = int(stage_plan.get("estimatedSteps") or 0)
    # Epochs come directly from diffusion-pipe's log and are authoritative when
    # available. The generated step budget is only a fallback for logs without
    # an epoch marker.
    use_steps = epoch is None and step is not None and planned_steps > 0
    if not use_steps and epoch is None:
        return
    stage_fraction = min(1.0, max(0.0, float(step) / float(planned_steps))) if use_steps else min(1.0, max(0.0, float(epoch) / float(current_epochs)))

    stages = _normalize_training_stages(job.get("stages"))
    hi_planned_steps = int((plan.get("hi") or {}).get("estimatedSteps") or 0) if isinstance(plan.get("hi"), dict) else 0
    lo_planned_steps = int((plan.get("lo") or {}).get("estimatedSteps") or 0) if isinstance(plan.get("lo"), dict) else 0
    hi_epochs = _read_config_epochs(snapshot.get("hi", ""))
    lo_epochs = _read_config_epochs(snapshot.get("lo", ""))
    if stages == "both" and use_steps and hi_planned_steps and lo_planned_steps:
        total_steps = hi_planned_steps + lo_planned_steps
        overall_fraction = (stage_fraction * hi_planned_steps / total_steps) if stage == "hi" else ((hi_planned_steps + stage_fraction * lo_planned_steps) / total_steps)
    elif stages == "both" and hi_epochs and lo_epochs:
        total_epochs = hi_epochs + lo_epochs
        overall_fraction = (stage_fraction * hi_epochs / total_epochs) if stage == "hi" else ((hi_epochs + stage_fraction * lo_epochs) / total_epochs)
    else:
        overall_fraction = stage_fraction

    progress = {
        "stage": stage,
        "epoch": int(epoch) if epoch is not None else None,
        "epochs": int(current_epochs),
        "step": int(step) if step is not None else None,
        "stagePercent": round(stage_fraction * 100, 1),
        "overallPercent": round(overall_fraction * 100, 1),
        "estimated": use_steps,
    }
    if use_steps:
        progress["plannedSteps"] = planned_steps
        progress["source"] = "steps"
    else:
        progress["source"] = "epochs"
    seconds_per_step = _recent_seconds_per_step(log_text, stage)
    if step is not None and seconds_per_step is not None:
        progress["estimatedTrainingSeconds"] = round(max(0, step) * seconds_per_step)
    if step is not None and planned_steps > 0 and seconds_per_step is not None:
        remaining_steps = max(0, planned_steps - step)
        eta_scope = "completion"
        if stages == "both" and stage == "hi":
            next_stage_steps = lo_planned_steps
            if next_stage_steps > 0:
                remaining_steps += next_stage_steps
            else:
                eta_scope = "stage"
        progress["etaSeconds"] = round(remaining_steps * seconds_per_step)
        progress["etaScope"] = eta_scope
    if epoch is not None and checkpoint_every_epochs:
        next_checkpoint_epoch = ((int(epoch) // checkpoint_every_epochs) + 1) * checkpoint_every_epochs
        if next_checkpoint_epoch <= current_epochs:
            progress["checkpointEveryNEpochs"] = checkpoint_every_epochs
            progress["nextCheckpointEpoch"] = next_checkpoint_epoch
            if planned_steps > 0 and seconds_per_step is not None:
                checkpoint_steps = max(0.0, (next_checkpoint_epoch - float(epoch)) * planned_steps / float(current_epochs))
                progress["checkpointEtaSeconds"] = round(checkpoint_steps * seconds_per_step)
    job["progress"] = progress


def _job_wsl_distribution(job):
    runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
    return str(runtime.get("wslDistribution") or _training_settings()["wslDistribution"] or "").strip()


def _annotate_completed_job(job):
    if job.get("status") != "completed":
        return
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    epoch = int(progress.get("epoch") or 0)
    epochs = int(progress.get("epochs") or 0)
    if epochs:
        if epoch < epochs * 0.9:
            job["completionNote"] = (
                "Finished at epoch " + format(epoch, ",") + " of " + format(epochs, ",")
                + " planned epochs. Review output; the run ended below the planned estimate."
            )
        else:
            job.pop("completionNote", None)
        return
    step = int(progress.get("step") or 0)
    planned_steps = int(progress.get("plannedSteps") or 0)
    if planned_steps and step < planned_steps * 0.9:
        job["completionNote"] = (
            "Finished at step " + format(step, ",") + " of ~" + format(planned_steps, ",")
            + " planned steps. Review output; the run ended below the planned estimate."
        )
    else:
        job.pop("completionNote", None)


def _annotate_finished_early_job(job):
    if job.get("status") != "finished_early":
        return
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    details = []
    epoch = progress.get("epoch")
    epochs = progress.get("epochs")
    step = progress.get("step")
    if isinstance(epoch, (int, float)) and isinstance(epochs, (int, float)) and epochs:
        details.append("epoch " + str(int(epoch)) + " / " + str(int(epochs)))
    if isinstance(step, (int, float)):
        details.append("step " + format(int(step), ","))
    job["completionNote"] = "Finished early by the user" + (" at " + " · ".join(details) if details else ".")


def _pid_alive(pid, distribution=""):
    if not pid:
        return False
    code, _, _ = _run_wsl("kill -0 " + str(int(pid)), timeout=8, distribution=distribution)
    return code == 0


def _job_runner_pid(job):
    """Use the PID recorded by the runner when it is available."""
    try:
        recorded = (_job_dir(job) / "pid").read_text(encoding="utf-8").strip()
        if recorded.isdigit():
            return int(recorded)
    except OSError:
        pass
    try:
        return int(job.get("pid") or 0)
    except (TypeError, ValueError):
        return 0


def _bind_job_run_path(job):
    """Bind only a run directory carrying the exact launched config bytes."""
    model_id = str(job.get("stages") or "")
    if model_id not in ("hi", "lo", "krea2", "wan21") or job.get("outputRunPath"):
        return
    hashes = job.get("configHashes") if isinstance(job.get("configHashes"), dict) else {}
    wanted_hash = str(hashes.get(model_id) or "")
    snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
    snapshot_path = str(snapshot.get(model_id) or "")
    if not wanted_hash and snapshot_path:
        try:
            wanted_hash = config_sha256(snapshot_path)
            hashes[model_id] = wanted_hash
            job["configHashes"] = hashes
        except OSError:
            return
    output_root = Path(str(job.get("outputRoot") or ""))
    if not wanted_hash or not output_root.is_dir():
        return
    filename = Path(snapshot_path).name
    exact = []
    try:
        for config_path in output_root.rglob(filename):
            if ".webcap" in config_path.parts or config_sha256(config_path) != wanted_hash:
                continue
            exact.append(config_path.parent)
    except (OSError, ValueError):
        return
    if len(exact) != 1:
        return
    training_root = str(job.get("effectiveOutputDir") or "")
    try:
        relative = exact[0].relative_to(output_root).as_posix()
        job["outputRunPath"] = str(PurePosixPath(training_root) / relative) if training_root.startswith("/") else str(exact[0])
    except ValueError:
        job["outputRunPath"] = str(exact[0])
    job["updatedAt"] = time.time()


def _refresh_job(job):
    if str(job.get("status")) not in ACTIVE_STATUSES:
        return
    if not job.get("progressPlan"):
        job["progressPlan"] = _default_progress_plan()
    _bind_job_run_path(job)
    result = _read_result(job)
    if result:
        result_status = str(result.get("status") or "failed")
        requested_action = str(job.get("actionRequested") or "")
        log_path = Path(job.get("logPath") or "")
        failure_excerpt = ""
        if log_path.is_file():
            try:
                tail = _read_log_tail(log_path)
                failure_excerpt = tail[-8192:]
                if "[webcap] stage=wan21" in tail:
                    job["stage"] = "wan21"
                elif "[webcap] stage=krea2" in tail:
                    job["stage"] = "krea2"
                elif "[webcap] stage=lo" in tail:
                    job["stage"] = "lo"
                elif "[webcap] stage=hi" in tail:
                    job["stage"] = "hi"
                _sync_job_progress(job, tail)
            except OSError:
                pass
        job.pop("confirmationNote", None)
        job.pop("error", None)
        exit_code = int(result.get("exitCode") or 0)
        if requested_action == "pause":
            job["status"] = "paused"
        elif requested_action == "finish" and result_status != "completed":
            job["status"] = "finished_early"
        elif requested_action == "stop":
            job["status"] = "stopped"
        elif result_status == "stopped":
            job["status"] = "interrupted"
            job["error"] = "Runner stopped without a WebCap stop or pause action."
        else:
            job["status"] = result_status
        job["exitCode"] = exit_code
        if job["status"] == "failed":
            job["failureScope"] = "unknown"
            job["failureExcerpt"] = failure_excerpt
            job["error"] = "Training process exited with code " + str(exit_code) + ". See failure details or open the run log."
        job["finishedAt"] = float(result.get("finishedAt") or time.time())
        job["updatedAt"] = time.time()
        _annotate_completed_job(job)
        _annotate_finished_early_job(job)
        return
    now = time.time()
    log_advanced = False
    log_has_progress = False
    log_path = Path(job.get("logPath") or "")
    if log_path.exists():
        try:
            log_mtime = log_path.stat().st_mtime
            prior_log_mtime = float(job.get("lastLogAt") or 0)
            job["lastLogAt"] = log_mtime
            tail = _read_log_tail(log_path)
            log_advanced = bool(prior_log_mtime and log_mtime > prior_log_mtime)
            log_has_progress = bool(_LOG_EPOCH_PATTERN.search(tail) or _LOG_STEP_PATTERN.search(tail))
            if "[webcap] stage=wan21" in tail:
                job["stage"] = "wan21"
            elif "[webcap] stage=krea2" in tail:
                job["stage"] = "krea2"
            elif "[webcap] stage=lo" in tail:
                job["stage"] = "lo"
            elif "[webcap] stage=hi" in tail:
                job["stage"] = "hi"
            _sync_job_progress(job, tail)
        except OSError:
            pass
    runner_pid = _job_runner_pid(job)
    if runner_pid:
        job["pid"] = runner_pid
    if _pid_alive(runner_pid, _job_wsl_distribution(job)):
        if job.get("status") == "unconfirmed":
            job["status"] = "running" if log_has_progress else "starting"
        elif job.get("status") == "starting" and log_has_progress:
            job["status"] = "running"
        job.pop("confirmationNote", None)
        job["updatedAt"] = now
        return
    if log_advanced:
        job["status"] = "running"
        job.pop("confirmationNote", None)
        job["updatedAt"] = now
        return
    if job.get("status") != "stopping":
        job["status"] = "unconfirmed"
        job["confirmationNote"] = "WebCap cannot currently confirm the runner. Waiting for its result record."
    else:
        action = str(job.get("actionRequested") or "stop")
        job["confirmationNote"] = action.capitalize() + " requested. Waiting for the runner result."
    job["updatedAt"] = time.time()
    return


def _prepare_paused_job_for_resume(job):
    stage = str(job.get("stages") or "")
    if stage not in ("hi", "lo", "krea2", "wan21"):
        return "Only an individual training stage can resume."
    folder = str(job.get("folder") or "")
    folder_path = app_config.safe_join_fs_root(folder)
    bound_path = str(job.get("outputRunPath") or "").strip()
    if not bound_path:
        return "Resume invariant failed: this job has no recorded output run path."
    try:
        run = validate_resumable_run_for_path(folder_path, stage, bound_path)
    except ValueError as exc:
        return "Resume invariant failed: " + str(exc)
    checkpoint = str(run.get("path") or "")
    job["resumeFromCheckpoint"] = checkpoint
    job["resumeStage"] = stage if checkpoint else ""
    job.pop("actionRequested", None)
    job.pop("actionRequestedAt", None)
    job["status"] = "queued"
    job["stage"] = "queued"
    job["error"] = ""
    job.pop("finishedAt", None)
    return ""


def _start_next(state):
    if state.get("queuePaused"):
        return
    active_id = str(state.get("activeJobId") or "")
    active = _find_job(state, active_id) if active_id else None
    if active and active.get("status") in ACTIVE_STATUSES:
        return
    state["activeJobId"] = ""
    for job in state.get("jobs", []):
        if job.get("status") not in QUEUE_STATUSES:
            continue
        if job.get("status") in ("paused", "interrupted"):
            resume_error = _prepare_paused_job_for_resume(job)
            if resume_error:
                job["error"] = resume_error
                job["status"] = "failed"
                job["stage"] = "resume"
                job["finishedAt"] = time.time()
                continue
        folder_path = app_config.safe_join_fs_root(job["folder"])
        _launch_job(job, folder_path)
        if job.get("status") in ACTIVE_STATUSES:
            state["activeJobId"] = job["id"]
            return
        if job.get("status") == "failed":
            continue


def _refresh_state(state):
    for job in state.get("jobs", []):
        if job.get("status") == "queued" and not job.get("progressPlan"):
            job["progressPlan"] = _default_progress_plan()
        if job.get("status") == "queued" and str(job.get("resumeFromCheckpoint") or "").strip():
            try:
                folder_path = app_config.safe_join_fs_root(job["folder"])
                stage = str(job.get("resumeStage") or job.get("stages") or "")
                job["resumePoint"] = resume_point_from_directory(folder_path, stage, job["resumeFromCheckpoint"])
                job.pop("resumePointError", None)
            except Exception as exc:
                job["resumePoint"] = {}
                job["resumePointError"] = str(exc)
        elif job.get("status") == "completed":
            _annotate_completed_job(job)
    active_id = str(state.get("activeJobId") or "")
    active = _find_job(state, active_id) if active_id else None
    if active:
        _refresh_job(active)
        if active.get("status") == "paused":
            state["queuePaused"] = True
            state["queuePauseReason"] = state.get("queuePauseReason") or "Queue paused by the user."
            state["activeJobId"] = ""
        if active.get("status") in TERMINAL_STATUSES:
            state["activeJobId"] = ""
    _start_next(state)


def _monitor_loop():
    while True:
        try:
            with _lock:
                state = _read_state()
                _apply_restart_hold(state)
                _refresh_state(state)
                _sync_histories(state)
                _write_state(state)
        except Exception:
            _logger.exception("Training queue monitor failed; the existing queue state was not replaced.")
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(target=_monitor_loop, name="webcap-training-runner", daemon=True)
        _monitor_thread.start()


def _public_job(job):
    fields = ("id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel", "model", "input", "artifactDir", "artifactSummary", "resumeFromCheckpoint", "resumeStage", "resumePoint", "resumePointError", "outputRunPath", "configHashes", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt", "updatedAt", "lastLogAt", "error", "confirmationNote", "completionNote", "exitCode", "failureScope", "failureExcerpt", "resolvedConfigs", "preflight", "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence", "launchGroupRoot", "parentJobId", "progress", "progressPlan", "actionRequested", "actionRequestedAt")
    return {field: job.get(field) for field in fields if field in job}


def validate_response(folder, stages="both", resume_from_checkpoint="", resume_stage="", profile_id="", run_id=""):
    try:
        if profile_id or run_id:
            _, selected_run = profile_run(profile_id, run_id, stages)
            stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
        payload = _preflight_payload(folder, stages)
        settings = payload.pop("settings")
        artifacts = {key: Path(value) for key, value in payload.pop("artifacts").items()}
        blockers = [item for item in payload["checks"] if item["severity"] == "blocker" and not item["ok"]]
        if blockers:
            warnings = [item for item in payload["checks"] if item["severity"] == "warning" and not item["ok"]]
            payload["ok"] = False
            payload["summary"] = {"blockers": len(blockers), "warnings": len(warnings)}
            payload.pop("folderPath", None)
            return payload, 200
        diagnostic_job = {
            "id": "diagnostic",
            "snapshot": ({"krea2": str(artifacts["krea2Config"])} if stages == "krea2" else {"wan21": str(artifacts["wan21Config"])} if stages == "wan21" else {"hi": str(artifacts["hiConfig"]), "lo": str(artifacts["loConfig"])}),
            "stages": stages,
            "resumeFromCheckpoint": str(resume_from_checkpoint or "").strip(),
            "resumeStage": resume_stage,
        }
        try:
            script, resolved = _build_runner_script(diagnostic_job, settings, artifacts, _runtime_root() / "diagnostic")
            payload["runnerScript"] = script
            payload["resolvedConfigs"] = resolved
            code, stdout, stderr = _run_wsl(
                "bash -n -c " + shlex.quote(script),
                timeout=15,
                distribution=settings["wslDistribution"],
            )
            payload["checks"].append(_make_check(
                "runner_syntax", "blocker", code == 0,
                "Generated runner script has valid Bash syntax." if code == 0 else "Generated runner script has invalid Bash syntax.",
                (stdout + stderr).strip(),
            ))
        except Exception as exc:
            payload["runnerScript"] = ""
            payload["scriptError"] = str(exc)
            payload["checks"].append(_make_check("runner_syntax", "blocker", False, "Could not build the runner script.", str(exc)))
        blockers = [item for item in payload["checks"] if item["severity"] == "blocker" and not item["ok"]]
        warnings = [item for item in payload["checks"] if item["severity"] == "warning" and not item["ok"]]
        payload["ok"] = not blockers
        payload["summary"] = {"blockers": len(blockers), "warnings": len(warnings)}
        payload.pop("folderPath", None)
        return payload, 200
    except Exception as exc:
        return {"ok": False, "error": str(exc), "checks": [], "summary": {"blockers": 1, "warnings": 0}}, 400


def _new_job(folder, preflight, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id="", profile_id="", run_id="", launch_group=None):
    job_id = uuid.uuid4().hex[:12]
    _, folder_path = _resolve_folder(folder)
    stages = _normalize_training_stages(stages)
    artifacts, _ = _resolve_artifacts(folder, folder_path, stages)
    selected_profile, _ = profile_run(profile_id, run_id, stages)
    config_meta = config_for_stage(selected_profile["id"], stages)
    output_slug = config_meta["outputSlug"]
    resume_path = str(resume_from_checkpoint or "").strip()
    distribution = _training_settings()["wslDistribution"]
    if resume_path:
        configured_output = output_dir_from_config(folder_path, stages)
        if configured_output is None:
            raise ValueError("Current training config is missing output_dir.")
        effective_output_dir = str(configured_output).replace("\\", "/")
        output_root = host_path_for_training_path(effective_output_dir)
        group_root = output_root
    else:
        group_root = Path(launch_group) if launch_group else allocate_training_launch_group(folder_path)
        output_root = group_root / output_slug
        output_root.mkdir(parents=True, exist_ok=False)
        normalize_path_permissions(output_root)
        effective_output_dir = _to_wsl_path(output_root, distribution)
        source_config = artifacts[stages + "Config"]
        source_config.write_text(
            with_output_dir(source_config.read_text(encoding="utf-8"), effective_output_dir),
            encoding="utf-8",
        )
        normalize_path_permissions(source_config)
    job_dir = group_root / ".webcap" / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    normalize_path_permissions(job_dir)
    snapshot = _copy_snapshot(job_dir, artifacts, folder_path, stages, effective_output_dir)
    config_hashes = {
        model_id: config_sha256(config_path)
        for model_id, config_path in snapshot.items()
        if model_id in ("hi", "lo", "krea2", "wan21")
    }
    progress_plan = _plan_run_steps(_read_training_plan(folder_path) or _default_progress_plan(), snapshot)
    input_evidence = _input_evidence(folder_path, stages)
    model = _model_identity(artifacts, selected_profile["id"], stages)
    sequence_match = re.match(r"^([0-9A-Z]{3})-", group_root.name)
    action_run_id = str(run_id or "")
    job_run_id = stages if selected_profile["id"] == "wan22_t2v" and action_run_id == "both" else action_run_id
    return {
        "id": job_id,
        "folder": folder,
        "stages": stages,
        "profileId": selected_profile["id"],
        "runId": job_run_id,
        "actionRunId": action_run_id,
        "modelLabel": model["label"],
        "model": model,
        "datasetTarget": _training_profile(folder_path),
        "input": input_evidence,
        "resumeFromCheckpoint": resume_path,
        "resumeStage": _normalize_resume_stage(stages, resume_path, resume_stage),
        "outputRunPath": resume_path,
        "resumePoint": resume_point_for_path(folder_path, stages, resume_path) if resume_path else {},
        "status": "queued",
        "stage": "queued",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "permissionsRepairedAt": time.time(),
        "snapshot": snapshot,
        "configHashes": config_hashes,
        "artifactPath": str(job_dir),
        "artifactDir": str(job_dir),
        "progressPlan": progress_plan,
        "runtime": {"wslDistribution": distribution},
        "preflight": {"checks": preflight.get("checks", []), "blockers": preflight.get("summary", {}).get("blockers", 0)},
        "outputRoot": str(output_root),
        "effectiveOutputDir": effective_output_dir,
        "outputSlug": output_slug,
        "launchGroupId": group_root.name,
        "sequence": sequence_match.group(1) if sequence_match else "",
        "launchGroupRoot": str(group_root),
        "parentJobId": str(parent_job_id or ""),
    }


def start_response(folder, queue=False, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id="", profile_id="", run_id=""):
    try:
        selected_profile, selected_run = profile_run(profile_id, run_id, stages)
        stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}, 400
    try:
        _, folder_path = _resolve_folder(folder)
        settings = _training_settings()
        permission_error = _repair_training_set_permissions(folder_path, settings["wslDistribution"])
        if permission_error:
            return {"ok": False, "error": permission_error}, 400
        _, folder_path, _, _, checks = _build_launch_preflight(folder, stages)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 400
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    preflight = {"checks": checks, "summary": {"blockers": len(blockers), "warnings": 0}}
    if blockers:
        return {"ok": False, "error": "Launch checks failed.", "preflight": preflight}, 400
    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        _apply_restart_hold(state)
        _refresh_state(state)
        active = _find_job(state, state.get("activeJobId")) if state.get("activeJobId") else None
        has_pending_queue = any(job.get("status") in QUEUE_STATUSES for job in state.get("jobs", []))
        if active and active.get("status") not in TERMINAL_STATUSES and not queue:
            _write_state(state)
            return {"ok": False, "error": "A managed training job is already active.", "activeJob": _public_job(active)}, 409
        # An explicit Train request is permission to start a fresh queue. A
        # stale hold from a previous terminal job must not leave the new job
        # queued forever when there is no active or pending work to protect.
        if not active and not has_pending_queue:
            state["queuePaused"] = False
            state["queuePauseReason"] = ""
        job_stages = ("hi", "lo") if stages == "both" else (stages,)
        needs_new_output = any(not (resume_from_checkpoint and resume_stage == job_stage) for job_stage in job_stages)
        launch_group = allocate_training_launch_group(folder_path) if needs_new_output else None
        jobs = []
        for job_stage in job_stages:
            stage_resume = resume_from_checkpoint if resume_stage == job_stage else ""
            jobs.append(_new_job(
                str(folder).strip(), preflight, job_stage, stage_resume, job_stage if stage_resume else "", parent_job_id,
                selected_profile["id"], selected_run["id"], launch_group
            ))
        state["jobs"].extend(jobs)
        if not active or active.get("status") in TERMINAL_STATUSES:
            _start_next(state)
        _sync_histories(state)
        _write_state(state)
        return {
            "ok": True,
            "job": _public_job(jobs[0]),
            "jobs": [_public_job(job) for job in jobs],
            "queued": jobs[0].get("status") == "queued",
        }, 200


def folder_statuses_for_folders(folder_paths):
    """Return the small training-status payload used by the folder backlog view."""
    with _lock:
        try:
            state = _read_state()
        except TrainingStateError:
            _logger.exception("Training queue state is unavailable; omitting folder training badges.")
            return {}
        jobs = list(state.get("jobs", []))
    queue_position = 0
    queued_by_folder = {}
    for job in jobs:
        if job.get("status") in QUEUE_STATUSES:
            queue_position += 1
            queued_by_folder.setdefault(str(job.get("folder") or ""), {"position": queue_position, "status": job.get("status")})
    result = {}
    for folder_path in folder_paths:
        path = Path(folder_path)
        try:
            folder = str(path.relative_to(app_config.FS_ROOT)).replace("\\", "/")
        except ValueError:
            continue
        matching = [job for job in jobs if str(job.get("folder") or "") == folder]
        active = next((job for job in matching if job.get("status") in ACTIVE_STATUSES), None)
        if active:
            result[path] = {"status": "training", "label": "Training", "jobId": active.get("id"), "stage": active.get("stages")}
        elif folder in queued_by_folder:
            queued = queued_by_folder[folder]
            result[path] = {"status": "queued", "label": "Queued #" + str(queued["position"]), "queuePosition": queued["position"]}
        else:
            required_stages, completed = completed_stages(path)
            if required_stages and len(completed) == len(required_stages):
                result[path] = {"status": "trained", "label": "Trained"}
            elif completed:
                result[path] = {"status": "partial", "label": "Partially trained"}
            elif all((path / name).is_file() for name in (HI_CONFIG_NAME, LO_CONFIG_NAME, "dataset.hi.toml", "dataset.lo.toml")) and _prepared_dataset_is_ready(path):
                needs_review, partial_count, touched_count = _needs_partial_annotation_caption_review(path)
                if needs_review:
                    result[path] = {
                        "status": "caption-review",
                        "label": "Caption review needed (" + str(partial_count) + " of " + str(touched_count) + ")",
                    }
                else:
                    result[path] = {"status": "ready", "label": "Ready to train"}
            else:
                result[path] = {"status": "never", "label": ""}
    return result


def status_response():
    with _lock:
        _ensure_monitor_started()
        try:
            state = _read_state()
        except TrainingStateError as exc:
            return {"ok": False, "stateError": True, "recoveryAvailable": True, "error": str(exc)}, 409
        _apply_restart_hold(state)
        _refresh_state(state)
        _sync_histories(state)
        _write_state(state)
        return {
            "ok": True,
            "activeJobId": state.get("activeJobId") or "",
            "queuePaused": bool(state.get("queuePaused")),
            "queuePauseReason": str(state.get("queuePauseReason") or ""),
            "jobs": [_public_job(job) for job in state.get("jobs", [])],
        }, 200


def clear_history_response(folder, job_id):
    folder_text = str(folder or "").strip()
    job_id = str(job_id or "").strip()
    if not folder_text or not job_id:
        return {"ok": False, "error": "Folder and job ID are required."}, 400
    with _lock:
        folder_path = app_config.safe_join_fs_root(folder_text)
        state = _read_state()
        job = _find_job(state, job_id)
        if job and str(job.get("folder") or "") == folder_text:
            job["historyHidden"] = True
            job["updatedAt"] = time.time()
        cleared = clear_history_job(folder_path, job_id)
        _write_state(state)
        return {"ok": True, "cleared": cleared}, 200


def gpu_status_response():
    return {"ok": True, "gpu": _gpu_snapshot()}, 200


def log_response(job_id, offset=0, tail=False):
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        _refresh_state(state)
        job = _find_job(state, job_id)
        _sync_histories(state)
        _write_state(state)
        if not job:
            return {"error": "Training job not found"}, 404
        path = Path(job.get("logPath") or (_job_dir(job) / "run.log"))
        try:
            position = max(0, int(offset or 0))
        except (TypeError, ValueError):
            position = 0
        if not path.exists():
            return {"ok": True, "job": _public_job(job), "offset": 0, "nextOffset": 0, "text": ""}, 200
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            if tail:
                position = max(0, size - 65536)
            else:
                position = min(position, size)
            handle.seek(position)
            raw = handle.read(65536)
            next_offset = handle.tell()
        return {
            "ok": True,
            "job": _public_job(job),
            "offset": position,
            "nextOffset": next_offset,
            "text": raw.decode("utf-8", errors="replace"),
            "truncated": bool(tail and position > 0),
        }, 200


def log_path_for_job(job_id):
    """Return the managed log path for a known job; never accept a caller path."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id)
        if not job:
            raise ValueError("Training job not found")
        path = _job_dir(job) / "run.log"
        if not path.is_file():
            raise FileNotFoundError("Training log is not available yet")
        return path


def output_path_for_job(job_id):
    """Return the trainer-created run directory, or its parent before binding."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id)
        if not job:
            raise ValueError("Training job was not found.")
        raw_run_path = str(job.get("outputRunPath") or "").strip()
        if raw_run_path:
            path = host_path_for_training_path(raw_run_path)
            if not path.is_dir():
                raise FileNotFoundError("Recorded training run directory is unavailable: " + raw_run_path)
            return path
        raw_path = str(job.get("outputRoot") or "").strip()
        if not raw_path:
            raise ValueError("Training job has no effective output directory.")
        return Path(raw_path)


def stop_response(job_id, cancel=False, pause=False, finish=False):
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        _refresh_state(state)
        job = _find_job(state, job_id)
        if not job:
            return {"ok": False, "error": "Training job not found"}, 404
        if job.get("status") in QUEUE_STATUSES and cancel:
            job["status"] = "cancelled"
            job["stage"] = "cancelled"
            job["finishedAt"] = time.time()
            job["updatedAt"] = time.time()
            job["historyHidden"] = True
            folder = str(job.get("folder") or "").strip()
            if folder:
                clear_history_job(app_config.safe_join_fs_root(folder), job.get("id"))
            _write_state(state)
            return {"ok": True, "job": _public_job(job)}, 200
        if cancel:
            return {"ok": False, "error": "Only queued training jobs can be cancelled. Use Stop, Pause, or Finish for the active job."}, 400
        if job.get("status") not in ACTIVE_STATUSES:
            return {"ok": False, "error": "Training job is not running."}, 400
        pid = int(job.get("pid") or 0)
        action = "pause" if pause else "finish" if finish else "stop"
        if pid <= 0:
            return {"ok": False, "error": "WebCap has no recorded runner PID, so it cannot send the " + action + " request safely."}, 409
        distribution = _job_wsl_distribution(job)
        action_path = _job_action_path(job)
        action_path.write_text(action, encoding="utf-8")
        normalize_path_permissions(action_path)
        code, stdout, stderr = _run_wsl("kill -INT -- -" + str(pid), timeout=8, distribution=distribution)
        if code != 0:
            try:
                action_path.unlink()
            except OSError:
                pass
            message = (stderr or stdout or "Could not send the " + action + " request.").strip()
            job["error"] = message
            job["updatedAt"] = time.time()
            _write_state(state)
            return {"ok": False, "error": message, "job": _public_job(job)}, 502
        job["actionRequested"] = action
        job["actionRequestedAt"] = time.time()
        job["status"] = "stopping"
        job["stage"] = "stopping"
        job["confirmationNote"] = action.capitalize() + " requested. Waiting for the runner result."
        job["updatedAt"] = time.time()
        _write_state(state)
        return {"ok": True, "job": _public_job(job)}, 200


def reorder_response(job_id, direction):
    if direction not in ("up", "down"):
        return {"ok": False, "error": "Queue direction must be up or down."}, 400
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        queued_indexes = [index for index, job in enumerate(state.get("jobs", [])) if job.get("status") in QUEUE_STATUSES]
        current = next((index for index in queued_indexes if state["jobs"][index].get("id") == job_id), None)
        if current is None:
            return {"ok": False, "error": "Queued training job not found."}, 404
        queue_position = queued_indexes.index(current)
        target_position = queue_position - 1 if direction == "up" else queue_position + 1
        if target_position < 0 or target_position >= len(queued_indexes):
            return {"ok": False, "error": "Training job cannot move further in the queue."}, 400
        target = queued_indexes[target_position]
        state["jobs"][current], state["jobs"][target] = state["jobs"][target], state["jobs"][current]
        state["jobs"][current]["updatedAt"] = time.time()
        state["jobs"][target]["updatedAt"] = time.time()
        _sync_histories(state)
        _write_state(state)
        return {"ok": True, "jobs": [_public_job(job) for job in state["jobs"]]}, 200


def resume_queue_response():
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        active = _find_job(state, state.get("activeJobId")) if state.get("activeJobId") else None
        if active and active.get("status") in ACTIVE_STATUSES:
            return {"ok": False, "error": "A training job is already active."}, 409
        state["queuePaused"] = False
        state["queuePauseReason"] = ""
        _refresh_state(state)
        _sync_histories(state)
        _write_state(state)
        if state.get("queuePaused") and not state.get("activeJobId"):
            return {
                "ok": False,
                "error": state.get("queuePauseReason") or "No queued training job was started.",
                "jobs": [_public_job(job) for job in state["jobs"]],
            }, 409
        return {"ok": True, "activeJobId": state.get("activeJobId") or "", "jobs": [_public_job(job) for job in state["jobs"]]}, 200


def resume_job_response(job_id):
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        _refresh_state(state)
        prior = _find_job(state, job_id)
        if not prior:
            return {"ok": False, "error": "Training job not found."}, 404
        if prior.get("status") not in ("paused", "interrupted"):
            return {"ok": False, "error": "Only paused or interrupted jobs can resume."}, 400
        next_job = next((job for job in state.get("jobs", []) if job.get("status") in QUEUE_STATUSES), None)
        if next_job is not prior:
            return {"ok": False, "error": "Reorder the queue, then resume its first item."}, 409
        resume_error = _prepare_paused_job_for_resume(prior)
        if resume_error:
            prior["error"] = resume_error
            _sync_histories(state)
            _write_state(state)
            return {"ok": False, "error": resume_error}, 409
        state["queuePaused"] = False
        state["queuePauseReason"] = ""
        _start_next(state)
        _sync_histories(state)
        _write_state(state)
        return {"ok": True, "job": _public_job(prior), "resumeFromCheckpoint": prior.get("resumeFromCheckpoint", "")}, 200
