import os
import posixpath
import shlex
import shutil
import subprocess

from . import config as app_config


TRAINING_RUNTIME_DIR_NAME = ".webcap_training"


def training_runtime_settings(training):
    source = training if isinstance(training, dict) else {}
    return {
        "cwd": str(source.get("diffusion_pipe_wsl") or "").strip(),
        "activate": str(source.get("activate_script") or "").strip(),
        "wslDistribution": str(source.get("wsl_distribution") or "").strip(),
        "condaExecutable": str(source.get("conda_executable") or "").strip(),
        "condaEnvironment": str(source.get("conda_environment") or "").strip(),
    }


def has_conda_runtime(settings):
    return bool(settings.get("condaExecutable") or settings.get("condaEnvironment"))


def has_complete_conda_runtime(settings):
    return bool(settings.get("condaExecutable") and settings.get("condaEnvironment"))


def build_runtime_command(settings, command):
    if not has_complete_conda_runtime(settings):
        return command
    return (
        shlex.quote(settings["condaExecutable"])
        + " run --no-capture-output --name "
        + shlex.quote(settings["condaEnvironment"])
        + " "
        + command
    )


def build_training_launcher(settings):
    return build_runtime_command(settings, "deepspeed")


def configured_training_settings():
    config = app_config.config if isinstance(app_config.config, dict) else {}
    training = config.get("training") if isinstance(config.get("training"), dict) else {}
    return training_runtime_settings(training)


def wsl_executable():
    return shutil.which("wsl.exe") or shutil.which("wsl")


def uses_native_wsl_shell():
    return os.name != "nt"


def run_wsl(command, timeout=20, distribution=""):
    if uses_native_wsl_shell():
        args = ["bash", "-lc", command]
    else:
        executable = wsl_executable()
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


def to_wsl_path(path, distribution=""):
    value = str(path)
    if value.startswith("/"):
        return value
    code, stdout, stderr = run_wsl("wslpath -a " + shlex.quote(value), timeout=10, distribution=distribution)
    value = (stdout or "").strip()
    if code != 0 or not value:
        raise RuntimeError((stderr or stdout or "wslpath failed").strip())
    return value


def activation_prefix(settings):
    if has_conda_runtime(settings):
        return ""
    activate = settings["activate"]
    if not activate:
        return ""
    return "source " + shlex.quote(activate) + " && "


def _repair_permissions_recursively(path, distribution, timeout, label):
    try:
        wsl_path = to_wsl_path(path, distribution)
    except Exception as exc:
        return "Could not resolve the " + label + " path in WSL: " + str(exc)
    command = "chmod -R 775 -- " + shlex.quote(wsl_path)
    code, stdout, stderr = run_wsl(command, timeout=timeout, distribution=distribution)
    if code == 0:
        return ""
    detail = (stderr or stdout).strip() or ("exit " + str(code))
    return "Could not restore " + label + " permissions: " + detail


def repair_configured_training_root_permissions():
    """Restore access throughout the configured training root."""
    settings = configured_training_settings()
    return _repair_permissions_recursively(
        app_config.FS_ROOT,
        settings["wslDistribution"],
        timeout=600,
        label="training-root",
    )


def repair_boot_critical_training_permissions():
    """Restore the small training subtree required by the managed runner."""
    settings = configured_training_settings()
    distribution = settings["wslDistribution"]
    try:
        wsl_root = to_wsl_path(app_config.FS_ROOT, distribution)
    except Exception as exc:
        return "Could not resolve the training-root path in WSL: " + str(exc)
    runtime_root = posixpath.join(wsl_root, TRAINING_RUNTIME_DIR_NAME)
    command = (
        "chmod 775 -- " + shlex.quote(wsl_root)
        + " && if [ -e " + shlex.quote(runtime_root) + " ]; then chmod -R 775 -- "
        + shlex.quote(runtime_root) + "; fi"
    )
    code, stdout, stderr = run_wsl(command, timeout=30, distribution=distribution)
    if code == 0:
        return ""
    detail = (stderr or stdout).strip() or ("exit " + str(code))
    return "Could not restore boot-critical training permissions: " + detail
