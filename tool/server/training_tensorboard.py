import json
import os
import shlex
import time
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_history import output_root_for_folder
from .training_runtime import build_runtime_command, has_complete_conda_runtime
from . import training_runner


STATE_FILE_NAME = "tensorboard.json"
LOG_FILE_NAME = "tensorboard.log"


def _runtime_root():
    return Path(app_config.FS_ROOT) / training_runner.RUNNER_DIR_NAME


def _state_path():
    return _runtime_root() / STATE_FILE_NAME


def _default_state():
    return {"version": 1, "status": "stopped"}


def _read_state():
    path = _state_path()
    if not path.exists():
        return _default_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_state()
    return state if isinstance(state, dict) else _default_state()


def _write_state(state):
    root = _runtime_root()
    root.mkdir(parents=True, exist_ok=True)
    path = _state_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    normalize_path_permissions(path)


def _settings():
    config = app_config.config if isinstance(app_config.config, dict) else {}
    training = config.get("training") if isinstance(config.get("training"), dict) else {}
    return training_runner._training_settings(), training


def _port(training):
    value = training.get("tensorboard_port", 6006)
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise ValueError("TensorBoard port must be an integer.")
    if port < 1024 or port > 65535:
        raise ValueError("TensorBoard port must be between 1024 and 65535.")
    return port


def _refresh(state):
    if state.get("status") != "running":
        return state
    if not training_runner._pid_alive(state.get("pid"), state.get("wslDistribution") or ""):
        state["status"] = "stopped"
        state["stoppedAt"] = time.time()
        state["error"] = "TensorBoard process exited."
    return state


def _public(state):
    fields = ("status", "pid", "startedAt", "stoppedAt", "error", "url", "port", "logRoot", "logPath")
    return {field: state.get(field) for field in fields if field in state}


def status_response(folder=""):
    state = _refresh(_read_state())
    _write_state(state)
    payload = _public(state)
    if folder:
        folder_path = app_config.safe_join_fs_root(folder)
        payload["setLogRoot"] = str(output_root_for_folder(folder_path))
    return {"ok": True, "tensorboard": payload}, 200


def _validate_runtime(settings):
    if has_complete_conda_runtime(settings):
        command = build_runtime_command(settings, "python -m tensorboard.main --version")
    else:
        command = "python -m tensorboard.main --version"
    shell = "cd " + shlex.quote(settings["cwd"]) + " && " + training_runner._activation_prefix(settings) + command
    code, stdout, stderr = training_runner._run_wsl(shell, timeout=20, distribution=settings["wslDistribution"])
    if code != 0:
        raise RuntimeError((stdout + stderr).strip() or "TensorBoard is not available in the training runtime.")


def start_response(folder=""):
    state = _refresh(_read_state())
    if state.get("status") == "running":
        _write_state(state)
        return {"ok": True, "tensorboard": _public(state), "alreadyRunning": True}, 200
    settings, training = _settings()
    if not settings["cwd"]:
        return {"ok": False, "error": "Set training.diffusion_pipe_wsl in App Settings."}, 400
    try:
        port = _port(training)
        _validate_runtime(settings)
    except (RuntimeError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}, 400
    if folder:
        folder_path = app_config.safe_join_fs_root(folder)
        output_root_for_folder(folder_path).mkdir(parents=True, exist_ok=True)
    log_root = Path(app_config.FS_ROOT) / "output" / "runs"
    log_root.mkdir(parents=True, exist_ok=True)
    root_wsl = training_runner._to_wsl_path(log_root, settings["wslDistribution"])
    log_path = _runtime_root() / LOG_FILE_NAME
    log_wsl = training_runner._to_wsl_path(log_path, settings["wslDistribution"])
    probe = build_runtime_command(settings, "python -c " + shlex.quote(
        "import socket; s=socket.socket(); s.bind(('127.0.0.1', " + str(port) + ")); s.close()"
    ))
    shell_prefix = "cd " + shlex.quote(settings["cwd"]) + " && " + training_runner._activation_prefix(settings)
    code, stdout, stderr = training_runner._run_wsl(shell_prefix + probe, timeout=15, distribution=settings["wslDistribution"])
    if code != 0:
        return {"ok": False, "error": "TensorBoard port " + str(port) + " is unavailable. " + (stdout + stderr).strip()}, 400
    command = build_runtime_command(
        settings,
        "python -m tensorboard.main --logdir " + shlex.quote(root_wsl) + " --host 127.0.0.1 --port " + str(port),
    )
    launch = shell_prefix + "setsid " + command + " > " + shlex.quote(log_wsl) + " 2>&1 < /dev/null & echo $!"
    code, stdout, stderr = training_runner._run_wsl(launch, timeout=15, distribution=settings["wslDistribution"])
    pid = (stdout or "").strip().splitlines()[-1] if (stdout or "").strip() else ""
    if code != 0 or not pid.isdigit():
        return {"ok": False, "error": (stderr or stdout).strip() or "Could not launch TensorBoard."}, 400
    state = {
        "version": 1,
        "status": "running",
        "pid": int(pid),
        "startedAt": time.time(),
        "error": "",
        "port": port,
        "url": "http://127.0.0.1:" + str(port) + "/",
        "logRoot": str(log_root),
        "logPath": str(log_path),
        "wslDistribution": settings["wslDistribution"],
    }
    _write_state(state)
    return {"ok": True, "tensorboard": _public(state)}, 200


def stop_response():
    state = _refresh(_read_state())
    if state.get("status") != "running":
        _write_state(state)
        return {"ok": False, "error": "TensorBoard is not running."}, 400
    training_runner._run_wsl("kill -INT -- -" + str(int(state["pid"])), timeout=8, distribution=state.get("wslDistribution") or "")
    deadline = time.time() + 5
    while time.time() < deadline and training_runner._pid_alive(state["pid"], state.get("wslDistribution") or ""):
        time.sleep(0.5)
    if training_runner._pid_alive(state["pid"], state.get("wslDistribution") or ""):
        training_runner._run_wsl("kill -KILL -- -" + str(int(state["pid"])), timeout=8, distribution=state.get("wslDistribution") or "")
    state["status"] = "stopped"
    state["stoppedAt"] = time.time()
    _write_state(state)
    return {"ok": True, "tensorboard": _public(state)}, 200
