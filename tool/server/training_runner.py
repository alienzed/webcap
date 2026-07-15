import json
import os
import re
import csv
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import config as app_config
from .caption_ops import _caption_name_for_media
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .permissions import normalize_path_permissions
from .training_commands import build_training_command_plan, build_training_launcher_probe
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME
from .dataset_config import repeat_targets_for_mode
from .training_history import completed_stages, discover_runs, output_root_for_folder, record_job
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
ACTIVE_STATUSES = {"starting", "running", "stopping"}
QUEUE_STATUSES = {"queued", "paused", "interrupted"}
HISTORY_STATUSES = {"completed", "finished_early", "failed", "stopped", "cancelled"}
TERMINAL_STATUSES = HISTORY_STATUSES | {"paused", "interrupted"}
_lock = threading.Lock()
_monitor_lock = threading.Lock()
_monitor_thread = None
_startup_reconciled = False
_history_signatures = {}
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_LOG_EPOCH_PATTERN = re.compile(r"Started new epoch:\s*(\d+)", re.IGNORECASE)
_LOG_STEP_PATTERN = re.compile(r"\bstep=(\d+)", re.IGNORECASE)
_LOG_ITER_TIME_PATTERN = re.compile(r"\biter time \(s\):\s*(\d+(?:\.\d+)?)", re.IGNORECASE)
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


def _read_state():
    _ensure_runtime_dirs()
    path = _state_path()
    if not path.exists():
        return _default_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_state()
    if not isinstance(parsed, dict) or parsed.get("version") != 3:
        return _default_state()
    parsed.setdefault("activeJobId", "")
    parsed.setdefault("jobs", [])
    parsed.setdefault("queuePaused", False)
    parsed.setdefault("queuePauseReason", "")
    if not isinstance(parsed["jobs"], list):
        parsed["jobs"] = []
    return parsed


def _write_state(state):
    _ensure_runtime_dirs()
    path = _state_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    normalize_path_permissions(path)


def _sync_job_history(job):
    if job.get("status") not in HISTORY_STATUSES:
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


def _job_dir(job_id):
    return _jobs_root() / str(job_id)


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


def _resolve_artifacts(folder, folder_path):
    paths = {
        "hiConfig": folder_path / HI_CONFIG_NAME,
        "loConfig": folder_path / LO_CONFIG_NAME,
        "hiDataset": folder_path / "dataset.hi.toml",
        "loDataset": folder_path / "dataset.lo.toml",
        "manifest": folder_path / "auto_dataset" / "prep_manifest.json",
    }
    missing = [name for name, path in paths.items() if not path.exists() or not path.is_file()]
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


def _build_preflight(folder):
    folder_value, folder_path = _resolve_folder(folder)
    artifacts, missing = _resolve_artifacts(folder_value, folder_path)
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


def _build_launch_preflight(folder):
    folder_value, folder_path = _resolve_folder(folder)
    artifacts, missing = _resolve_artifacts(folder_value, folder_path)
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
    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(_make_check("conda_runtime", "blocker", False,
                                  "Conda runtime needs both the executable path and environment name."))
    return folder_value, folder_path, artifacts, settings, checks


def _preflight_payload(folder):
    folder_value, folder_path, artifacts, settings, checks = _build_preflight(folder)
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


def _copy_snapshot(job_dir, artifacts):
    snapshot = {}
    for key, filename in (("hi", HI_CONFIG_NAME), ("lo", LO_CONFIG_NAME)):
        source = artifacts[key + "Config"]
        target = job_dir / filename
        shutil.copy2(source, target)
        normalize_path_permissions(target)
        snapshot[key] = str(target)
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
    training = app_config.config.get("training") if isinstance(app_config.config, dict) else {}
    hi_steps, lo_steps = repeat_targets_for_mode((training or {}).get("mode"))
    return {
        "hi": {"estimatedSteps": hi_steps},
        "lo": {"estimatedSteps": lo_steps},
    }


def _normalize_training_stages(stages):
    value = str(stages or "both").strip().lower()
    if value not in ("hi", "lo", "both"):
        raise ValueError("Training stage must be hi, lo, or both.")
    return value


def _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage):
    if not str(resume_from_checkpoint or "").strip():
        return ""
    if stages in ("hi", "lo"):
        return stages
    value = str(resume_stage or "lo").strip().lower()
    if value not in ("hi", "lo"):
        raise ValueError("Resume stage must be hi or lo.")
    return value


