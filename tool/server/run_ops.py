import subprocess
import traceback
import queue
import threading
import json
import re
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path, PurePosixPath

from flask import Response, jsonify, stream_with_context

from . import config as app_config
from .dataset_config import generate_dataset_configs
from .dataset_prep import prepare_dataset
from .permissions import normalize_path_permissions
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME
from .training_history import training_output_group_for_folder
from .training_profiles import config_for_stage, normalize_mode, profile_run
from .training_bundle import materialize_training_bundle
from .training_commands import build_training_command_plan
from .training_runtime import build_training_launcher, training_runtime_settings


class _QueueWriter:
    def __init__(self, output_queue):
        self._queue = output_queue
        self._buffer = ""

    def write(self, text):
        if not text:
            return 0
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._queue.put(line + "\n")
        return len(text)

    def flush(self):
        if self._buffer:
            self._queue.put(self._buffer)
            self._buffer = ""


_MICRO_BATCH_PATTERN = re.compile(r"^(\s*micro_batch_size_per_gpu\s*=\s*)(\d+)(\s*(?:#.*)?)$", re.MULTILINE)


def _manifest_is_image_only(manifest_path: Path):
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if not isinstance(raw, dict):
        return False
    videos = raw.get("videos") or []
    images = raw.get("images") or []
    if not isinstance(videos, list) or not isinstance(images, list):
        return False

    def _has_prepared_entries(rows):
        for row in rows:
            if not isinstance(row, dict):
                continue
            if str(row.get("prepared_path") or "").strip():
                return True
        return False

    has_videos = _has_prepared_entries(videos)
    has_images = _has_prepared_entries(images)
    return has_images and (not has_videos)


def _bump_micro_batch_default_if_template_value(config_path: Path):
    if not config_path.exists() or not config_path.is_file():
        return False
    try:
        original = config_path.read_text(encoding="utf-8")
    except Exception:
        return False
    match = _MICRO_BATCH_PATTERN.search(original)
    if not match:
        return False
    current = int(match.group(2))
    if current != 1:
        return False
    updated = _MICRO_BATCH_PATTERN.sub(r"\g<1>2\g<3>", original, count=1)
    if updated == original:
        return False
    config_path.write_text(updated, encoding="utf-8")
    normalize_path_permissions(config_path)
    return True


def _run_prepare_dataset(folder_path: Path, output_queue, selected_media=None, selection_criteria=None, total_media_count=None, fallback_captions=None):
    writer = _QueueWriter(output_queue)
    try:
        with redirect_stdout(writer), redirect_stderr(writer):
            writer.write(
                prepare_dataset(
                    folder_path,
                    selected_media=selected_media,
                    selection_criteria=selection_criteria,
                    total_media_count=total_media_count,
                    fallback_captions=fallback_captions,
                )
            )
    except Exception as e:
        writer.write(f"[ERROR] {e}\n")
        if app_config.FS_DEBUG:
            writer.write(traceback.format_exc() + "\n")
    finally:
        writer.flush()
        output_queue.put(None)


def prepare_dataset_response(folder: str, selected_media=None, selection_criteria=None, total_media_count=None, fallback_captions=None):
    if not folder:
        return jsonify({"error": "Missing folder argument"}), 400
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {folder}"}), 404

        def generate():
            output_queue = queue.Queue()
            thread = threading.Thread(
                target=_run_prepare_dataset,
                args=(folder_path, output_queue, selected_media, selection_criteria, total_media_count, fallback_captions),
                daemon=True,
            )
            thread.start()
            while True:
                chunk = output_queue.get()
                if chunk is None:
                    break
                yield chunk
            thread.join()
            yield "[prepare-dataset] Finished. dataset.hi.toml and dataset.lo.toml were not modified.\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[prepare_dataset] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def generate_dataset_config_response(folder: str, mode: str = "", profile_id: str = ""):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")
        training = app_config.config.get("training") or {}
        mode = str(mode or "normal").strip().lower()
        write_snapshot_comments = bool(training.get("write_selection_snapshot_comments"))
        prep_manifest_path = folder_path / "auto_dataset" / "prep_manifest.json"
        if not prep_manifest_path.exists():
            return Response(f"[ERROR] Missing prep manifest: {prep_manifest_path}\n", status=400, mimetype="text/plain")

        try:
            text = generate_dataset_configs(
                folder_path,
                mode=mode,
                write_selection_snapshot_comments=write_snapshot_comments,
                profile_id=profile_id,
            )
            image_only = _manifest_is_image_only(prep_manifest_path)
            if image_only:
                hi_name = HI_CONFIG_NAME
                lo_name = LO_CONFIG_NAME
                updated = []
                if _bump_micro_batch_default_if_template_value(folder_path / hi_name):
                    updated.append(hi_name)
                if _bump_micro_batch_default_if_template_value(folder_path / lo_name):
                    updated.append(lo_name)
                if updated:
                    text += "[INFO] Image-only set detected: defaulted micro_batch_size_per_gpu to 2 in " + ", ".join(updated) + ".\n"
            return Response(text, mimetype="text/plain")
        except (FileNotFoundError, ValueError) as e:
            return Response(f"[ERROR] {e}\n", status=400, mimetype="text/plain")
    except Exception as e:
        app_config.debug_traceback()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")


