import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .permissions import normalize_path_permissions
from .storyboard_store import load_story, storyboard_root


VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"}


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _story_dir(story_id):
    return storyboard_root() / str(story_id)


def _selection(story):
    result = []
    for scene_id in story.get("sceneOrder") or []:
        scene = (story.get("scenes") or {}).get(scene_id)
        if not isinstance(scene, dict):
            continue
        take_id = str(scene.get("selectedTakeId") or "").strip()
        if take_id:
            result.append({"sceneId": scene_id, "takeId": take_id})
    return result


def _resolve_story_media(story_id, media_path):
    raw = str(media_path or "").strip()
    relative = Path(raw)
    if not raw or relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Storyboard Take media path is invalid.")
    root = _story_dir(story_id).resolve()
    resolved = (root / relative).resolve()
    if resolved != root and root not in resolved.parents:
        raise RuntimeError("Storyboard Take media path escapes its Story folder.")
    if not resolved.is_file():
        raise FileNotFoundError("Selected Take media file does not exist: " + raw)
    return resolved


def selected_sequence(story_id):
    story = load_story(story_id)
    items = []
    for scene_id in story.get("sceneOrder") or []:
        scene = (story.get("scenes") or {}).get(scene_id)
        if not isinstance(scene, dict):
            continue
        take_id = str(scene.get("selectedTakeId") or "").strip()
        if not take_id:
            continue
        take = (scene.get("takes") or {}).get(take_id)
        if not isinstance(take, dict):
            raise RuntimeError("Selected Take does not exist for Scene: " + str(scene.get("title") or scene_id))
        source = _resolve_story_media(story_id, take.get("mediaPath"))
        if source.suffix.lower() not in VIDEO_EXTS:
            raise RuntimeError(
                "Selected sequence export currently supports video Takes only. "
                "Scene '" + str(scene.get("title") or scene_id) + "' has a non-video selected Take."
            )
        items.append({
            "sceneId": scene_id,
            "sceneTitle": str(scene.get("title") or ""),
            "takeId": take_id,
            "mediaPath": str(take.get("mediaPath") or "").replace("\\", "/"),
            "sourcePath": source,
        })
    if not items:
        raise ValueError("Select at least one video Take before exporting the sequence.")
    return story, items


def _probe_stream_signature(path):
    command = [
        "ffprobe",
        "-v", "error",
        "-show_entries",
        "stream=codec_type,codec_name,codec_tag_string,width,height,pix_fmt,r_frame_rate,time_base,sample_fmt,sample_rate,channels,channel_layout",
        "-of", "json",
        str(path),
    ]
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("ffprobe failed for selected Take: " + (proc.stderr or proc.stdout or "").strip())
    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("ffprobe returned invalid JSON for selected Take.") from exc
    streams = payload.get("streams") if isinstance(payload, dict) else None
    if not isinstance(streams, list) or not streams:
        raise RuntimeError("Selected Take has no readable media streams.")
    return [
        {
            key: stream.get(key)
            for key in (
                "codec_type", "codec_name", "codec_tag_string",
                "width", "height", "pix_fmt", "r_frame_rate", "time_base",
                "sample_fmt", "sample_rate", "channels", "channel_layout",
            )
            if stream.get(key) is not None
        }
        for stream in streams
        if isinstance(stream, dict) and stream.get("codec_type") in {"video", "audio"}
    ]



def _stream_of_type(signature, stream_type):
    return next(
        (stream for stream in signature if stream.get("codec_type") == stream_type),
        None,
    )


def _signature_key(signature):
    return json.dumps(signature, sort_keys=True, separators=(",", ":"))


