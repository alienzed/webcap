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
VALID_INVARIANT_KINDS = {"visual", "character", "location", "world", "sound", "custom"}
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
    return app_config.output_root().resolve() / STORYBOARD_DIRNAME


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


def _normalize_scene_invariant_refs(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Scene invariantRefs must be a list.")
    result = []
    seen = set()
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("Each Scene invariantRef must be an object.")
        kind = str(raw.get("kind") or "").strip().lower()
        title = str(raw.get("title") or "").strip()
        if kind not in {"character", "location"} or not title:
            raise ValueError("Scene invariantRefs must contain a character/location kind and non-empty title.")
        key = (kind, title.casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append({"kind": kind, "title": title})
    return result


def _normalize_shared_context_refs(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Scene sharedContextRefs must be a list.")
    result = []
    seen = set()
    for raw in value:
        ref = str(raw or "").strip()
        if not ref:
            raise ValueError("Scene sharedContextRefs must contain non-empty strings.")
        key = ref.casefold()
        if key in seen:
            raise ValueError("Scene sharedContextRefs must not contain duplicates.")
        seen.add(key)
        result.append(ref)
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


def resolve_scene_invariant_context(story, scene):
    refs = scene.get("invariantRefs") if isinstance((scene or {}).get("invariantRefs"), list) else []
    invariants = story.get("invariants") if isinstance((story or {}).get("invariants"), list) else []
    by_key = {}
    for item in invariants:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip().lower()
        title = str(item.get("title") or "").strip()
        text = str(item.get("text") or "").strip()
        if kind in {"character", "location"} and title and text:
            by_key[(kind, title.casefold())] = kind.capitalize() + " " + title + ": " + text
    lines = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        kind = str(ref.get("kind") or "").strip().lower()
        title = str(ref.get("title") or "").strip()
        value = by_key.get((kind, title.casefold()))
        if value:
            lines.append(value)
    return "\n".join(lines)


def resolve_scene_shared_context(story, scene):
    refs = scene.get("sharedContextRefs") if isinstance((scene or {}).get("sharedContextRefs"), list) else []
    if not refs:
        return ""
    development = story.get("development") if isinstance((story or {}).get("development"), dict) else {}
    plan = development.get("plan") if isinstance(development.get("plan"), dict) else {}
    shared = plan.get("sharedContext") if isinstance(plan.get("sharedContext"), dict) else {}
    by_id = {}
    for category in ("subjects", "wardrobes", "locations", "persistentFacts"):
        items = shared.get(category) if isinstance(shared.get(category), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            context_id = str(item.get("id") or "").strip()
            description = str(item.get("description") or "").strip()
            if context_id and description:
                by_id[context_id] = (
                    (str(item.get("label") or context_id).strip() or context_id)
                    + ": "
                    + description
                )
    return "\n".join(
        by_id[ref]
        for ref in (str(value or "").strip() for value in refs)
        if ref in by_id
    )


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

    refine_complete = value.get("refineComplete", current.get("refineComplete", False))
    if not isinstance(refine_complete, bool):
        raise ValueError("Scene refineComplete must be boolean.")

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
        "previousPrompt": (
            str(value.get("previousPrompt"))
            if isinstance(value.get("previousPrompt"), str)
            else (current.get("previousPrompt") if isinstance(current.get("previousPrompt"), str) else None)
        ),
        "promptDirectorModel": str(value.get("promptDirectorModel", current.get("promptDirectorModel", "")) or "").strip(),
        "promptDirectorJobId": str(value.get("promptDirectorJobId", current.get("promptDirectorJobId", "")) or "").strip(),
        "refineComplete": refine_complete,
        "planDirectorModel": str(value.get("planDirectorModel", current.get("planDirectorModel", "")) or "").strip(),
        "invariantRefs": _normalize_scene_invariant_refs(
            value.get("invariantRefs", current.get("invariantRefs", []))
        ),
        "sharedContextRefs": _normalize_shared_context_refs(
            value.get("sharedContextRefs", current.get("sharedContextRefs", []))
        ),
        "durationSeconds": duration,
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "seed": seed,
        "seedMode": seed_mode,
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
        "repairInstruction": str(payload.get("repairInstruction", current.get("repairInstruction", "")) or ""),
        "repairComplete": bool(payload.get("repairComplete", current.get("repairComplete", False))),
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
        "previousSceneRepair": copy.deepcopy(current.get("previousSceneRepair")) if isinstance(current.get("previousSceneRepair"), dict) else None,
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
        "repairInstruction": source.get("repairInstruction") or "",
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
        "title", "summary", "entryState", "exitState", "prompt", "invariantRefs", "sharedContextRefs",
        "durationSeconds", "aspectRatio", "megapixels", "seed", "seedMode",
        "loras", "storyLoraOverrides", "notes",
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
def apply_defined_invariants(story_id, payload):
    story = load_story(story_id)
    raw_items = payload.get("invariants") if isinstance(payload, dict) else None
    if not isinstance(raw_items, list):
        return story, 0

    existing = _normalize_story_invariants(story.get("invariants") or [])
    existing_subjects = {
        (str(item.get("kind") or "").strip().lower(), str(item.get("title") or "").strip().casefold())
        for item in existing
        if str(item.get("title") or "").strip()
    }
    added = 0
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip().lower()
        title = str(item.get("title") or "").strip()
        text = str(item.get("text") or "").strip()
        if kind not in {"character", "location"} or not title or not text:
            continue
        key = (kind, title.casefold())
        if key in existing_subjects:
            continue
        existing.append({"kind": kind, "title": title, "text": text})
        existing_subjects.add(key)
        added += 1

    if added:
        story["invariants"] = existing
        story["updatedAt"] = _utc_now()
        _write_json_atomic(_story_path(story_id), story)
    return story, added


@_serialized_mutation
def restore_previous_concept(story_id):
    story = load_story(story_id)
    previous = story.get("previousConcept")
    if not isinstance(previous, str):
        raise FileNotFoundError("No previous Story concept is available.")
    current = str(story.get("concept") or "")
    story["concept"] = previous
    story["previousConcept"] = current
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


def _normalize_developed_shared_context(value):
    if not isinstance(value, dict):
        raise ValueError("Developed Story sharedContext must be an object.")
    normalized = {}
    seen_ids = set()
    for category in ("subjects", "wardrobes", "locations", "persistentFacts"):
        items = value.get(category, [])
        if not isinstance(items, list):
            raise ValueError("Developed Story sharedContext " + category + " must be an array.")
        normalized_items = []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict) or not {"id", "label", "description"}.issubset(item):
                raise ValueError(
                    "Developed Story sharedContext "
                    + category
                    + " item "
                    + str(index)
                    + " is missing required fields."
                )
            context_id = str(item.get("id") or "").strip()
            label = str(item.get("label") or "").strip()
            description = str(item.get("description") or "").strip()
            if not context_id or not label or not description:
                raise ValueError("Developed Story sharedContext definitions must have non-empty id, label, and description.")
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", context_id):
                raise ValueError("Developed Story sharedContext id is invalid: " + context_id)
            key = context_id.casefold()
            if key in seen_ids:
                raise ValueError("Developed Story sharedContext ids must be unique.")
            seen_ids.add(key)
            normalized_items.append({
                "id": context_id,
                "label": label,
                "description": description,
            })
        normalized[category] = normalized_items
    return normalized


def _validate_developed_plan(plan, target_scene_count=None, story_invariants=None):
    if not isinstance(plan, dict):
        raise ValueError("Developed Story plan must be an object.")
    if "scenes" not in plan:
        raise ValueError("Developed Story plan is missing Scenes.")

    shared_context = {
        "subjects": [],
        "wardrobes": [],
        "locations": [],
        "persistentFacts": [],
    }
    raw_shared_context = plan.get("sharedContext")
    if raw_shared_context is not None:
        try:
            shared_context = _normalize_developed_shared_context(raw_shared_context)
        except ValueError as exc:
            _logger.warning(
                "Ignoring unusable optional Director sharedContext; Scenes remain usable: %s",
                exc,
            )
    shared_context_id_map = {
        item["id"].casefold(): item["id"]
        for category in shared_context.values()
        for item in category
    }
    invariant_map = {}
    for invariant in story_invariants if isinstance(story_invariants, list) else []:
        if not isinstance(invariant, dict):
            continue
        kind = str(invariant.get("kind") or "").strip().lower()
        title = str(invariant.get("title") or "").strip()
        text = str(invariant.get("text") or "").strip()
        if kind in {"character", "location"} and title and text:
            invariant_map[(kind, title.casefold())] = {"kind": kind, "title": title}

    scenes = plan.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("Developed Story plan Scenes must be an array.")
    if not scenes:
        raise ValueError("Storyboard Director returned no Scenes.")

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
        if not scene_keys.issubset(item):
            raise ValueError("Developed Story Scene " + str(index) + " is missing required fields.")

        text_fields = {}
        for key in ("title", "summary", "entryState", "exitState", "prompt"):
            value = item.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError("Developed Story Scene " + str(index) + " has invalid " + key + ".")
            text_fields[key] = value.strip()

        refs = item.get("sharedContextRefs", [])
        normalized_refs = []
        seen_refs = set()
        if isinstance(refs, list):
            for value in refs:
                if not isinstance(value, str) or not value.strip():
                    continue
                ref = value.strip()
                key = ref.casefold()
                if key in seen_refs or key not in shared_context_id_map:
                    continue
                seen_refs.add(key)
                normalized_refs.append(shared_context_id_map[key])
        elif refs not in (None, ""):
            _logger.warning(
                "Ignoring optional Director sharedContextRefs for Scene %s because they are not an array.",
                index,
            )

        raw_invariant_refs = item.get("invariantRefs", [])
        normalized_invariant_refs = []
        seen_invariant_refs = set()
        if isinstance(raw_invariant_refs, list):
            for ref in raw_invariant_refs:
                if not isinstance(ref, dict):
                    continue
                kind = str(ref.get("kind") or "").strip().lower()
                title = str(ref.get("title") or "").strip()
                canonical = invariant_map.get((kind, title.casefold()))
                if canonical is None:
                    continue
                key = (canonical["kind"], canonical["title"].casefold())
                if key in seen_invariant_refs:
                    continue
                seen_invariant_refs.add(key)
                normalized_invariant_refs.append(dict(canonical))
        elif raw_invariant_refs not in (None, ""):
            _logger.warning(
                "Ignoring optional Director invariantRefs for Scene %s because they are not an array.",
                index,
            )

        duration_value = item.get("suggestedDurationSeconds")
        if isinstance(duration_value, bool) or not isinstance(duration_value, (int, float)):
            raise ValueError("Developed Story Scene duration must be numeric.")
        duration = float(duration_value)
        if duration < 4 or duration > 15:
            raise ValueError("Developed Story Scene duration must be between 4 and 15 seconds.")

        continuity = item.get("continuity")
        if not isinstance(continuity, dict) or not continuity_keys.issubset(continuity):
            raise ValueError("Developed Story Scene continuity is missing required fields.")
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
            "invariantRefs": normalized_invariant_refs,
            "sharedContextRefs": normalized_refs,
            "continuity": {
                "continuesPreviousScene": continues_previous,
                "carryForward": [value.strip() for value in carry_forward],
            },
        })
    return {
        "sharedContext": shared_context,
        "scenes": normalized,
    }


@_serialized_mutation
def apply_developed_plan(story_id, plan, model_id=""):
    story = load_story(story_id)
    normalized_plan = _validate_developed_plan(
        plan,
        story.get("targetSceneCount", DEFAULT_TARGET_SCENE_COUNT),
        story.get("invariants"),
    )
    planned_scenes = normalized_plan["scenes"]
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
    story["previousSceneRepair"] = None
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
def apply_director_prompt(story_id, scene_id, prompt, model_id="", job_id="", operation="", duration_override=None):
    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    current = scenes.get(scene_id)
    if not isinstance(current, dict):
        raise FileNotFoundError("Director target Scene does not exist.")
    generated = str(prompt or "")
    if not generated.strip():
        raise ValueError("Storyboard Director returned an empty Scene prompt.")

    scene_patch = {
        "prompt": generated,
        "previousPrompt": str(current.get("prompt") or ""),
        "promptDirectorModel": str(model_id or "").strip(),
        "promptDirectorJobId": str(job_id or "").strip(),
        "refineComplete": str(operation or "").strip() == "refine_prompt",
    }
    if duration_override is not None:
        if str(operation or "").strip() != "refine_prompt":
            raise ValueError("Only Scene refinement may return a duration override.")
        if isinstance(duration_override, bool):
            raise ValueError("Refined Scene duration must be numeric.")
        try:
            duration_override = float(duration_override)
        except (TypeError, ValueError) as exc:
            raise ValueError("Refined Scene duration must be numeric.") from exc
        if duration_override < 6 or duration_override > 15:
            raise ValueError("Refined Scene duration must be between 6 and 15 seconds.")
        scene_patch["durationSeconds"] = duration_override

    scene = _normalize_scene(scene_id, scene_patch, existing=current)
    scenes[scene_id] = scene
    story["scenes"] = scenes
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story, scene


@_serialized_mutation
def apply_scene_repairs(story_id, payload, repair_base, model_id="", job_id=""):
    if not isinstance(payload, dict) or not isinstance(payload.get("changes"), list):
        raise ValueError("Storyboard Scene repair response must contain a changes array.")
    if not isinstance(repair_base, dict):
        raise RuntimeError("Storyboard Scene repair is missing its frozen base state.")

    base_order = repair_base.get("sceneOrder")
    base_scenes = repair_base.get("scenes")
    if not isinstance(base_order, list) or not isinstance(base_scenes, dict):
        raise RuntimeError("Storyboard Scene repair frozen base state is invalid.")

    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}

    current_story_context = {
        "title": str(story.get("title") or ""),
        "concept": str(story.get("concept") or ""),
        "style": str(story.get("style") or ""),
        "invariants": story.get("invariants") if isinstance(story.get("invariants"), list) else [],
    }
    if current_story_context != repair_base.get("storyContext"):
        raise RuntimeError(
            "Story context changed while Check & Repair was running. Run Check & Repair again so newer edits are preserved."
        )
    if list(story.get("sceneOrder") or []) != list(base_order):
        raise RuntimeError(
            "Scene order changed while Check & Repair was running. Run Check & Repair again so newer edits are preserved."
        )
    for scene_id in base_order:
        current = scenes.get(scene_id)
        base_scene = base_scenes.get(scene_id)
        if not isinstance(current, dict) or not isinstance(base_scene, dict):
            raise RuntimeError("A Scene changed structurally while Check & Repair was running. Run Check & Repair again.")
        current_context = {
            "title": str(current.get("title") or ""),
            "summary": str(current.get("summary") or ""),
            "entryState": str(current.get("entryState") or ""),
            "exitState": str(current.get("exitState") or ""),
            "prompt": str(current.get("prompt") or ""),
            "durationSeconds": current.get("durationSeconds"),
            "referenceRoles": [
                str(reference.get("role") or "").strip()
                for reference in current.get("references") or []
                if isinstance(reference, dict)
            ],
            "invariantRefs": current.get("invariantRefs") if isinstance(current.get("invariantRefs"), list) else [],
        }
        if current_context != base_scene:
            raise RuntimeError(
                "Scene context changed while Check & Repair was running. Run Check & Repair again so newer edits are preserved."
            )

    allowed_fields = ("summary", "entryState", "exitState", "prompt")
    prepared = []
    seen_numbers = set()

    for raw in payload["changes"]:
        if not isinstance(raw, dict):
            continue
        scene_number = raw.get("sceneNumber")
        if isinstance(scene_number, bool) or not isinstance(scene_number, int):
            continue
        if scene_number < 1 or scene_number > len(base_order):
            continue
        fields = raw.get("fields")
        if not isinstance(fields, dict):
            continue
        if scene_number in seen_numbers:
            _logger.warning("Ignoring duplicate optional Scene repair patch for Scene %s.", scene_number)
            continue
        scene_id = str(base_order[scene_number - 1] or "").strip()
        current = scenes.get(scene_id)
        base_scene = base_scenes.get(scene_id)
        if not isinstance(current, dict) or not isinstance(base_scene, dict):
            raise RuntimeError("A Scene changed structurally while Check & Repair was running. Run Check & Repair again.")

        patch = {}
        for key in allowed_fields:
            if key not in fields:
                continue
            value = fields.get(key)
            if not isinstance(value, str):
                continue
            if key in {"summary", "prompt"} and not value.strip():
                continue
            current_value = str(current.get(key) or "")
            base_value = str(base_scene.get(key) or "")
            if current_value != base_value:
                raise RuntimeError(
                    "Scene "
                    + str(scene_number)
                    + " changed while Check & Repair was running. Run Check & Repair again so newer edits are preserved."
                )
            normalized_value = value if key == "prompt" else value.strip()
            if normalized_value != current_value:
                patch[key] = normalized_value

        if patch:
            seen_numbers.add(scene_number)
            prepared.append((scene_id, patch))

    if not prepared:
        story["repairInstruction"] = ""
        story["repairComplete"] = True
        story["updatedAt"] = _utc_now()
        _write_json_atomic(_story_path(story_id), story)
        return story, 0, 0

    new_scenes = copy.deepcopy(scenes)
    repair_snapshot = {
        "createdAt": _utc_now(),
        "model": str(model_id or "").strip(),
        "jobId": str(job_id or "").strip(),
        "scenes": [],
    }
    changed_field_count = 0

    for scene_id, patch in prepared:
        current = new_scenes[scene_id]
        before = {key: str(current.get(key) or "") for key in patch}
        normalize_patch = dict(patch)
        prompt_meta_before = None
        if "prompt" in patch:
            prompt_meta_before = {
                "previousPrompt": current.get("previousPrompt") if isinstance(current.get("previousPrompt"), str) else None,
                "promptDirectorModel": str(current.get("promptDirectorModel") or ""),
                "promptDirectorJobId": str(current.get("promptDirectorJobId") or ""),
                "refineComplete": bool(current.get("refineComplete")),
            }
            normalize_patch.update({
                "previousPrompt": str(current.get("prompt") or ""),
                "promptDirectorModel": str(model_id or "").strip(),
                "promptDirectorJobId": str(job_id or "").strip(),
                "refineComplete": False,
            })
        repaired = _normalize_scene(scene_id, normalize_patch, existing=current)
        new_scenes[scene_id] = repaired
        snapshot = {
            "sceneId": scene_id,
            "before": before,
            "after": {key: str(repaired.get(key) or "") for key in patch},
        }
        if prompt_meta_before is not None:
            snapshot["promptMetaBefore"] = prompt_meta_before
        repair_snapshot["scenes"].append(snapshot)
        changed_field_count += len(patch)

    story["scenes"] = new_scenes
    story["previousSceneRepair"] = repair_snapshot
    story["repairInstruction"] = ""
    story["repairComplete"] = True
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story, len(prepared), changed_field_count


