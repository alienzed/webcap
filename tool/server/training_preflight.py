import csv
import json
import shlex
import shutil
import time
import tomllib
from pathlib import Path

from . import config as app_config
from .caption_ops import _caption_name_for_media
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .training_commands import build_training_launcher_probe
from .training_config_files import H3_CONFIG_NAME, HI_CONFIG_NAME, LO_CONFIG_NAME, KREA2_CONFIG_NAME, WAN21_CONFIG_NAME
from .training_runtime import (
    activation_prefix,
    build_runtime_command,
    build_training_launcher,
    configured_training_settings,
    has_complete_conda_runtime,
    has_conda_runtime,
    run_wsl,
    uses_native_wsl_shell,
    wsl_executable,
)


PARTIAL_CAPTION_REVIEW_MIN_ITEMS = 3
PARTIAL_CAPTION_REVIEW_MIN_RATIO = 0.15


def resolve_folder(folder):
    value = str(folder or "").strip()
    if not value:
        raise ValueError("Missing folder argument")
    path = app_config.safe_join_fs_root(value)
    if not path.exists() or not path.is_dir():
        raise ValueError("Folder does not exist: " + value)
    return value, path


def resolve_artifacts(folder, folder_path, stages="both"):
    paths = {
        "hiConfig": folder_path / HI_CONFIG_NAME,
        "loConfig": folder_path / LO_CONFIG_NAME,
        "krea2Config": folder_path / KREA2_CONFIG_NAME,
        "wan21Config": folder_path / WAN21_CONFIG_NAME,
        "h3Config": folder_path / H3_CONFIG_NAME,
        "hiDataset": folder_path / "dataset.hi.toml",
        "loDataset": folder_path / "dataset.lo.toml",
        "trainDataset": folder_path / "dataset.train.toml",
        "manifest": folder_path / "auto_dataset" / "prep_manifest.json",
    }
    if stages == "krea2":
        required = ("krea2Config", "trainDataset", "manifest")
    elif stages == "wan21":
        required = ("wan21Config", "trainDataset", "manifest")
    elif stages == "h3":
        required = ("h3Config", "trainDataset", "manifest")
    elif stages == "hi":
        required = ("hiConfig", "hiDataset", "manifest")
    elif stages == "lo":
        required = ("loConfig", "loDataset", "manifest")
    else:
        required = ("hiConfig", "loConfig", "hiDataset", "loDataset", "manifest")
    missing = [name for name in required if not paths[name].exists() or not paths[name].is_file()]
    return paths, missing


def prepared_dataset_is_ready(folder_path):
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


def partial_annotation_caption_counts(folder_path):
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


def needs_partial_annotation_caption_review(folder_path):
    partial_count, touched_count = partial_annotation_caption_counts(folder_path)
    if not touched_count or partial_count < PARTIAL_CAPTION_REVIEW_MIN_ITEMS:
        return False, partial_count, touched_count
    return partial_count / touched_count >= PARTIAL_CAPTION_REVIEW_MIN_RATIO, partial_count, touched_count


def make_check(check_id, severity, ok, message, details=""):
    return {
        "id": check_id,
        "severity": severity,
        "ok": bool(ok),
        "message": message,
        "details": str(details or "").strip(),
    }


def wsl_check(check_id, severity, settings, command, message):
    cwd = settings["cwd"]
    shell = "cd " + shlex.quote(cwd) + " && " + activation_prefix(settings) + command
    code, stdout, stderr = run_wsl(shell, distribution=settings["wslDistribution"])
    details = (stdout + stderr).strip()
    return make_check(check_id, severity, code == 0, message if code == 0 else message + " (exit " + str(code) + ")", details)


def parse_nvidia_smi_csv(text, fields):
    rows = []
    for values in csv.reader((text or "").splitlines()):
        if len(values) != len(fields):
            continue
        rows.append({field: value.strip() for field, value in zip(fields, values)})
    return rows


def gpu_snapshot():
    settings = configured_training_settings()
    distribution = settings.get("wslDistribution") or ""
    gpu_fields = ("index", "name", "utilization", "memoryUsed", "memoryTotal", "temperature", "powerDraw")
    gpu_command = "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits"
    code, stdout, stderr = run_wsl(gpu_command, timeout=5, distribution=distribution)
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
    process_code, process_stdout, process_stderr = run_wsl(process_command, timeout=5, distribution=distribution)
    return {
        "available": True,
        "gpus": parse_nvidia_smi_csv(stdout, gpu_fields),
        "processes": parse_nvidia_smi_csv(process_stdout, process_fields) if process_code == 0 else [],
        "processError": (process_stderr or "").strip() if process_code != 0 else "",
        "checkedAt": time.time(),
    }