def _stream_differences(signature, baseline):
    differences = []
    video = _stream_of_type(signature, "video")
    expected_video = _stream_of_type(baseline, "video")
    audio = _stream_of_type(signature, "audio")
    expected_audio = _stream_of_type(baseline, "audio")

    if video and expected_video:
        actual_resolution = (video.get("width"), video.get("height"))
        expected_resolution = (expected_video.get("width"), expected_video.get("height"))
        if actual_resolution != expected_resolution:
            differences.append(
                "resolution "
                + str(actual_resolution[0]) + "x" + str(actual_resolution[1])
                + " (expected "
                + str(expected_resolution[0]) + "x" + str(expected_resolution[1]) + ")"
            )
        for key, label in (
            ("codec_name", "video codec"),
            ("pix_fmt", "pixel format"),
            ("r_frame_rate", "frame rate"),
            ("time_base", "time base"),
        ):
            if video.get(key) != expected_video.get(key):
                differences.append(
                    label + " " + str(video.get(key) or "none")
                    + " (expected " + str(expected_video.get(key) or "none") + ")"
                )
    elif video != expected_video:
        differences.append("video stream presence differs")

    if bool(audio) != bool(expected_audio):
        differences.append("audio stream " + ("present" if audio else "missing")
                           + " (expected " + ("present" if expected_audio else "none") + ")")
    elif audio and expected_audio:
        for key, label in (
            ("codec_name", "audio codec"),
            ("sample_rate", "audio sample rate"),
            ("channels", "audio channels"),
            ("channel_layout", "audio layout"),
        ):
            if audio.get(key) != expected_audio.get(key):
                differences.append(
                    label + " " + str(audio.get(key) or "none")
                    + " (expected " + str(expected_audio.get(key) or "none") + ")"
                )

    if signature != baseline and not differences:
        differences.append("media stream parameters differ")
    return differences


def _analyze_streams(items):
    signatures = [_probe_stream_signature(item["sourcePath"]) for item in items]
    keys = [_signature_key(signature) for signature in signatures]
    counts = {key: keys.count(key) for key in set(keys)}
    baseline_index = max(range(len(keys)), key=lambda index: (counts[keys[index]], -index))
    baseline = signatures[baseline_index]
    warnings = []
    for item, signature in zip(items, signatures):
        if signature == baseline:
            continue
        warnings.append({
            "sceneId": item["sceneId"],
            "sceneTitle": item["sceneTitle"],
            "takeId": item["takeId"],
            "mediaPath": item["mediaPath"],
            "differences": _stream_differences(signature, baseline),
        })
    return {
        "requiresEncoding": bool(warnings),
        "baseline": baseline,
        "signatures": signatures,
        "warnings": warnings,
    }


def _normalize_clip(source, source_signature, baseline, destination):
    target_video = _stream_of_type(baseline, "video")
    if not target_video or not target_video.get("width") or not target_video.get("height"):
        raise RuntimeError("Selected Takes do not expose a usable video resolution for encoding.")

    width = int(target_video["width"])
    height = int(target_video["height"])
    frame_rate = str(target_video.get("r_frame_rate") or "").strip()
    video_filter = (
        "scale=" + str(width) + ":" + str(height)
        + ":force_original_aspect_ratio=decrease,"
        + "pad=" + str(width) + ":" + str(height) + ":(ow-iw)/2:(oh-ih)/2,"
        + "setsar=1"
    )
    if frame_rate and frame_rate != "0/0":
        video_filter += ",fps=" + frame_rate

    target_audio = _stream_of_type(baseline, "audio")
    source_audio = _stream_of_type(source_signature, "audio")
    command = ["ffmpeg", "-y", "-i", str(source)]
    synthetic_audio = False

    if target_audio and not source_audio:
        sample_rate = str(target_audio.get("sample_rate") or "48000")
        channels = int(target_audio.get("channels") or 2)
        layout = str(target_audio.get("channel_layout") or ("mono" if channels == 1 else "stereo"))
        command.extend([
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=" + layout + ":sample_rate=" + sample_rate,
        ])
        synthetic_audio = True

    command.extend([
        "-map", "0:v:0",
        "-vf", video_filter,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-preset", "medium",
    ])

    if target_audio:
        command.extend(["-map", "1:a:0" if synthetic_audio else "0:a:0"])
        command.extend([
            "-c:a", "aac",
            "-ar", str(target_audio.get("sample_rate") or "48000"),
            "-ac", str(target_audio.get("channels") or 2),
        ])
        if synthetic_audio:
            command.append("-shortest")
    else:
        command.append("-an")

    command.extend(["-movflags", "+faststart", str(destination)])
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg Take encoding failed: " + (proc.stderr or proc.stdout or "").strip())


def _ffconcat_quote(path):
    return str(path).replace("'", "'\\''")


