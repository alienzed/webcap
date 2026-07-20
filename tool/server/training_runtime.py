import os
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


def pid_alive(pid, distribution=""):
    if not pid:
        return False
    code, _, _ = run_wsl("kill -0 " + str(int(pid)), timeout=8, distribution=distribution)
    return code == 0


def repair_training_set_permissions(folder_path, distribution=""):
    """Restore WSL access to the training inputs without touching reversible originals."""
    try:
        wsl_folder = to_wsl_path(folder_path, distribution)
    except Exception as exc:
        return "Could not resolve the training set path in WSL: " + str(exc)
    quoted_folder = shlex.quote(wsl_folder)
    command = (
        "chmod 775 -- " + quoted_folder
        + " && find " + quoted_folder + " -type d -name originals -prune -o -type d -exec chmod 775 {} +"
        + " && find " + quoted_folder + " -type d -name originals -prune -o -type f -exec chmod 664 {} +"
    )
    code, stdout, stderr = run_wsl(command, timeout=120, distribution=distribution)
    if code == 0:
        return ""
    detail = (stderr or stdout).strip() or ("exit " + str(code))
    return "Could not restore training-set permissions: " + detail
