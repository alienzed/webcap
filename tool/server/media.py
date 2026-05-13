import json
import os
import shutil
import subprocess
import traceback
from pathlib import Path

from flask import jsonify

from .config import FS_DEBUG, safe_join_fs_root
from .crop_ops import crop_image_in_place
from .originals import MEDIA_ALL_EXTS, restore_original_media, restore_original_media_video_only


def get_aspect_ratio(width, height):
    from math import gcd

    g = gcd(width, height)
    return f"{width//g}:{height//g}"


def probe_media_metadata(file_path):
    ext = file_path.suffix.lower()
    result = {
        "size": file_path.stat().st_size,
        "mtime": int(file_path.stat().st_mtime),
    }
    if ext in {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=width,height,avg_frame_rate,codec_name,pix_fmt,bit_rate,nb_frames,nb_read_frames",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(file_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            info = json.loads(proc.stdout)
            stream = info["streams"][0]
            width = stream["width"]
            height = stream["height"]
            result["resolution"] = f"{width}x{height}"
            result["aspect_ratio"] = get_aspect_ratio(width, height)
            result["fps"] = eval(stream["avg_frame_rate"]) if stream["avg_frame_rate"] != "0/0" else None
            result["codec"] = stream.get("codec_name", "")
            result["color_space"] = stream.get("pix_fmt", "")
            result["bitrate"] = int(stream.get("bit_rate", 0)) // 1000 if stream.get("bit_rate") else None
            result["duration"] = float(info["format"]["duration"])
            fps = result.get("fps")
            duration = result.get("duration")
            frame_count = None
            if stream:
                frame_count = stream.get("nb_read_frames") or stream.get("nb_frames")
            if frame_count not in (None, "", "N/A"):
                try:
                    result["frame_count"] = int(frame_count)
                except Exception:
                    result["frame_count"] = None
            else:
                result["frame_count"] = None
            if result["frame_count"] is None and fps is not None and duration is not None:
                try:
                    result["frame_count"] = int(round(float(fps) * float(duration)))
                except Exception as e:
                    result["frame_count_estimate_error"] = str(e)
        except Exception as e:
            result["error"] = str(e)
    elif ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(file_path),
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
    folder_path = Path(folder_path)
    metadata_path = folder_path / "media_metadata.json"
    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    else:
        metadata = {}
    for entry in folder_path.iterdir():
        if not entry.is_file() or entry.suffix.lower() not in MEDIA_ALL_EXTS:
            continue
        key = entry.name
        stat = entry.stat()
        mtime = int(stat.st_mtime)
        size = stat.st_size
        cached = metadata.get(key)
        if cached and cached.get("mtime") == mtime and cached.get("size") == size:
            continue
        metadata[key] = probe_media_metadata(entry)
    to_remove = [k for k in metadata if not (folder_path / k).exists()]
    for k in to_remove:
        del metadata[k]
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    return metadata


def media_restore_response(data):
    data = data or {}
    print("[caption_restore] Incoming data:", data)
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        print("[caption_restore] Missing required parameters:", folder, file_name)
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        result = restore_original_media(folder_path, file_name)
        if result == "not_found":
            return jsonify({"error": "Original media not found in originals"}), 404
        if result == "exists":
            return jsonify({"error": "Media file already exists in set; restore will not overwrite."}), 409
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_restore] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def media_reset_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        ok = restore_original_media_video_only(folder_path, file_name)
        if not ok:
            return jsonify({"error": "Original media not found in originals"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_reset] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def media_crop_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = (data.get("fileName") or data.get("media") or "").strip()
    if not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        result = crop_image_in_place(folder_path, file_name, data.get("crop"))
        # Keep cached media_metadata.json in sync immediately after in-place crop.
        update_media_metadata(folder_path)
        return jsonify({"ok": True, **result})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        if FS_DEBUG:
            print("[media_crop] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def media_prune_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = data.get("media", "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        originals_path = folder_path / "originals"
        originals_path.mkdir(exist_ok=True)
        src_media = folder_path / file_name
        if not src_media.exists() or not src_media.is_file():
            return jsonify({"error": "Media file not found"}), 404

        def find_unique_pruned_name(base_name, ext, originals_path):
            candidate = originals_path / (f"pruned_{base_name}{ext}")
            if not candidate.exists():
                return candidate.name
            i = 1
            while True:
                candidate = originals_path / (f"pruned_{base_name}-{i}{ext}")
                if not candidate.exists():
                    return candidate.name
                i += 1

        base = Path(file_name).stem
        ext = Path(file_name).suffix
        dst_media_name = find_unique_pruned_name(base, ext, originals_path)
        dst_media = originals_path / dst_media_name

        if dst_media.exists():
            raise Exception(f"Destination already exists: {dst_media}")
        shutil.move(str(src_media), str(dst_media))

        src_caption = folder_path / (Path(file_name).stem + ".txt")
        dst_caption = originals_path / (Path(dst_media_name).stem + ".txt")
        if src_caption.exists():
            with open(src_caption, "r", encoding="utf-8") as fsrc, open(dst_caption, "w", encoding="utf-8") as fdst:
                fdst.write(fsrc.read())
            try:
                os.chmod(dst_caption, 0o644)
            except Exception:
                pass
            src_caption.unlink()

        return jsonify({"ok": True})
    except Exception as e:
        if FS_DEBUG:
            print("[caption_prune] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400


def media_metadata_response(rel_path):
    rel_path = (rel_path or "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        metadata_dict = update_media_metadata(folder_path)
        metadata_list = []
        for filename, info in metadata_dict.items():
            record = {
                "file": filename,
                "resolution": info.get("resolution", "-"),
                "fps": f"{info['fps']:.2f}" if info.get("fps") else "-",
                "aspect": info.get("aspect_ratio", "-"),
                "size": f"{info['size'] / (1024*1024):.2f} MB" if info.get("size") else "-",
                "bitrate": f"{info['bitrate']} kbps" if info.get("bitrate") else "-",
                "codec": info.get("codec", "-"),
                "color": info.get("color_space", "-"),
                "duration": f"{info['duration']:.2f}s" if info.get("duration") else "-",
                "frames": info.get("frame_count", "-"),
            }
            metadata_list.append(record)
        return jsonify(metadata_list)
    except Exception as e:
        if FS_DEBUG:
            print("[fs_media_metadata] ERROR:", e)
            traceback.print_exc()
        return jsonify({"error": str(e)}), 400
