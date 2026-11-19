"""Bounded, local no-reference detail measurements for Media Explorer.

This is NOT an aesthetic or perceptual video-quality grade. The relative fine-to-
coarse detail signal helps find suspiciously soft footage even at high resolution.
An almost textureless frame is unmeasurable, not automatically a poor frame.
"""
import math
import statistics
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

QUALITY_VERSION = 1
MAX_SIDE = 1024
MAX_SAMPLES = 8


def current_quality(meta):
    """Only normalized, versioned evidence may drive Explorer ordering."""
    if not isinstance(meta, dict):
        return False
    block = meta.get("quality")
    return (isinstance(block, dict)
            and block.get("version") == QUALITY_VERSION
            and block.get("method") == "multiscale-detail"
            and isinstance(block.get("sampleCount"), int)
            and 1 <= block["sampleCount"] <= MAX_SAMPLES
            and (block.get("detailSignal") is None
                 or (isinstance(block.get("detailSignal"), (float, int))
                     and math.isfinite(block["detailSignal"]))))


def _size(width, height):
    if width <= 0 or height <= 0:
        raise ValueError("Missing source dimensions for detail analysis.")
    factor = min(1.0, MAX_SIDE / max(width, height))
    return max(1, round(width * factor)), max(1, round(height * factor))


def _signal(frame):
    """Multiscale detail ratio, not a comparison against an invented quality target."""
    gray = frame.convert("L")
    # Suppress pixel noise before comparing fine and broad image structure.
    smooth = gray.filter(ImageFilter.GaussianBlur(0.6))
    contrast = ImageStat.Stat(smooth).stddev[0]
    fine = ImageStat.Stat(ImageChops.difference(
        smooth, smooth.filter(ImageFilter.GaussianBlur(1.2)))).mean[0]
    broad = ImageStat.Stat(ImageChops.difference(
        smooth, smooth.filter(ImageFilter.GaussianBlur(3.0)))).mean[0]
    # Flat scenes, fades and near-black frames cannot establish sharpness.
    if contrast < 9.0 or broad < 1.2:
        return None
    return round(100.0 * fine / broad, 2)


def _video_frame(path, when, width, height):
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
               "-threads", "2", "-ss", format(when, ".3f"), "-i", str(path),
               "-map", "0:v:0", "-frames:v", "1",
               "-vf", f"scale={width}:{height}:flags=area,format=gray",
               "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
    proc = subprocess.run(command, capture_output=True, timeout=35)
    if proc.returncode or len(proc.stdout) != width * height:
        error = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError("Could not decode sampled video frame at "
                           + format(when, ".3f") + "s: " + (error or "incomplete frame"))
    return Image.frombytes("L", (width, height), proc.stdout)


def analyze_media_quality(path, metadata, *, cancel=None):
    """Read only source frames; caller owns caching, source freshness and cancellation."""
    path = Path(path)
    resolution = str(metadata.get("resolution") or "")
    try:
        original_width, original_height = (int(value) for value in resolution.split("x"))
    except (ValueError, TypeError) as exc:
        raise ValueError("Technical metadata must include dimensions before quality analysis.") from exc
    width, height = _size(original_width, original_height)
    video = path.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv", ".avi",
                                     ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
    samples = []
    failures = []
    if video:
        duration = float(metadata.get("duration") or 0)
        if not math.isfinite(duration) or duration < 0:
            raise ValueError("Invalid video duration for detail analysis.")
        # Seek at evenly distributed positions; do not decode entire long clips.
        # Unknown durations can only be sampled at the start.
        count = min(MAX_SAMPLES, 6 if duration <= 3 else 8) if duration else 1
        times = [duration * (index + 0.5) / count for index in range(count)] if duration else [0.0]
        for when in times:
            if cancel is not None and cancel.is_set():
                raise InterruptedError("Quality analysis stopped.")
            try:
                frame = _video_frame(path, when, width, height)
                samples.append({"seconds": round(when, 3), "detailSignal": _signal(frame)})
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                failures.append(str(exc))
    else:
        if cancel is not None and cancel.is_set():
            raise InterruptedError("Quality analysis stopped.")
        with Image.open(path) as source:
            source.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
            samples.append({"seconds": 0, "detailSignal": _signal(source)})
    if not samples:
        raise RuntimeError("All sampled frames failed to decode: "
                           + (failures[0] if failures else "no video frames"))
    valid = [sample["detailSignal"] for sample in samples if sample["detailSignal"] is not None]
    return {"version": QUALITY_VERSION, "method": "multiscale-detail",
            "detailSignal": round(statistics.median(valid), 2) if valid else None,
            "minimumDetail": min(valid) if valid else None,
            "maximumDetail": max(valid) if valid else None,
            "sampleCount": len(samples), "measurableCount": len(valid),
            "failedSamples": len(failures), "samples": samples}
