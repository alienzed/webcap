import json
import re
import time
from collections import defaultdict
from pathlib import Path

from .caption_ops import _resolve_folder, _validate_media_name, list_media_files
from .caption_vision import VISION_MEDIA_EXTS
from .media import set_media_metadata_analysis_block


VISION_SIGHT_VERSION = 1
VISION_SCHEMA_MINING_VERSION = 1

_STOP_WORDS = {
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "from", "with", "without",
    "is", "are", "was", "were", "be", "being", "been", "has", "have", "had", "this", "that",
    "these", "those", "image", "photo", "photograph", "picture", "shows", "show", "showing",
    "visible", "visibly", "appears", "appearing", "seen", "wearing", "wears", "dressed",
}


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
    return sight if str(sight.get("description") or "").strip() else None


def vision_sight_status(folder, model, include_descriptions=False):
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
        if include_descriptions:
            item["description"] = str((sight or {}).get("description") or "")
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


def save_vision_sight(folder, media_name, model, description):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    model = str(model or "").strip()
    description = str(description or "").strip()
    if not model:
        raise ValueError("Vision model is required.")
    if not description:
        raise ValueError("Vision sight description is empty.")

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    if media_path.suffix.casefold() not in VISION_MEDIA_EXTS:
        raise ValueError("Vision sight supports images and videos.")

    stat = media_path.stat()
    sight = {
        "version": VISION_SIGHT_VERSION,
        "model": model,
        "description": description,
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


def _tokens(text):
    raw = re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", str(text or "").casefold())
    return [token for token in raw if token not in _STOP_WORDS and (len(token) > 1 or token.isdigit())]


def mine_sight_records(records, limit=180):
    prepared = []
    for row in records if isinstance(records, list) else []:
        if not isinstance(row, dict):
            continue
        media = str(row.get("file") or "").strip()
        description = str(row.get("description") or "").strip()
        if media and description:
            prepared.append({"file": media, "description": description})

    evidence = defaultdict(set)
    for row in prepared:
        tokens = _tokens(row["description"])
        seen_for_item = set()
        for width in (1, 2, 3):
            for index in range(max(0, len(tokens) - width + 1)):
                gram = tuple(tokens[index:index + width])
                if not gram or gram in seen_for_item:
                    continue
                if width == 1 and len(gram[0]) < 3:
                    continue
                seen_for_item.add(gram)
                evidence[gram].add(row["file"])

    minimum_support = 2 if len(prepared) >= 4 else 1
    candidates = [
        (gram, sorted(media, key=str.casefold))
        for gram, media in evidence.items()
        if len(media) >= minimum_support
    ]
    candidates.sort(key=lambda item: (-len(item[1]), -len(item[0]), " ".join(item[0])))

    patterns = []
    for index, (gram, media) in enumerate(candidates[:max(1, int(limit))], start=1):
        patterns.append({
            "id": "p{:03d}".format(index),
            "label": " ".join(gram),
            "count": len(media),
            "media": media,
            "examples": media[:6],
        })
    return {
        "version": VISION_SCHEMA_MINING_VERSION,
        "itemCount": len(prepared),
        "patternCount": len(patterns),
        "patterns": patterns,
    }


def mine_vision_sight(folder, model):
    status = vision_sight_status(folder, model, include_descriptions=True)
    records = [
        {"file": item["file"], "description": item["description"]}
        for item in status["items"]
        if item["cached"] and item["description"]
    ]
    analysis = mine_sight_records(records)
    analysis["visionModel"] = str(model or "")
    analysis["coverage"] = {"cached": status["cached"], "total": status["total"]}
    return analysis
