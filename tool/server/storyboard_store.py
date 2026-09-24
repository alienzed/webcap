import copy
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .originals import MEDIA_ALL_EXTS
from .video_frame_ops import VIDEO_EXTS, extract_boundary_frame_png


STORYBOARD_VERSION = 1
STORYBOARD_DIRNAME = "storyboards"
STORY_FILE = "story.json"
VALID_STATUSES = {"active", "complete", "archived"}
VALID_SEED_MODES = {"random", "fixed"}
VALID_INVARIANT_KINDS = {"visual", "character", "world", "sound", "custom"}
VALID_REFERENCE_ROLES = {"first_frame", "last_frame", "guide_frame"}
VALID_REFERENCE_FRAMES = {"first", "last"}
ASPECT_RATIO_OPTIONS = (
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
)
DEFAULT_TARGET_SCENE_COUNT = 12
DEFAULT_STORY_ASPECT_RATIO = "4:3 (Standard)"
DEFAULT_STORY_MEGAPIXELS = 0.2

_mutation_lock = threading.RLock()
_logger = logging.getLogger(__name__)


def _serialized_mutation(func):
    def wrapped(*args, **kwargs):
        with _mutation_lock:
            return func(*args, **kwargs)
    return wrapped


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


def _restore_order_metadata(item):
    metadata = item.get("_restoreOrder") if isinstance(item.get("_restoreOrder"), dict) else {}
    return {
        "index": metadata.get("index", item.get("removedOrderIndex")),
        "beforeId": str(metadata.get("beforeId", item.get("removedBeforeId")) or ""),
        "afterId": str(metadata.get("afterId", item.get("removedAfterId")) or ""),
    }


def _restore_ordered_id(order, item_id, removed, active_items):
    restored = list(order or [])
    metadata = _restore_order_metadata(removed)
    lower_bounds = []
    upper_bounds = []
    before_id = metadata["beforeId"]
    after_id = metadata["afterId"]
    if before_id and before_id in restored:
        lower_bounds.append(restored.index(before_id) + 1)
    if after_id and after_id in restored:
        upper_bounds.append(restored.index(after_id))

    for active_id in restored:
        active = active_items.get(active_id) if isinstance(active_items, dict) else None
        if not isinstance(active, dict):
            continue
        active_metadata = _restore_order_metadata(active)
        if active_metadata["beforeId"] == item_id:
            upper_bounds.append(restored.index(active_id))
        if active_metadata["afterId"] == item_id:
            lower_bounds.append(restored.index(active_id) + 1)

    lower = max(lower_bounds, default=0)
    upper = min(upper_bounds, default=len(restored))
    if lower <= upper and (lower_bounds or upper_bounds):
        restored.insert(upper if upper_bounds else lower, item_id)
        return restored
    try:
        index = int(metadata["index"])
    except (TypeError, ValueError):
        index = len(restored)
    restored.insert(max(0, min(index, len(restored))), item_id)
    return restored


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


def _normalize_loras(value, *, allow_enabled=False):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("LoRAs must be a list.")
    result = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Each LoRA must be an object.")
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            raise ValueError("LoRAs must not contain duplicates.")
        try:
            strength = float(item.get("strength", 1.0))
        except (TypeError, ValueError) as exc:
            raise ValueError("LoRA strength must be numeric.") from exc
        if not (-100.0 < strength < 100.0):
            raise ValueError("LoRA strength is outside a reasonable range.")
        normalized = {"name": name, "strength": strength}
        if allow_enabled and "enabled" in item:
            if not isinstance(item.get("enabled"), bool):
                raise ValueError("LoRA enabled must be boolean.")
            if item["enabled"] is False:
                normalized["enabled"] = False
        seen.add(key)
        result.append(normalized)
    return result


