"""Prepare isolated MiniMax H3 envelope-probe seeds for external execution."""

import json
import os
import shutil
import shlex
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .dataset_prep import VIDEO_EXTS, resolve_prepared_caption_text, write_prepared_caption
from .media import update_media_metadata
from .permissions import normalize_path_permissions
from .training_bundle import _copy_or_convert_bundle_video
from .training_config_files import render_training_config_template, training_config_template_path
from .training_profiles import MINIMAX_H3_PROFILE_ID, config_for_stage
from .training_runtime import activation_prefix, build_runtime_command, configured_training_settings, run_wsl, to_wsl_path


ROOT = Path(__file__).resolve().parents[2]
PLAN_PATH = ROOT / "scripts" / "h3_shape_probe_plan.json"
SCRIPT_PATH = ROOT / "scripts" / "h3_shape_probe.py"
PROBE_ROOT_NAME = ".webcap_training"
RUNTIME_FILE_NAME = "runtime.json"
CANCEL_FILE_NAME = "cancel.request"
H3_CAPTURE_FPS = 24


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _probe_id():
    return "h3-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]


def _safe_media_filename(value):
    name = str(value or "").strip()
    if not name or name != Path(name).name or name in (".", ".."):
        raise ValueError("Invalid probe video filename.")
    return name


def _required_h3_source_duration_seconds():
    try:
        plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        frames = max(int(ladder["frames"]) for ladder in plan["ladders"])
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError("Could not read the fixed H3 probe plan for source validation.") from error
    return float(frames) / H3_CAPTURE_FPS


def _seed_relative(path, root):
    return Path(path).relative_to(root).as_posix()


def _probe_command(seed_path, settings, publish_config_path=None):
    distribution = settings["wslDistribution"]
    cwd = str(settings["cwd"] or "").strip()
    if not cwd:
        raise RuntimeError("Training runtime is missing diffusion_pipe_wsl.")
    script_wsl = to_wsl_path(SCRIPT_PATH, distribution)
    seed_wsl = to_wsl_path(seed_path, distribution)
    python_command = "python " + shlex.quote(script_wsl) + " --seed " + shlex.quote(seed_wsl)
    if publish_config_path:
        python_command += " --publish-config " + shlex.quote(str(publish_config_path))
    python_command = build_runtime_command(settings, python_command)
    return "cd " + shlex.quote(cwd) + " && " + activation_prefix(settings) + python_command


def _write_json(path, payload):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    normalize_path_permissions(path)


