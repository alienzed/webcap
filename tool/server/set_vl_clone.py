"""Clone a Prep Set into a sibling folder using saved Open Sight descriptions."""

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .caption_ops import _caption_name_for_media, _resolve_folder, list_media_files
from .permissions import normalize_path_permissions, normalize_tree_permissions


_SCOPED_MAPS = (
    "flags", "ratings_by_media", "caption_tags_by_media",
    "caption_group_tags_by_media", "caption_requirements_checked",
    "caption_term_descriptors_by_media", "caption_group_term_descriptors_by_media",
    "caption_assist_candidates", "ai_validation_receipts",
)
_SCOPED_LISTS = (
    "reviewedKeys", "mutated_media_keys",
    "caption_group_term_descriptor_snapshot_media_keys",
)


def _read_object(path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return data


def _write_object(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    normalize_path_permissions(path)


def _source_snapshot(folder):
    source_path = _resolve_folder(folder)
    if source_path.resolve() == Path(app_config.FS_ROOT).resolve():
        raise ValueError("Open a Set folder, not the filesystem root.")
    files = list_media_files(folder)
    metadata = _read_object(source_path / "media_metadata.json")
    descriptions = {}
    for media in files:
        entry = metadata.get(media) if isinstance(metadata.get(media), dict) else {}
        sight = entry.get("vision_sight") if isinstance(entry.get("vision_sight"), dict) else {}
        model = str(sight.get("model") or "").strip()
        description = str(sight.get("description") or "")
        if not model or not description.strip():
            continue
        stat = (source_path / media).stat()
        if sight.get("mtime") != int(stat.st_mtime) or sight.get("size") != stat.st_size:
            continue
        descriptions.setdefault(model, {})[media] = description
    return source_path, files, metadata, descriptions


def preview_vl_set_clone(folder):
    source, media_files, _metadata, descriptions = _source_snapshot(folder)
    total = len(media_files)
    return {
        "ok": True,
        "source_folder": source.relative_to(Path(app_config.FS_ROOT).resolve()).as_posix(),
        "total": total,
        "sources": [
            {"model": model, "available": len(captions), "excluded": total - len(captions)}
            for model, captions in sorted(descriptions.items())
        ],
    }


def _prune_missing_media_state(folder_path, excluded):
    state_path = folder_path / ".webcap_state.json"
    if not state_path.exists() or not excluded:
        return
    state = _read_object(state_path)
    for key in _SCOPED_MAPS:
        values = state.get(key)
        if isinstance(values, dict):
            for media in excluded:
                values.pop(media, None)
    for key in _SCOPED_LISTS:
        values = state.get(key)
        if isinstance(values, list):
            state[key] = [media for media in values if media not in excluded]
    settings = state.get("test_generation_settings")
    if isinstance(settings, dict) and isinstance(settings.get("selectedFiles"), list):
        settings["selectedFiles"] = [media for media in settings["selectedFiles"] if media not in excluded]
    _write_object(state_path, state)


def clone_set_with_vl_captions(folder, model, set_name):
    source, media_files, metadata, sources = _source_snapshot(folder)
    model = str(model or "").strip()
    captions = sources.get(model)
    if not captions:
        raise ValueError("No current saved Open Sight descriptions for that model in this Set.")
    set_name = str(set_name or "").strip()
    if not set_name or set_name in (".", "..") or "/" in set_name or "\\" in set_name:
        raise ValueError("Enter one valid sibling folder name.")
    if Path(set_name).name != set_name:
        raise ValueError("Enter one valid sibling folder name.")
    destination = source.parent / set_name
    if destination.exists():
        raise FileExistsError(f"Set folder already exists: {set_name}")

    # Each media stem has one caption sidecar in WebCap.
    caption_names = [_caption_name_for_media(media) for media in captions]
    if len(caption_names) != len(set(caption_names)):
        raise ValueError("Multiple matched media share a caption filename; rename them before cloning.")

    excluded = set(media_files) - set(captions)
    original_captions = {}
    for media in captions:
        original_path = source / _caption_name_for_media(media)
        original_captions[media] = original_path.read_text(encoding="utf-8") if original_path.is_file() else None

    # Prepare the complete copy off to the side. A failure leaves no half-created Set.
    staging = source.parent / f".{set_name}.vl-clone-{uuid.uuid4().hex}"
    try:
        shutil.copytree(source, staging)
        for media in excluded:
            (staging / media).unlink()
            caption_path = staging / _caption_name_for_media(media)
            if caption_path.exists() and _caption_name_for_media(media) not in caption_names:
                caption_path.unlink()

        for media, text in captions.items():
            caption_path = staging / _caption_name_for_media(media)
            caption_path.write_text(text, encoding="utf-8")
            normalize_path_permissions(caption_path)

        if (staging / "media_metadata.json").exists():
            copy_metadata = dict(metadata)
            for media in excluded:
                copy_metadata.pop(media, None)
            _write_object(staging / "media_metadata.json", copy_metadata)
        _prune_missing_media_state(staging, excluded)
        _write_object(staging / "vl_caption_clone.json", {
            "version": 1,
            "source_set": source.relative_to(Path(app_config.FS_ROOT).resolve()).as_posix(),
            "caption_source": "vision_sight.description",
            "vision_model": model,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "copied_count": len(captions),
            "excluded_files": sorted(excluded),
            "original_captions": original_captions,
        })
        normalize_tree_permissions(staging)
        if destination.exists():
            raise FileExistsError(f"Set folder already exists: {set_name}")
        staging.rename(destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    return {
        "ok": True,
        "folder": destination.relative_to(Path(app_config.FS_ROOT).resolve()).as_posix(),
        "copied_count": len(captions),
        "excluded_count": len(excluded),
        "model": model,
    }
