import math
import subprocess
from pathlib import Path

from flask import jsonify

from .config import FS_DEBUG, safe_join_fs_root
from .media import probe_media_metadata

VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"}


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


def clip_video_response(data):
    data = data or {}
    folder = str(data.get("folder") or "").strip()
    media_name = _safe_media_name(data.get("fileName") or data.get("media") or "")
    output_name = _normalize_output_name(data.get("outputName") or "")
    start_sec = _parse_positive_float(data.get("startSec"), "Start time")
    requested_duration = _parse_duration(data.get("durationSec"))
    overwrite = bool(data.get("overwrite"))

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

        # If user is inside src_videos, export to the parent set folder.
        # Otherwise export to the current folder.
        set_folder = src_folder.parent if src_folder.name.lower() == "src_videos" else src_folder
        out_path = set_folder / output_name
        if out_path.exists() and not overwrite:
            return jsonify({"error": "Output file already exists", "requiresOverwrite": True, "outputName": output_name}), 409

        _run_clip_ffmpeg(source_path, out_path, start_sec, duration_sec, crop_rect)

        return jsonify({
            "ok": True,
            "outputName": output_name,
            "startSec": start_sec,
            "durationSec": duration_sec,
            "crop": crop_rect,
            "resolution": f"{src_w}x{src_h}",
        })
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if FS_DEBUG:
            import traceback
            print("[video_clip] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
