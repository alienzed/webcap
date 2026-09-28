import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import inference_runtime
from .training_runtime import (
    activation_prefix,
    build_runtime_command,
    build_training_launcher,
    has_complete_conda_runtime,
    has_conda_runtime,
    run_wsl,
    training_runtime_settings,
    uses_native_wsl_shell,
    wsl_executable,
)


GROUPS = ("core", "training", "inference", "director", "optional_analysis")


def _check(check_id, group, required, ok, message, details="", guidance=""):
    return {
        "id": check_id,
        "group": group,
        "required": bool(required),
        "ok": bool(ok),
        "message": str(message or "").strip(),
        "details": str(details or "").strip(),
        "guidance": str(guidance or "").strip(),
    }


def _host_command(args, timeout=10):
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


def _python_package_check(package_name, label, group="optional_analysis", required=False):
    available = importlib.util.find_spec(package_name) is not None
    guidance = ""
    if not available:
        guidance = (
            "Use Settings > Advanced > Install / Repair Python Requirements."
            if not required
            else "Run python -m pip install -r requirements.txt in the WebCap environment."
        )
    return _check(
        "package_" + package_name.replace("-", "_"),
        group,
        required,
        available,
        label + " is installed." if available else label + " is not installed.",
        "",
        guidance,
    )


def _training_shell(settings, command):
    cwd = settings.get("cwd") or ""
    shell = ("cd " + shlex.quote(cwd) + " && " if cwd else "") + activation_prefix(settings) + command
    return run_wsl(shell, distribution=settings.get("wslDistribution") or "")


def _training_check(check_id, required, settings, command, success_message, guidance=""):
    code, stdout, stderr = _training_shell(settings, command)
    details = (stdout + stderr).strip()
    return _check(
        check_id,
        "training",
        required,
        code == 0,
        success_message if code == 0 else success_message.replace(" is ", " is not ", 1),
        details,
        guidance if code != 0 else "",
    )


def _parse_json_output(stdout):
    text = str(stdout or "").strip()
    if not text:
        return {}
    return json.loads(text.splitlines()[-1])


