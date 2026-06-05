import math
import os
import subprocess
import tempfile
import threading
import time
import uuid
from queue import Queue
from pathlib import Path

from flask import jsonify

from . import config as app_config
from .media import probe_media_metadata
from .originals import ensure_original_by_hash, ensure_originals_folder

# Alias kept for compatibility with callers and tests that monkeypatch this name.
safe_join_fs_root = app_config.safe_join_fs_root

VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"}
VIDEO_CLIP_RECENT_DUPLICATE_WINDOW_SEC = 2.0
VIDEO_CLIP_JOB_RETENTION_SEC = 600.0
VIDEO_CLIP_MAX_TRACKED_JOBS = 512

_video_clip_queue = Queue()
_video_clip_jobs = {}
_video_clip_signatures = {}
_video_clip_worker = None
_video_clip_lock = threading.Lock()


def _safe_file_name(name):
    value = str(name or "").strip()
    if not value:
        raise RuntimeError("Output name is required")
    if "/" in value or "\\" in value or ".." in value:
        raise RuntimeError("Invalid output name")
    return value


def _safe_media_name(name):
    value = str(name or "").strip()
    if not value:
        raise RuntimeError("Source media file is required")
    if Path(value).name != value:
        raise RuntimeError("Invalid source media filename")
    return value


def _normalize_output_name(name):
    value = _safe_file_name(name)
    stem = Path(value).stem
    if not stem:
        raise RuntimeError("Output name is required")
    ext = Path(value).suffix.lower()
    if ext != ".mp4":
        value = stem + ".mp4"
    return value


def _parse_video_resolution(metadata):
    text = str((metadata or {}).get("resolution") or "").strip().lower()
    if "x" not in text:
        raise RuntimeError("Could not determine source video resolution")
    parts = text.split("x", 1)
    try:
        width = int(parts[0].strip())
        height = int(parts[1].strip())
    except Exception:
        raise RuntimeError("Invalid source video resolution")
    if width <= 0 or height <= 0:
        raise RuntimeError("Invalid source video resolution")
    return width, height


def _parse_positive_float(value, label):
    try:
        n = float(value)
    except Exception:
        raise RuntimeError(label + " must be a number")
    if not math.isfinite(n):
        raise RuntimeError(label + " must be finite")
    if n < 0:
        raise RuntimeError(label + " must be >= 0")
    return n


def _parse_duration(value):
    try:
        n = float(value)
    except Exception:
        raise RuntimeError("Duration must be a number")
    if not math.isfinite(n):
        raise RuntimeError("Duration must be finite")
    if n <= 0:
        raise RuntimeError("Duration must be > 0")
    return n


def _parse_crop_rect(crop, src_w, src_h):
    if not isinstance(crop, dict):
        raise RuntimeError("Crop rectangle is required")
    try:
        x = int(round(float(crop.get("x"))))
        y = int(round(float(crop.get("y"))))
        w = int(round(float(crop.get("width"))))
        h = int(round(float(crop.get("height"))))
    except Exception:
        raise RuntimeError("Crop rectangle values must be numeric")

    if w <= 0 or h <= 0:
        raise RuntimeError("Crop width and height must be > 0")
    if x < 0 or y < 0:
        raise RuntimeError("Crop x/y must be >= 0")
    if x + w > src_w or y + h > src_h:
        raise RuntimeError("Crop rectangle exceeds source bounds")

    return {"x": x, "y": y, "width": w, "height": h}


def _is_video_file(path):
    return path.suffix.lower() in VIDEO_EXTS


