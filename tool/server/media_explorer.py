"""Read-only Media Explorer discovery of durable Generate artifacts.

Only files recorded by Generate manifests are displayed. No persistent index.
"""
from pathlib import Path
from urllib.parse import quote
from . import config as app_config
from .generate_store import list_results


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def _kind(path):
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return ""


def _item(path, role, storage_id, created_at, rating=0, model="", uses=None):
    root = app_config.output_root().resolve()
    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    kind = _kind(candidate)
    if not kind:
        return None
    return {
        "id": "generate:" + path,
        "source": "generate",
        "storageId": storage_id,
        "role": role,
        "mediaKind": kind,
        "fileName": candidate.name,
        "mediaPath": path,
        "mediaUrl": "/fs/generate/media?path=" + quote(path, safe=""),
        "createdAt": created_at,
        "rating": rating if role == "generated" else None,
        "model": model,
        "uses": uses or [],
    }


def discover_generate(limit=500):
    """Discover recorded outputs and their saved reference copies."""
    items = {}
    for record in list_results(limit=limit):
        storage_id = str(record.get("storageId") or "")
        created = int(record.get("createdAt") or 0)
        model = str(record.get("modelId") or "")
        media = str(record.get("mediaPath") or "")
        output = _item(media, "generated", storage_id, created,
                       record.get("rating", 0), model)
        if output:
            items[output["id"]] = output
        references = record.get("references") or {}
        if not isinstance(references, dict):
            continue
        for role, path in references.items():
            relative = str(path or "")
            item = _item(relative, "reference", storage_id, created, model=model,
                         uses=[{"storageId": storage_id, "role": str(role)}])
            if item:
                current = items.get(item["id"])
                if current:
                    current["uses"].extend(item["uses"])
                else:
                    items[item["id"]] = item
    return sorted(items.values(), key=lambda x: (x["createdAt"], x["id"]), reverse=True)


def list_media(limit=60, offset=0, role="", kind="", search="", sort="newest", full=False):
    limit = max(1, min(int(limit), 120))
    offset = max(0, int(offset))
    full = str(full).strip().lower() in ("1", "true", "yes")
    results = discover_generate(limit=None if full else 500)
    if role:
        results = [item for item in results if item["role"] == role]
    if kind:
        results = [item for item in results if item["mediaKind"] == kind]
    if search:
        query = search.casefold()
        results = [item for item in results if query in item["fileName"].casefold()
                   or query in item["model"].casefold()]
    if sort == "oldest":
        results.sort(key=lambda item: (item["createdAt"], item["id"]))
    elif sort == "name":
        results.sort(key=lambda item: (item["fileName"].casefold(), item["id"]))
    elif sort == "rating":
        results.sort(key=lambda item: (-(item["rating"] or 0), -item["createdAt"], item["id"]))
    elif sort != "newest":
        raise ValueError("Unknown media sort.")
    return {"ok": True, "items": results[offset:offset + limit],
            "total": len(results), "offset": offset, "limit": limit,
            "complete": full, "scope": "Generate (all results)" if full else "Generate (latest 500 results)"}