def _http_json(url, timeout=3):
    request = urllib.request.Request(str(url), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError(str(exc)) from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Endpoint returned invalid JSON.") from exc


def _append_optional_analysis_checks(checks):
    for package_name, label in (
        ("mediapipe", "MediaPipe"),
        ("rembg", "rembg"),
        ("onnxruntime", "ONNX Runtime"),
        ("deface", "deface / CenterFace"),
        ("imageio", "imageio"),
        ("tensorboard", "TensorBoard"),
    ):
        checks.append(_python_package_check(package_name, label))

    deface_path = shutil.which("deface")
    checks.append(_check(
        "analysis_deface_command",
        "optional_analysis",
        False,
        bool(deface_path),
        "deface command is available." if deface_path else "deface command is not available.",
        deface_path or "",
        "Use Settings > Advanced > Install / Repair Python Requirements." if not deface_path else "",
    ))

    model_root = Path(__file__).resolve().parents[1] / "vendor" / "mediapipe" / "models"
    missing_models = [
        name
        for name in ("face_landmarker.task", "pose_landmarker_lite.task")
        if not (model_root / name).is_file()
    ]
    checks.append(_check(
        "analysis_mediapipe_models",
        "optional_analysis",
        False,
        not missing_models,
        "WebCap MediaPipe task models are available." if not missing_models else "WebCap MediaPipe task models are missing.",
        ", ".join(missing_models),
        "Restore the vendored MediaPipe model files from the WebCap repository." if missing_models else "",
    ))


def _append_inference_checks(checks):
    try:
        stats = inference_runtime.system_stats()
        details = ""
        if isinstance(stats, dict):
            system = stats.get("system") if isinstance(stats.get("system"), dict) else {}
            devices = stats.get("devices") if isinstance(stats.get("devices"), list) else []
            parts = []
            if system.get("os"):
                parts.append(str(system.get("os")))
            if devices:
                names = [str(item.get("name") or item.get("type") or "").strip() for item in devices if isinstance(item, dict)]
                names = [name for name in names if name]
                if names:
                    parts.append(", ".join(names))
            details = " · ".join(parts)
        checks.append(_check(
            "inference_comfyui",
            "inference",
            True,
            True,
            "ComfyUI API is reachable.",
            details or inference_runtime.COMFY_BASE_URL,
            "",
        ))
    except Exception as exc:
        checks.append(_check(
            "inference_comfyui",
            "inference",
            True,
            False,
            "ComfyUI API is not reachable.",
            str(exc),
            "Start/configure ComfyUI and verify " + inference_runtime.COMFY_BASE_URL + "/system_stats responds.",
        ))


def _append_director_checks(checks, source):
    storyboard = source.get("storyboard") if isinstance(source.get("storyboard"), dict) else {}
    director = storyboard.get("director") if isinstance(storyboard.get("director"), dict) else {}
    filesystem = source.get("filesystem") if isinstance(source.get("filesystem"), dict) else {}
    mode = str(director.get("mode") or "local").strip().lower()

    checks.append(_check(
        "director_mode",
        "director",
        True,
        mode in {"local", "remote"},
        "Storyboard Director mode is " + mode + "." if mode in {"local", "remote"} else "Storyboard Director mode is invalid.",
        "",
        "Set Storyboard Director mode to local or remote." if mode not in {"local", "remote"} else "",
    ))
    if mode not in {"local", "remote"}:
        return

    if mode == "remote":
        endpoint = str(director.get("endpoint") or "").strip().rstrip("/")
        configured = endpoint.startswith(("http://", "https://"))
        checks.append(_check(
            "director_remote_config",
            "director",
            True,
            configured,
            "Remote Director endpoint is configured." if configured else "Remote Director endpoint is not configured.",
            endpoint,
            "Set an OpenAI-compatible endpoint in App Settings > Storyboard." if not configured else "",
        ))
        if configured:
            try:
                payload = _http_json(endpoint + "/models", timeout=3)
                checks.append(_check(
                    "director_remote_endpoint",
                    "director",
                    True,
                    isinstance(payload, dict),
                    "Remote Director endpoint is reachable.",
                    endpoint + "/models",
                    "",
                ))
            except Exception as exc:
                checks.append(_check(
                    "director_remote_endpoint",
                    "director",
                    True,
                    False,
                    "Remote Director endpoint is not reachable.",
                    str(exc),
                    "Verify the configured OpenAI-compatible endpoint and its /models route.",
                ))
        return

    configured_executable = str(director.get("llama_server") or "").strip()
    if configured_executable:
        executable = Path(configured_executable).expanduser()
        executable_ok = executable.is_file()
        executable_details = str(executable)
    else:
        discovered = shutil.which("llama-server")
        executable_ok = bool(discovered)
        executable_details = discovered or ""
    checks.append(_check(
        "director_llama_server",
        "director",
        True,
        executable_ok,
        "llama-server is available." if executable_ok else "llama-server is not available.",
        executable_details,
        "Install a recent llama.cpp build or configure App Settings > Storyboard > llama-server executable." if not executable_ok else "",
    ))

    models_root = str(filesystem.get("models") or "").strip()
    checks.append(_check(
        "director_models_root",
        "director",
        True,
        bool(models_root),
        "WebCap Model Root is configured." if models_root else "WebCap Model Root is not configured.",
        models_root,
        "Set Models Root in App Settings so local Director GGUF files can be discovered." if not models_root else "",
    ))


def _append_training_checks(checks, settings):
    shell_path = shutil.which("bash") if uses_native_wsl_shell() else wsl_executable()
    shell_label = "Current Linux shell" if uses_native_wsl_shell() else "WSL"
    checks.append(_check(
        "training_shell",
        "training",
        True,
        bool(shell_path),
        shell_label + (" is available." if shell_path else " is not available."),
        shell_path or "",
        (
            "Install WSL 2 with a Linux distribution and restart WebCap."
            if not uses_native_wsl_shell()
            else "Install bash and ensure it is available on PATH."
        ) if not shell_path else "",
    ))

    cwd = settings.get("cwd") or ""
    checks.append(_check(
        "training_cwd_configured",
        "training",
        True,
        bool(cwd),
        "Diffusion Pipe path is configured." if cwd else "Diffusion Pipe path is not configured.",
        cwd,
        "Set Diffusion Pipe WSL in App Settings > Training to the checkout that owns train.py." if not cwd else "",
    ))

    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(_check(
            "training_conda_config",
            "training",
            True,
            False,
            "Conda runtime configuration is incomplete.",
            "Configure both Conda Executable and Conda Environment, or clear both fields.",
            "Use one complete runtime method: Conda executable + environment, a venv activation script, or the existing shell environment.",
        ))

    if not shell_path or not cwd:
        return

    checks.append(_training_check(
        "training_cwd",
        True,
        settings,
        "test -d .",
        "Diffusion Pipe working directory is available.",
        "Correct Diffusion Pipe WSL to an existing checkout path.",
    ))

    if has_complete_conda_runtime(settings):
        checks.append(_training_check(
            "training_conda_executable",
            True,
            settings,
            "test -x " + shlex.quote(settings["condaExecutable"]),
            "Conda executable is available.",
            "Correct Conda Executable to the conda binary inside WSL.",
        ))
    elif settings.get("activate"):
        checks.append(_training_check(
            "training_activate_script",
            True,
            settings,
            "test -f " + shlex.quote(settings["activate"]),
            "Activation script is available.",
            "Correct Venv Activate Script to an existing shell activation script.",
        ))
    else:
        checks.append(_check(
            "training_runtime_shell",
            "training",
            False,
            True,
            "Training will use the existing shell environment.",
        ))

    runtime_python = build_runtime_command(settings, "python -c " + shlex.quote(
        "import json,sys; print(json.dumps({'version':sys.version.split()[0],'executable':sys.executable}))"
    ))
    code, stdout, stderr = _training_shell(settings, runtime_python)
    python_details = (stdout + stderr).strip()
    if code == 0:
        try:
            info = _parse_json_output(stdout)
            python_details = "Python " + str(info.get("version") or "?") + " · " + str(info.get("executable") or "")
        except (ValueError, TypeError):
            pass
    checks.append(_check(
        "training_python",
        "training",
        True,
        code == 0,
        "Training Python is available." if code == 0 else "Training Python is not available.",
        python_details,
        "Fix the configured Conda/venv runtime, or install Python in the selected WSL environment." if code != 0 else "",
    ))

    checks.append(_training_check(
        "training_train_py",
        True,
        settings,
        "test -f train.py",
        "Diffusion Pipe train.py is available.",
        "Point Diffusion Pipe WSL at the repository root containing train.py.",
    ))

    launcher = build_training_launcher(settings)
    checks.append(_training_check(
        "training_deepspeed",
        True,
        settings,
        launcher + " --version",
        "DeepSpeed launcher is available.",
        "Install the Diffusion Pipe training requirements into the same Python environment WebCap is configured to use.",
    ))

    torch_probe = build_runtime_command(settings, "python -c " + shlex.quote(
        "import json,torch; print(json.dumps({'torch':torch.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available(),'device_count':torch.cuda.device_count(),'devices':[torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]}))"
    ))
    code, stdout, stderr = _training_shell(settings, torch_probe)
    torch_details = (stdout + stderr).strip()
    torch_ok = False
    if code == 0:
        try:
            info = _parse_json_output(stdout)
            torch_ok = bool(info.get("cuda_available")) and int(info.get("device_count") or 0) > 0
            torch_details = (
                "torch " + str(info.get("torch") or "?")
                + " · CUDA build " + str(info.get("cuda_build") or "none")
                + " · " + str(info.get("device_count") or 0) + " GPU(s)"
            )
            devices = info.get("devices")
            if isinstance(devices, list) and devices:
                torch_details += " · " + ", ".join(str(item) for item in devices)
        except (ValueError, TypeError):
            torch_ok = False
    checks.append(_check(
        "training_torch_cuda",
        "training",
        True,
        code == 0 and torch_ok,
        "PyTorch can use CUDA." if code == 0 and torch_ok else "PyTorch cannot use CUDA in the selected training environment.",
        torch_details,
        "Install the PyTorch build required by your Diffusion Pipe/model environment for this NVIDIA driver/CUDA stack; avoid changing CUDA packages blindly." if not (code == 0 and torch_ok) else "",
    ))

    code, stdout, stderr = _training_shell(
        settings,
        "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits",
    )
    checks.append(_check(
        "training_nvidia_smi",
        "training",
        False,
        code == 0,
        "NVIDIA telemetry is available." if code == 0 else "NVIDIA telemetry is not available.",
        (stdout + stderr).strip(),
        "Verify the NVIDIA Windows/Linux driver exposes nvidia-smi inside WSL; H3 calibration and GPU diagnostics depend on it." if code != 0 else "",
    ))


def build_environment_report(config=None):
    source = config if isinstance(config, dict) else {}
    training = source.get("training") if isinstance(source.get("training"), dict) else {}
    settings = training_runtime_settings(training)
    checks = []

    python_ok = sys.version_info >= (3, 10)
    checks.append(_check(
        "host_python",
        "core",
        True,
        python_ok,
        "WebCap Python " + sys.version.split()[0] + (" is supported." if python_ok else " is too old."),
        sys.executable,
        "Install Python 3.10 or newer, create a fresh environment, then reinstall requirements.txt." if not python_ok else "",
    ))

    pip_code, pip_out, pip_err = _host_command([sys.executable, "-m", "pip", "--version"])
    checks.append(_check(
        "host_pip",
        "core",
        True,
        pip_code == 0,
        "pip is available." if pip_code == 0 else "pip is not available in the WebCap Python environment.",
        (pip_out + pip_err).strip(),
        "Bootstrap pip for this Python installation, then run python -m pip install -r requirements.txt." if pip_code != 0 else "",
    ))

    checks.append(_python_package_check("flask", "Flask", group="core", required=True))
    checks.append(_python_package_check("PIL", "Pillow", group="core", required=True))

    for executable in ("ffmpeg", "ffprobe"):
        path = shutil.which(executable)
        checks.append(_check(
            "host_" + executable,
            "core",
            True,
            bool(path),
            executable + (" is available." if path else " is not available."),
            path or "",
            "" if path else "Install FFmpeg and make " + executable + " available on PATH.",
        ))

    _append_optional_analysis_checks(checks)
    _append_inference_checks(checks)
    _append_director_checks(checks, source)
    _append_training_checks(checks, settings)
    return _finalize(checks, settings)


def _group_summary(checks, group):
    rows = [item for item in checks if item["group"] == group]
    required_failures = [item for item in rows if item["required"] and not item["ok"]]
    optional_failures = [item for item in rows if not item["required"] and not item["ok"]]
    return {
        "ready": not required_failures,
        "requiredFailures": len(required_failures),
        "optionalFailures": len(optional_failures),
        "passed": len([item for item in rows if item["ok"]]),
        "total": len(rows),
    }


def _finalize(checks, settings):
    summaries = {group: _group_summary(checks, group) for group in GROUPS}
    return {
        "ok": summaries["core"]["ready"],
        "checks": checks,
        "summary": {
            **summaries,
            "passed": len([item for item in checks if item["ok"]]),
            "total": len(checks),
        },
        "training": settings,
        "platform": {
            "osName": os.name,
            "python": sys.version.split()[0],
            "pythonExecutable": sys.executable,
        },
    }
