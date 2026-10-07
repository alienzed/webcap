import hashlib
import json
import time
from collections import defaultdict
from pathlib import Path

from .caption_ops import _resolve_folder, _validate_media_name, list_media_files
from .caption_vision import VISION_MEDIA_EXTS
from .media import set_media_metadata_analysis_block


VISION_SIGHT_VERSION = 2
VISION_SCHEMA_MINING_VERSION = 2
VISION_VOCABULARY_SIGHT_VERSION = 1
VISION_VOCABULARY_MINING_VERSION = 1

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

VISION_VOCABULARY_SIGHT_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["groups", "other"],
    "properties": {
        "groups": {
            "type": "array",
            "maxItems": 40,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["group", "observations"],
                "properties": {
                    "group": {"type": "string", "minLength": 1},
                    "observations": {
                        "type": "array",
                        "maxItems": 16,
                        "items": {"type": "string", "minLength": 1},
                    },
                },
            },
        },
        "other": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["suggestedGroup", "observations"],
                "properties": {
                    "suggestedGroup": {"type": "string", "minLength": 1},
                    "observations": {
                        "type": "array",
                        "maxItems": 16,
                        "items": {"type": "string", "minLength": 1},
                    },
                },
            },
        },
    },
}

VISION_VOCABULARY_SIGHT_SYSTEM_PROMPT = (
    "You are performing a fresh second visual inspection for annotation-vocabulary discovery. "
    "You are given existing annotation group names as semantic lenses for the inspection. "
    "You are not given the current terms, so describe what you actually see rather than trying to match existing vocabulary. "
    "For every supplied group that has clearly visible relevant evidence, report compact observations in your own literal visual wording. "
    "Use short noun/adjective phrases rather than sentences, and prefer common stable wording over stylistic synonyms. "
    "Then report other visually meaningful concepts that do not fit any supplied group, with a concise suggested group name. "
    "This pass is for discovering missing vocabulary, not assigning tags. Report only what is clearly visible in this image. "
    "Do not infer intent, identity, mood, or hidden attributes. Return JSON only."
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


def _normalize_vocabulary_groups(groups):
    out = []
    seen = set()
    for raw in groups if isinstance(groups, list) else []:
        if not isinstance(raw, dict):
            continue
        name = _clean(raw.get("group") or raw.get("name"), 120)
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        terms = _clean_list(raw.get("terms"), 32)
        out.append({"group": name, "terms": terms})
    return out


def vision_vocabulary_group_signature(groups):
    normalized = _normalize_vocabulary_groups(groups)
    payload = json.dumps(
        [row["group"] for row in normalized],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def build_vision_vocabulary_sight_messages(media_reference, existing_groups):
    groups = _normalize_vocabulary_groups(existing_groups)
    if not groups:
        raise ValueError("Vocabulary discovery needs at least one existing annotation group.")
    text = (
        "Inspect this image again from scratch. Do not rely on any earlier visual answer. "
        "For each supplied group that applies, list concise visible observations that could reveal missing or overly broad vocabulary. "
        "Also list important visible concepts that do not fit the supplied groups under other. "
        "Do not decide the final vocabulary; just produce fresh visual evidence.\n\n"
        + json.dumps({"groups": [row["group"] for row in groups]}, ensure_ascii=False)
    )
    return [
        {"role": "system", "content": VISION_VOCABULARY_SIGHT_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": str(media_reference or "")}},
            ],
        },
    ]


def normalize_vision_vocabulary_sight_payload(data, existing_groups):
    if not isinstance(data, dict):
        raise ValueError("Vocabulary sight response must be an object.")
    if not isinstance(data.get("groups"), list):
        raise ValueError("Vocabulary sight response is missing its groups array.")
    if not isinstance(data.get("other"), list):
        raise ValueError("Vocabulary sight response is missing its other array.")

    groups = _normalize_vocabulary_groups(existing_groups)
    allowed = {row["group"].casefold(): row["group"] for row in groups}
    grouped = {row["group"]: [] for row in groups}

    def add_observations(target, values, label):
        if not isinstance(values, list):
            raise ValueError(label + " observations must be an array.")
        seen = {value.casefold() for value in target}
        for raw in values:
            value = _clean(raw)
            if not value:
                raise ValueError(label + " contains an empty observation.")
            key = value.casefold()
            if key not in seen:
                seen.add(key)
                target.append(value)

    unknown = []
    for index, raw in enumerate(data["groups"], start=1):
        if not isinstance(raw, dict):
            raise ValueError("Vocabulary sight group {} is not an object.".format(index))
        raw_group = _clean(raw.get("group"), 120)
        if not raw_group:
            raise ValueError("Vocabulary sight group {} has an empty name.".format(index))
        observations = raw.get("observations")
        canonical = allowed.get(raw_group.casefold())
        if canonical:
            add_observations(grouped[canonical], observations, "Vocabulary sight group '{}'".format(raw_group))
        else:
            values = []
            add_observations(values, observations, "Vocabulary sight group '{}'".format(raw_group))
            if values:
                unknown.append({"suggestedGroup": raw_group, "observations": values})

    for index, raw in enumerate(data["other"], start=1):
        if not isinstance(raw, dict):
            raise ValueError("Vocabulary sight other item {} is not an object.".format(index))
        suggested = _clean(raw.get("suggestedGroup"), 120)
        if not suggested:
            raise ValueError("Vocabulary sight other item {} has an empty suggestedGroup.".format(index))
        observations = raw.get("observations")
        canonical = allowed.get(suggested.casefold())
        if canonical:
            add_observations(grouped[canonical], observations, "Vocabulary sight other '{}'".format(suggested))
        else:
            values = []
            add_observations(values, observations, "Vocabulary sight other '{}'".format(suggested))
            if values:
                unknown.append({"suggestedGroup": suggested, "observations": values})

    other_by_key = {}
    for row in unknown:
        key = row["suggestedGroup"].casefold()
        target = other_by_key.setdefault(key, {
            "suggestedGroup": row["suggestedGroup"],
            "observations": [],
        })
        add_observations(
            target["observations"],
            row["observations"],
            "Vocabulary sight other '{}'".format(row["suggestedGroup"]),
        )

    return {
        "groups": [
            {"group": row["group"], "observations": grouped[row["group"]]}
            for row in groups
            if grouped[row["group"]]
        ],
        "other": list(other_by_key.values()),
    }


def normalize_vision_vocabulary_sight_result(raw_text, existing_groups):
    text = _strip_json_fence(raw_text)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Vision model returned invalid vocabulary Sight JSON.") from exc
    return normalize_vision_vocabulary_sight_payload(payload, existing_groups)


def _load_metadata(folder_path):
    path = Path(folder_path) / "media_metadata.json"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def _cached_sight_block(folder_path, media_name, metadata, model):
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
    if int(sight.get("version") or 0) not in {1, VISION_SIGHT_VERSION}:
        return None
    if str(sight.get("model") or "") != str(model or ""):
        return None
    if int(sight.get("mtime") or -1) != int(stat.st_mtime):
        return None
    if int(sight.get("size") or -1) != int(stat.st_size):
        return None
    if not str(sight.get("description") or "").strip():
        return None
    return sight


def _structured_sight_block(folder_path, media_name, metadata, model):
    sight = _cached_sight_block(folder_path, media_name, metadata, model)
    if not sight or sight.get("version") != VISION_SIGHT_VERSION or not isinstance(sight.get("inventory"), dict):
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
        sight = _cached_sight_block(folder_path, media_name, metadata, model)
        structured = _structured_sight_block(folder_path, media_name, metadata, model)
        item = {
            "file": media_name,
            "cached": bool(sight),
            "structured": bool(structured),
        }
        if include_sight:
            item["sight"] = {
                "description": str((structured or {}).get("description") or ""),
                "inventory": dict((structured or {}).get("inventory") or {}),
            }
        items.append(item)
    cached = sum(1 for item in items if item["cached"])
    structured = sum(1 for item in items if item["structured"])
    return {
        "version": VISION_SIGHT_VERSION,
        "model": str(model or ""),
        "total": len(items),
        "cached": cached,
        "structured": structured,
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


def _cached_vocabulary_sight_block(folder_path, media_name, metadata, model, group_signature):
    media_path = Path(folder_path) / media_name
    if not media_path.exists() or not media_path.is_file():
        return None
    info = metadata.get(media_name)
    if not isinstance(info, dict):
        return None
    sight = info.get("vision_vocabulary_sight")
    if not isinstance(sight, dict):
        return None
    stat = media_path.stat()
    if int(sight.get("version") or 0) != VISION_VOCABULARY_SIGHT_VERSION:
        return None
    if str(sight.get("model") or "") != str(model or ""):
        return None
    if str(sight.get("groupSignature") or "") != str(group_signature or ""):
        return None
    if int(sight.get("mtime") or -1) != int(stat.st_mtime):
        return None
    if int(sight.get("size") or -1) != int(stat.st_size):
        return None
    if not isinstance(sight.get("groups"), list) or not isinstance(sight.get("other"), list):
        return None
    return sight


def vision_vocabulary_sight_status(folder, model, existing_groups, include_sight=False):
    folder_path = _resolve_folder(folder)
    metadata = _load_metadata(folder_path)
    signature = vision_vocabulary_group_signature(existing_groups)
    items = []
    for media_name in list_media_files(folder):
        media_path = folder_path / media_name
        if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
            continue
        sight = _cached_vocabulary_sight_block(folder_path, media_name, metadata, model, signature)
        item = {"file": media_name, "cached": bool(sight)}
        if include_sight and sight:
            item["sight"] = {
                "groups": list(sight.get("groups") or []),
                "other": list(sight.get("other") or []),
            }
        items.append(item)
    cached = sum(1 for item in items if item["cached"])
    return {
        "version": VISION_VOCABULARY_SIGHT_VERSION,
        "model": str(model or ""),
        "groupSignature": signature,
        "total": len(items),
        "cached": cached,
        "pending": max(0, len(items) - cached),
        "items": items,
    }


def save_vision_vocabulary_sight(folder, media_name, model, existing_groups, sight_payload):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    model = str(model or "").strip()
    if not model:
        raise ValueError("Vision model is required.")
    normalized_groups = _normalize_vocabulary_groups(existing_groups)
    if not normalized_groups:
        raise ValueError("Vocabulary discovery needs at least one existing annotation group.")
    sight_payload = normalize_vision_vocabulary_sight_payload(sight_payload, normalized_groups)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
        raise ValueError("Vocabulary sight supports images and videos.")

    stat = media_path.stat()
    sight = {
        "version": VISION_VOCABULARY_SIGHT_VERSION,
        "model": model,
        "groupSignature": vision_vocabulary_group_signature(normalized_groups),
        "groups": sight_payload["groups"],
        "other": sight_payload["other"],
        "mtime": int(stat.st_mtime),
        "size": int(stat.st_size),
        "updatedAt": time.time(),
    }
    return set_media_metadata_analysis_block(
        folder_path,
        media_name,
        "vision_vocabulary_sight",
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


def vision_sight_records(folder, model, files=None):
    status = vision_sight_status(folder, model, include_sight=True)
    wanted = {
        str(value or "").strip()
        for value in (files or [])
        if str(value or "").strip()
    }
    records = []
    for item in status["items"]:
        if wanted and item["file"] not in wanted:
            continue
        sight = item.get("sight") if isinstance(item.get("sight"), dict) else {}
        description = str(sight.get("description") or "").strip()
        inventory = sight.get("inventory") if isinstance(sight.get("inventory"), dict) else None
        if not item.get("structured") or not description or inventory is None:
            continue
        records.append({
            "file": item["file"],
            "description": description,
            "inventory": inventory,
        })
    return records


def mine_vision_sight(folder, model, files=None):
    status = vision_sight_status(folder, model, include_sight=True)
    records = vision_sight_records(folder, model, files=files)
    analysis = mine_sight_records(records)
    analysis["visionModel"] = str(model or "")
    analysis["coverage"] = {
        "cached": status["cached"],
        "structured": status["structured"],
        "total": status["total"],
    }
    return analysis


def vision_vocabulary_sight_records(folder, model, existing_groups, files=None):
    status = vision_vocabulary_sight_status(
        folder,
        model,
        existing_groups,
        include_sight=True,
    )
    wanted = {
        str(value or "").strip()
        for value in (files or [])
        if str(value or "").strip()
    }
    records = []
    for item in status["items"]:
        if wanted and item["file"] not in wanted:
            continue
        sight = item.get("sight") if isinstance(item.get("sight"), dict) else None
        if not item.get("cached") or sight is None:
            continue
        records.append({
            "file": item["file"],
            "groups": list(sight.get("groups") or []),
            "other": list(sight.get("other") or []),
        })
    return records


def mine_vocabulary_sight_records(records, limit=360, singleton_limit_per_group=18):
    buckets = {}
    dimension_order = []

    def add(media, source, suggested_group, label):
        label = _clean(label)
        suggested_group = _clean(suggested_group, 120)
        if not label or not suggested_group:
            return
        dimension_key = (source, suggested_group.casefold())
        if dimension_key not in dimension_order:
            dimension_order.append(dimension_key)
        key = (source, suggested_group.casefold(), label.casefold())
        row = buckets.get(key)
        if row is None:
            row = {
                "source": source,
                "category": "group" if source == "schema" else "other",
                "suggestedGroup": suggested_group,
                "label": label,
                "media": set(),
            }
            buckets[key] = row
        row["media"].add(media)

    prepared_count = 0
    for record in records if isinstance(records, list) else []:
        if not isinstance(record, dict):
            continue
        media = str(record.get("file") or "").strip()
        if not media:
            continue
        prepared_count += 1
        for group_row in record.get("groups") if isinstance(record.get("groups"), list) else []:
            if not isinstance(group_row, dict):
                continue
            group = _clean(group_row.get("group"), 120)
            for observation in group_row.get("observations") if isinstance(group_row.get("observations"), list) else []:
                add(media, "schema", group, observation)
        for other_row in record.get("other") if isinstance(record.get("other"), list) else []:
            if not isinstance(other_row, dict):
                continue
            suggested = _clean(other_row.get("suggestedGroup"), 120)
            for observation in other_row.get("observations") if isinstance(other_row.get("observations"), list) else []:
                add(media, "other", suggested, observation)

    recurring = [row for row in buckets.values() if len(row["media"]) >= 2]
    recurring.sort(key=lambda row: (
        0 if row["source"] == "schema" else 1,
        row["suggestedGroup"].casefold(),
        -len(row["media"]),
        row["label"].casefold(),
    ))

    singleton_by_dimension = defaultdict(list)
    for row in buckets.values():
        if len(row["media"]) == 1:
            singleton_by_dimension[(row["source"], row["suggestedGroup"].casefold())].append(row)
    singletons = []
    for dimension in dimension_order:
        rows = singleton_by_dimension.get(dimension, [])
        rows.sort(key=lambda row: row["label"].casefold())
        singletons.extend(rows[:max(0, int(singleton_limit_per_group))])

    candidates = (recurring + singletons)[:max(1, int(limit))]
    evidence = []
    for index, row in enumerate(candidates, start=1):
        media = sorted(row["media"], key=str.casefold)
        evidence.append({
            "id": "g{:03d}".format(index),
            "source": row["source"],
            "category": row["category"],
            "suggestedGroup": row["suggestedGroup"],
            "label": row["label"],
            "count": len(media),
            "media": media,
            "examples": media[:6],
            "contexts": [],
        })
    return {
        "version": VISION_VOCABULARY_MINING_VERSION,
        "itemCount": prepared_count,
        "evidenceCount": len(evidence),
        "evidence": evidence,
    }


def mine_vision_vocabulary(folder, model, existing_groups, files=None):
    open_records = vision_sight_records(folder, model, files=files)
    vocabulary_records = vision_vocabulary_sight_records(
        folder,
        model,
        existing_groups,
        files=files,
    )
    open_analysis = mine_sight_records(open_records, limit=180)
    vocabulary_analysis = mine_vocabulary_sight_records(vocabulary_records)

    evidence = []
    for index, row in enumerate(open_analysis.get("evidence") or [], start=1):
        copied = dict(row)
        copied["id"] = "o{:03d}".format(index)
        copied["source"] = "open"
        copied["suggestedGroup"] = ""
        evidence.append(copied)
    evidence.extend(vocabulary_analysis.get("evidence") or [])

    return {
        "version": VISION_VOCABULARY_MINING_VERSION,
        "visionModel": str(model or ""),
        "itemCount": len(open_records),
        "openItemCount": len(open_records),
        "schemaAwareItemCount": len(vocabulary_records),
        "evidenceCount": len(evidence),
        "evidence": evidence,
        "coverage": {
            "open": len(open_records),
            "schemaAware": len(vocabulary_records),
        },
    }