def _normalize_story_invariants(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Story invariants must be a list.")
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Each Story invariant must be an object.")
        kind = str(item.get("kind") or "custom").strip().lower()
        if kind not in VALID_INVARIANT_KINDS:
            raise ValueError("Story invariant kind is unsupported.")
        title = str(item.get("title") or "").strip()
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        result.append({"kind": kind, "title": title, "text": text})
    return result


def _normalize_story_lora_overrides(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Story LoRA overrides must be a list.")
    result = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Each Story LoRA override must be an object.")
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            raise ValueError("Story LoRA overrides must not contain duplicates.")
        normalized = {"name": name}
        if "enabled" in item:
            if not isinstance(item.get("enabled"), bool):
                raise ValueError("Story LoRA override enabled must be boolean.")
            normalized["enabled"] = item["enabled"]
        if "strength" in item and item.get("strength") not in ("", None):
            try:
                strength = float(item["strength"])
            except (TypeError, ValueError) as exc:
                raise ValueError("Story LoRA override strength must be numeric.") from exc
            if not (-100.0 < strength < 100.0):
                raise ValueError("Story LoRA override strength is outside a reasonable range.")
            normalized["strength"] = strength
        if len(normalized) > 1:
            result.append(normalized)
        seen.add(key)
    return result


def _normalize_target_scene_count(value):
    if isinstance(value, bool):
        raise ValueError("Story target Scene count must be an integer.")
    try:
        count = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Story target Scene count must be an integer.") from exc
    if count < 2 or count > 50:
        raise ValueError("Story target Scene count must be between 2 and 50.")
    return count


def _normalize_story_generation_defaults(value=None, existing=None):
    if value is not None and not isinstance(value, dict):
        raise ValueError("Story generation defaults must be an object.")
    current = existing if isinstance(existing, dict) else {}
    supplied = value if isinstance(value, dict) else {}

    aspect_ratio = str(
        supplied.get("aspectRatio", current.get("aspectRatio", DEFAULT_STORY_ASPECT_RATIO))
        or DEFAULT_STORY_ASPECT_RATIO
    ).strip()
    if aspect_ratio not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Storyboard aspect ratio: " + aspect_ratio)

    megapixels_value = supplied.get("megapixels", current.get("megapixels", DEFAULT_STORY_MEGAPIXELS))
    if isinstance(megapixels_value, bool):
        raise ValueError("Story megapixels must be a number.")
    try:
        megapixels = float(megapixels_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Story megapixels must be a number.") from exc
    if megapixels <= 0:
        raise ValueError("Story megapixels must be greater than zero.")

    return {
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
    }


def resolve_scene_generation_defaults(story, scene):
    defaults = _normalize_story_generation_defaults((story or {}).get("generationDefaults"))
    aspect_ratio = str((scene or {}).get("aspectRatio") or "").strip() or defaults["aspectRatio"]
    if aspect_ratio not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Storyboard aspect ratio: " + aspect_ratio)

    megapixels_value = (scene or {}).get("megapixels")
    if megapixels_value in (None, ""):
        megapixels = defaults["megapixels"]
    else:
        if isinstance(megapixels_value, bool):
            raise ValueError("Scene megapixels must be a number.")
        try:
            megapixels = float(megapixels_value)
        except (TypeError, ValueError) as exc:
            raise ValueError("Scene megapixels must be a number.") from exc
        if megapixels <= 0:
            raise ValueError("Scene megapixels must be greater than zero.")

    return {
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
    }


def resolve_scene_loras(story, scene):
    story_loras = _normalize_loras((story or {}).get("loras", []), allow_enabled=True)
    scene_loras = _normalize_loras((scene or {}).get("loras", []))
    overrides = {
        item["name"].casefold(): item
        for item in _normalize_story_lora_overrides((scene or {}).get("storyLoraOverrides", []))
    }
    story_names = {item["name"].casefold() for item in story_loras}

    resolved = []
    for item in story_loras:
        if item.get("enabled") is False:
            continue
        override = overrides.get(item["name"].casefold(), {})
        if override.get("enabled") is False:
            continue
        resolved.append({
            "name": item["name"],
            "strength": override.get("strength", item["strength"]),
        })

    for item in scene_loras:
        if item["name"].casefold() in story_names:
            raise ValueError(
                "Scene-specific LoRA duplicates a Story LoRA; use the inherited Story LoRA controls instead."
            )
        resolved.append(item)
    return resolved


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

    if "aspectRatio" in value:
        aspect_ratio_value = value.get("aspectRatio")
    else:
        aspect_ratio_value = current.get("aspectRatio") if "aspectRatio" in current else None
    aspect_ratio = str(aspect_ratio_value or "").strip() or None
    if aspect_ratio is not None and aspect_ratio not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Storyboard aspect ratio: " + aspect_ratio)

    if "megapixels" in value:
        megapixels_value = value.get("megapixels")
    else:
        megapixels_value = current.get("megapixels") if "megapixels" in current else None
    if megapixels_value in (None, ""):
        megapixels = None
    else:
        if isinstance(megapixels_value, bool):
            raise ValueError("Scene megapixels must be a number.")
        try:
            megapixels = float(megapixels_value)
        except (TypeError, ValueError) as exc:
            raise ValueError("Scene megapixels must be a number.") from exc
        if megapixels <= 0:
            raise ValueError("Scene megapixels must be greater than zero.")

    normalized = {
        "id": scene_id,
        "title": str(value.get("title", current.get("title", "")) or "").strip(),
        "summary": str(value.get("summary", current.get("summary", "")) or "").strip(),
        "entryState": str(value.get("entryState", current.get("entryState", "")) or "").strip(),
        "exitState": str(value.get("exitState", current.get("exitState", "")) or "").strip(),
        "prompt": str(value.get("prompt", current.get("prompt", "")) or ""),
        "promptDirectorModel": str(value.get("promptDirectorModel", current.get("promptDirectorModel", "")) or "").strip(),
        "planDirectorModel": str(value.get("planDirectorModel", current.get("planDirectorModel", "")) or "").strip(),
        "durationSeconds": duration,
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "seed": seed,
        "seedMode": seed_mode,
        "wildcardsEnabled": bool(value.get("wildcardsEnabled", current.get("wildcardsEnabled", False))),
        "loras": _normalize_loras(value.get("loras", current.get("loras", []))),
        "storyLoraOverrides": _normalize_story_lora_overrides(
            value.get("storyLoraOverrides", current.get("storyLoraOverrides", []))
        ),
        "references": list(current.get("references") or []),
        "notes": str(value.get("notes", current.get("notes", "")) or ""),
        "takes": dict(current.get("takes") or {}) if isinstance(current.get("takes"), dict) else {},
        "removedTakes": dict(current.get("removedTakes") or {}) if isinstance(current.get("removedTakes"), dict) else {},
        "takeOrder": list(current.get("takeOrder") or []),
        "selectedTakeId": current.get("selectedTakeId"),
        "createdAt": current.get("createdAt") or now,
        "updatedAt": now,
    }
    if isinstance(current.get("_restoreOrder"), dict):
        normalized["_restoreOrder"] = copy.deepcopy(current["_restoreOrder"])
    return normalized


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

    target_scene_count = _normalize_target_scene_count(
        payload.get("targetSceneCount", current.get("targetSceneCount", DEFAULT_TARGET_SCENE_COUNT))
    )
    generation_defaults = _normalize_story_generation_defaults(
        payload.get("generationDefaults") if "generationDefaults" in payload else None,
        current.get("generationDefaults"),
    )

    return {
        "version": STORYBOARD_VERSION,
        "id": resolved_id,
        "title": str(payload.get("title", current.get("title", "")) or "").strip(),
        "concept": str(payload.get("concept", current.get("concept", "")) or ""),
        "previousConcept": current.get("previousConcept") if isinstance(current.get("previousConcept"), str) else None,
        "style": str(payload.get("style", current.get("style", "")) or ""),
        "invariants": _normalize_story_invariants(payload.get("invariants", current.get("invariants", []))),
        "loras": _normalize_loras(payload.get("loras", current.get("loras", [])), allow_enabled=True),
        "targetSceneCount": target_scene_count,
        "generationDefaults": generation_defaults,
        "tags": _normalize_tags(payload.get("tags", current.get("tags", []))),
        "status": status,
        "pinned": bool(payload.get("pinned", current.get("pinned", False))),
        "createdAt": current.get("createdAt") or now,
        "updatedAt": now,
        "sceneOrder": scene_order,
        "scenes": scenes,
        "removedScenes": removed_scenes,
        "development": copy.deepcopy(current.get("development")) if isinstance(current.get("development"), dict) else None,
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
    pinned = [item for item in stories if item.get("pinned")]
    unpinned = [item for item in stories if not item.get("pinned")]
    pinned.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    unpinned.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return pinned + unpinned


@_serialized_mutation
def create_story(payload):
    story = _normalize_story(payload or {})
    path = _story_path(story["id"])
    if path.exists():
        raise RuntimeError("Story already exists.")
    _write_json_atomic(path, story)
    (path.parent / "takes").mkdir(parents=True, exist_ok=True)
    return story


@_serialized_mutation
def duplicate_story(story_id):
    source = load_story(story_id)
    source_scenes = source.get("scenes") if isinstance(source.get("scenes"), dict) else {}
    duplicate = _normalize_story({
        "title": (str(source.get("title") or "Untitled Story").strip() + " Copy").strip(),
        "concept": source.get("concept") or "",
        "style": source.get("style") or "",
        "invariants": copy.deepcopy(source.get("invariants") or []),
        "loras": copy.deepcopy(source.get("loras") or []),
        "targetSceneCount": source.get("targetSceneCount", DEFAULT_TARGET_SCENE_COUNT),
        "generationDefaults": copy.deepcopy(source.get("generationDefaults") or {}),
        "tags": copy.deepcopy(source.get("tags") or []),
        "status": "active",
        "pinned": False,
    })

    duplicate["sceneOrder"] = []
    duplicate["scenes"] = {}
    duplicate["removedScenes"] = {}
    duplicate["development"] = copy.deepcopy(source.get("development")) if isinstance(source.get("development"), dict) else None

    scene_fields = (
        "title", "summary", "entryState", "exitState", "prompt", "promptDirectorModel", "planDirectorModel",
        "durationSeconds", "aspectRatio", "megapixels", "seed", "seedMode",
        "wildcardsEnabled", "loras", "storyLoraOverrides", "notes",
    )
    for source_scene_id in source.get("sceneOrder") or []:
        current = source_scenes.get(source_scene_id)
        if not isinstance(current, dict):
            raise RuntimeError("Story scene order is invalid.")
        scene_id = _new_id("scene")
        payload = {key: copy.deepcopy(current.get(key)) for key in scene_fields if key in current}
        scene = _normalize_scene(scene_id, payload)
        duplicate["scenes"][scene_id] = scene
        duplicate["sceneOrder"].append(scene_id)

    path = _story_path(duplicate["id"])
    if path.exists():
        raise RuntimeError("Story already exists.")
    _write_json_atomic(path, duplicate)
    (path.parent / "takes").mkdir(parents=True, exist_ok=True)
    for scene_id in duplicate["sceneOrder"]:
        (path.parent / "takes" / scene_id).mkdir(parents=True, exist_ok=True)
    return duplicate


@_serialized_mutation
def delete_story(story_id):
    resolved_id = _safe_story_id(story_id)
    directory = _story_dir(resolved_id)
    if directory.is_symlink():
        raise RuntimeError("Storyboard Story folder must not be a symlink.")
    story = load_story(resolved_id)
    shutil.rmtree(directory)
    return story["id"]


def load_story(story_id):
    path = _story_path(story_id)
    if not path.is_file():
        raise FileNotFoundError("Story does not exist.")
    story = _read_json(path)
    if story.get("id") != _safe_story_id(story_id):
        raise RuntimeError("Story metadata ID does not match its folder.")
    return story


@_serialized_mutation
def update_story(story_id, payload):
    current = load_story(story_id)
    story = _normalize_story(payload or {}, existing=current, story_id=story_id)
    _write_json_atomic(_story_path(story_id), story)
    return story


@_serialized_mutation
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


@_serialized_mutation
def apply_concept_expansion(story_id, expanded_concept):
    story = load_story(story_id)
    expanded = str(expanded_concept or "").strip()
    if not expanded:
        raise ValueError("Expanded Story concept is empty.")
    previous = str(story.get("concept") or "")
    story["previousConcept"] = previous
    story["concept"] = expanded
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


@_serialized_mutation
def restore_previous_concept(story_id):
    story = load_story(story_id)
    previous = story.get("previousConcept")
    if not isinstance(previous, str):
        raise FileNotFoundError("No previous Story concept is available.")
    story["concept"] = previous
    story["previousConcept"] = None
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


def _validate_developed_plan(plan, target_scene_count=None):
    if not isinstance(plan, dict):
        raise ValueError("Developed Story plan must be an object.")
    if set(plan.keys()) != {"scenes"}:
        raise ValueError("Developed Story plan contains unsupported fields.")
    scenes = plan.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("Developed Story plan Scenes must be an array.")
    if target_scene_count is not None and len(scenes) != int(target_scene_count):
        raise ValueError(
            "Storyboard Director returned "
            + str(len(scenes))
            + " Scenes; this Story requests exactly "
            + str(int(target_scene_count))
            + "."
        )

    scene_keys = {
        "title",
        "summary",
        "entryState",
        "exitState",
        "prompt",
        "suggestedDurationSeconds",
        "continuity",
    }
    continuity_keys = {"continuesPreviousScene", "carryForward"}
    normalized = []
    for index, item in enumerate(scenes, start=1):
        if not isinstance(item, dict):
            raise ValueError("Developed Story Scene " + str(index) + " must be an object.")
        if set(item.keys()) != scene_keys:
            raise ValueError("Developed Story Scene " + str(index) + " has missing or unsupported fields.")

        text_fields = {}
        for key in ("title", "summary", "entryState", "exitState", "prompt"):
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError("Developed Story Scene " + str(index) + " has invalid " + key + ".")
            text_fields[key] = value.strip()

        duration_value = item.get("suggestedDurationSeconds")
        if isinstance(duration_value, bool) or not isinstance(duration_value, (int, float)):
            raise ValueError("Developed Story Scene duration must be numeric.")
        duration = float(duration_value)
        if duration < 4 or duration > 15:
            raise ValueError("Developed Story Scene duration must be between 4 and 15 seconds.")

        continuity = item.get("continuity")
        if not isinstance(continuity, dict) or set(continuity.keys()) != continuity_keys:
            raise ValueError("Developed Story Scene continuity has missing or unsupported fields.")
        continues_previous = continuity.get("continuesPreviousScene")
        if not isinstance(continues_previous, bool):
            raise ValueError("Developed Story Scene continuesPreviousScene must be boolean.")
        carry_forward = continuity.get("carryForward")
        if (
            not isinstance(carry_forward, list)
            or any(not isinstance(value, str) or not value.strip() for value in carry_forward)
        ):
            raise ValueError("Developed Story Scene carryForward must be a list of non-empty strings.")

        normalized.append({
            **text_fields,
            "durationSeconds": duration,
            "continuity": {
                "continuesPreviousScene": continues_previous,
                "carryForward": [value.strip() for value in carry_forward],
            },
        })
    return normalized


@_serialized_mutation
def apply_developed_plan(story_id, plan, model_id=""):
    story = load_story(story_id)
    planned_scenes = _validate_developed_plan(plan, story.get("targetSceneCount", DEFAULT_TARGET_SCENE_COUNT))
    now = _utc_now()

    removed = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
    active_order = list(story.get("sceneOrder") or [])
    active_scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    for index, scene_id in enumerate(active_order):
        scene = active_scenes.get(scene_id)
        if not isinstance(scene, dict):
            continue
        archived = copy.deepcopy(scene)
        archived["removedAt"] = now
        archived["removedReason"] = "replaced_by_develop_story"
        archived["removedOrderIndex"] = index
        archived["removedBeforeId"] = active_order[index - 1] if index > 0 else None
        archived["removedAfterId"] = active_order[index + 1] if index + 1 < len(active_order) else None
        removed[scene_id] = archived

    new_scenes = {}
    new_order = []
    for item in planned_scenes:
        scene_id = _new_id("scene")
        scene = _normalize_scene(scene_id, {
            **item,
            "promptDirectorModel": str(model_id or "").strip(),
            "planDirectorModel": str(model_id or "").strip(),
        })
        new_scenes[scene_id] = scene
        new_order.append(scene_id)

    story["scenes"] = new_scenes
    story["sceneOrder"] = new_order
    story["removedScenes"] = removed
    story["development"] = {
        "createdAt": now,
        "model": str(model_id or "").strip(),
        "plan": copy.deepcopy(plan),
    }
    story["updatedAt"] = now
    _write_json_atomic(_story_path(story_id), story)

    for scene_id in new_order:
        (_story_dir(story_id) / "takes" / scene_id).mkdir(parents=True, exist_ok=True)
    return story


@_serialized_mutation
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


@_serialized_mutation
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
        "entryState": current.get("entryState") or "",
        "exitState": current.get("exitState") or "",
        "prompt": current.get("prompt") or "",
        "promptDirectorModel": current.get("promptDirectorModel") or "",
        "planDirectorModel": current.get("planDirectorModel") or "",
        "durationSeconds": current.get("durationSeconds", 6),
        "aspectRatio": current.get("aspectRatio"),
        "megapixels": current.get("megapixels"),
        "seed": current.get("seed"),
        "seedMode": current.get("seedMode", "random"),
        "wildcardsEnabled": bool(current.get("wildcardsEnabled")),
        "notes": current.get("notes") or "",
    }
    copied["loras"] = copy.deepcopy(current.get("loras") or [])
    copied["storyLoraOverrides"] = copy.deepcopy(current.get("storyLoraOverrides") or [])
    scene = _normalize_scene(new_id, copied)
    scene["references"] = list(current.get("references") or [])

    story["scenes"][new_id] = scene
    index = scene_order.index(scene_id) + 1
    scene_order.insert(index, new_id)
    story["sceneOrder"] = scene_order
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    (_story_dir(story_id) / "takes" / new_id).mkdir(parents=True, exist_ok=True)
    return story, scene


@_serialized_mutation
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


@_serialized_mutation
def delete_scene(story_id, scene_id):
    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    if scene_id not in scenes:
        raise FileNotFoundError("Scene does not exist.")
    scene_order = list(story.get("sceneOrder") or [])
    scene = dict(scenes.pop(scene_id))
    scene["removedAt"] = _utc_now()
    order_index = scene_order.index(scene_id) if scene_id in scene_order else len(scene_order)
    scene["removedOrderIndex"] = order_index
    scene["removedBeforeId"] = scene_order[order_index - 1] if order_index > 0 else None
    scene["removedAfterId"] = scene_order[order_index + 1] if order_index + 1 < len(scene_order) else None
    scene["_restoreOrder"] = {
        "index": scene["removedOrderIndex"],
        "beforeId": scene["removedBeforeId"],
        "afterId": scene["removedAfterId"],
    }
    removed = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
    removed[scene_id] = scene
    story["removedScenes"] = removed
    story["sceneOrder"] = [value for value in story.get("sceneOrder") or [] if value != scene_id]
    story["scenes"] = scenes
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


@_serialized_mutation
def restore_scene(story_id, scene_id):
    story = load_story(story_id)
    removed = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
    scene = removed.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Removed Scene does not exist.")
    restored = dict(scene)
    restored.pop("removedAt", None)
    restored.pop("removedReason", None)
    story["sceneOrder"] = _restore_ordered_id(
        story.get("sceneOrder") or [], scene_id, restored, story.get("scenes") or {}
    )
    restored.pop("removedOrderIndex", None)
    restored.pop("removedBeforeId", None)
    restored.pop("removedAfterId", None)
    restored["updatedAt"] = _utc_now()
    story["scenes"][scene_id] = restored
    del removed[scene_id]
    story["removedScenes"] = removed
    if not removed:
        for active_scene in story["scenes"].values():
            if isinstance(active_scene, dict):
                active_scene.pop("_restoreOrder", None)
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


@_serialized_mutation
def add_take_upload(story_id, scene_id, filename, stream, effective_loras=None):
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
        "entryState": str(scene.get("entryState") or ""),
        "exitState": str(scene.get("exitState") or ""),
        "durationSeconds": scene.get("durationSeconds", 6),
        "seed": scene.get("seed"),
        "seedMode": scene.get("seedMode", "random"),
        "wildcardsEnabled": bool(scene.get("wildcardsEnabled")),
        "loras": _normalize_loras(effective_loras) if effective_loras is not None else resolve_scene_loras(story, scene),
        "references": copy.deepcopy(scene.get("references") or []),
        "workflowProfile": None,
        "providerJobId": None,
        "label": "",
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


@_serialized_mutation
def remove_take(story_id, scene_id, take_id):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    resolved_take_id = str(take_id or "").strip()
    take = takes.get(resolved_take_id)
    if not isinstance(take, dict):
        raise FileNotFoundError("Take does not exist.")

    take_order = list(scene.get("takeOrder") or [])
    removed_take = dict(take)
    removed_take["removedAt"] = _utc_now()
    order_index = take_order.index(resolved_take_id) if resolved_take_id in take_order else len(take_order)
    removed_take["removedOrderIndex"] = order_index
    removed_take["removedBeforeId"] = take_order[order_index - 1] if order_index > 0 else None
    removed_take["removedAfterId"] = take_order[order_index + 1] if order_index + 1 < len(take_order) else None
    removed_take["_restoreOrder"] = {
        "index": removed_take["removedOrderIndex"],
        "beforeId": removed_take["removedBeforeId"],
        "afterId": removed_take["removedAfterId"],
    }
    removed = scene.get("removedTakes") if isinstance(scene.get("removedTakes"), dict) else {}
    removed[resolved_take_id] = removed_take
    del takes[resolved_take_id]
    scene["takes"] = takes
    scene["removedTakes"] = removed
    scene["takeOrder"] = [value for value in scene.get("takeOrder") or [] if value != resolved_take_id]
    if scene.get("selectedTakeId") == resolved_take_id:
        scene["selectedTakeId"] = None
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story


@_serialized_mutation
def delete_take(story_id, scene_id, take_id):
    story = load_story(story_id)
    original_story = copy.deepcopy(story)
    scene_id, scene = _scene_for_story(story, scene_id)
    resolved_take_id = str(take_id or "").strip()

    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    removed = scene.get("removedTakes") if isinstance(scene.get("removedTakes"), dict) else {}
    take = takes.get(resolved_take_id)
    source = "active"
    if not isinstance(take, dict):
        take = removed.get(resolved_take_id)
        source = "removed"
    if not isinstance(take, dict):
        raise FileNotFoundError("Take does not exist.")

    media_path_value = str(take.get("mediaPath") or "").strip()
    relative = Path(media_path_value)
    if not media_path_value or relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Storyboard Take media path is invalid.")
    story_root = _story_dir(story_id).resolve()
    media_path = (story_root / relative).resolve()
    if media_path != story_root and story_root not in media_path.parents:
        raise RuntimeError("Storyboard Take media path escapes its Story folder.")

    for scene_map in (story.get("scenes"), story.get("removedScenes")):
        if not isinstance(scene_map, dict):
            continue
        for candidate_scene in scene_map.values():
            if not isinstance(candidate_scene, dict):
                continue
            for reference in candidate_scene.get("references") or []:
                if not isinstance(reference, dict):
                    continue
                if (
                    str(reference.get("sourceTakeId") or "") == resolved_take_id
                    and str(reference.get("mediaPath") or "") == media_path_value
                ):
                    raise RuntimeError(
                        "Take cannot be deleted while its media is used as a Scene reference. Clear that reference first."
                    )

    if source == "active":
        del takes[resolved_take_id]
        scene["takes"] = takes
        scene["takeOrder"] = [
            value for value in scene.get("takeOrder") or []
            if value != resolved_take_id
        ]
        if scene.get("selectedTakeId") == resolved_take_id:
            scene["selectedTakeId"] = None
    else:
        del removed[resolved_take_id]
        scene["removedTakes"] = removed

    now = _utc_now()
    scene["updatedAt"] = now
    story["updatedAt"] = now
    _write_json_atomic(_story_path(story_id), story)

    try:
        if media_path.exists():
            if not media_path.is_file():
                raise RuntimeError("Storyboard Take media path is not a file.")
            media_path.unlink()
    except Exception:
        _write_json_atomic(_story_path(story_id), original_story)
        raise

    return story


@_serialized_mutation
def restore_take(story_id, scene_id, take_id):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    removed = scene.get("removedTakes") if isinstance(scene.get("removedTakes"), dict) else {}
    resolved_take_id = str(take_id or "").strip()
    take = removed.get(resolved_take_id)
    if not isinstance(take, dict):
        raise FileNotFoundError("Removed Take does not exist.")

    restored = dict(take)
    restored.pop("removedAt", None)
    scene["takeOrder"] = _restore_ordered_id(
        scene.get("takeOrder") or [], resolved_take_id, restored, scene.get("takes") or {}
    )
    restored.pop("removedOrderIndex", None)
    restored.pop("removedBeforeId", None)
    restored.pop("removedAfterId", None)
    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    takes[resolved_take_id] = restored
    del removed[resolved_take_id]
    scene["takes"] = takes
    scene["removedTakes"] = removed
    if not removed:
        for active_take in takes.values():
            if isinstance(active_take, dict):
                active_take.pop("_restoreOrder", None)
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story


def _take_for_scene(scene, take_id):
    resolved_take_id = str(take_id or "").strip()
    takes = scene.get("takes") if isinstance(scene.get("takes"), dict) else {}
    take = takes.get(resolved_take_id)
    if not isinstance(take, dict):
        raise FileNotFoundError("Take does not exist.")
    return resolved_take_id, take


def _resolved_story_media_path(story_id, media_path):
    raw = str(media_path or "").strip()
    relative = Path(raw)
    if not raw or relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Storyboard media path is invalid.")
    root = _story_dir(story_id).resolve()
    resolved = (root / relative).resolve()
    if resolved != root and root not in resolved.parents:
        raise RuntimeError("Storyboard media path escapes its Story folder.")
    if not resolved.is_file():
        raise FileNotFoundError("Storyboard media file does not exist.")
    return resolved


def _reference_media_for_take(story_id, source_scene_id, take, frame):
    frame = str(frame or "").strip().lower()
    if frame not in VALID_REFERENCE_FRAMES:
        raise ValueError("Reference frame must be first or last.")
    source_path = _resolved_story_media_path(story_id, take.get("mediaPath"))
    if source_path.suffix.lower() not in VIDEO_EXTS:
        return str(take.get("mediaPath") or "").replace("\\", "/")

    reference_dir = _story_dir(story_id) / "references" / source_scene_id
    reference_dir.mkdir(parents=True, exist_ok=True)
    filename = str(take.get("id") or "") + "-" + frame + ".png"
    output_path = reference_dir / filename
    if not output_path.exists():
        png = extract_boundary_frame_png(source_path, frame)
        fd, tmp_name = tempfile.mkstemp(prefix=filename + ".", suffix=".tmp", dir=str(reference_dir))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(png)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, output_path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
    return ("references/" + source_scene_id + "/" + filename).replace("\\", "/")


def _reference_media_still_used(story, media_path):
    target = str(media_path or "").strip()
    if not target:
        return False
    for scene_map in (story.get("scenes"), story.get("removedScenes")):
        if not isinstance(scene_map, dict):
            continue
        for scene in scene_map.values():
            if not isinstance(scene, dict):
                continue
            for reference in scene.get("references") or []:
                if isinstance(reference, dict) and str(reference.get("mediaPath") or "").strip() == target:
                    return True
    return False


def _cleanup_replaced_uploaded_reference(story_id, story, reference):
    if not isinstance(reference, dict) or reference.get("source") != "upload":
        return
    media_path = str(reference.get("mediaPath") or "").strip()
    if not media_path or _reference_media_still_used(story, media_path):
        return
    try:
        path = _resolved_story_media_path(story_id, media_path)
    except FileNotFoundError:
        return
    try:
        path.unlink()
        parent = path.parent
        root = (_story_dir(story_id) / "references" / "manual").resolve()
        while parent != root and root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    except OSError:
        _logger.exception("Could not clean replaced Storyboard reference upload %s.", media_path)


@_serialized_mutation
def set_scene_reference_upload(story_id, scene_id, role, filename, stream):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    role = str(role or "").strip().lower()
    if role not in {"first_frame", "last_frame"}:
        raise ValueError("Uploaded Storyboard references must target first_frame or last_frame.")

    source_name = str(filename or "").strip()
    safe_name = Path(source_name).name
    if not source_name or safe_name != source_name:
        raise ValueError("Invalid reference image filename.")
    suffix = Path(safe_name).suffix.lower()
    if suffix not in MEDIA_ALL_EXTS or suffix in VIDEO_EXTS:
        raise ValueError("Storyboard reference upload must be an image file.")

    reference_id = _new_id("ref")
    reference_dir = _story_dir(story_id) / "references" / "manual" / scene_id
    reference_dir.mkdir(parents=True, exist_ok=True)
    destination = reference_dir / (reference_id + suffix)
    fd, tmp_name = tempfile.mkstemp(prefix=reference_id + ".", suffix=".tmp", dir=str(reference_dir))
    try:
        with os.fdopen(fd, "wb") as handle:
            shutil.copyfileobj(stream, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, destination)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

    old_reference = next(
        (
            copy.deepcopy(item)
            for item in scene.get("references") or []
            if isinstance(item, dict) and item.get("role") == role
        ),
        None,
    )
    reference = {
        "role": role,
        "source": "upload",
        "sourceFilename": safe_name,
        "mediaPath": str(destination.relative_to(_story_dir(story_id))).replace("\\", "/"),
    }
    references = [
        item for item in scene.get("references") or []
        if not isinstance(item, dict) or item.get("role") != role
    ]
    references.append(reference)
    scene["references"] = references
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    try:
        _write_json_atomic(_story_path(story_id), story)
    except Exception:
        try:
            destination.unlink()
        except OSError:
            _logger.exception("Could not clean failed Storyboard reference upload %s.", destination)
        raise

    _cleanup_replaced_uploaded_reference(story_id, story, old_reference)
    return story, reference


@_serialized_mutation
def set_scene_reference_from_take(story_id, scene_id, role, source_scene_id, source_take_id, frame):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    source_scene_id, source_scene = _scene_for_story(story, source_scene_id)
    source_take_id, take = _take_for_scene(source_scene, source_take_id)

    role = str(role or "").strip().lower()
    if role not in VALID_REFERENCE_ROLES:
        raise ValueError("Unsupported Storyboard reference role.")
    frame = str(frame or "").strip().lower()
    media_path = _reference_media_for_take(story_id, source_scene_id, take, frame)
    old_reference = next(
        (
            copy.deepcopy(item)
            for item in scene.get("references") or []
            if isinstance(item, dict) and item.get("role") == role
        ),
        None,
    )
    reference = {
        "role": role,
        "source": "take",
        "sourceSceneId": source_scene_id,
        "sourceTakeId": source_take_id,
        "frame": frame,
        "mediaPath": media_path,
    }
    references = [item for item in scene.get("references") or [] if isinstance(item, dict) and item.get("role") != role]
    references.append(reference)
    scene["references"] = references
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    _cleanup_replaced_uploaded_reference(story_id, story, old_reference)
    return story, reference


@_serialized_mutation
def clear_scene_reference(story_id, scene_id, role):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    role = str(role or "").strip().lower()
    if role not in VALID_REFERENCE_ROLES:
        raise ValueError("Unsupported Storyboard reference role.")
    removed_reference = next(
        (
            copy.deepcopy(item)
            for item in scene.get("references") or []
            if isinstance(item, dict) and item.get("role") == role
        ),
        None,
    )
    scene["references"] = [
        item for item in scene.get("references") or []
        if not isinstance(item, dict) or item.get("role") != role
    ]
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    _cleanup_replaced_uploaded_reference(story_id, story, removed_reference)
    return story


@_serialized_mutation
def finalize_generated_take(story_id, scene_id, take_id, provenance):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    resolved_take_id, take = _take_for_scene(scene, take_id)
    if not isinstance(provenance, dict):
        raise ValueError("Generated Take provenance must be an object.")

    for key in (
        "prompt",
        "entryState",
        "exitState",
        "sourcePrompt",
        "wildcardsEnabled",
        "durationSeconds",
        "seed",
        "seedMode",
        "aspectRatio",
        "megapixels",
        "loras",
        "references",
        "workflowProfile",
        "providerJobId",
    ):
        if key in provenance:
            take[key] = copy.deepcopy(provenance[key])
    take["generated"] = True
    scene["takes"][resolved_take_id] = take
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story, take


@_serialized_mutation
def label_take(story_id, scene_id, take_id, label):
    story = load_story(story_id)
    scene_id, scene = _scene_for_story(story, scene_id)
    resolved_take_id, take = _take_for_scene(scene, take_id)
    normalized = str(label or "").strip()
    if len(normalized) > 120:
        raise ValueError("Take label must be 120 characters or fewer.")
    take["label"] = normalized
    scene["takes"][resolved_take_id] = take
    scene["updatedAt"] = _utc_now()
    story["updatedAt"] = scene["updatedAt"]
    _write_json_atomic(_story_path(story_id), story)
    return story, take


@_serialized_mutation
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


@_serialized_mutation
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
