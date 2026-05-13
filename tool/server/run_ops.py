import shlex
import subprocess
import sys
import traceback
import queue
import threading
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

from flask import Response, jsonify, stream_with_context

from . import config as app_config
from . import autoset as autoset_module
from .dataset_config import generate_dataset_configs
from .dataset_prep import prepare_dataset

ROOT = Path(__file__).resolve().parents[2]


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


def _run_prepare_dataset(folder_path: Path, output_queue):
    writer = _QueueWriter(output_queue)
    try:
        with redirect_stdout(writer), redirect_stderr(writer):
            writer.write(prepare_dataset(folder_path, target_fps=16))
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


def prepare_dataset_response(folder: str):
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
            yield "[prepare-dataset] Finished. dataset.hi.toml and dataset.lo.toml were not modified.\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            print("[prepare_dataset] ERROR:", e)
            traceback.print_exc()
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
            print("[autoset_run] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def generate_dataset_config_response(folder: str):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")
        text = generate_dataset_configs(folder_path)
        return Response(text, mimetype="text/plain")
    except Exception as e:
        traceback.print_exc()
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
    hi_name = (training_cfg.get("config_hi") or "config.hi.toml").strip()
    lo_name = (training_cfg.get("config_lo") or "config.lo.toml").strip()

    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")

        warnings = []
        hi_path = folder_path / hi_name
        lo_path = folder_path / lo_name
        if not hi_path.exists() or not hi_path.is_file():
            warnings.append(f"[WARN] Missing config file: {hi_name}")
        if not lo_path.exists() or not lo_path.is_file():
            warnings.append(f"[WARN] Missing config file: {lo_name}")

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
        def generate():
            try:
                yield f"[INFO] Running from: {diffusion_pipe_wsl}\n"
                yield f"[INFO] Config HI: {hi_wsl}\n"
                yield f"[INFO] Config LO: {lo_wsl}\n"
                for line in warnings:
                    yield line + "\n"
                yield "[INFO] Command 1:\n"
                yield cmd1 + "\n"
                yield "[INFO] Command 2:\n"
                yield cmd2 + "\n"
                yield "[train] Command preview only; execution is currently disabled.\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            traceback.print_exc()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")
