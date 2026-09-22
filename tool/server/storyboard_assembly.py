import json
import os
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .permissions import normalize_path_permissions
from .storyboard_store import load_story, storyboard_root


VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg"}
_lock = threading.Lock()
_jobs = {}
_active_job_id = None


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _story_dir(story_id):
    return storyboard_root() / str(story_id)


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
        "stream=index,codec_type,codec_name,codec_tag_string,width,height,pix_fmt,r_frame_rate,time_base,sample_fmt,sample_rate,channels,channel_layout",
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
    signature = []
    for stream in streams:
        if not isinstance(stream, dict):
            continue
        signature.append({
            key: stream.get(key)
            for key in (
                "codec_type", "codec_name", "codec_tag_string",
                "width", "height", "pix_fmt", "r_frame_rate", "time_base",
                "sample_fmt", "sample_rate", "channels", "channel_layout",
            )
            if stream.get(key) is not None
        })
    return signature


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


def _assemble(story_id, items):
    baseline = _probe_stream_signature(items[0]["sourcePath"])
    for item in items[1:]:
        if _probe_stream_signature(item["sourcePath"]) != baseline:
            raise RuntimeError(
                "Selected Takes do not have matching media streams. "
                "This first assembly path only performs a lossless splice; choose Takes with matching "
                "resolution/codec/audio settings rather than silently re-encoding them."
            )

    export_dir = _story_dir(story_id) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / "selected-sequence.mp4"

    list_fd, list_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".ffconcat", dir=str(export_dir))
    out_fd, out_name = tempfile.mkstemp(prefix=".selected-sequence-", suffix=".mp4", dir=str(export_dir))
    os.close(out_fd)
    list_path = Path(list_name)
    temp_output = Path(out_name)
    try:
        with os.fdopen(list_fd, "w", encoding="utf-8") as handle:
            handle.write("ffconcat version 1.0\n")
            for item in items:
                handle.write("file '" + _ffconcat_quote(item["sourcePath"]) + "'\n")

        command = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-map", "0",
            "-c", "copy",
            "-movflags", "+faststart",
            str(temp_output),
        ]
        proc = subprocess.run(command, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg sequence export failed: " + (proc.stderr or proc.stdout or "").strip())
        os.replace(temp_output, destination)
        normalize_path_permissions(destination)

        manifest = {
            "version": 1,
            "storyId": story_id,
            "createdAt": _utc_now(),
            "output": "exports/selected-sequence.mp4",
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
            "folder": "output/storyboards/" + story_id + "/exports",
            "media": "selected-sequence.mp4",
            "manifest": "exports/selected-sequence.json",
            "itemCount": len(items),
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


def _public_job(job):
    if not isinstance(job, dict):
        return None
    result = dict(job)
    result.pop("_items", None)
    return result


def _run_job(job_id):
    global _active_job_id
    try:
        with _lock:
            job = _jobs.get(job_id)
            if not job:
                return
            items = list(job.get("_items") or [])
            story_id = job["storyId"]
        output = _assemble(story_id, items)
        with _lock:
            current = _jobs.get(job_id)
            if current:
                current["status"] = "completed"
                current["completedAt"] = _utc_now()
                current["output"] = output
    except Exception as exc:
        with _lock:
            current = _jobs.get(job_id)
            if current:
                current["status"] = "failed"
                current["completedAt"] = _utc_now()
                current["error"] = str(exc)
    finally:
        with _lock:
            if _active_job_id == job_id:
                _active_job_id = None


def start_assembly(story_id):
    global _active_job_id
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")
    _story, items = selected_sequence(story_id)

    with _lock:
        if _active_job_id:
            active = _jobs.get(_active_job_id)
            if active and active.get("status") == "running":
                raise RuntimeError("A Storyboard sequence export is already running.")
            _active_job_id = None

        job_id = uuid.uuid4().hex[:12]
        selection = [
            {"sceneId": item["sceneId"], "takeId": item["takeId"]}
            for item in items
        ]
        _jobs[job_id] = {
            "jobId": job_id,
            "storyId": story_id,
            "status": "running",
            "startedAt": _utc_now(),
            "completedAt": None,
            "selection": selection,
            "output": None,
            "error": "",
            "_items": items,
        }
        _active_job_id = job_id

    thread = threading.Thread(target=_run_job, args=(job_id,), daemon=True, name="storyboard-assembly-" + job_id)
    try:
        thread.start()
    except Exception:
        with _lock:
            _jobs.pop(job_id, None)
            if _active_job_id == job_id:
                _active_job_id = None
        raise
    return _public_job(_jobs[job_id])


def assembly_status(job_id):
    with _lock:
        job = _jobs.get(str(job_id or "").strip())
        if not job:
            raise FileNotFoundError("Storyboard sequence export job does not exist.")
        return _public_job(job)