def _build_runner_script(job, settings, artifacts, job_dir):
    use_snapshot = not (artifacts["hiConfig"].is_file() and artifacts["loConfig"].is_file())
    hi_path = Path(job["snapshot"]["hi"]) if use_snapshot else artifacts["hiConfig"]
    lo_path = Path(job["snapshot"]["lo"]) if use_snapshot else artifacts["loConfig"]
    distribution = settings["wslDistribution"]
    hi_wsl = _to_wsl_path(hi_path, distribution)
    lo_wsl = _to_wsl_path(lo_path, distribution)
    stages = _normalize_training_stages(job.get("stages"))
    resume_stage = _normalize_resume_stage(stages, job.get("resumeFromCheckpoint"), job.get("resumeStage"))
    command_plan = build_training_command_plan(
        hi_wsl,
        lo_wsl,
        build_training_launcher(settings),
        job.get("resumeFromCheckpoint") or "",
        resume_stage,
    )
    result_wsl = _to_wsl_path(job_dir / "result.json", distribution)
    pid_wsl = _to_wsl_path(job_dir / "pid", distribution)
    lines = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        "PID_FILE=" + shlex.quote(pid_wsl),
        "RESULT_FILE=" + shlex.quote(result_wsl),
        "echo $$ > \"$PID_FILE\"",
        "write_result() { printf '{\\\"status\\\":\\\"%s\\\",\\\"exitCode\\\":%s,\\\"finishedAt\\\":%s}\\n' \"$1\" \"$2\" \"$(date +%s)\" > \"$RESULT_FILE\"; }",
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
            "if [ \"$HI_CODE\" -ne 0 ]; then echo '[webcap] HI failed'; write_result failed \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
        ])
    if stages in ("lo", "both"):
        lines.extend([
            "echo '[webcap] stage=lo'",
            "printf '%s\\n' " + shlex.quote("[webcap] command lo: " + command_plan["loCommand"]),
            command_plan["loCommand"],
            "LO_CODE=$?",
            "if [ \"$LO_CODE\" -ne 0 ]; then echo '[webcap] LO failed'; write_result failed \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
        ])
    lines.extend(["echo '[webcap] completed'", "write_result completed 0"])
    script = "\n".join(lines) + "\n"
    return script, {"hi": hi_wsl, "lo": lo_wsl, "usedSnapshot": use_snapshot}


def _write_runner_script(job, settings, artifacts):
    job_dir = _job_dir(job["id"])
    script, resolved = _build_runner_script(job, settings, artifacts, job_dir)
    path = job_dir / "runner.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    normalize_path_permissions(path)
    job["runnerScript"] = str(path)
    job["resolvedConfigs"] = resolved
    return path


def _launch_job(job, folder_path):
    _, _, artifacts, settings, checks = _build_launch_preflight(job["folder"])
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    job["preflight"] = {"checks": checks, "blockers": len(blockers)}
    if blockers:
        job["status"] = "failed"
        job["stage"] = "launch"
        job["error"] = "Preflight failed before launch."
        job["finishedAt"] = time.time()
        return False
    job_dir = _job_dir(job["id"])
    result_path = job_dir / "result.json"
    if result_path.exists():
        result_path.unlink()
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
        "startedAt": time.time(),
        "updatedAt": time.time(),
        "logPath": str(log_path),
        "error": "",
    })
    return True


def _read_result(job):
    path = _job_dir(job["id"]) / "result.json"
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


def _read_log_tail(path, byte_count=4096):
    try:
        with Path(path).open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - byte_count))
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _sync_job_progress(job, log_text):
    stage = str(job.get("stage") or "").lower()
    if stage not in ("hi", "lo"):
        job.pop("progress", None)
        return

    snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
    current_epochs = _read_config_epochs(snapshot.get(stage, ""))
    if not current_epochs:
        job.pop("progress", None)
        return

    previous = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    previous_epoch = previous.get("epoch") if previous.get("stage") == stage else None
    epoch_matches = _LOG_EPOCH_PATTERN.findall(log_text or "")
    step_matches = _LOG_STEP_PATTERN.findall(log_text or "")
    iter_time_matches = _LOG_ITER_TIME_PATTERN.findall(log_text or "")
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
        if iter_time_matches:
            seconds_per_step = float(iter_time_matches[-1])
            if seconds_per_step > 0:
                progress["etaSeconds"] = round(max(0, planned_steps - step) * seconds_per_step)
    else:
        progress["source"] = "epochs"
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


