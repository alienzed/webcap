import os
import json
import subprocess
from pathlib import Path
from .originals import MEDIA_ALL_EXTS

def get_aspect_ratio(width, height):
    # Simple aspect ratio as string
    from math import gcd
    g = gcd(width, height)
    return f"{width//g}:{height//g}"

def probe_media_metadata(file_path):
    """
    Run ffprobe and extract all relevant metadata for video/image.
    Returns dict with all fields needed for media_metadata.json.
    """
    ext = file_path.suffix.lower()
    result = {
        "size": file_path.stat().st_size,
        "mtime": int(file_path.stat().st_mtime),
    }
    if ext in {'.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogg', '.wmv', '.mpg', '.mpeg'}:
        # Video
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries",
            "stream=width,height,avg_frame_rate,codec_name,pix_fmt,bit_rate",
            "-show_entries", "format=duration",
            "-of", "json",
            str(file_path)
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            info = json.loads(proc.stdout)
            stream = info["streams"][0]
            width = stream["width"]
            height = stream["height"]
            result["resolution"] = f"{width}x{height}"
            result["aspect_ratio"] = get_aspect_ratio(width, height)
            result["fps"] = eval(stream["avg_frame_rate"]) if stream["avg_frame_rate"] != '0/0' else None
            result["codec"] = stream.get("codec_name", "")
            result["color_space"] = stream.get("pix_fmt", "")
            result["bitrate"] = int(stream.get("bit_rate", 0)) // 1000 if stream.get("bit_rate") else None
            # Always estimate frame count if fps and duration are present
            result["frame_count"] = None
            fps = result.get("fps")
            duration = result.get("duration")
            try:
                if fps is not None and duration is not None:
                    result["frame_count"] = int(round(float(fps) * float(duration)))
            except Exception as e:
                result["frame_count_estimate_error"] = str(e)
            result["duration"] = float(info["format"]["duration"])
        except Exception as e:
            result["error"] = str(e)
    elif ext in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}:
        # Image
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            str(file_path)
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            info = json.loads(proc.stdout)
            stream = info["streams"][0]
            width = stream["width"]
            height = stream["height"]
            result["resolution"] = f"{width}x{height}"
            result["aspect_ratio"] = get_aspect_ratio(width, height)
        except Exception as e:
            result["error"] = str(e)
    return result

def update_media_metadata(folder_path):
    """
    Scan all media files, update media_metadata.json with new/changed files.
    """
    folder_path = Path(folder_path)
    metadata_path = folder_path / "media_metadata.json"
    # Load existing metadata
    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    else:
        metadata = {}
    # Scan media files
    for entry in folder_path.iterdir():
        if not entry.is_file() or entry.suffix.lower() not in MEDIA_ALL_EXTS:
            continue
        key = entry.name
        stat = entry.stat()
        mtime = int(stat.st_mtime)
        size = stat.st_size
        cached = metadata.get(key)
        if cached and cached.get("mtime") == mtime and cached.get("size") == size:
            continue  # Up to date
        # Probe and update
        metadata[key] = probe_media_metadata(entry)
    # Remove deleted files
    to_remove = [k for k in metadata if not (folder_path / k).exists()]
    for k in to_remove:
        del metadata[k]
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    return metadata