def _run_clip_ffmpeg(source_path, out_path, start_sec, duration_sec, crop_rect):
    crop_filter = "crop={w}:{h}:{x}:{y}".format(
        w=crop_rect["width"],
        h=crop_rect["height"],
        x=crop_rect["x"],
        y=crop_rect["y"],
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(source_path),
        "-ss",
        "{:.6f}".format(start_sec),
        "-t",
        "{:.6f}".format(duration_sec),
        "-vf",
        crop_filter,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        str(out_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError("ffmpeg failed: " + stderr)


def _run_clip_ffmpeg_overwrite_source(source_path, start_sec, duration_sec, crop_rect):
    originals_dir = ensure_originals_folder(source_path.parent)
    if originals_dir is None:
        raise RuntimeError("Cannot overwrite source in this folder")
    ensure_original_by_hash(source_path, originals_dir)

    fd, tmp_name = tempfile.mkstemp(
        prefix=source_path.stem + "_clip_tmp_",
        suffix=(source_path.suffix or ".mp4"),
        dir=str(source_path.parent),
    )
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        _run_clip_ffmpeg(source_path, tmp_path, start_sec, duration_sec, crop_rect)
        os.replace(tmp_path, source_path)
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


def _format_signature(source_path, out_path, start_sec, duration_sec, crop_rect):
    return "|".join([
        str(source_path).lower(),
        str(out_path).lower(),
        "{:.6f}".format(float(start_sec)),
        "{:.6f}".format(float(duration_sec)),
        str(int(crop_rect["x"])),
        str(int(crop_rect["y"])),
        str(int(crop_rect["width"])),
        str(int(crop_rect["height"])),
    ])


def _set_signature_state(signature, status):
    _video_clip_signatures[signature] = {
        "status": status,
        "updatedAt": time.time(),
    }


def get_clip_job_status(job_id):
    job_id = str(job_id or "").strip()
    if not job_id:
        return None
    with _video_clip_lock:
        job = _video_clip_jobs.get(job_id)
        if not job:
            return None
        return {
            "id": job.get("id"),
            "status": job.get("status"),
            "error": job.get("error"),
            "outputName": job.get("outputName"),
            "overwriteSource": bool(job.get("overwriteSource")),
            "updatedAt": job.get("updatedAt"),
        }


def _prune_tracking(now_ts):
    stale_job_ids = []
    for job_id, job in _video_clip_jobs.items():
        status = str(job.get("status") or "")
        updated_at = float(job.get("updatedAt") or job.get("createdAt") or now_ts)
        if status in ("completed", "failed") and (now_ts - updated_at) > VIDEO_CLIP_JOB_RETENTION_SEC:
            stale_job_ids.append(job_id)
    for job_id in stale_job_ids:
        _video_clip_jobs.pop(job_id, None)

    stale_signatures = []
    for signature, item in _video_clip_signatures.items():
        status = str(item.get("status") or "")
        updated_at = float(item.get("updatedAt") or now_ts)
        if status in ("completed", "failed") and (now_ts - updated_at) > VIDEO_CLIP_RECENT_DUPLICATE_WINDOW_SEC:
            stale_signatures.append(signature)
    for signature in stale_signatures:
        _video_clip_signatures.pop(signature, None)

    # Keep map bounded under heavy use.
    if len(_video_clip_jobs) > VIDEO_CLIP_MAX_TRACKED_JOBS:
        ordered = sorted(
            _video_clip_jobs.items(),
            key=lambda kv: float((kv[1] or {}).get("updatedAt") or (kv[1] or {}).get("createdAt") or 0),
        )
        to_drop = len(_video_clip_jobs) - VIDEO_CLIP_MAX_TRACKED_JOBS
        for i in range(max(0, to_drop)):
            _video_clip_jobs.pop(ordered[i][0], None)


def _clip_worker_loop():
    while True:
        job_id = _video_clip_queue.get()
        try:
            with _video_clip_lock:
                job = _video_clip_jobs.get(job_id)
                if not job:
                    continue
                job["status"] = "running"
                job["updatedAt"] = time.time()
                _set_signature_state(job["signature"], "running")

            if bool(job.get("overwriteSource")):
                _run_clip_ffmpeg_overwrite_source(
                    Path(job["sourcePath"]),
                    float(job["startSec"]),
                    float(job["durationSec"]),
                    job["crop"],
                )
            else:
                _run_clip_ffmpeg(
                    Path(job["sourcePath"]),
                    Path(job["outputPath"]),
                    float(job["startSec"]),
                    float(job["durationSec"]),
                    job["crop"],
                )

            with _video_clip_lock:
                current = _video_clip_jobs.get(job_id)
                if current:
                    current["status"] = "completed"
                    current["updatedAt"] = time.time()
                _set_signature_state(job["signature"], "completed")
                _prune_tracking(time.time())
        except Exception as exc:
            with _video_clip_lock:
                current = _video_clip_jobs.get(job_id)
                if current:
                    current["status"] = "failed"
                    current["error"] = str(exc)
                    current["updatedAt"] = time.time()
                if job_id in _video_clip_jobs:
                    _set_signature_state(_video_clip_jobs[job_id]["signature"], "failed")
                _prune_tracking(time.time())
        finally:
            _video_clip_queue.task_done()


def _ensure_clip_worker_started():
    global _video_clip_worker
    if _video_clip_worker and _video_clip_worker.is_alive():
        return
    _video_clip_worker = threading.Thread(target=_clip_worker_loop, name="video-clip-worker", daemon=True)
    _video_clip_worker.start()


def clip_video_response(data):
    data = data or {}
    folder = str(data.get("folder") or "").strip()
    media_name = _safe_media_name(data.get("fileName") or data.get("media") or "")
    output_name_raw = data.get("outputName") or ""
    start_sec = _parse_positive_float(data.get("startSec"), "Start time")
    requested_duration = _parse_duration(data.get("durationSec"))
    overwrite = bool(data.get("overwrite"))
    overwrite_source = bool(data.get("overwriteSource"))

    if not folder:
        return jsonify({"error": "Missing folder"}), 400

    try:
        src_folder = safe_join_fs_root(folder)
        if not src_folder.exists() or not src_folder.is_dir():
            return jsonify({"error": "Source folder does not exist"}), 404

        source_path = src_folder / media_name
        if not source_path.exists() or not source_path.is_file():
            return jsonify({"error": "Source media file not found"}), 404

        if not _is_video_file(source_path):
            return jsonify({"error": "Clip export is only available for video files"}), 400

        metadata = probe_media_metadata(source_path)
        src_w, src_h = _parse_video_resolution(metadata)
        duration_total = float(metadata.get("duration") or 0)
        if duration_total <= 0:
            return jsonify({"error": "Could not determine source video duration"}), 400

        if start_sec >= duration_total:
            return jsonify({"error": "Start time exceeds video duration"}), 400

        max_duration = duration_total - start_sec
        duration_sec = min(requested_duration, max_duration)
        if duration_sec <= 0:
            return jsonify({"error": "Duration must be greater than zero at selected start"}), 400

        crop_rect = _parse_crop_rect(data.get("crop"), src_w, src_h)

        in_src_videos = src_folder.name.lower() == "src_videos"
        if overwrite_source:
            if in_src_videos:
                return jsonify({"error": "Source overwrite is not allowed inside src_videos"}), 400
            output_name = source_path.name
            out_path = source_path
        else:
            # If user is inside src_videos, export to the parent set folder.
            # Otherwise export to the current folder.
            output_name = _normalize_output_name(output_name_raw)
            set_folder = src_folder.parent if in_src_videos else src_folder
            out_path = set_folder / output_name
            if out_path.exists() and not overwrite:
                return jsonify({"error": "Output file already exists", "requiresOverwrite": True, "outputName": output_name}), 409

        signature = _format_signature(source_path, out_path, start_sec, duration_sec, crop_rect)
        now_ts = time.time()
        with _video_clip_lock:
            _prune_tracking(now_ts)
            existing = _video_clip_signatures.get(signature)
            if existing:
                existing_status = str(existing.get("status") or "")
                updated_at = float(existing.get("updatedAt") or now_ts)
                duplicate_window_active = (now_ts - updated_at) <= VIDEO_CLIP_RECENT_DUPLICATE_WINDOW_SEC
                if existing_status in ("queued", "running") or (existing_status == "completed" and duplicate_window_active):
                    return jsonify({
                        "error": "Duplicate clip export ignored",
                        "duplicateRequest": True,
                    }), 409

            job_id = uuid.uuid4().hex[:12]
            _video_clip_jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "createdAt": now_ts,
                "updatedAt": now_ts,
                "sourcePath": str(source_path),
                "outputPath": str(out_path),
                "outputName": output_name,
                "startSec": start_sec,
                "durationSec": duration_sec,
                "crop": crop_rect,
                "signature": signature,
                "overwriteSource": overwrite_source,
            }
            _set_signature_state(signature, "queued")
            _ensure_clip_worker_started()
            _video_clip_queue.put(job_id)

        return jsonify({
            "ok": True,
            "queued": True,
            "jobId": job_id,
            "outputName": output_name,
            "startSec": start_sec,
            "durationSec": duration_sec,
            "crop": crop_rect,
            "resolution": f"{src_w}x{src_h}",
            "overwriteSource": overwrite_source,
        }), 202
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        app_config.debug_print("[video_clip] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