def _refresh_job(job):
    if str(job.get("status")) not in ACTIVE_STATUSES:
        return
    if not job.get("progressPlan"):
        job["progressPlan"] = _default_progress_plan()
    result = _read_result(job)
    if result:
        result_status = str(result.get("status") or "failed")
        requested_action = str(job.get("actionRequested") or "")
        if requested_action == "pause":
            job["status"] = "paused"
        elif requested_action == "finish":
            job["status"] = "finished_early"
        elif requested_action == "stop":
            job["status"] = "stopped"
        elif result_status == "stopped":
            job["status"] = "interrupted"
            job["error"] = "Runner stopped without a WebCap stop or pause action."
        else:
            job["status"] = result_status
        job["exitCode"] = int(result.get("exitCode") or 0)
        job["finishedAt"] = float(result.get("finishedAt") or time.time())
        job["updatedAt"] = time.time()
        _annotate_completed_job(job)
        _annotate_finished_early_job(job)
        return
    if not _pid_alive(job.get("pid"), _job_wsl_distribution(job)):
        requested_action = str(job.get("actionRequested") or "")
        if requested_action == "pause":
            job["status"] = "paused"
        elif requested_action == "finish":
            job["status"] = "finished_early"
        elif requested_action == "stop":
            job["status"] = "stopped"
        else:
            job["status"] = "interrupted"
            job["error"] = "Training runner exited without a result record."
        job["finishedAt"] = time.time()
        job["updatedAt"] = time.time()
        _annotate_finished_early_job(job)
        return
    log_path = Path(job.get("logPath") or "")
    if log_path.exists():
        try:
            job["lastLogAt"] = log_path.stat().st_mtime
            tail = _read_log_tail(log_path)
            if job.get("status") == "starting" and (_LOG_EPOCH_PATTERN.search(tail) or _LOG_STEP_PATTERN.search(tail)):
                job["status"] = "running"
            if "[webcap] stage=lo" in tail:
                job["stage"] = "lo"
            elif "[webcap] stage=hi" in tail:
                job["stage"] = "hi"
            _sync_job_progress(job, tail)
        except OSError:
            pass
    job["updatedAt"] = time.time()


def _prepare_paused_job_for_resume(job):
    stage = str(job.get("stages") or "")
    if stage not in ("hi", "lo"):
        return "Only an individual training stage can resume."
    folder = str(job.get("folder") or "")
    folder_path = app_config.safe_join_fs_root(folder)
    checkpoint = next((run["path"] for run in discover_runs(folder_path, stage) if run.get("checkpointAvailable")), "")
    if not checkpoint:
        return "No resumable checkpoint was found for " + stage.upper() + "."
    job["resumeFromCheckpoint"] = checkpoint
    job["resumeStage"] = stage
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
                state["queuePaused"] = True
                state["queuePauseReason"] = "Queue held: " + resume_error
                return
        folder_path = app_config.safe_join_fs_root(job["folder"])
        _launch_job(job, folder_path)
        if job.get("status") in ACTIVE_STATUSES:
            state["activeJobId"] = job["id"]
            return
        if job.get("status") == "failed":
            state["queuePaused"] = True
            state["queuePauseReason"] = "Queue held after " + str(job.get("stages") or "training") + " " + str(job.get("status")) + "."
            return


def _refresh_state(state):
    for job in state.get("jobs", []):
        if job.get("status") == "queued" and not job.get("progressPlan"):
            job["progressPlan"] = _default_progress_plan()
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
        elif active.get("status") == "interrupted":
            state["queuePaused"] = True
            state["queuePauseReason"] = "Queue held after " + str(active.get("stages") or "training") + " interrupted."
            state["activeJobId"] = ""
        if active.get("status") in TERMINAL_STATUSES:
            state["activeJobId"] = ""
            if active.get("status") in ("failed", "interrupted"):
                state["queuePaused"] = True
                state["queuePauseReason"] = "Queue held after " + str(active.get("stage") or "training") + " " + str(active.get("status")) + "."
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
            pass
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(target=_monitor_loop, name="webcap-training-runner", daemon=True)
        _monitor_thread.start()


