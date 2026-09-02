import base64
import hashlib
import json
import math
import subprocess
import threading
import time
from pathlib import Path

from flask import jsonify

from . import config as app_config


VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"}
FRAME_CACHE_MAX_SOURCES = 8

_frame_cache = {}
_frame_cache_lock = threading.Lock()


def _safe_media_name(name):
    value = str(name or "").strip()
    if not value:
        raise RuntimeError("Source media file is required")
    if Path(value).name != value:
        raise RuntimeError("Invalid source media filename")
    return value


def _source_fingerprint(source_path):
    stat = source_path.stat()
    identity = "\0".join((str(source_path.resolve()).lower(), str(stat.st_size), str(stat.st_mtime_ns)))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _read_frame_timestamps(source_path):
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time,pkt_pts_time",
        "-of",
        "json",
        str(source_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("ffprobe frame indexing failed: " + (proc.stderr or proc.stdout or "").strip())
    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("ffprobe frame indexing returned invalid JSON") from exc
    timestamps = []
    for frame in payload.get("frames") or []:
        if not isinstance(frame, dict):
            continue
        value = frame.get("best_effort_timestamp_time", frame.get("pkt_pts_time"))
        try:
            timestamp = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(timestamp):
            continue
        timestamps.append(max(0.0, timestamp))
    if not timestamps:
        raise RuntimeError("ffprobe did not return decoded video frames")
    return timestamps


def _cached_frame_timestamps(source_path):
    fingerprint = _source_fingerprint(source_path)
    with _frame_cache_lock:
        cached = _frame_cache.get(fingerprint)
        if cached:
            cached["usedAt"] = time.monotonic()
            return fingerprint, cached["timestamps"]

    timestamps = _read_frame_timestamps(source_path)
    with _frame_cache_lock:
        _frame_cache[fingerprint] = {"timestamps": timestamps, "usedAt": time.monotonic()}
        if len(_frame_cache) > FRAME_CACHE_MAX_SOURCES:
            stale = sorted(_frame_cache, key=lambda key: _frame_cache[key]["usedAt"])
            for key in stale[:len(_frame_cache) - FRAME_CACHE_MAX_SOURCES]:
                _frame_cache.pop(key, None)
    return fingerprint, timestamps


def _parse_frame_index(value):
    if isinstance(value, bool):
        raise RuntimeError("Frame index must be a non-negative integer")
    try:
        index = int(value)
    except (TypeError, ValueError):
        raise RuntimeError("Frame index must be a non-negative integer")
    if index < 0 or str(index) != str(value).strip():
        raise RuntimeError("Frame index must be a non-negative integer")
    return index


def _parse_approximate_time(value):
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        raise RuntimeError("Approximate time must be a number")
    if not math.isfinite(timestamp) or timestamp < 0:
        raise RuntimeError("Approximate time must be a non-negative finite number")
    return timestamp


def _nearest_frame_at_or_after(timestamps, approximate_time):
    for index, timestamp in enumerate(timestamps):
        if timestamp >= approximate_time:
            return index
    return len(timestamps) - 1


def _extract_frame_png(source_path, frame_index):
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-vf",
        "select=eq(n\\," + str(frame_index) + ")",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        error = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("ffmpeg frame extraction failed: " + error)
    return proc.stdout


def inspect_video_frame(source_path, approximate_time=None, frame_index=None):
    if not source_path.exists() or not source_path.is_file():
        raise RuntimeError("Source media file not found")
    if source_path.suffix.lower() not in VIDEO_EXTS:
        raise RuntimeError("Frame inspection is only available for video files")
    if (approximate_time is None) == (frame_index is None):
        raise RuntimeError("Provide either an approximate time or a frame index")

    fingerprint, timestamps = _cached_frame_timestamps(source_path)
    if frame_index is None:
        index = _nearest_frame_at_or_after(timestamps, _parse_approximate_time(approximate_time))
    else:
        index = _parse_frame_index(frame_index)
    if index >= len(timestamps):
        raise RuntimeError("Frame index is outside the source video")
    preview = _extract_frame_png(source_path, index)
    return {
        "frameIndex": index,
        "timestampSec": timestamps[index],
        "sourceFingerprint": fingerprint,
        "previewDataUrl": "data:image/png;base64," + base64.b64encode(preview).decode("ascii"),
    }


def resolve_exact_start(source_path, frame_index, source_fingerprint):
    expected = str(source_fingerprint or "").strip()
    if not expected:
        raise RuntimeError("Exact frame selection is missing its source fingerprint")
    if _source_fingerprint(source_path) != expected:
        raise RuntimeError("Source media changed after frame inspection. Check the frame again before export.")
    fingerprint, timestamps = _cached_frame_timestamps(source_path)
    index = _parse_frame_index(frame_index)
    if index >= len(timestamps):
        raise RuntimeError("Exact frame selection is outside the current source video")
    return {"frameIndex": index, "timestampSec": timestamps[index], "sourceFingerprint": fingerprint}


def inspect_video_frame_response(data):
    data = data or {}
    folder = str(data.get("folder") or "").strip()
    if not folder:
        return jsonify({"error": "Missing folder"}), 400
    try:
        source_folder = app_config.safe_join_fs_root(folder)
        if not source_folder.exists() or not source_folder.is_dir():
            return jsonify({"error": "Source folder does not exist"}), 404
        source_path = source_folder / _safe_media_name(data.get("fileName") or data.get("media") or "")
        if "frameIndex" in data:
            frame = inspect_video_frame(source_path, frame_index=data.get("frameIndex"))
        else:
            frame = inspect_video_frame(source_path, approximate_time=data.get("approximateTimeSec"))
        return jsonify({"ok": True, "frame": frame})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app_config.debug_print("[video_frame] ERROR:", exc)
        app_config.debug_traceback()
        return jsonify({"error": str(exc)}), 400
