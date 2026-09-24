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


def _video_stream(signature):
    for stream in signature or []:
        if isinstance(stream, dict) and stream.get("codec_type") == "video":
            return stream
    return None


def _has_audio(signature):
    return any(
        isinstance(stream, dict) and stream.get("codec_type") == "audio"
        for stream in signature or []
    )


def _preview_target(signatures):
    first_video = _video_stream(signatures[0]) if signatures else None
    if not first_video:
        raise RuntimeError("Selected Take has no readable video stream.")
    width = int(first_video.get("width") or 0)
    height = int(first_video.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("Selected Take video dimensions are unavailable.")
    width -= width % 2
    height -= height % 2
    if width <= 0 or height <= 0:
        raise RuntimeError("Selected Take video dimensions are invalid.")
    frame_rate = str(first_video.get("r_frame_rate") or "30/1").strip()
    if not frame_rate or frame_rate == "0/0":
        frame_rate = "30/1"
    return width, height, frame_rate


def _normalize_preview_clip(source_path, destination, width, height, frame_rate, include_audio):
    video_filter = (
        "scale=" + str(width) + ":" + str(height) + ":force_original_aspect_ratio=decrease,"
        "pad=" + str(width) + ":" + str(height) + ":(ow-iw)/2:(oh-ih)/2,"
        "setsar=1,fps=" + frame_rate + ",format=yuv420p"
    )
    command = [
        "ffmpeg",
        "-y",
        "-i", str(source_path),
        "-map", "0:v:0",
        "-vf", video_filter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
    ]
    if include_audio:
        command.extend([
            "-map", "0:a:0",
            "-af", "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad",
            "-c:a", "aac",
            "-b:a", "160k",
            "-shortest",
        ])
    else:
        command.append("-an")
    command.extend(["-movflags", "+faststart", str(destination)])
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            "ffmpeg could not normalize a selected Take for the assembly preview: "
            + (proc.stderr or proc.stdout or "").strip()
        )


def _concat_preview(inputs, destination, export_dir):
    list_fd, list_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".ffconcat", dir=str(export_dir))
    out_fd, out_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".mp4", dir=str(export_dir))
    os.close(out_fd)
    list_path = Path(list_name)
    temp_output = Path(out_name)
    try:
        with os.fdopen(list_fd, "w", encoding="utf-8") as handle:
            handle.write("ffconcat version 1.0\n")
            for path in inputs:
                handle.write("file '" + _ffconcat_quote(path) + "'\n")

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
            raise RuntimeError("ffmpeg sequence preview failed: " + (proc.stderr or proc.stdout or "").strip())
        os.replace(temp_output, destination)
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


def _assemble(story_id, items):
    signatures = [_probe_stream_signature(item["sourcePath"]) for item in items]
    lossless = all(signature == signatures[0] for signature in signatures[1:])
    audio_mode = "copied"
    assembly_mode = "lossless"

    export_dir = _story_dir(story_id) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / "selected-sequence.mp4"

    if lossless:
        concat_inputs = [item["sourcePath"] for item in items]
        _concat_preview(concat_inputs, destination, export_dir)
    else:
        assembly_mode = "normalized-preview"
        width, height, frame_rate = _preview_target(signatures)
        include_audio = all(_has_audio(signature) for signature in signatures)
        audio_mode = "normalized" if include_audio else (
            "none" if not any(_has_audio(signature) for signature in signatures) else "dropped-mixed"
        )
        with tempfile.TemporaryDirectory(prefix=".assembly-preview-", dir=str(export_dir)) as temp_dir:
            normalized = []
            for index, item in enumerate(items):
                normalized_path = Path(temp_dir) / ("clip-" + str(index + 1).zfill(3) + ".mp4")
                _normalize_preview_clip(
                    item["sourcePath"],
                    normalized_path,
                    width,
                    height,
                    frame_rate,
                    include_audio,
                )
                normalized.append(normalized_path)
            _concat_preview(normalized, destination, export_dir)

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
        "assemblyMode": assembly_mode,
        "audioMode": audio_mode,
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
        "folder": "output/storyboards/" + story_id + "/exports",
        "media": "selected-sequence.mp4",
        "manifest": "exports/selected-sequence.json",
        "createdAt": manifest["createdAt"],
        "itemCount": len(items),
        "selection": selection,
        "assemblyMode": assembly_mode,
        "audioMode": audio_mode,
        "current": True,
    }


def export_selected_sequence(story_id):
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")
    _story, items = selected_sequence(story_id)
    return _assemble(story_id, items)


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
        "folder": "output/storyboards/" + story_id + "/exports",
        "media": "selected-sequence.mp4",
        "manifest": "exports/selected-sequence.json",
        "createdAt": str(manifest.get("createdAt") or ""),
        "itemCount": len(selection),
        "selection": selection,
        "current": selection == _selection(story),
    }