def _public_job(job):
    fields = ("id", "folder", "stages", "modelLabel", "resumeFromCheckpoint", "resumeStage", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt", "updatedAt", "lastLogAt", "error", "completionNote", "exitCode", "resolvedConfigs", "preflight", "outputRoot", "parentJobId", "progress", "progressPlan", "actionRequested", "actionRequestedAt")
    return {field: job.get(field) for field in fields if field in job}


def validate_response(folder, stages="both", resume_from_checkpoint="", resume_stage=""):
    try:
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
        payload = _preflight_payload(folder)
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
            "snapshot": {"hi": str(artifacts["hiConfig"]), "lo": str(artifacts["loConfig"])},
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


def _new_job(folder, preflight, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id=""):
    job_id = uuid.uuid4().hex[:12]
    job_dir = _job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=False)
    _, folder_path = _resolve_folder(folder)
    artifacts, _ = _resolve_artifacts(folder, folder_path)
    snapshot = _copy_snapshot(job_dir, artifacts)
    stages = _normalize_training_stages(stages)
    resume_path = str(resume_from_checkpoint or "").strip()
    return {
        "id": job_id,
        "folder": folder,
        "stages": stages,
        "modelLabel": "WAN 2.2",
        "resumeFromCheckpoint": resume_path,
        "resumeStage": _normalize_resume_stage(stages, resume_path, resume_stage),
        "status": "queued",
        "stage": "queued",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "snapshot": snapshot,
        "progressPlan": _read_training_plan(folder_path) or _default_progress_plan(),
        "runtime": {"wslDistribution": _training_settings()["wslDistribution"]},
        "preflight": {"checks": preflight.get("checks", []), "blockers": preflight.get("summary", {}).get("blockers", 0)},
        "outputRoot": str(output_root_for_folder(folder_path, stages)),
        "parentJobId": str(parent_job_id or ""),
    }


