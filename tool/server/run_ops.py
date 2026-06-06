import os
import shlex
import subprocess
import sys
import traceback
import queue
import threading
import json
import re
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

from flask import Response, jsonify, stream_with_context

from . import config as app_config
from . import autoset as autoset_module
from .dataset_config import generate_dataset_configs
from .dataset_prep import prepare_dataset
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME, ensure_training_config_files


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
    return True


def _run_prepare_dataset(folder_path: Path, output_queue, selected_media=None, selection_criteria=None, total_media_count=None):
    writer = _QueueWriter(output_queue)
    try:
        with redirect_stdout(writer), redirect_stderr(writer):
            writer.write(
                prepare_dataset(
                    folder_path,
                    target_fps=16,
                    selected_media=selected_media,
                    selection_criteria=selection_criteria,
                    total_media_count=total_media_count,
                )
            )
    except Exception as e:
        writer.write(f"[ERROR] {e}\n")
        if app_config.FS_DEBUG:
            writer.write(traceback.format_exc() + "\n")
    finally:
        writer.flush()
        output_queue.put(None)


def _run_legacy_autoset(folder_path: Path, output_queue):
    writer = _QueueWriter(output_queue)
    try:
        with redirect_stdout(writer), redirect_stderr(writer):
            autoset_module.main(["--master", str(folder_path)])
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else 1
        if code not in (0, None):
            writer.write(f"[ERROR] autoset exited with code {code}\n")
    except Exception as e:
        writer.write(f"[ERROR] {e}\n")
        if app_config.FS_DEBUG:
            writer.write(traceback.format_exc() + "\n")
    finally:
        writer.flush()
        output_queue.put(None)


def prepare_dataset_response(folder: str, selected_media=None, selection_criteria=None, total_media_count=None):
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
                args=(folder_path, output_queue, selected_media, selection_criteria, total_media_count),
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


def autoset_run_response(folder: str):
    if not folder:
        return jsonify({"error": "Missing folder argument"}), 400
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {folder}"}), 404

        def generate():
            output_queue = queue.Queue()
            thread = threading.Thread(
                target=_run_legacy_autoset,
                args=(folder_path, output_queue),
                daemon=True,
            )
            thread.start()
            while True:
                chunk = output_queue.get()
                if chunk is None:
                    break
                yield chunk
            thread.join()
            yield "[autoset] Finished legacy autoset run.\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[autoset_run] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def generate_dataset_config_response(folder: str):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")
        training = app_config.config.get("training") or {}
        mode = str(training.get("mode") or "normal").strip().lower()
        write_snapshot_comments = bool(training.get("write_selection_snapshot_comments"))
        prep_manifest_path = folder_path / "auto_dataset" / "prep_manifest.json"
        auto_prepare_attempted = False
        prep_log = ""
        if not prep_manifest_path.exists():
            auto_prepare_attempted = True
            prep_log += "[INFO] Missing prep manifest; auto-running Prepare Dataset once.\n"
            prep_text = prepare_dataset(folder_path, target_fps=16)
            if prep_text:
                prep_log += str(prep_text).rstrip() + "\n"

        try:
            text = generate_dataset_configs(
                folder_path,
                mode=mode,
                write_selection_snapshot_comments=write_snapshot_comments,
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
            return Response(prep_log + text, mimetype="text/plain")
        except FileNotFoundError as e:
            if auto_prepare_attempted:
                return Response(
                    prep_log + f"[ERROR] Generate failed after auto-prepare attempt: {e}\n",
                    status=500,
                    mimetype="text/plain",
                )
            raise
    except Exception as e:
        app_config.debug_traceback()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")


def _to_wsl_path(path_obj: Path):
    cmd = ["wsl", "wslpath", "-a", str(path_obj)]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "wslpath failed").strip())
    out = (result.stdout or "").strip()
    if not out:
        raise RuntimeError("wslpath returned empty output")
    return out


