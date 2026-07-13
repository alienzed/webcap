import shlex


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
