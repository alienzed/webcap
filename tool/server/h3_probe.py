"""Prepare isolated MiniMax H3 envelope-probe seeds for external execution."""

import json
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
from .training_runtime import activation_prefix, build_runtime_command, configured_training_settings, to_wsl_path


ROOT = Path(__file__).resolve().parents[2]
PLAN_PATH = ROOT / "scripts" / "h3_shape_probe_plan.json"
SCRIPT_PATH = ROOT / "scripts" / "h3_shape_probe.py"
PROBE_ROOT_NAME = ".webcap_training"


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _probe_id():
    return "h3-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]


def _safe_media_filename(value):
    name = str(value or "").strip()
    if not name or name != Path(name).name or name in (".", ".."):
        raise ValueError("Invalid probe video filename.")
    return name


def _seed_relative(path, root):
    return Path(path).relative_to(root).as_posix()


def _probe_command(seed_path, settings):
    distribution = settings["wslDistribution"]
    cwd = str(settings["cwd"] or "").strip()
    if not cwd:
        raise RuntimeError("Training runtime is missing diffusion_pipe_wsl.")
    script_wsl = to_wsl_path(SCRIPT_PATH, distribution)
    seed_wsl = to_wsl_path(seed_path, distribution)
    python_command = "python " + shlex.quote(script_wsl) + " --seed " + shlex.quote(seed_wsl)
    python_command = build_runtime_command(settings, python_command)
    return "cd " + shlex.quote(cwd) + " && " + activation_prefix(settings) + python_command


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

    metadata = update_media_metadata(folder_path)
    source_fps = (metadata.get(selected_name) or {}).get("fps")
    captured_video = source_root / source.name
    capture = _copy_or_convert_bundle_video(source, captured_video, 24, source_fps)
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
