import json
import os
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_commands import build_training_command_plan, build_training_launcher_probe
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME
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
TERMINAL_STATUSES = {"completed", "failed", "stopped", "cancelled"}
_lock = threading.Lock()
_monitor_lock = threading.Lock()
_monitor_thread = None


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
    return {"version": 1, "activeJobId": "", "jobs": []}


def _read_state():
    _ensure_runtime_dirs()
    path = _state_path()
    if not path.exists():
        return _default_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_state()
    if not isinstance(parsed, dict):
        return _default_state()
    parsed.setdefault("version", 1)
    parsed.setdefault("activeJobId", "")
    parsed.setdefault("jobs", [])
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
    checks.append(_wsl_check("nvidia_smi", "warning", settings, "nvidia-smi -L", "nvidia-smi is available."))
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


def _build_runner_script(job, settings, artifacts, job_dir):
    use_snapshot = not (artifacts["hiConfig"].is_file() and artifacts["loConfig"].is_file())
    hi_path = Path(job["snapshot"]["hi"]) if use_snapshot else artifacts["hiConfig"]
    lo_path = Path(job["snapshot"]["lo"]) if use_snapshot else artifacts["loConfig"]
    distribution = settings["wslDistribution"]
    hi_wsl = _to_wsl_path(hi_path, distribution)
    lo_wsl = _to_wsl_path(lo_path, distribution)
    command_plan = build_training_command_plan(hi_wsl, lo_wsl, build_training_launcher(settings))
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
        "cd " + shlex.quote(settings["cwd"]),
    ]
    if settings["activate"] and not has_conda_runtime(settings):
        lines.append("source " + shlex.quote(settings["activate"]))
    lines.extend([
        "echo '[webcap] stage=hi'",
        command_plan["hiCommand"],
        "HI_CODE=$?",
        "if [ \"$HI_CODE\" -ne 0 ]; then echo '[webcap] HI failed'; write_result failed \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
        "echo '[webcap] stage=lo'",
        command_plan["loCommand"],
        "LO_CODE=$?",
        "if [ \"$LO_CODE\" -ne 0 ]; then echo '[webcap] LO failed'; write_result failed \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
        "echo '[webcap] completed'",
        "write_result completed 0",
    ])
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
    _, _, artifacts, settings, checks = _build_preflight(job["folder"])
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    job["preflight"] = {"checks": checks, "blockers": len(blockers)}
    if blockers:
        job["status"] = "failed"
        job["stage"] = "launch"
        job["error"] = "Preflight failed before launch."
        job["finishedAt"] = time.time()
        return False
    job_dir = _job_dir(job["id"])
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
        "status": "running",
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


def _job_wsl_distribution(job):
    runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
    return str(runtime.get("wslDistribution") or _training_settings()["wslDistribution"] or "").strip()


def _pid_alive(pid, distribution=""):
    if not pid:
        return False
    code, _, _ = _run_wsl("kill -0 " + str(int(pid)), timeout=8, distribution=distribution)
    return code == 0


def _refresh_job(job):
    if str(job.get("status")) not in ("running", "stopping"):
        return
    result = _read_result(job)
    if result:
        job["status"] = str(result.get("status") or "failed")
        job["exitCode"] = int(result.get("exitCode") or 0)
        job["finishedAt"] = float(result.get("finishedAt") or time.time())
        job["updatedAt"] = time.time()
        return
    if not _pid_alive(job.get("pid"), _job_wsl_distribution(job)):
        job["status"] = "failed"
        job["error"] = "Training runner exited without a result record."
        job["finishedAt"] = time.time()
        job["updatedAt"] = time.time()
        return
    log_path = Path(job.get("logPath") or "")
    if log_path.exists():
        try:
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-4096:]
            if "[webcap] stage=lo" in tail:
                job["stage"] = "lo"
            elif "[webcap] stage=hi" in tail:
                job["stage"] = "hi"
        except OSError:
            pass
    job["updatedAt"] = time.time()


