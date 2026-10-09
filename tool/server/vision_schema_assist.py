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
VISION_VOCABULARY_SIGHT_VERSION = 2
VISION_VOCABULARY_MINING_VERSION = 2

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
    "required": ["caption", "matches"],
    "properties": {
        "caption": {"type": "string", "minLength": 1},
        "matches": {
            "type": "array",
            "maxItems": 40,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["group", "terms"],
                "properties": {
                    "group": {"type": "string", "minLength": 1},
                    "terms": {
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
    "You perform a fresh second visual read of one image using the Set's annotation language as context. "
    "Focus on the image first. Build a concise caption from clearly visible details in the image. "
    "Prefer exact supplied terms when they clearly match what you see. "
    "Use the supplied caption template to guide ordering, emphasis, and visual relationships. "
    "Treat the supplied groups and terms as preferred annotation language. "
    "Return the caption plus the exact supplied terms you used, grouped under their supplied group names. "
    "Keep the response compact and visual. Return JSON only."
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
        terms = []
        term_seen = set()
        for raw_term in raw.get("terms") if isinstance(raw.get("terms"), list) else []:
            term = _clean(raw_term)
            term_key = term.casefold()
            if term and term_key not in term_seen:
                term_seen.add(term_key)
                terms.append(term)
        out.append({"group": name, "terms": terms})
    return out


def vision_vocabulary_group_signature(groups, caption_template=""):
    normalized = _normalize_vocabulary_groups(groups)
    payload = json.dumps(
        {
            "groups": normalized,
            "captionTemplate": str(caption_template or "").strip(),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def build_vision_vocabulary_sight_messages(media_reference, existing_groups, caption_template=""):
    groups = _normalize_vocabulary_groups(existing_groups)
    text = (
        "Make a fresh visual read of this image. "
        "Build the caption from clearly visible details in the image. "
        "Prefer exact supplied terms when they clearly match what you see. "
        "Use the caption template to guide ordering, emphasis, and relationships.\n\n"
        + json.dumps(
            {
                "captionTemplate": str(caption_template or "").strip(),
                "groups": groups,
            },
            ensure_ascii=False,
        )
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
        raise ValueError("Context Sight response must be an object.")
    caption = _clean(data.get("caption"), 1600)
    if not caption:
        raise ValueError("Context Sight response is missing its caption.")
    if not isinstance(data.get("matches"), list):
        raise ValueError("Context Sight response is missing its matches array.")

    groups = _normalize_vocabulary_groups(existing_groups)
    allowed_groups = {row["group"].casefold(): row for row in groups}
    grouped = {row["group"]: [] for row in groups}
    unmatched = []
    prior_diagnostics = data.get("diagnostics")
    prior_warnings = (
        prior_diagnostics.get("parseWarnings")
        if isinstance(prior_diagnostics, dict) else None
    )
    parse_warnings = [
        _clean(value, 240) for value in prior_warnings
        if _clean(value, 240)
    ] if isinstance(prior_warnings, list) else []

    for index, raw in enumerate(data["matches"], start=1):
        if not isinstance(raw, dict):
            parse_warnings.append("Match {} is not an object.".format(index))
            continue
        raw_group = _clean(raw.get("group"), 120)
        if not raw_group:
            parse_warnings.append("Match {} has an empty group.".format(index))
            continue
        raw_terms = raw.get("terms")
        if not isinstance(raw_terms, list):
            parse_warnings.append("Match '{}' terms must be an array.".format(raw_group))
            continue
        target = allowed_groups.get(raw_group.casefold())
        if target is None:
            unmatched.append({
                "group": raw_group,
                "terms": _clean_list(raw_terms, 16),
                "reason": "unknown_group",
            })
            continue
        exact_terms = {term.casefold(): term for term in target["terms"]}
        seen = {term.casefold() for term in grouped[target["group"]]}
        unknown_terms = []
        for raw_term in raw_terms:
            term = _clean(raw_term)
            if not term:
                parse_warnings.append("Match '{}' contains an empty term.".format(raw_group))
                continue
            canonical = exact_terms.get(term.casefold())
            if canonical:
                if canonical.casefold() not in seen:
                    seen.add(canonical.casefold())
                    grouped[target["group"]].append(canonical)
            elif term.casefold() not in {value.casefold() for value in unknown_terms}:
                unknown_terms.append(term)
        if unknown_terms:
            unmatched.append({
                "group": target["group"],
                "terms": unknown_terms,
                "reason": "unknown_term",
            })

    return {
        "caption": caption,
        "matches": [
            {"group": row["group"], "terms": grouped[row["group"]]}
            for row in groups
            if grouped[row["group"]]
        ],
        "diagnostics": {
            "unmatched": unmatched,
            "unmatchedCount": sum(len(row.get("terms") or []) for row in unmatched),
            "parseWarnings": parse_warnings[:24],
        },
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
    if int(sight.get("mtime") or -1) != int(stat.st_mtime):
        return None
    if int(sight.get("size") or -1) != int(stat.st_size):
        return None
    if not str(sight.get("description") or "").strip():
        return None
    return sight


def _structured_sight_block(folder_path, media_name, metadata, model):
    sight = _cached_sight_block(folder_path, media_name, metadata, model)
    if not sight or not isinstance(sight.get("inventory"), dict):
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


def _valid_vocabulary_sight_block(folder_path, media_name, metadata, model):
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
    if int(sight.get("mtime") or -1) != int(stat.st_mtime):
        return None
    if int(sight.get("size") or -1) != int(stat.st_size):
        return None
    if not str(sight.get("caption") or "").strip() or not isinstance(sight.get("matches"), list):
        return None
    return sight


def _cached_vocabulary_sight_block(folder_path, media_name, metadata, model, context_signature):
    sight = _valid_vocabulary_sight_block(folder_path, media_name, metadata, model)
    if not sight:
        return None
    return sight


def vision_vocabulary_sight_status(folder, model, existing_groups, include_sight=False, caption_template=""):
    folder_path = _resolve_folder(folder)
    metadata = _load_metadata(folder_path)
    signature = vision_vocabulary_group_signature(existing_groups, caption_template)
    items = []
    for media_name in list_media_files(folder):
        media_path = folder_path / media_name
        if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
            continue
        latest = _valid_vocabulary_sight_block(folder_path, media_name, metadata, model)
        current = latest
        item = {
            "file": media_name,
            "cached": bool(current),
            "available": bool(latest),
        }
        if include_sight and current:
            item["sight"] = {
                "caption": str(current.get("caption") or ""),
                "matches": list(current.get("matches") or []),
                "diagnostics": dict(current.get("diagnostics") or {}),
            }
        items.append(item)
    cached = sum(1 for item in items if item["cached"])
    available = sum(1 for item in items if item["available"])
    return {
        "version": VISION_VOCABULARY_SIGHT_VERSION,
        "model": str(model or ""),
        "contextSignature": signature,
        "total": len(items),
        "cached": cached,
        "available": available,
        "pending": max(0, len(items) - cached),
        "items": items,
    }


def save_vision_vocabulary_sight(folder, media_name, model, existing_groups, sight_payload, caption_template=""):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    model = str(model or "").strip()
    if not model:
        raise ValueError("Vision model is required.")
    normalized_groups = _normalize_vocabulary_groups(existing_groups)
    if not normalized_groups:
        raise ValueError("Context Sight needs at least one existing annotation group.")
    sight_payload = normalize_vision_vocabulary_sight_payload(sight_payload, normalized_groups)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
        raise ValueError("Context Sight supports images and videos.")

    stat = media_path.stat()
    sight = {
        "version": VISION_VOCABULARY_SIGHT_VERSION,
        "model": model,
        "contextSignature": vision_vocabulary_group_signature(normalized_groups, caption_template),
        "caption": sight_payload["caption"],
        "matches": sight_payload["matches"],
        "diagnostics": sight_payload.get("diagnostics") or {"unmatched": [], "unmatchedCount": 0},
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


def vision_vocabulary_sight_records(
    folder,
    model,
    existing_groups,
    files=None,
    caption_template="",
    current_context=True,
):
    folder_path = _resolve_folder(folder)
    metadata = _load_metadata(folder_path)
    signature = (
        vision_vocabulary_group_signature(existing_groups, caption_template)
        if current_context else ""
    )
    wanted = {
        str(value or "").strip()
        for value in (files or [])
        if str(value or "").strip()
    }
    records = []
    for media_name in list_media_files(folder):
        if wanted and media_name not in wanted:
            continue
        media_path = folder_path / media_name
        if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
            continue
        sight = (
            _cached_vocabulary_sight_block(folder_path, media_name, metadata, model, signature)
            if current_context
            else _valid_vocabulary_sight_block(folder_path, media_name, metadata, model)
        )
        if not sight:
            continue
        records.append({
            "file": media_name,
            "caption": str(sight.get("caption") or ""),
            "matches": list(sight.get("matches") or []),
            "diagnostics": dict(sight.get("diagnostics") or {}),
        })
    return records


def mine_vocabulary_sight_records(records, limit=360, singleton_limit_per_group=18):
    buckets = {}
    dimension_order = []
    captions = []

    def add(media, group, term, context):
        group = _clean(group, 120)
        term = _clean(term)
        if not group or not term:
            return
        group_key = group.casefold()
        key = (group_key, term.casefold())
        if group_key not in dimension_order:
            dimension_order.append(group_key)
        row = buckets.get(key)
        if row is None:
            row = {
                "source": "context",
                "category": "group",
                "suggestedGroup": group,
                "label": term,
                "media": set(),
                "contexts": [],
            }
            buckets[key] = row
        row["media"].add(media)
        context = _clean(context, 420)
        if context and context not in row["contexts"] and len(row["contexts"]) < 2:
            row["contexts"].append(context)

    prepared_count = 0
    for record in records if isinstance(records, list) else []:
        if not isinstance(record, dict):
            continue
        media = str(record.get("file") or "").strip()
        caption = _clean(record.get("caption"), 1600)
        if not media or not caption:
            continue
        prepared_count += 1
        captions.append({"file": media, "caption": caption})
        for match in record.get("matches") if isinstance(record.get("matches"), list) else []:
            if not isinstance(match, dict):
                continue
            group = _clean(match.get("group"), 120)
            for term in match.get("terms") if isinstance(match.get("terms"), list) else []:
                add(media, group, term, caption)

        diagnostics = record.get("diagnostics") if isinstance(record.get("diagnostics"), dict) else {}
        for unmatched in diagnostics.get("unmatched") if isinstance(diagnostics.get("unmatched"), list) else []:
            if not isinstance(unmatched, dict):
                continue
            group = _clean(unmatched.get("group"), 120)
            reason = str(unmatched.get("reason") or "").strip()
            for term in unmatched.get("terms") if isinstance(unmatched.get("terms"), list) else []:
                term = _clean(term)
                if not group or not term:
                    continue
                key = (group.casefold(), term.casefold())
                row = buckets.get(key)
                if row is None:
                    row = {
                        "source": "context_unmatched",
                        "category": "group" if reason == "unknown_term" else "other",
                        "suggestedGroup": group,
                        "label": term,
                        "media": set(),
                        "contexts": [],
                    }
                    buckets[key] = row
                    if group.casefold() not in dimension_order:
                        dimension_order.append(group.casefold())
                row["media"].add(media)
                context = _clean(caption, 420)
                if context and context not in row["contexts"] and len(row["contexts"]) < 2:
                    row["contexts"].append(context)

    recurring = [row for row in buckets.values() if len(row["media"]) >= 2]
    recurring.sort(key=lambda row: (
        row["suggestedGroup"].casefold(),
        -len(row["media"]),
        row["label"].casefold(),
    ))

    singleton_by_dimension = defaultdict(list)
    for row in buckets.values():
        if len(row["media"]) == 1:
            singleton_by_dimension[row["suggestedGroup"].casefold()].append(row)
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
            "contexts": row["contexts"][:2],
        })
    return {
        "version": VISION_VOCABULARY_MINING_VERSION,
        "itemCount": prepared_count,
        "evidenceCount": len(evidence),
        "evidence": evidence,
        "captions": captions,
    }


def mine_vision_vocabulary(folder, model, existing_groups, files=None, caption_template=""):
    open_records = vision_sight_records(folder, model, files=files)
    vocabulary_records = vision_vocabulary_sight_records(
        folder,
        model,
        existing_groups,
        files=files,
        caption_template=caption_template,
        current_context=True,
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
    for index, row in enumerate(vocabulary_analysis.get("captions") or [], start=1):
        file_name = str(row.get("file") or "").strip()
        caption = _clean(row.get("caption"), 420)
        if not file_name or not caption:
            continue
        evidence.append({
            "id": "c{:03d}".format(index),
            "source": "context_caption",
            "category": "caption",
            "suggestedGroup": "",
            "label": caption,
            "count": 1,
            "media": [file_name],
            "examples": [file_name],
            "contexts": [],
        })

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

