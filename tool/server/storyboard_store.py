import copy
import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .originals import MEDIA_ALL_EXTS


STORYBOARD_VERSION = 1
STORYBOARD_DIRNAME = "storyboards"
STORY_FILE = "story.json"
VALID_STATUSES = {"active", "complete", "archived"}
VALID_SEED_MODES = {"random", "fixed"}


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def storyboard_root():
    return Path(app_config.FS_ROOT).resolve() / "output" / STORYBOARD_DIRNAME


def _safe_story_id(value):
    story_id = str(value or "").strip()
    if not story_id or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,119}", story_id):
        raise ValueError("Invalid Story ID.")
    return story_id


def _new_id(prefix):
    return prefix + "-" + uuid.uuid4().hex[:12]


def _story_dir(story_id):
    return storyboard_root() / _safe_story_id(story_id)


def _story_path(story_id):
    return _story_dir(story_id) / STORY_FILE


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read Storyboard metadata: " + str(path)) from exc


def _write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _normalize_tags(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Story tags must be a list.")
    result = []
    seen = set()
    for item in value:
        tag = str(item or "").strip()
        if not tag:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(tag)
    return result


def _normalize_scene(scene_id, value, existing=None):
    if not isinstance(value, dict):
        raise ValueError("Scene data must be an object.")
    now = _utc_now()
    current = existing if isinstance(existing, dict) else {}
    seed_mode = str(value.get("seedMode", current.get("seedMode", "random")) or "random").strip().lower()
    if seed_mode not in VALID_SEED_MODES:
        raise ValueError("Scene seed mode must be random or fixed.")

    seed = value.get("seed", current.get("seed"))
    if seed in ("", None):
        seed = None
    else:
        try:
            seed = int(seed)
        except (TypeError, ValueError) as exc:
            raise ValueError("Scene seed must be an integer.") from exc
        if seed < 0:
            raise ValueError("Scene seed must be zero or greater.")

    duration = value.get("durationSeconds", current.get("durationSeconds", 6))
    try:
        duration = float(duration)
    except (TypeError, ValueError) as exc:
        raise ValueError("Scene duration must be a number.") from exc
    if duration <= 0:
        raise ValueError("Scene duration must be greater than zero.")

    return {
        "id": scene_id,
        "title": str(value.get("title", current.get("title", "")) or "").strip(),
        "summary": str(value.get("summary", current.get("summary", "")) or "").strip(),
        "prompt": str(value.get("prompt", current.get("prompt", "")) or ""),
        "durationSeconds": duration,
        "seed": seed,
        "seedMode": seed_mode,
        "wildcardsEnabled": bool(value.get("wildcardsEnabled", current.get("wildcardsEnabled", False))),
        "loras": list(current.get("loras") or []),
        "references": list(current.get("references") or []),
        "notes": str(value.get("notes", current.get("notes", "")) or ""),
        "takes": dict(current.get("takes") or {}) if isinstance(current.get("takes"), dict) else {},
        "takeOrder": list(current.get("takeOrder") or []),
        "selectedTakeId": current.get("selectedTakeId"),
        "createdAt": current.get("createdAt") or now,
        "updatedAt": now,
    }


def _normalize_story(payload, existing=None, story_id=None):
    if not isinstance(payload, dict):
        raise ValueError("Story data must be an object.")

    current = existing if isinstance(existing, dict) else {}
    now = _utc_now()
    resolved_id = _safe_story_id(story_id or current.get("id") or _new_id("story"))
    status = str(payload.get("status", current.get("status", "active")) or "active").strip().lower()
    if status not in VALID_STATUSES:
        raise ValueError("Story status must be active, complete, or archived.")

    scenes = current.get("scenes") if isinstance(current.get("scenes"), dict) else {}
    removed_scenes = current.get("removedScenes") if isinstance(current.get("removedScenes"), dict) else {}
    scene_order = current.get("sceneOrder") if isinstance(current.get("sceneOrder"), list) else []
    scene_order = [scene_id for scene_id in scene_order if scene_id in scenes]

    return {
        "version": STORYBOARD_VERSION,
        "id": resolved_id,
        "title": str(payload.get("title", current.get("title", "")) or "").strip(),
        "concept": str(payload.get("concept", current.get("concept", "")) or ""),
        "style": str(payload.get("style", current.get("style", "")) or ""),
        "tags": _normalize_tags(payload.get("tags", current.get("tags", []))),
        "status": status,
        "pinned": bool(payload.get("pinned", current.get("pinned", False))),
        "createdAt": current.get("createdAt") or now,
        "updatedAt": now,
        "sceneOrder": scene_order,
        "scenes": scenes,
        "removedScenes": removed_scenes,
    }


def list_stories():
    root = storyboard_root()
    if not root.is_dir():
        return []
    stories = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        path = child / STORY_FILE
        if not path.is_file():
            continue
        story = _read_json(path)
        stories.append({
            "id": story.get("id") or child.name,
            "title": story.get("title") or "",
            "concept": story.get("concept") or "",
            "tags": story.get("tags") if isinstance(story.get("tags"), list) else [],
            "status": story.get("status") or "active",
            "pinned": bool(story.get("pinned")),
            "sceneCount": len(story.get("sceneOrder") or []),
            "createdAt": story.get("createdAt"),
            "updatedAt": story.get("updatedAt"),
        })
    stories.sort(
        key=lambda item: (
            0 if item.get("pinned") else 1,
            str(item.get("updatedAt") or ""),
        ),
        reverse=False,
    )
    pinned = [item for item in stories if item.get("pinned")]
    unpinned = [item for item in stories if not item.get("pinned")]
    pinned.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    unpinned.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return pinned + unpinned


def create_story(payload):
    story = _normalize_story(payload or {})
    path = _story_path(story["id"])
    if path.exists():
        raise RuntimeError("Story already exists.")
    _write_json_atomic(path, story)
    (path.parent / "takes").mkdir(parents=True, exist_ok=True)
    return story


def load_story(story_id):
    path = _story_path(story_id)
    if not path.is_file():
        raise FileNotFoundError("Story does not exist.")
    story = _read_json(path)
    if story.get("id") != _safe_story_id(story_id):
        raise RuntimeError("Story metadata ID does not match its folder.")
    return story


def update_story(story_id, payload):
    current = load_story(story_id)
    story = _normalize_story(payload or {}, existing=current, story_id=story_id)
    _write_json_atomic(_story_path(story_id), story)
    return story


def add_scene(story_id, payload=None):
    story = load_story(story_id)
    scene_id = _new_id("scene")
    scene = _normalize_scene(scene_id, payload or {})
    story["scenes"][scene_id] = scene
    story["sceneOrder"].append(scene_id)
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    (_story_dir(story_id) / "takes" / scene_id).mkdir(parents=True, exist_ok=True)
    return story, scene


def update_scene(story_id, scene_id, payload):
    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    current = scenes.get(scene_id)
    if not isinstance(current, dict):
        raise FileNotFoundError("Scene does not exist.")
    scene = _normalize_scene(scene_id, payload or {}, existing=current)
    scenes[scene_id] = scene
    story["scenes"] = scenes
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story, scene


def duplicate_scene(story_id, scene_id):
    story = load_story(story_id)
    current = (story.get("scenes") or {}).get(scene_id)
    if not isinstance(current, dict):
        raise FileNotFoundError("Scene does not exist.")
    scene_order = list(story.get("sceneOrder") or [])
    if scene_id not in scene_order:
        raise RuntimeError("Scene order is invalid.")

    new_id = _new_id("scene")
    copied = {
        "title": (str(current.get("title") or "").strip() + " Copy").strip(),
        "summary": current.get("summary") or "",
        "prompt": current.get("prompt") or "",
        "durationSeconds": current.get("durationSeconds", 6),
        "seed": current.get("seed"),
        "seedMode": current.get("seedMode", "random"),
        "wildcardsEnabled": bool(current.get("wildcardsEnabled")),
        "notes": current.get("notes") or "",
    }
    scene = _normalize_scene(new_id, copied)
    scene["loras"] = list(current.get("loras") or [])
    scene["references"] = list(current.get("references") or [])

    story["scenes"][new_id] = scene
    index = scene_order.index(scene_id) + 1
    scene_order.insert(index, new_id)
    story["sceneOrder"] = scene_order
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    (_story_dir(story_id) / "takes" / new_id).mkdir(parents=True, exist_ok=True)
    return story, scene


def reorder_scenes(story_id, ordered_ids):
    story = load_story(story_id)
    if not isinstance(ordered_ids, list):
        raise ValueError("Scene order must be a list.")
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    normalized = [str(value or "").strip() for value in ordered_ids]
    if len(normalized) != len(set(normalized)) or set(normalized) != set(scenes.keys()):
        raise ValueError("Scene order must contain every Scene exactly once.")
    story["sceneOrder"] = normalized
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


def delete_scene(story_id, scene_id):
    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    if scene_id not in scenes:
        raise FileNotFoundError("Scene does not exist.")
    scene = dict(scenes.pop(scene_id))
    scene["removedAt"] = _utc_now()
    removed = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
    removed[scene_id] = scene
    story["removedScenes"] = removed
    story["sceneOrder"] = [value for value in story.get("sceneOrder") or [] if value != scene_id]
    story["scenes"] = scenes
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


def restore_scene(story_id, scene_id):
    story = load_story(story_id)
    removed = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
    scene = removed.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Removed Scene does not exist.")
    restored = dict(scene)
    restored.pop("removedAt", None)
    restored["updatedAt"] = _utc_now()
    story["scenes"][scene_id] = restored
    del removed[scene_id]
    story["removedScenes"] = removed
    story["sceneOrder"].append(scene_id)
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


def _scene_for_story(story, scene_id):
    scene_id = str(scene_id or "").strip()
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    scene = scenes.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")
    return scene_id, scene


def add_take_upload(story_id, scene_id, filename, stream):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    source_name = str(filename or "").strip()
    safe_name = Path(source_name).name
    if not source_name or safe_name != source_name:
        raise ValueError("Invalid Take filename.")
    suffix = Path(safe_name).suffix.lower()
    if suffix not in MEDIA_ALL_EXTS:
        raise ValueError("Take must be a supported image or video file.")

    take_id = _new_id("take")
    take_dir = _story_dir(story_id) / "takes" / scene_id
    take_dir.mkdir(parents=True, exist_ok=True)
    stored_name = take_id + suffix
    destination = take_dir / stored_name
    fd, tmp_name = tempfile.mkstemp(prefix=stored_name + ".", suffix=".tmp", dir=str(take_dir))
    try:
        with os.fdopen(fd, "wb") as handle:
            shutil.copyfileobj(stream, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, destination)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

    now = _utc_now()
    take = {
        "id": take_id,
        "sceneId": scene_id,
        "createdAt": now,
        "mediaPath": "takes/" + scene_id + "/" + stored_name,
        "sourceFilename": safe_name,
        "prompt": str(scene.get("prompt") or ""),
        "durationSeconds": scene.get("durationSeconds", 6),
        "seed": scene.get("seed"),
        "seedMode": scene.get("seedMode", "random"),
        "wildcardsEnabled": bool(scene.get("wildcardsEnabled")),
        "loras": copy.deepcopy(scene.get("loras") or []),
        "references": copy.deepcopy(scene.get("references") or []),
        "workflowProfile": None,
        "providerJobId": None,
        "rating": None,
    }
    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    take_order = list(scene.get("takeOrder") or [])
    takes[take_id] = take
    take_order.append(take_id)
    scene["takes"] = takes
    scene["takeOrder"] = take_order
    scene["updatedAt"] = now
    story["scenes"][scene_id] = scene
    story["updatedAt"] = now
    try:
        _write_json_atomic(_story_path(story_id), story)
    except Exception:
        try:
            destination.unlink()
        except OSError:
            pass
        raise
    return story, take


def rate_take(story_id, scene_id, take_id, rating):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    take = takes.get(str(take_id or "").strip())
    if not isinstance(take, dict):
        raise FileNotFoundError("Take does not exist.")
    if rating in ("", None):
        normalized = None
    else:
        try:
            normalized = int(rating)
        except (TypeError, ValueError) as exc:
            raise ValueError("Take rating must be 1 through 5.") from exc
        if normalized < 1 or normalized > 5:
            raise ValueError("Take rating must be 1 through 5.")
    take["rating"] = normalized
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story, take


def select_take(story_id, scene_id, take_id):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    resolved_take_id = str(take_id or "").strip()
    if resolved_take_id:
        takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
        if not isinstance(takes.get(resolved_take_id), dict):
            raise FileNotFoundError("Take does not exist.")
        scene["selectedTakeId"] = resolved_take_id
    else:
        scene["selectedTakeId"] = None
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story