def build_preflight(folder, stages="both"):
    folder_value, folder_path = resolve_folder(folder)
    artifacts, missing = resolve_artifacts(folder_value, folder_path, stages)
    settings = configured_training_settings()
    checks = [
        make_check("set_folder_exists", "blocker", True, "Set folder is available.", str(folder_path)),
        make_check(
            "training_artifacts",
            "blocker",
            not missing,
            "Training artifacts are available." if not missing else "Missing: " + ", ".join(missing),
        ),
    ]
    shell_available = bool(shutil.which("bash")) if uses_native_wsl_shell() else bool(wsl_executable())
    checks.append(make_check(
        "wsl_available",
        "blocker",
        shell_available,
        "Current WSL shell is available." if uses_native_wsl_shell() and shell_available else
        "WSL is available." if shell_available else "wsl.exe was not found on PATH.",
    ))
    checks.append(make_check(
        "training_cwd",
        "blocker",
        bool(settings["cwd"]),
        "Diffusion Pipe WSL path is configured." if settings["cwd"] else "Set training.diffusion_pipe_wsl in App Settings.",
    ))
    if not all(item["ok"] for item in checks if item["severity"] == "blocker"):
        return folder_value, folder_path, artifacts, settings, checks

    checks.append(wsl_check("cwd_exists", "blocker", settings, "test -d .", "Training working directory is available."))
    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(make_check("conda_runtime", "blocker", False, "Conda runtime needs both the executable path and environment name."))
        return folder_value, folder_path, artifacts, settings, checks
    if has_complete_conda_runtime(settings):
        checks.append(wsl_check(
            "conda_executable",
            "blocker",
            settings,
            "test -x " + shlex.quote(settings["condaExecutable"]),
            "Conda executable is available.",
        ))
    elif settings["activate"]:
        checks.append(wsl_check("activate_script", "blocker", settings, "test -f " + shlex.quote(settings["activate"]), "Activation script is available."))
    else:
        checks.append(make_check("activate_script", "warning", True, "No activation script configured; using the WSL shell environment."))
    if has_complete_conda_runtime(settings) and not checks[-1]["ok"]:
        return folder_value, folder_path, artifacts, settings, checks
    checks.append(wsl_check("python_available", "blocker", settings, build_runtime_command(settings, "python --version"), "Python is available."))
    checks.append(wsl_check("deepspeed_available", "blocker", settings, build_training_launcher_probe(build_training_launcher(settings)), "DeepSpeed launcher is available."))
    checks.append(wsl_check("train_py_present", "blocker", settings, "test -f train.py", "train.py is available."))
    checks.append(wsl_check(
        "torch_cuda_visible",
        "blocker",
        settings,
        build_runtime_command(settings, "python -c " + shlex.quote("import torch; raise SystemExit(0 if torch.cuda.is_available() and torch.cuda.device_count() else 1)")),
        "CUDA is visible to PyTorch.",
    ))
    checks.append(wsl_check("nvidia_smi", "warning", settings, "nvidia-smi", "nvidia-smi is available."))
    return folder_value, folder_path, artifacts, settings, checks


def build_launch_preflight(folder, stages="both"):
    folder_value, folder_path = resolve_folder(folder)
    artifacts, missing = resolve_artifacts(folder_value, folder_path, stages)
    settings = configured_training_settings()
    shell_available = bool(shutil.which("bash")) if uses_native_wsl_shell() else bool(wsl_executable())
    checks = [
        make_check("set_folder_exists", "blocker", True, "Set folder is available.", str(folder_path)),
        make_check("training_artifacts", "blocker", not missing, "Training artifacts are available." if not missing else "Missing: " + ", ".join(missing)),
        make_check(
            "wsl_available",
            "blocker",
            shell_available,
            "Current WSL shell is available." if uses_native_wsl_shell() and shell_available else
            "WSL is available." if shell_available else "wsl.exe was not found on PATH.",
        ),
        make_check("training_cwd", "blocker", bool(settings["cwd"]), "Diffusion Pipe WSL path is configured." if settings["cwd"] else "Set training.diffusion_pipe_wsl in App Settings."),
    ]
    toml_keys = (
        ("krea2Config", "trainDataset") if stages == "krea2" else
        ("wan21Config", "trainDataset") if stages == "wan21" else
        ("h3Config", "trainDataset") if stages == "h3" else
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
    checks.append(make_check(
        "training_toml",
        "blocker",
        not toml_errors,
        "Training TOML is valid." if not toml_errors else "Training TOML could not be parsed.",
        "; ".join(toml_errors),
    ))
    if has_conda_runtime(settings) and not has_complete_conda_runtime(settings):
        checks.append(make_check("conda_runtime", "blocker", False, "Conda runtime needs both the executable path and environment name."))
    return folder_value, folder_path, artifacts, settings, checks


def preflight_payload(folder, stages="both"):
    folder_value, folder_path, artifacts, settings, checks = build_preflight(folder, stages)
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