def _to_wsl_path(path_obj: Path, distribution=""):
    cmd = ["wsl"]
    if distribution:
        cmd.extend(["--distribution", distribution])
    cmd.extend(["--", "wslpath", "-a", str(path_obj)])
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "wslpath failed").strip())
    out = (result.stdout or "").strip()
    if not out:
        raise RuntimeError("wslpath returned empty output")
    return out


def train_run_response(
    folder: str,
    stages="both",
    resume_from_checkpoint="",
    resume_stage="",
    profile_id="",
    run_id="",
    mode="normal",
    selected_media=None,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")

    live_config = app_config.config
    training_cfg = live_config.get("training", {}) if isinstance(live_config, dict) else {}
    runtime_settings = training_runtime_settings(training_cfg)
    diffusion_pipe_wsl = runtime_settings["cwd"]
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")
        selected_profile, selected_run = profile_run(profile_id, run_id, stages)
        selected_mode = normalize_mode(mode)
        stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stage_names = ("hi", "lo") if stages == "both" else (stages,)
        launch_group = training_output_group_for_folder(folder_path, create=True)
        output_dirs = {}
        for stage in stage_names:
            meta = config_for_stage(selected_profile["id"], stage, selected_mode)
            if resume_from_checkpoint and resume_stage == stage:
                output_dir = str(Path(resume_from_checkpoint).parent) if not str(resume_from_checkpoint).startswith("/") else str(PurePosixPath(resume_from_checkpoint).parent)
            else:
                stage_output = launch_group / meta["outputSlug"]
                stage_output.mkdir(parents=True, exist_ok=True)
                normalize_path_permissions(stage_output)
                output_dir = _to_wsl_path(stage_output, runtime_settings["wslDistribution"])
            output_dirs[stage] = output_dir
        bundle = materialize_training_bundle(
            folder_path,
            launch_group,
            selected_profile["id"],
            selected_mode,
            stages,
            selected_media,
            fallback_captions=fallback_captions,
            selection_criteria=selection_criteria,
            total_media_count=total_media_count,
            output_dirs=output_dirs,
            distribution=runtime_settings["wslDistribution"],
        )
        artifacts = bundle["artifacts"]
        stage_configs = {
            stage: _to_wsl_path(artifacts[stage + "Config"], runtime_settings["wslDistribution"])
            for stage in stage_names
        }
        hi_wsl = stage_configs.get("hi") or next(iter(stage_configs.values()))
        lo_wsl = stage_configs.get("lo") or next(iter(stage_configs.values()))

        if not diffusion_pipe_wsl:
            diffusion_pipe_wsl = "<set training.diffusion_pipe_wsl>"

        command_plan = build_training_command_plan(
            hi_wsl,
            lo_wsl,
            build_training_launcher(runtime_settings),
            resume_from_checkpoint,
            resume_stage,
        )
        if stages == "hi":
            handoff_cmd = command_plan["hiCommand"]
        elif stages in ("lo", "krea2", "wan21", "h3"):
            handoff_cmd = command_plan["loCommand"]
        else:
            handoff_cmd = command_plan["handoffCommand"]
        def generate():
            try:
                yield f"[INFO] Running from: {diffusion_pipe_wsl}\n"
                yield f"[INFO] Training stages: {stages}\n"
                yield f"[INFO] Launch group: {launch_group.name}\n"
                yield f"[INFO] Captured files: {bundle['path']}\n"
                yield f"[INFO] Captured media items: {bundle['capturedItemCount']}\n"
                for stage in stage_names:
                    yield f"[INFO] Effective output {stage.upper()}: {output_dirs[stage]}\n"
                if resume_from_checkpoint:
                    yield f"[INFO] Resume {resume_stage.upper()} checkpoint: {resume_from_checkpoint}\n"
                if stages in ("krea2", "wan21", "h3"):
                    yield f"[INFO] Config {selected_profile['label']}: {lo_wsl}\n"
                else:
                    yield f"[INFO] Config HI: {hi_wsl}\n"
                    yield f"[INFO] Config LO: {lo_wsl}\n"
                yield "[INFO] Manual training command (copy/paste):\n"
                yield handoff_cmd + "\n"
                yield "[train] Manual handoff only; run this command in WSL yourself.\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except ValueError as e:
        return Response(f"[ERROR] {e}\n", status=400, mimetype="text/plain")
    except Exception as e:
        app_config.debug_traceback()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")
