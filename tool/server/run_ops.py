import shlex
import subprocess
import sys
import traceback
import queue
import threading
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

from flask import Response, jsonify, stream_with_context

from .config import FS_DEBUG, config, safe_join_fs_root
from .dataset_config import generate_dataset_configs
from . import autoset as autoset_module

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
            autoset_module.main(["--master", str(folder_path)])
    except Exception as e:
        writer.write(f"[ERROR] {e}\n")
        if FS_DEBUG:
            writer.write(traceback.format_exc() + "\n")
    finally:
        writer.flush()
        output_queue.put(None)


def prepare_dataset_response(folder: str):
    if not folder:
        return jsonify({"error": "Missing folder argument"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
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
        if FS_DEBUG:
            print("[prepare_dataset] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def autoset_run_response(folder: str):
    # Legacy alias kept for context-menu compatibility.
    return prepare_dataset_response(folder)


def generate_dataset_config_response(folder: str):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")
    try:
        folder_path = safe_join_fs_root(folder)
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

    training_cfg = config.get("training", {}) if isinstance(config, dict) else {}
    diffusion_pipe_wsl = (training_cfg.get("diffusion_pipe_wsl") or "").strip()
    activate_script = (training_cfg.get("activate_script") or "dp-clean/bin/activate").strip()
    hi_name = (training_cfg.get("config_hi") or "config.hi.toml").strip()
    lo_name = (training_cfg.get("config_lo") or "config.lo.toml").strip()

    if not diffusion_pipe_wsl:
        return Response("[ERROR] Missing training.diffusion_pipe_wsl in config.json\n", status=400, mimetype="text/plain")

    try:
        folder_path = safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")

        hi_path = folder_path / hi_name
        lo_path = folder_path / lo_name
        if not hi_path.exists() or not hi_path.is_file():
            return Response(f"[ERROR] Missing config file: {hi_name}\n", status=404, mimetype="text/plain")
        if not lo_path.exists() or not lo_path.is_file():
            return Response(f"[ERROR] Missing config file: {lo_name}\n", status=404, mimetype="text/plain")

        hi_wsl = _to_wsl_path(hi_path)
        lo_wsl = _to_wsl_path(lo_path)

        cmd1 = (
            'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
            'deepspeed --num_gpus=1 train.py --deepspeed --config ' + shlex.quote(hi_wsl)
        )
        cmd2 = (
            'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
            'deepspeed --num_gpus=1 train.py --deepspeed --config ' + shlex.quote(lo_wsl)
        )
        script = (
            "cd " + shlex.quote(diffusion_pipe_wsl)
            + " && source " + shlex.quote(activate_script)
            + " && " + cmd1
            + " ; " + cmd2
        )
        cmd = ["wsl", "bash", "-lc", script]

        def generate():
            try:
                yield f"[INFO] Running from: {diffusion_pipe_wsl}\n"
                yield f"[INFO] Config HI: {hi_wsl}\n"
                yield f"[INFO] Config LO: {lo_wsl}\n"
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=1,
                    universal_newlines=True,
                )
                for line in proc.stdout:
                    yield line
                proc.stdout.close()
                code = proc.wait()
                if code == 0:
                    yield "[train] Finished both runs.\n"
                else:
                    yield f"[train] Finished with exit code {code}.\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except Exception as e:
        if FS_DEBUG:
            traceback.print_exc()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")
