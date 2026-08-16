import json
import math
import statistics
from pathlib import Path

from flask import jsonify

from . import config as app_config
from .media import update_media_metadata
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .permissions import run_with_directory_repair


PRUNE_CANDIDATES_VERSION = 1
MIN_COHORT_SIZE = 5
MIN_SHORT_EDGE = 256
LOW_RESOLUTION_MEDIAN_RATIO = 0.65
MIN_VIDEO_FRAMES = 16
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
ASPECT_BUCKETS = {
    "square": 1.0,
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
}
ASPECT_TOLERANCE = 0.05


def _positive_number(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _parse_resolution(value):
    text = str(value or "").strip().lower()
    if "x" not in text:
        return None
    left, right = text.split("x", 1)
    width = _positive_number(left)
    height = _positive_number(right)
    if width is None or height is None:
        return None
    return int(round(width)), int(round(height))


def _aspect_bucket(width, height):
    ratio = float(width) / float(height)
    for label, target in ASPECT_BUCKETS.items():
        if abs(ratio - target) < ASPECT_TOLERANCE:
            return label
    return "unknown"


def _load_folder_state(folder_path):
    state_path = Path(folder_path) / ".webcap_state.json"
    if not state_path.exists() or not state_path.is_file():
        return {}
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _context_for(info, rating, flag):
    return {
        "scene_complexity": info.get("scene_complexity") if isinstance(info.get("scene_complexity"), dict) else None,
        "face_focus": info.get("face_focus") if isinstance(info.get("face_focus"), dict) else None,
        "selection_pose": info.get("selection_pose") if isinstance(info.get("selection_pose"), dict) else None,
        "fps": info.get("fps"),
        "duration": info.get("duration"),
        "frames": info.get("frame_count"),
        "bitrate": info.get("bitrate"),
        "codec": info.get("codec"),
        "color_space": info.get("color_space"),
        "rating": rating,
        "flag": flag,
    }


def build_prune_candidates(folder_path, metadata):
    folder = Path(folder_path)
    state = _load_folder_state(folder)
    ratings = state.get("ratings_by_media") if isinstance(state.get("ratings_by_media"), dict) else {}
    flags = state.get("flags") if isinstance(state.get("flags"), dict) else {}
    records = []
    cohorts = {}

    media_files = sorted(
        [
            path for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in MEDIA_ALL_EXTS and not is_transient_media_name(path.name)
        ],
        key=lambda path: path.name.lower(),
    )
    for media_path in media_files:
        info = metadata.get(media_path.name) if isinstance(metadata.get(media_path.name), dict) else {}
        dims = _parse_resolution(info.get("resolution"))
        kind = "video" if media_path.suffix.lower() in VIDEO_EXTS else "image"
        bucket = _aspect_bucket(*dims) if dims else "unknown"
        record = {
            "file": media_path.name,
            "kind": kind,
            "info": info,
            "dims": dims,
            "aspect_bucket": bucket,
            "short_edge": min(dims) if dims else None,
        }
        records.append(record)
        if dims and bucket != "unknown":
            cohorts.setdefault((kind, bucket), []).append(record["short_edge"])

    cohort_medians = {
        key: float(statistics.median(values))
        for key, values in cohorts.items()
        if values
    }
    candidates = []
    for record in records:
        reasons = []
        dims = record["dims"]
        info = record["info"]
        bucket = record["aspect_bucket"]
        short_edge = record["short_edge"]
        cohort_values = cohorts.get((record["kind"], bucket), [])
        cohort_median = cohort_medians.get((record["kind"], bucket))
        cohort_ratio = (float(short_edge) / cohort_median) if short_edge and cohort_median else None

        if not dims:
            reasons.append({
                "code": "missing_resolution",
                "severity": "blocking",
                "message": "Resolution metadata is missing or unreadable.",
            })
        elif bucket == "unknown":
            reasons.append({
                "code": "unsupported_aspect_ratio",
                "severity": "blocking",
                "message": f"Resolution {dims[0]}x{dims[1]} does not match a supported aspect bucket.",
            })

        if record["kind"] == "video":
            frames = _positive_number(info.get("frame_count"))
            if frames is None:
                reasons.append({
                    "code": "missing_video_frames",
                    "severity": "blocking",
                    "message": "Video frame count is missing or unreadable.",
                })
            elif frames < MIN_VIDEO_FRAMES:
                reasons.append({
                    "code": "short_video_frames",
                    "severity": "blocking",
                    "message": f"Video has {int(frames)} frames; at least {MIN_VIDEO_FRAMES} are required for normal bucket statistics.",
                })

        absolute_low = bool(short_edge is not None and short_edge < MIN_SHORT_EDGE)
        relative_low = bool(
            short_edge is not None
            and cohort_median
            and len(cohort_values) >= MIN_COHORT_SIZE
            and cohort_ratio < LOW_RESOLUTION_MEDIAN_RATIO
        )
        if absolute_low or relative_low:
            details = [f"short edge {int(short_edge)} px"]
            if relative_low:
                details.append(f"{round(cohort_ratio * 100):d}% of the {int(round(cohort_median))} px cohort median")
            if absolute_low:
                details.append(f"below the {MIN_SHORT_EDGE} px minimum")
            reasons.append({
                "code": "low_resolution",
                "severity": "outlier",
                "message": "Low resolution: " + "; ".join(details) + ".",
            })

        if not reasons:
            continue
        priority = "blocking" if any(reason["severity"] == "blocking" for reason in reasons) else "outlier"
        candidates.append({
            "file": record["file"],
            "kind": record["kind"],
            "priority": priority,
            "reasons": reasons,
            "metrics": {
                "resolution": f"{dims[0]}x{dims[1]}" if dims else None,
                "aspect_bucket": bucket,
                "short_edge": short_edge,
                "frame_count": info.get("frame_count") if record["kind"] == "video" else None,
                "cohort_size": len(cohort_values),
                "cohort_median_short_edge": cohort_median,
                "cohort_ratio": round(cohort_ratio, 4) if cohort_ratio is not None else None,
                "minimum_short_edge": MIN_SHORT_EDGE,
                "minimum_video_frames": MIN_VIDEO_FRAMES if record["kind"] == "video" else None,
                "relative_low_resolution_ratio": LOW_RESOLUTION_MEDIAN_RATIO,
            },
            "context": _context_for(info, ratings.get(record["file"]), flags.get(record["file"])),
        })

    candidates.sort(key=lambda row: (
        0 if row["priority"] == "blocking" else 1,
        row["metrics"].get("cohort_ratio") if row["metrics"].get("cohort_ratio") is not None else 1.0,
        row["file"].lower(),
    ))
    return {
        "version": PRUNE_CANDIDATES_VERSION,
        "folder": str(folder),
        "population_count": len(records),
        "candidate_count": len(candidates),
        "candidates": candidates,
    }


def prune_candidates_response(rel_path, include_face_focus=False, include_selection_pose=False):
    rel_path = str(rel_path or "").strip()
    if not rel_path:
        return jsonify({"error": "Missing folder argument."}), 400
    try:
        folder_path = app_config.safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        metadata = run_with_directory_repair(
            folder_path,
            lambda: update_media_metadata(
                folder_path,
                include_face_focus=include_face_focus,
                include_selection_pose=include_selection_pose,
            ),
        )
        payload = build_prune_candidates(folder_path, metadata)
        payload["folder"] = rel_path
        return jsonify(payload)
    except Exception as exc:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(exc)}), 500
