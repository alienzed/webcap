"""Explicit, owner-local Storyboard media archive. No background cleanup or index."""
import copy
from pathlib import Path

from .storyboard_assembly import current_export
from .storyboard_store import (
    _mutation_lock, _story_path, _utc_now, _write_json_atomic,
    load_story, resolve_story_media,
)


def _scenes(story):
    for section in ("scenes", "removedScenes"):
        for scene in (story.get(section) or {}).values():
            if isinstance(scene, dict):
                yield scene


def _take_records(story):
    for scene in _scenes(story):
        for section in ("takes", "removedTakes"):
            for take in (scene.get(section) or {}).values():
                if isinstance(take, dict):
                    yield take


def _archive_plan(story_id, story):
    exported = current_export(story_id)
    if not exported:
        raise ValueError("Export the selected sequence before archiving its generated Takes.")
    if not exported.get("current"):
        raise ValueError("The selected sequence changed since export. Export the current selection before archiving.")

    # An archived recipe must retain every still-available input referenced by
    # either today's Scenes or the immutable settings of historical Takes.
    reference_paths = set()
    for item in list(_scenes(story)) + list(_take_records(story)):
        for reference in item.get("references") or []:
            if isinstance(reference, dict) and reference.get("mediaPath"):
                reference_paths.add(str(reference["mediaPath"]).replace("\\", "/"))

    missing_references = []
    for media_path in sorted(reference_paths):
        try:
            resolve_story_media(story_id, media_path)
        except FileNotFoundError:
            # Some references may already have been cleared or their sources
            # explicitly deleted. Report the actual reproducibility limitation.
            missing_references.append(media_path)

    candidates = {}
    imported_count = 0
    kept_generated_count = 0
    for take in _take_records(story):
        media_path = str(take.get("mediaPath") or "").replace("\\", "/")
        if not take.get("generated"):
            imported_count += 1
            continue  # Imported media cannot be regenerated from prompts.
        if media_path in reference_paths:
            kept_generated_count += 1
            continue
        # Only generated, Story-owned Take files are eligible for cleanup.
        path = Path(media_path)
        if len(path.parts) != 3 or path.parts[0] != "takes" or path.is_absolute() or ".." in path.parts:
            raise RuntimeError("Generated Take has an unexpected media path: " + media_path)
        try:
            file = resolve_story_media(story_id, media_path)
        except FileNotFoundError:
            candidates.setdefault(media_path, {"path": None, "size": 0, "takes": []})["takes"].append(take)
            continue
        if file.is_symlink():
            raise RuntimeError("Cannot archive a symlinked Take: " + media_path)
        entry = candidates.setdefault(media_path, {"path": file, "size": file.stat().st_size, "takes": []})
        entry["takes"].append(take)

    return {
        "export": exported,
        "candidates": candidates,
        "preview": {
            "storyId": story_id,
            "exportPath": exported["mediaPath"],
            "reclaimableBytes": sum(item["size"] for item in candidates.values()),
            "purgeTakeCount": sum(len(item["takes"]) for item in candidates.values()),
            "retainedImportedCount": imported_count,
            "retainedReferencedTakeCount": kept_generated_count,
            "missingReferences": missing_references,
        },
    }


def archive_preview(story_id):
    story = load_story(story_id)
    return copy.deepcopy(_archive_plan(story_id, story)["preview"])


def archive_story(story_id):
    # Keep Story metadata and media mutations serialized with existing writes.
    # A failed deletion remains visibly failed and can be retried: successfully
    # removed Takes are recorded individually before proceeding to the next.
    with _mutation_lock:
        story = load_story(story_id)
        plan = _archive_plan(story_id, story)
        reclaimed = 0
        for item in plan["candidates"].values():
            path = item["path"]
            for take in item["takes"]:
                take["mediaPurged"] = True
                if not take.get("mediaPurgedAt"):
                    take["mediaPurgedAt"] = _utc_now()
            _write_json_atomic(_story_path(story_id), story)
            if path is not None:
                path.unlink()
                reclaimed += item["size"]
        story["status"] = "archived"
        story["mediaArchivedAt"] = _utc_now()
        story["updatedAt"] = story["mediaArchivedAt"]
        _write_json_atomic(_story_path(story_id), story)
        return {"story": story, "reclaimedBytes": reclaimed, "preview": plan["preview"]}