def train_run_response(folder: str):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")

    live_config = app_config.config
    training_cfg = live_config.get("training", {}) if isinstance(live_config, dict) else {}
    diffusion_pipe_wsl = (training_cfg.get("diffusion_pipe_wsl") or "").strip()
    hi_name = HI_CONFIG_NAME
    lo_name = LO_CONFIG_NAME
    mode = str(training_cfg.get("mode") or "normal").strip().lower()
    write_snapshot_comments = bool(training_cfg.get("write_selection_snapshot_comments"))

    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")

        warnings = []
        hi_path = folder_path / hi_name
        lo_path = folder_path / lo_name
        dataset_hi_path = folder_path / "dataset.hi.toml"
        dataset_lo_path = folder_path / "dataset.lo.toml"
        missing_hi = not hi_path.exists() or not hi_path.is_file()
        missing_lo = not lo_path.exists() or not lo_path.is_file()
        missing_dataset_hi = not dataset_hi_path.exists() or not dataset_hi_path.is_file()
        missing_dataset_lo = not dataset_lo_path.exists() or not dataset_lo_path.is_file()

        if missing_hi or missing_lo or missing_dataset_hi or missing_dataset_lo:
            warnings.append("[INFO] Missing training config or dataset files; auto-running Generate Dataset Configs.")
            ensure_training_config_files(folder_path)
            prep_manifest_path = folder_path / "auto_dataset" / "prep_manifest.json"
            if not prep_manifest_path.exists():
                warnings.append("[INFO] Missing prep manifest; auto-running Prepare Dataset once.")
                prep_text = prepare_dataset(folder_path, target_fps=16)
                if prep_text:
                    warnings.append(str(prep_text).rstrip())
            try:
                gen_text = generate_dataset_configs(
                    folder_path,
                    mode=mode,
                    write_selection_snapshot_comments=write_snapshot_comments,
                )
                if gen_text:
                    warnings.append(str(gen_text).rstrip())
            except FileNotFoundError as e:
                return Response(
                    "[ERROR] Train failed while auto-generating configs: " + str(e) + "\n",
                    status=500,
                    mimetype="text/plain",
                )
            missing_hi = not hi_path.exists() or not hi_path.is_file()
            missing_lo = not lo_path.exists() or not lo_path.is_file()
            missing_dataset_hi = not dataset_hi_path.exists() or not dataset_hi_path.is_file()
            missing_dataset_lo = not dataset_lo_path.exists() or not dataset_lo_path.is_file()
            if missing_hi:
                warnings.append(f"[WARN] Config file still missing after generate: {hi_name}")
            if missing_lo:
                warnings.append(f"[WARN] Config file still missing after generate: {lo_name}")
            if missing_dataset_hi:
                warnings.append("[WARN] Dataset HI config still missing after generate: dataset.hi.toml")
            if missing_dataset_lo:
                warnings.append("[WARN] Dataset LO config still missing after generate: dataset.lo.toml")

        try:
            hi_wsl = _to_wsl_path(hi_path)
        except Exception:
            hi_wsl = hi_path.as_posix()
            warnings.append(f"[WARN] Could not resolve WSL path for {hi_name}; using native path.")
        try:
            lo_wsl = _to_wsl_path(lo_path)
        except Exception:
            lo_wsl = lo_path.as_posix()
            warnings.append(f"[WARN] Could not resolve WSL path for {lo_name}; using native path.")

        if not diffusion_pipe_wsl:
            diffusion_pipe_wsl = "<set training.diffusion_pipe_wsl>"
            warnings.append("[WARN] Missing training.diffusion_pipe_wsl in config.json; using placeholder cwd.")

        cmd1 = (
            'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
            'deepspeed --num_gpus=1 train.py --deepspeed --config ' + shlex.quote(hi_wsl)
        )
        cmd2 = (
            'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
            'deepspeed --num_gpus=1 train.py --deepspeed --config ' + shlex.quote(lo_wsl)
        )
        handoff_cmd = cmd1 + " ; " + cmd2
        hi_kill_pattern = re.escape(hi_name)
        hi_kill_cmd = "pkill -f '" + hi_kill_pattern + "'"

        def generate():
            try:
                yield f"[INFO] Running from: {diffusion_pipe_wsl}\n"
                yield f"[INFO] Config HI: {hi_wsl}\n"
                yield f"[INFO] Config LO: {lo_wsl}\n"
                for line in warnings:
                    yield line + "\n"
                yield "[INFO] Training commands (copy/paste):\n"
                yield handoff_cmd + "\n"
                yield "[INFO] Optional early-stop HI (run from another terminal):\n"
                yield hi_kill_cmd + "\n"
                yield "[train] Command preview only; execution is currently disabled.\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        app_config.debug_traceback()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")