def start_response(folder, queue=False, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id=""):
    try:
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}, 400
    try:
        _, _, _, _, checks = _build_launch_preflight(folder)
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
        if active and active.get("status") not in TERMINAL_STATUSES and not queue:
            _write_state(state)
            return {"ok": False, "error": "A managed training job is already active.", "activeJob": _public_job(active)}, 409
        job_stages = ("hi", "lo") if stages == "both" else (stages,)
        jobs = []
        for job_stage in job_stages:
            stage_resume = resume_from_checkpoint if resume_stage == job_stage else ""
            jobs.append(_new_job(
                str(folder).strip(), preflight, job_stage, stage_resume, job_stage if stage_resume else "", parent_job_id
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


def _attention_payload(state):
    queued_count = sum(1 for job in state.get("jobs", []) if job.get("status") == "queued")
    if any(job.get("status") in ACTIVE_STATUSES for job in state.get("jobs", [])):
        return None
    attention_job = None
    if state.get("queuePaused"):
        attention_job = next((
            job for job in reversed(state.get("jobs", []))
            if job.get("status") == "failed" and not any(
                retry.get("status") in QUEUE_STATUSES | ACTIVE_STATUSES
                and retry.get("folder") == job.get("folder")
                and retry.get("stages") == job.get("stages")
                and float(retry.get("createdAt") or 0) > float(job.get("createdAt") or 0)
                for retry in state.get("jobs", [])
            )
        ), None)
    if attention_job:
        folder_path = app_config.safe_join_fs_root(attention_job["folder"])
        stage = str(attention_job.get("stages") or "")
        runs = discover_runs(folder_path, stage)
        resume_path = next((run["path"] for run in runs if run.get("checkpointAvailable")), "")
        status = str(attention_job.get("status"))
        if status == "failed":
            message = "Failed " + stage.upper() + " for " + attention_job["folder"] + "."
        else:
            message = "Interrupted " + stage.upper() + " for " + attention_job["folder"] + "."
        return {
            "kind": status,
            "jobId": attention_job["id"],
            "folder": attention_job["folder"],
            "stage": stage,
            "message": message,
            "details": str(attention_job.get("error") or attention_job.get("completionNote") or ""),
            "resumeFromCheckpoint": resume_path,
            "queuedCount": queued_count,
        }
    if state.get("queuePaused"):
        return {
            "kind": "queue_held",
            "message": str(state.get("queuePauseReason") or "Queue is held."),
            "queuedCount": queued_count,
        }
    return None


def folder_statuses_for_folders(folder_paths):
    """Return the small training-status payload used by the folder backlog view."""
    with _lock:
        state = _read_state()
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
        attention = next((job for job in reversed(matching) if job.get("status") == "failed"), None)
        if active:
            result[path] = {"status": "training", "label": "Training", "jobId": active.get("id"), "stage": active.get("stages")}
        elif folder in queued_by_folder:
            queued = queued_by_folder[folder]
            queue_status = str(queued["status"] or "queued")
            label = "Queued" if queue_status == "queued" else queue_status.title()
            result[path] = {"status": queue_status, "label": label + " #" + str(queued["position"]), "queuePosition": queued["position"]}
        elif attention:
            result[path] = {
                "status": "attention", "label": "Needs attention", "jobId": attention.get("id"),
                "outcome": attention.get("status"), "stage": attention.get("stages"),
            }
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
        state = _read_state()
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
            "attention": _attention_payload(state),
        }, 200


def gpu_status_response():
    return {"ok": True, "gpu": _gpu_snapshot()}, 200


def log_response(job_id, offset=0):
    with _lock:
        state = _read_state()
        _apply_restart_hold(state)
        _refresh_state(state)
        job = _find_job(state, job_id)
        _sync_histories(state)
        _write_state(state)
        if not job:
            return {"error": "Training job not found"}, 404
        path = Path(job.get("logPath") or (_job_dir(job_id) / "run.log"))
        try:
            position = max(0, int(offset or 0))
        except (TypeError, ValueError):
            position = 0
        if not path.exists():
            return {"ok": True, "job": _public_job(job), "offset": position, "nextOffset": position, "text": ""}, 200
        with open(path, "rb") as handle:
            handle.seek(position)
            raw = handle.read(65536)
            next_offset = handle.tell()
        return {"ok": True, "job": _public_job(job), "offset": position, "nextOffset": next_offset, "text": raw.decode("utf-8", errors="replace")}, 200


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
            _sync_histories(state)
            _write_state(state)
            return {"ok": True, "job": _public_job(job)}, 200
        if job.get("status") not in ACTIVE_STATUSES:
            return {"ok": False, "error": "Training job is not running."}, 400
        pid = int(job.get("pid") or 0)
        job["actionRequested"] = "pause" if pause else "finish" if finish else "stop"
        job["actionRequestedAt"] = time.time()
        job["status"] = "stopping"
        job["stage"] = "stopping"
        distribution = _job_wsl_distribution(job)
        _run_wsl("kill -INT -- -" + str(pid), timeout=8, distribution=distribution)
        deadline = time.time() + 5
        while time.time() < deadline and _pid_alive(pid, distribution):
            time.sleep(0.5)
        if _pid_alive(pid, distribution):
            _run_wsl("kill -KILL -- -" + str(pid), timeout=8, distribution=distribution)
        _refresh_job(job)
        job["status"] = "paused" if pause else "finished_early" if finish else "stopped"
        job["stage"] = "paused" if pause else "finished_early" if finish else "stopped"
        job["finishedAt"] = time.time()
        job["updatedAt"] = time.time()
        _annotate_finished_early_job(job)
        if pause:
            state["queuePaused"] = True
            state["queuePauseReason"] = "Queue paused by the user."
        elif finish:
            state["queuePaused"] = False
            state["queuePauseReason"] = ""
        if state.get("activeJobId") == job.get("id"):
            state["activeJobId"] = ""
        _start_next(state)
        _sync_histories(state)
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
        next_job = next((job for job in state.get("jobs", []) if job.get("status") in QUEUE_STATUSES), None)
        if next_job and next_job.get("status") in ("paused", "interrupted"):
            resume_error = _prepare_paused_job_for_resume(next_job)
            if resume_error:
                next_job["error"] = resume_error
                state["queuePaused"] = True
                state["queuePauseReason"] = "Queue held: " + resume_error
                _sync_histories(state)
                _write_state(state)
                return {"ok": False, "error": resume_error}, 409
        state["queuePaused"] = False
        state["queuePauseReason"] = ""
        _refresh_state(state)
        _sync_histories(state)
        _write_state(state)
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