def _write_json_atomic(path, payload):
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _assemble(story_id, items, *, analysis=None, encode=False):
    analysis = analysis or _analyze_streams(items)
    if analysis["requiresEncoding"] and not encode:
        raise RuntimeError("Selected Takes require encoding before they can be assembled.")

    export_dir = _story_dir(story_id) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / "selected-sequence.mp4"

    normalized_dir = None
    sources = [item["sourcePath"] for item in items]
    if analysis["requiresEncoding"]:
        normalized_dir = tempfile.TemporaryDirectory(prefix=".selected-sequence-normalized-", dir=str(export_dir))
        normalized_root = Path(normalized_dir.name)
        sources = []
        for index, (item, signature) in enumerate(zip(items, analysis["signatures"])):
            normalized = normalized_root / ("clip-" + str(index).zfill(3) + ".mp4")
            _normalize_clip(item["sourcePath"], signature, analysis["baseline"], normalized)
            sources.append(normalized)

    list_fd, list_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".ffconcat", dir=str(export_dir))
    out_fd, out_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".mp4", dir=str(export_dir))
    os.close(out_fd)
    list_path = Path(list_name)
    temp_output = Path(out_name)
    try:
        with os.fdopen(list_fd, "w", encoding="utf-8") as handle:
            handle.write("ffconcat version 1.0\n")
            for source in sources:
                handle.write("file '" + _ffconcat_quote(source) + "'\n")

        command = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-map", "0:v:0",
            "-map", "0:a?",
            "-c", "copy",
            "-movflags", "+faststart",
            str(temp_output),
        ]
        proc = subprocess.run(command, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg sequence export failed: " + (proc.stderr or proc.stdout or "").strip())
        os.replace(temp_output, destination)
        normalize_path_permissions(destination)

        selection = [
            {"sceneId": item["sceneId"], "takeId": item["takeId"]}
            for item in items
        ]
        manifest = {
            "version": 1,
            "storyId": story_id,
            "createdAt": _utc_now(),
            "output": "exports/selected-sequence.mp4",
            "selection": selection,
            "encoded": bool(analysis["requiresEncoding"]),
            "items": [
                {
                    "sceneId": item["sceneId"],
                    "sceneTitle": item["sceneTitle"],
                    "takeId": item["takeId"],
                    "mediaPath": item["mediaPath"],
                }
                for item in items
            ],
        }
        manifest_path = export_dir / "selected-sequence.json"
        _write_json_atomic(manifest_path, manifest)
        normalize_path_permissions(manifest_path)
        return {
            "storyId": story_id,
            "media": "selected-sequence.mp4",
            "mediaPath": "exports/selected-sequence.mp4",
            "manifest": "exports/selected-sequence.json",
            "createdAt": manifest["createdAt"],
            "itemCount": len(items),
            "selection": selection,
            "encoded": manifest["encoded"],
            "current": True,
        }
    finally:
        try:
            if list_path.exists():
                list_path.unlink()
        except OSError:
            pass
        try:
            if temp_output.exists():
                temp_output.unlink()
        except OSError:
            pass
        if normalized_dir is not None:
            normalized_dir.cleanup()


def export_selected_sequence(story_id, *, encode=False):
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")
    _story, items = selected_sequence(story_id)
    analysis = _analyze_streams(items)
    if analysis["requiresEncoding"] and not encode:
        return {
            "requiresEncoding": True,
            "warnings": analysis["warnings"],
        }
    return _assemble(story_id, items, analysis=analysis, encode=encode)


def current_export(story_id):
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")

    story = load_story(story_id)
    export_dir = _story_dir(story_id) / "exports"
    media_path = export_dir / "selected-sequence.mp4"
    manifest_path = export_dir / "selected-sequence.json"
    if not media_path.exists() and not manifest_path.exists():
        return None
    if not media_path.is_file() or not manifest_path.is_file():
        raise RuntimeError("Storyboard sequence export is incomplete; expected both MP4 and manifest.")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Storyboard sequence export manifest is unreadable.") from exc
    if not isinstance(manifest, dict) or manifest.get("storyId") != story_id:
        raise RuntimeError("Storyboard sequence export manifest does not match this Story.")

    selection = manifest.get("selection")
    if not isinstance(selection, list):
        selection = [
            {"sceneId": item.get("sceneId"), "takeId": item.get("takeId")}
            for item in manifest.get("items") or []
            if isinstance(item, dict)
        ]
    return {
        "storyId": story_id,
        "media": "selected-sequence.mp4",
        "mediaPath": "exports/selected-sequence.mp4",
        "manifest": "exports/selected-sequence.json",
        "createdAt": str(manifest.get("createdAt") or ""),
        "itemCount": len(selection),
        "selection": selection,
        "current": selection == _selection(story),
    }