def _start_next(state):
    active_id = str(state.get("activeJobId") or "")
    active = _find_job(state, active_id) if active_id else None
    if active and active.get("status") not in TERMINAL_STATUSES:
        return
    state["activeJobId"] = ""
    for job in state.get("jobs", []):
        if job.get("status") != "queued":
            continue
        folder_path = app_config.safe_join_fs_root(job["folder"])
        _launch_job(job, folder_path)
        if job.get("status") == "running":
            state["activeJobId"] = job["id"]
            return


def _refresh_state(state):
    active_id = str(state.get("activeJobId") or "")
    active = _find_job(state, active_id) if active_id else None
    if active:
        _refresh_job(active)
        if active.get("status") in TERMINAL_STATUSES:
            state["activeJobId"] = ""
    _start_next(state)


def _monitor_loop():
    while True:
        try:
            with _lock:
                state = _read_state()
                _refresh_state(state)
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
    fields = ("id", "folder", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "exitCode", "resolvedConfigs", "preflight")
    return {field: job.get(field) for field in fields if field in job}


def validate_response(folder):
    try:
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
        diagnostic_job = {"id": "diagnostic", "snapshot": {"hi": str(artifacts["hiConfig"]), "lo": str(artifacts["loConfig"])}}
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


def _new_job(folder, preflight):
    job_id = uuid.uuid4().hex[:12]
    job_dir = _job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=False)
    _, folder_path = _resolve_folder(folder)
    artifacts, _ = _resolve_artifacts(folder, folder_path)
    snapshot = _copy_snapshot(job_dir, artifacts)
    return {
        "id": job_id,
        "folder": folder,
        "status": "queued",
        "stage": "queued",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "snapshot": snapshot,
        "runtime": {"wslDistribution": _training_settings()["wslDistribution"]},
        "preflight": {"checks": preflight.get("checks", []), "blockers": preflight.get("summary", {}).get("blockers", 0)},
    }


def start_response(folder, queue=False):
    preflight, status = validate_response(folder)
    if status != 200 or not preflight.get("ok"):
        return {"ok": False, "error": "Preflight failed.", "preflight": preflight}, 400
    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        _refresh_state(state)
        active = _find_job(state, state.get("activeJobId")) if state.get("activeJobId") else None
        if active and active.get("status") not in TERMINAL_STATUSES and not queue:
            _write_state(state)
            return {"ok": False, "error": "A managed training job is already active.", "activeJob": _public_job(active)}, 409
        job = _new_job(str(folder).strip(), preflight)
        state["jobs"].append(job)
        if not active or active.get("status") in TERMINAL_STATUSES:
            _start_next(state)
        _write_state(state)
        return {"ok": True, "job": _public_job(job), "queued": job.get("status") == "queued"}, 200


def status_response():
    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        _refresh_state(state)
        _write_state(state)
        return {"ok": True, "activeJobId": state.get("activeJobId") or "", "jobs": [_public_job(job) for job in state.get("jobs", [])]}, 200


def log_response(job_id, offset=0):
    with _lock:
        state = _read_state()
        _refresh_state(state)
        job = _find_job(state, job_id)
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


def stop_response(job_id, cancel=False):
    with _lock:
        state = _read_state()
        _refresh_state(state)
        job = _find_job(state, job_id)
        if not job:
            return {"ok": False, "error": "Training job not found"}, 404
        if job.get("status") == "queued" and cancel:
            job["status"] = "cancelled"
            job["stage"] = "cancelled"
            job["finishedAt"] = time.time()
            _write_state(state)
            return {"ok": True, "job": _public_job(job)}, 200
        if job.get("status") not in ("running", "stopping"):
            return {"ok": False, "error": "Training job is not running."}, 400
        pid = int(job.get("pid") or 0)
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
        if job.get("status") == "stopping":
            job["status"] = "stopped"
            job["finishedAt"] = time.time()
        if state.get("activeJobId") == job.get("id"):
            state["activeJobId"] = ""
        _start_next(state)
        _write_state(state)
        return {"ok": True, "job": _public_job(job)}, 200