@_serialized_mutation
def restore_scene_repairs(story_id):
    story = load_story(story_id)
    snapshot = story.get("previousSceneRepair")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("scenes"), list) or not snapshot["scenes"]:
        raise FileNotFoundError("No previous Scene repair is available.")

    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    for item in snapshot["scenes"]:
        if not isinstance(item, dict):
            raise RuntimeError("Stored Scene repair snapshot is invalid.")
        scene_id = str(item.get("sceneId") or "").strip()
        before = item.get("before")
        after = item.get("after")
        current = scenes.get(scene_id)
        if not isinstance(current, dict) or not isinstance(before, dict) or not isinstance(after, dict):
            raise RuntimeError("Stored Scene repair snapshot no longer matches the Story.")
        for key, value in after.items():
            if str(current.get(key) or "") != str(value or ""):
                raise RuntimeError(
                    "A repaired Scene has changed since the repair. Restore Last Repair was not applied so newer edits are preserved."
                )

    new_scenes = copy.deepcopy(scenes)
    for item in snapshot["scenes"]:
        scene_id = str(item["sceneId"])
        current = new_scenes[scene_id]
        before = item["before"]
        restored = _normalize_scene(scene_id, before, existing=current)
        if "prompt" in before:
            meta = item.get("promptMetaBefore") if isinstance(item.get("promptMetaBefore"), dict) else {}
            restored["previousPrompt"] = meta.get("previousPrompt") if isinstance(meta.get("previousPrompt"), str) else None
            restored["promptDirectorModel"] = str(meta.get("promptDirectorModel") or "")
            restored["promptDirectorJobId"] = str(meta.get("promptDirectorJobId") or "")
            restored["refineComplete"] = bool(meta.get("refineComplete"))
        new_scenes[scene_id] = restored

    story["scenes"] = new_scenes
    story["previousSceneRepair"] = None
    story["repairComplete"] = False
    story["updatedAt"] = _utc_now()
    _write_json_atomic(_story_path(story_id), story)
    return story


@_serialized_mutation
def restore_previous_prompt(story_id, scene_id):
    story = load_story(story_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    current = scenes.get(scene_id)
    if not isinstance(current, dict):
        raise FileNotFoundError("Scene does not exist.")
    previous = current.get("previousPrompt")
    if not isinstance(previous, str):
        raise FileNotFoundError("No previous Scene prompt is available.")

    scene = _normalize_scene(scene_id, {
        "prompt": previous,
        "previousPrompt": str(current.get("prompt") or ""),
        "promptDirectorModel": "",
        "promptDirectorJobId": "",
        "refineComplete": False,
    }, existing=current)
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
        "invariantRefs": copy.deepcopy(current.get("invariantRefs") or []),
        "sharedContextRefs": copy.deepcopy(current.get("sharedContextRefs") or []),
        "durationSeconds": current.get("durationSeconds", 6),
        "aspectRatio": current.get("aspectRatio"),
        "megapixels": current.get("megapixels"),
        "seed": current.get("seed"),
        "seedMode": current.get("seedMode", "random"),
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
        "durationSeconds",
        "seed",
        "seedMode",
        "aspectRatio",
        "megapixels",
        "loras",
        "references",
        "workflowProfile",
        "providerJobId",
        "effectiveInput",
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
