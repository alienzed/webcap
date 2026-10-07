import json
import time
from collections import defaultdict
from pathlib import Path

from .caption_ops import _resolve_folder, _validate_media_name, list_media_files
from .caption_vision import VISION_MEDIA_EXTS
from .media import set_media_metadata_analysis_block


VISION_SIGHT_VERSION = 2
VISION_SCHEMA_MINING_VERSION = 2

VISION_SCHEMA_SIGHT_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["description", "inventory"],
    "properties": {
        "description": {"type": "string", "minLength": 1},
        "inventory": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "viewpoint",
                "position",
                "things",
                "colors",
                "setting",
                "background",
                "lighting",
                "surface",
                "details",
            ],
            "properties": {
                "viewpoint": {
                    "type": "array",
                    "maxItems": 4,
                    "items": {"type": "string", "minLength": 1},
                },
                "position": {
                    "type": "array",
                    "maxItems": 6,
                    "items": {"type": "string", "minLength": 1},
                },
                "things": {
                    "type": "array",
                    "maxItems": 24,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["name", "qualities"],
                        "properties": {
                            "name": {"type": "string", "minLength": 1},
                            "qualities": {
                                "type": "array",
                                "maxItems": 8,
                                "items": {"type": "string", "minLength": 1},
                            },
                        },
                    },
                },
                "colors": {
                    "type": "array",
                    "maxItems": 24,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["thing", "color"],
                        "properties": {
                            "thing": {"type": "string", "minLength": 1},
                            "color": {"type": "string", "minLength": 1},
                        },
                    },
                },
                "setting": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {"type": "string", "minLength": 1},
                },
                "background": {
                    "type": "array",
                    "maxItems": 12,
                    "items": {"type": "string", "minLength": 1},
                },
                "lighting": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {"type": "string", "minLength": 1},
                },
                "surface": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {"type": "string", "minLength": 1},
                },
                "details": {
                    "type": "array",
                    "maxItems": 16,
                    "items": {"type": "string", "minLength": 1},
                },
            },
        },
    },
}

VISION_SCHEMA_SIGHT_SYSTEM_PROMPT = (
    "You inspect one image to create reusable visual evidence for annotation-vocabulary discovery. "
    "This is not the final training caption. Return two complementary views of the same image: "
    "a concise natural-language description for context and a structured inventory of short, reusable visual facts. "
    "Report only facts clearly supported by the image. If an axis is not observable, leave its array empty rather than guessing. "
    "Keep inventory values compact and visual, not sentence-like prose. Prioritize distinctions useful for prompting and annotation: "
    "camera viewpoint, subject position or pose, visible things and their non-color qualities such as shape, material, pattern, "
    "construction or accessories, explicit thing-to-color relationships, setting, background, lighting, support or surface, "
    "and distinctive repeatable details. Avoid filler such as 'the image shows', 'depicts', or other connective narration. "
    "Do not assume or imitate any existing annotation vocabulary; none is supplied. Return JSON only."
)


def _clean(value, limit=160):
    text = " ".join(str(value or "").split()).strip()
    return text[:limit] if limit else text


def _clean_list(values, limit=16):
    out = []
    seen = set()
    for raw in values if isinstance(values, list) else []:
        value = _clean(raw)
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
        if len(out) >= limit:
            break
    return out


