import json
import os
import shutil
import subprocess
import traceback
from pathlib import Path

from flask import jsonify

from . import config as app_config
from .crop_ops import crop_image_data_url_in_place, crop_image_in_place, transform_image_in_place
from .face_focus import FACE_FOCUS_VERSION, analyze_image_face_focus, get_face_focus_detector, is_face_focus_image
from .originals import MEDIA_ALL_EXTS, is_transient_media_name, restore_original_media, restore_original_media_video_only
from .permissions import normalize_path_permissions, run_with_directory_repair
from .scene_complexity import SCENE_COMPLEXITY_METHOD, SCENE_COMPLEXITY_VERSION, analyze_image_scene_complexity, is_scene_complexity_image
from .selection_pose import SELECTION_POSE_VERSION, analyze_image_selection_pose, get_selection_pose_analyzers, is_selection_pose_image

safe_join_fs_root = app_config.safe_join_fs_root


def media_flip_horizontal_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = (data.get("fileName") or data.get("media") or "").strip()
    if not folder or not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        src_media = folder_path / file_name
        if not src_media.exists() or not src_media.is_file():
            return jsonify({"error": "Media file not found"}), 404
        ext = src_media.suffix.lower()
        if ext not in {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}:
            return jsonify({"error": "Flip is only available for video files"}), 400
        # Write to temp file, then replace original
        tmp_path = src_media.with_suffix(src_media.suffix + ".tmp")
        cmd = [
            "ffmpeg", "-y", "-i", str(src_media),
            "-vf", "hflip",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-an",
            str(tmp_path)
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            stderr = (proc.stderr or proc.stdout or "").strip()
            if tmp_path.exists():
                try: tmp_path.unlink()
                except Exception: pass
            return jsonify({"error": "ffmpeg failed: " + stderr}), 400
        # Atomically replace original
        try:
            os.replace(tmp_path, src_media)
            normalize_path_permissions(src_media)
        except Exception as e:
            if tmp_path.exists():
                try: tmp_path.unlink()
                except Exception: pass
            return jsonify({"error": "Failed to replace original: " + str(e)}), 500
        update_media_metadata(folder_path)
        return jsonify({"ok": True})
    except Exception as e:
        app_config.debug_print("[media_flip_horizontal] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def get_aspect_ratio(width, height):
    from math import gcd

    g = gcd(width, height)
    return f"{width//g}:{height//g}"


def probe_media_metadata(file_path, face_detector=None, selection_pose_analyzers=None):
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
            if frame_count not in (None, "", "n/a"):
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
        if is_scene_complexity_image(file_path):
            try:
                result["scene_complexity"] = analyze_image_scene_complexity(file_path)
            except Exception as e:
                result["scene_complexity"] = {
                    "bucket": "unknown",
                    "score": 0.0,
                    "method": SCENE_COMPLEXITY_METHOD,
                    "version": SCENE_COMPLEXITY_VERSION,
                    "error": str(e),
                }
        if face_detector is not None and is_face_focus_image(file_path):
            try:
                result["face_focus"] = analyze_image_face_focus(file_path, face_detector)
            except Exception as e:
                result["face_focus"] = {
                    "bucket": "unknown",
                    "face_count": 0,
                    "error": str(e),
                }
        if selection_pose_analyzers is not None and is_selection_pose_image(file_path):
            try:
                result["selection_pose"] = analyze_image_selection_pose(file_path, selection_pose_analyzers)
            except Exception as e:
                result["selection_pose"] = {
                    "version": SELECTION_POSE_VERSION,
                    "face_direction": "unknown",
                    "expression_primary": "unknown",
                    "expressions": [],
                    "body_orientation": "unknown",
                    "pose_class": "unknown",
                    "arm_position": "unknown",
                    "error": str(e),
                }
    return result


def write_media_metadata_file(metadata_path, metadata):
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    normalize_path_permissions(metadata_path)


def update_media_metadata(folder_path, include_face_focus=False, include_selection_pose=False, scoped_filenames=None):
    folder_path = Path(folder_path)
    metadata_path = folder_path / "media_metadata.json"
    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    else:
        metadata = {}
    face_detector = None
    selection_pose_analyzers = None
    pending_entries = []
    scoped_filename_set = None
    if scoped_filenames:
        scoped_filename_set = {str(name or "").strip() for name in scoped_filenames if str(name or "").strip()}
    for entry in folder_path.iterdir():
        if not entry.is_file() or entry.suffix.lower() not in MEDIA_ALL_EXTS or is_transient_media_name(entry.name):
            continue
        if scoped_filename_set is not None and entry.name not in scoped_filename_set:
            continue
        key = entry.name
        stat = entry.stat()
        mtime = int(stat.st_mtime)
        size = stat.st_size
        cached = metadata.get(key)
        cached_face_focus = cached.get("face_focus") if isinstance(cached, dict) else None
        cached_has_current_face_focus = (
            isinstance(cached_face_focus, dict)
            and cached_face_focus.get("version") == FACE_FOCUS_VERSION
        )
        cached_selection_pose = cached.get("selection_pose") if isinstance(cached, dict) else None
        cached_has_current_selection_pose = (
            isinstance(cached_selection_pose, dict)
            and cached_selection_pose.get("version") == SELECTION_POSE_VERSION
        )
        cached_scene_complexity = cached.get("scene_complexity") if isinstance(cached, dict) else None
        cached_has_current_scene_complexity = (
            isinstance(cached_scene_complexity, dict)
            and cached_scene_complexity.get("version") == SCENE_COMPLEXITY_VERSION
        )
        needs_face_focus = bool(include_face_focus) and is_face_focus_image(entry) and not cached_has_current_face_focus
        needs_selection_pose = bool(include_selection_pose) and is_selection_pose_image(entry) and not cached_has_current_selection_pose
        needs_scene_complexity = is_scene_complexity_image(entry) and not cached_has_current_scene_complexity
        if cached and cached.get("mtime") == mtime and cached.get("size") == size and not needs_face_focus and not needs_selection_pose and not needs_scene_complexity:
            continue
        pending_entries.append(entry)
    if include_face_focus and any(is_face_focus_image(entry) for entry in pending_entries):
        face_detector = get_face_focus_detector()
    if include_selection_pose and any(is_selection_pose_image(entry) for entry in pending_entries):
        selection_pose_analyzers = get_selection_pose_analyzers()
    for entry in pending_entries:
        metadata[entry.name] = probe_media_metadata(entry, face_detector, selection_pose_analyzers)
        if (include_face_focus and is_face_focus_image(entry)) or (include_selection_pose and is_selection_pose_image(entry)):
            write_media_metadata_file(metadata_path, metadata)
    to_remove = [k for k in metadata if not (folder_path / k).exists() or is_transient_media_name(k)]
    for k in to_remove:
        del metadata[k]
    write_media_metadata_file(metadata_path, metadata)
    return metadata


def media_restore_response(data):
    data = data or {}
    app_config.debug_print("[caption_restore] Incoming data:", data)
    folder = data.get("folder", "").strip()
    file_name = data.get("fileName", "").strip()
    if not folder or not file_name:
        app_config.debug_print("[caption_restore] Missing required parameters:", folder, file_name)
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
        app_config.debug_print("[caption_restore] ERROR:", e)
        app_config.debug_traceback()
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
        app_config.debug_print("[caption_reset] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def media_crop_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = (data.get("fileName") or data.get("media") or "").strip()
    if not file_name:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        image_data_url = data.get("imageDataUrl")
        if image_data_url:
            result = crop_image_data_url_in_place(folder_path, file_name, image_data_url)
        else:
            result = crop_image_in_place(folder_path, file_name, data.get("crop"))
        # Keep cached media_metadata.json in sync immediately after in-place crop.
        update_media_metadata(folder_path)
        return jsonify({"ok": True, **result})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        app_config.debug_print("[media_crop] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def media_image_transform_response(data):
    data = data or {}
    folder = data.get("folder", "").strip()
    file_name = (data.get("fileName") or data.get("media") or "").strip()
    operation = data.get("operation")
    if not file_name or not operation:
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        result = transform_image_in_place(folder_path, file_name, operation)
        update_media_metadata(folder_path)
        return jsonify({"ok": True, **result})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        app_config.debug_print("[media_image_transform] ERROR:", e)
        app_config.debug_traceback()
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
        normalize_path_permissions(originals_path)
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
        normalize_path_permissions(dst_media)

        src_caption = folder_path / (Path(file_name).stem + ".txt")
        dst_caption = originals_path / (Path(dst_media_name).stem + ".txt")
        if src_caption.exists():
            with open(src_caption, "r", encoding="utf-8") as fsrc, open(dst_caption, "w", encoding="utf-8") as fdst:
                fdst.write(fsrc.read())
            normalize_path_permissions(dst_caption)
            src_caption.unlink()

        return jsonify({"ok": True})
    except Exception as e:
        app_config.debug_print("[caption_prune] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def media_metadata_response(rel_path, include_face_focus=False, include_selection_pose=False, scoped_filenames=None):
    rel_path = (rel_path or "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        metadata_dict = run_with_directory_repair(
            folder_path,
            lambda: update_media_metadata(
                folder_path,
                include_face_focus=include_face_focus,
                include_selection_pose=include_selection_pose,
                scoped_filenames=scoped_filenames,
            ),
        )
        app_config.debug_print(f"[metadata] generated for folder: {rel_path or '.'}")
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
            face_focus = info.get("face_focus") if isinstance(info.get("face_focus"), dict) else None
            if face_focus:
                record["face_focus"] = face_focus
                record["face_focus_bucket"] = face_focus.get("bucket", "unknown")
                record["face_count"] = face_focus.get("face_count", 0)
                record["largest_face_height_pct"] = face_focus.get("largest_height_pct")
                record["largest_face_area_pct"] = face_focus.get("largest_area_pct")
                record["largest_face_score"] = face_focus.get("largest_score")
            selection_pose = info.get("selection_pose") if isinstance(info.get("selection_pose"), dict) else None
            if selection_pose:
                record["selection_pose"] = selection_pose
                record["selection_pose_face_direction"] = selection_pose.get("face_direction", "unknown")
                record["selection_pose_expression_primary"] = selection_pose.get("expression_primary", "unknown")
                record["selection_pose_expressions"] = list(selection_pose.get("expressions", []) or [])
                record["selection_pose_body_orientation"] = selection_pose.get("body_orientation", "unknown")
                record["selection_pose_pose_class"] = selection_pose.get("pose_class", "unknown")
                record["selection_pose_arm_position"] = selection_pose.get("arm_position", "unknown")
            scene_complexity = info.get("scene_complexity") if isinstance(info.get("scene_complexity"), dict) else None
            if scene_complexity:
                score = scene_complexity.get("score")
                record["scene_complexity"] = scene_complexity
                record["scene_complexity_bucket"] = scene_complexity.get("bucket", "unknown")
                record["scene_complexity_score"] = score
                if isinstance(score, (int, float)):
                    record["scene_complexity_label"] = f"{scene_complexity.get('bucket', 'unknown').title()} ({round(float(score) * 100):d}%)"
                else:
                    record["scene_complexity_label"] = str(scene_complexity.get("bucket", "unknown")).title()
                record["scene"] = record["scene_complexity_label"]
            metadata_list.append(record)
        return jsonify(metadata_list)
    except Exception as e:
        app_config.debug_print("[fs_media_metadata] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