def _read_json(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _runtime_path(probe_root):
    return Path(probe_root) / RUNTIME_FILE_NAME


def _campaign_result(probe_root):
    return _read_json(Path(probe_root) / "results" / "campaign_result.json")


def _runtime_is_live(runtime):
    pid = int(runtime.get("pid") or 0)
    distribution = str(runtime.get("wslDistribution") or "")
    if pid <= 0:
        return False
    code, stdout, _stderr = run_wsl(
        "if test -d /proc/" + str(pid) + "; then tr '\\0' ' ' < /proc/" + str(pid) + "/cmdline; fi",
        timeout=8,
        distribution=distribution,
    )
    command_line = (stdout or "").strip()
    return code == 0 and "h3_shape_probe.py" in command_line


def _refresh_runtime(runtime_path):
    runtime = _read_json(runtime_path)
    if not runtime:
        raise FileNotFoundError("H3 calibration runtime state is missing.")
    if runtime.get("status") in ("running", "stopping") and not _runtime_is_live(runtime):
        campaign = _campaign_result(Path(runtime_path).parent)
        runtime["status"] = str(campaign.get("status") or "failed")
        runtime["finishedAt"] = _utc_now()
        runtime["campaignStatus"] = campaign.get("status") or ""
        _write_json(runtime_path, runtime)
        if runtime.get("publishConfig"):
            app_config.reload_runtime_config()
    return runtime


def _active_runtime_path():
    root = Path(app_config.FS_ROOT) / PROBE_ROOT_NAME / "h3-probes"
    if not root.is_dir():
        return None
    for path in root.glob("*/" + RUNTIME_FILE_NAME):
        runtime = _refresh_runtime(path)
        if runtime.get("status") in ("running", "stopping"):
            return path
    return None


def _public_runtime(runtime):
    fields = ("probeId", "status", "startedAt", "finishedAt", "campaignStatus", "pid", "seedPath")
    return {field: runtime.get(field) for field in fields if field in runtime}


def _calibration_status_fields():
    training = app_config.config.get("training") if isinstance(app_config.config, dict) else None
    calibration = training.get("h3_calibration") if isinstance(training, dict) else None
    if calibration is None:
        return {"savedResultCount": 0, "calibrated": False}
    if not isinstance(calibration, dict):
        raise ValueError("training.h3_calibration must be an object.")
    results = calibration.get("results")
    if not isinstance(results, dict):
        raise ValueError("training.h3_calibration.results must be an object.")
    return {"hardware": calibration.get("hardware"), "savedResultCount": len(results), "calibrated": bool(calibration.get("safe_shapes"))}


def current_h3_hardware():
    settings = configured_training_settings()
    command = "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits | head -n 1; awk '/MemTotal/ {print $2}' /proc/meminfo"
    code, stdout, stderr = run_wsl(command, timeout=8, distribution=settings["wslDistribution"])
    lines = (stdout or "").strip().splitlines()
    if code != 0 or len(lines) < 2:
        raise RuntimeError((stderr or "Could not read H3 calibration hardware identity.").strip())
    try:
        gpu_model, total_vram = [value.strip() for value in lines[0].split(",", 1)]
        hardware = {"total_ram_mib": int(lines[1]) // 1024, "gpu_model": gpu_model, "total_vram_mib": int(total_vram)}
    except (TypeError, ValueError) as error:
        raise RuntimeError("Could not parse H3 calibration hardware identity.") from error
    if hardware["total_ram_mib"] <= 0 or hardware["total_vram_mib"] <= 0 or not hardware["gpu_model"]:
        raise RuntimeError("H3 calibration hardware identity is invalid.")
    return hardware


def prepare_h3_probe(folder, file_name):
    """Capture one selected video and return its external probe command."""
    folder_value = str(folder or "").strip()
    if not folder_value:
        raise ValueError("Missing folder for H3 probe.")
    selected_name = _safe_media_filename(file_name)
    folder_path = app_config.safe_join_fs_root(folder_value)
    if not folder_path.is_dir():
        raise FileNotFoundError("Probe folder does not exist: " + folder_value)
    source = folder_path / selected_name
    if not source.is_file() or source.suffix.lower() not in VIDEO_EXTS:
        raise ValueError("H3 envelope probe requires a selected video.")
    config_name = config_for_stage(MINIMAX_H3_PROFILE_ID, "h3", "normal")["file"]
    source_config = folder_path / config_name
    if not source_config.is_file():
        training_config_template_path(config_name)
    caption, _ = resolve_prepared_caption_text(source, {})
    if not caption:
        raise ValueError("H3 envelope probe requires a saved non-empty caption: " + source.with_suffix(".txt").name)
    if not PLAN_PATH.is_file() or not SCRIPT_PATH.is_file():
        raise FileNotFoundError("H3 envelope probe script files are missing.")

    runtime_root = Path(app_config.FS_ROOT) / PROBE_ROOT_NAME / "h3-probes"
    probe_id = _probe_id()
    probe_root = runtime_root / probe_id
    source_root = probe_root / "source"
    base_root = probe_root / "base"
    probe_root.mkdir(parents=True, exist_ok=False)
    source_root.mkdir(parents=True, exist_ok=False)
    base_root.mkdir(parents=True, exist_ok=False)
    normalize_path_permissions(runtime_root)
    normalize_path_permissions(probe_root)
    normalize_path_permissions(source_root)
    normalize_path_permissions(base_root)

    metadata = update_media_metadata(folder_path, scoped_filenames=[selected_name])
    source_metadata = metadata.get(selected_name)
    if not isinstance(source_metadata, dict):
        raise RuntimeError("Could not read metadata for the selected H3 probe video.")
    source_fps = source_metadata.get("fps")
    duration = source_metadata.get("duration")
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        raise ValueError("H3 envelope probe requires readable source duration metadata.")
    if duration < _required_h3_source_duration_seconds():
        raise ValueError("H3 envelope probe source is too short for the fixed 102-frame plan.")
    captured_video = source_root / source.name
    capture = _copy_or_convert_bundle_video(source, captured_video, H3_CAPTURE_FPS, source_fps)
    if not capture.get("action"):
        raise RuntimeError("Could not capture selected probe video: " + str(capture.get("error") or "unknown error"))
    write_prepared_caption(source, source_root, caption)
    captured_config = base_root / config_name
    if source_config.is_file():
        shutil.copy2(source_config, captured_config)
        config_source = "set"
    else:
        captured_config.write_text(render_training_config_template(config_name, folder_path), encoding="utf-8")
        config_source = "template"
    normalize_path_permissions(captured_config)
    captured_plan = probe_root / "plan.json"
    shutil.copy2(PLAN_PATH, captured_plan)
    normalize_path_permissions(captured_plan)

    seed_path = probe_root / "seed.json"
    seed = {
        "version": 1,
        "id": probe_id,
        "profileId": MINIMAX_H3_PROFILE_ID,
        "createdAt": _utc_now(),
        "source": {
            "video": _seed_relative(captured_video, probe_root),
            "caption": _seed_relative(captured_video.with_suffix(".txt"), probe_root),
            "captureAction": capture["action"],
        },
        "baseConfig": _seed_relative(captured_config, probe_root),
        "baseConfigSource": config_source,
        "plan": _seed_relative(captured_plan, probe_root),
        "results": "results",
    }
    seed_path.write_text(json.dumps(seed, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    normalize_path_permissions(seed_path)
    settings = configured_training_settings()
    command = _probe_command(seed_path, settings)
    return {
        "ok": True,
        "probeId": probe_id,
        "seedPath": str(seed_path),
        "command": command,
    }


def start_h3_probe(folder, file_name):
    active = _active_runtime_path()
    if active:
        raise RuntimeError("An H3 calibration is already running. Stop it before starting another calibration.")
    prepared = prepare_h3_probe(folder, file_name)
    seed_path = Path(prepared["seedPath"])
    probe_root = seed_path.parent
    settings = configured_training_settings()
    config_wsl = to_wsl_path(app_config.CONFIG_PATH, settings["wslDistribution"])
    command = _probe_command(seed_path, settings, publish_config_path=config_wsl)
    log_path = probe_root / "run.log"
    log_wsl = to_wsl_path(log_path, settings["wslDistribution"])
    launch = "setsid bash -lc " + shlex.quote(command) + " > " + shlex.quote(log_wsl) + " 2>&1 < /dev/null & echo $!"
    code, stdout, stderr = run_wsl(launch, timeout=15, distribution=settings["wslDistribution"])
    pid = (stdout or "").strip().splitlines()[-1] if (stdout or "").strip() else ""
    if code != 0 or not pid.isdigit():
        raise RuntimeError((stderr or stdout or "Could not start H3 calibration.").strip())
    runtime = {
        "version": 1,
        "probeId": prepared["probeId"],
        "status": "running",
        "startedAt": _utc_now(),
        "pid": int(pid),
        "seedPath": str(seed_path),
        "logPath": str(log_path),
        "wslDistribution": settings["wslDistribution"],
        "publishConfig": True,
    }
    _write_json(_runtime_path(probe_root), runtime)
    return {"ok": True, **_public_runtime(runtime)}


def h3_probe_status():
    path = _active_runtime_path()
    if path:
        return {"ok": True, "active": True, **_calibration_status_fields(), **_public_runtime(_read_json(path))}
    root = Path(app_config.FS_ROOT) / PROBE_ROOT_NAME / "h3-probes"
    candidates = sorted(root.glob("*/" + RUNTIME_FILE_NAME), key=lambda item: item.stat().st_mtime, reverse=True) if root.is_dir() else []
    if not candidates:
        return {"ok": True, "active": False, **_calibration_status_fields()}
    runtime = _refresh_runtime(candidates[0])
    return {"ok": True, "active": False, **_calibration_status_fields(), **_public_runtime(runtime)}


def h3_probe_log(offset=0):
    status = h3_probe_status()
    seed_path = str(status.get("seedPath") or "")
    if not seed_path:
        return {"ok": True, "offset": 0, "text": "", "active": False}
    log_path = Path(seed_path).parent / "run.log"
    try:
        payload = log_path.read_bytes()
    except OSError:
        payload = b""
    start = max(0, min(int(offset or 0), len(payload)))
    return {"ok": True, "offset": len(payload), "text": payload[start:].decode("utf-8", errors="replace"), "active": bool(status.get("active")), "status": status.get("status")}


def stop_h3_probe():
    path = _active_runtime_path()
    if not path:
        raise RuntimeError("No H3 calibration is running.")
    runtime = _read_json(path)
    pid = int(runtime.get("pid") or 0)
    cancel_path = path.parent / CANCEL_FILE_NAME
    cancel_path.touch(exist_ok=False)
    code, stdout, stderr = run_wsl(
        "kill -INT -- -" + str(pid), timeout=8, distribution=str(runtime.get("wslDistribution") or "")
    )
    if code != 0:
        try:
            cancel_path.unlink()
        except OSError:
            pass
        raise RuntimeError((stderr or stdout or "Could not stop H3 calibration.").strip())
    runtime["status"] = "stopping"
    _write_json(path, runtime)
    return {"ok": True, **_public_runtime(runtime)}