def _strip_json_fence(raw_text):
    text = str(raw_text or "").strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def normalize_vision_schema_sight_payload(data):
    if not isinstance(data, dict):
        raise ValueError("Vision sight response must be an object.")
    description = _clean(data.get("description"), 1200)
    inventory = data.get("inventory")
    if not description or not isinstance(inventory, dict):
        raise ValueError("Vision sight response is missing description or inventory.")

    normalized = {
        "viewpoint": _clean_list(inventory.get("viewpoint"), 4),
        "position": _clean_list(inventory.get("position"), 6),
        "things": [],
        "colors": [],
        "setting": _clean_list(inventory.get("setting"), 8),
        "background": _clean_list(inventory.get("background"), 12),
        "lighting": _clean_list(inventory.get("lighting"), 8),
        "surface": _clean_list(inventory.get("surface"), 8),
        "details": _clean_list(inventory.get("details"), 16),
    }

    thing_seen = set()
    for raw in inventory.get("things") if isinstance(inventory.get("things"), list) else []:
        if not isinstance(raw, dict):
            continue
        name = _clean(raw.get("name"))
        if not name:
            continue
        qualities = _clean_list(raw.get("qualities"), 8)
        key = (name.casefold(), tuple(value.casefold() for value in qualities))
        if key in thing_seen:
            continue
        thing_seen.add(key)
        normalized["things"].append({"name": name, "qualities": qualities})
        if len(normalized["things"]) >= 24:
            break

    color_seen = set()
    for raw in inventory.get("colors") if isinstance(inventory.get("colors"), list) else []:
        if not isinstance(raw, dict):
            continue
        thing = _clean(raw.get("thing"))
        color = _clean(raw.get("color"))
        key = (thing.casefold(), color.casefold())
        if not thing or not color or key in color_seen:
            continue
        color_seen.add(key)
        normalized["colors"].append({"thing": thing, "color": color})
        if len(normalized["colors"]) >= 24:
            break

    return {"description": description, "inventory": normalized}


def normalize_vision_schema_sight_result(raw_text):
    text = _strip_json_fence(raw_text)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Vision model returned invalid Sight JSON.") from exc
    return normalize_vision_schema_sight_payload(payload)


def build_vision_schema_sight_messages(media_reference):
    text = (
        "Inspect this image for reusable visual vocabulary. "
        "The description should preserve useful context and relationships. "
        "The inventory should be atomic and compact. In things, list visually significant subjects, garments, objects, "
        "body or hair features, and environment elements; put non-color qualities on the thing they modify. "
        "In colors, bind every clear color to the thing it colors. "
        "Use details for repeatable construction, trim, connectors, cutouts, closures, unusual geometry, or other visual "
        "characteristics not cleanly represented by the other axes. Empty arrays are correct when something is not visible."
    )
    return [
        {"role": "system", "content": VISION_SCHEMA_SIGHT_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": str(media_reference or "")}},
            ],
        },
    ]


def _load_metadata(folder_path):
    path = Path(folder_path) / "media_metadata.json"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def _current_sight_block(folder_path, media_name, metadata, model):
    media_path = Path(folder_path) / media_name
    if not media_path.exists() or not media_path.is_file():
        return None
    info = metadata.get(media_name)
    if not isinstance(info, dict):
        return None
    sight = info.get("vision_sight")
    if not isinstance(sight, dict):
        return None
    stat = media_path.stat()
    if sight.get("version") != VISION_SIGHT_VERSION:
        return None
    if str(sight.get("model") or "") != str(model or ""):
        return None
    if int(sight.get("mtime") or -1) != int(stat.st_mtime):
        return None
    if int(sight.get("size") or -1) != int(stat.st_size):
        return None
    if not str(sight.get("description") or "").strip() or not isinstance(sight.get("inventory"), dict):
        return None
    return sight


def vision_sight_status(folder, model, include_sight=False):
    folder_path = _resolve_folder(folder)
    metadata = _load_metadata(folder_path)
    items = []
    for media_name in list_media_files(folder):
        media_path = folder_path / media_name
        if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
            continue
        sight = _current_sight_block(folder_path, media_name, metadata, model)
        item = {
            "file": media_name,
            "cached": bool(sight),
        }
        if include_sight:
            item["sight"] = {
                "description": str((sight or {}).get("description") or ""),
                "inventory": dict((sight or {}).get("inventory") or {}),
            }
        items.append(item)
    cached = sum(1 for item in items if item["cached"])
    return {
        "version": VISION_SIGHT_VERSION,
        "model": str(model or ""),
        "total": len(items),
        "cached": cached,
        "pending": max(0, len(items) - cached),
        "items": items,
    }


def save_vision_sight(folder, media_name, model, sight_payload):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    model = str(model or "").strip()
    if not model:
        raise ValueError("Vision model is required.")
    sight_payload = normalize_vision_schema_sight_payload(sight_payload)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
        raise ValueError("Vision sight supports images and videos.")

    stat = media_path.stat()
    sight = {
        "version": VISION_SIGHT_VERSION,
        "model": model,
        "description": sight_payload["description"],
        "inventory": sight_payload["inventory"],
        "mtime": int(stat.st_mtime),
        "size": int(stat.st_size),
        "updatedAt": time.time(),
    }
    return set_media_metadata_analysis_block(
        folder_path,
        media_name,
        "vision_sight",
        sight,
    )


def _evidence_key(category, label):
    return category.casefold(), _clean(label).casefold()


def _add_evidence(buckets, media, category, label, context):
    label = _clean(label)
    if not label:
        return
    key = _evidence_key(category, label)
    row = buckets.get(key)
    if row is None:
        row = {
            "category": category,
            "label": label,
            "media": set(),
            "contexts": [],
        }
        buckets[key] = row
    row["media"].add(media)
    context = _clean(context, 260)
    if context and context not in row["contexts"] and len(row["contexts"]) < 2:
        row["contexts"].append(context)


def mine_sight_records(records, limit=240):
    prepared = []
    for row in records if isinstance(records, list) else []:
        if not isinstance(row, dict):
            continue
        media = str(row.get("file") or "").strip()
        description = _clean(row.get("description"), 1200)
        inventory = row.get("inventory")
        if media and description and isinstance(inventory, dict):
            prepared.append({
                "file": media,
                "description": description,
                "inventory": normalize_vision_schema_sight_payload({
                    "description": description,
                    "inventory": inventory,
                })["inventory"],
            })

    buckets = {}
    for row in prepared:
        media = row["file"]
        context = row["description"]
        inventory = row["inventory"]

        for value in inventory["viewpoint"]:
            _add_evidence(buckets, media, "viewpoint", value, context)
        for value in inventory["position"]:
            _add_evidence(buckets, media, "position", value, context)

        for thing in inventory["things"]:
            name = thing["name"]
            _add_evidence(buckets, media, "thing", name, context)
            for quality in thing["qualities"]:
                _add_evidence(buckets, media, "quality", name + ": " + quality, context)

        for color in inventory["colors"]:
            _add_evidence(buckets, media, "color", color["thing"] + ": " + color["color"], context)

        for field in ("setting", "background", "lighting", "surface", "details"):
            category = "detail" if field == "details" else field
            for value in inventory[field]:
                _add_evidence(buckets, media, category, value, context)

    minimum_support = 2 if len(prepared) >= 4 else 1
    candidates = [
        row for row in buckets.values()
        if len(row["media"]) >= minimum_support
    ]
    candidates.sort(key=lambda row: (
        -len(row["media"]),
        row["category"],
        row["label"].casefold(),
    ))

    evidence = []
    for index, row in enumerate(candidates[:max(1, int(limit))], start=1):
        media = sorted(row["media"], key=str.casefold)
        evidence.append({
            "id": "e{:03d}".format(index),
            "category": row["category"],
            "label": row["label"],
            "count": len(media),
            "media": media,
            "examples": media[:6],
            "contexts": row["contexts"][:2],
        })
    return {
        "version": VISION_SCHEMA_MINING_VERSION,
        "itemCount": len(prepared),
        "evidenceCount": len(evidence),
        "evidence": evidence,
    }


def mine_vision_sight(folder, model):
    status = vision_sight_status(folder, model, include_sight=True)
    records = [
        {
            "file": item["file"],
            "description": item["sight"]["description"],
            "inventory": item["sight"]["inventory"],
        }
        for item in status["items"]
        if item["cached"] and item["sight"]["description"]
    ]
    analysis = mine_sight_records(records)
    analysis["visionModel"] = str(model or "")
    analysis["coverage"] = {"cached": status["cached"], "total": status["total"]}
    return analysis
