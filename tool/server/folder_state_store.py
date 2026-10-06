import json
import os
import stat
import tempfile
import threading
from pathlib import Path

from .permissions import normalize_path_permissions


class FolderStateReadError(RuntimeError):
    pass


class FolderStateUnsafeWriteError(RuntimeError):
    pass


_folder_state_mutation_lock = threading.Lock()


def set_media_annotation_state(
    state_path,
    media_key,
    *,
    group_tags,
    unscoped_tags,
    checked_requirements,
    descriptors,
    descriptor_snapshot,
    reviewed,
):
    key = str(media_key or "").strip()
    if not key:
        raise ValueError("Media annotation save requires a media key.")
    if not isinstance(group_tags, dict):
        raise ValueError("groupTags must be an object.")
    if not isinstance(unscoped_tags, list):
        raise ValueError("unscopedTags must be an array.")
    if not isinstance(checked_requirements, dict):
        raise ValueError("checkedRequirements must be an object.")
    if not isinstance(descriptors, dict):
        raise ValueError("descriptors must be an object.")

    path = Path(state_path)
    with _folder_state_mutation_lock:
        state = read_folder_state(path)

        def set_map_entry(field, value):
            current = state.get(field)
            current = dict(current) if isinstance(current, dict) else {}
            if value:
                current[key] = value
            else:
                current.pop(key, None)
            state[field] = current

        set_map_entry("caption_group_tags_by_media", group_tags)
        set_map_entry("caption_tags_by_media", unscoped_tags)
        set_map_entry("caption_requirements_checked", checked_requirements)
        set_map_entry("caption_group_term_descriptors_by_media", descriptors)

        snapshot_keys = state.get("caption_group_term_descriptor_snapshot_media_keys")
        snapshot_keys = [str(value or "").strip() for value in snapshot_keys] if isinstance(snapshot_keys, list) else []
        snapshot_keys = [value for value in snapshot_keys if value and value != key]
        if descriptor_snapshot:
            snapshot_keys.append(key)
        state["caption_group_term_descriptor_snapshot_media_keys"] = snapshot_keys

        reviewed_keys = state.get("reviewedKeys")
        reviewed_keys = [str(value or "").strip() for value in reviewed_keys] if isinstance(reviewed_keys, list) else []
        reviewed_keys = [value for value in reviewed_keys if value and value != key]
        if reviewed:
            reviewed_keys.append(key)
        state["reviewedKeys"] = reviewed_keys

        write_folder_state_atomic(path, state)

    return {
        "mediaKey": key,
        "reviewed": bool(reviewed),
    }


def set_media_rating(state_path, media_key, rating):
    key = str(media_key or "").strip()
    if not key:
        raise ValueError("Media rating requires a media key.")
    try:
        normalized = int(round(float(rating)))
    except (TypeError, ValueError) as exc:
        raise ValueError("Media rating must be between 0 and 5.") from exc
    if normalized < 0 or normalized > 5:
        raise ValueError("Media rating must be between 0 and 5.")

    path = Path(state_path)
    with _folder_state_mutation_lock:
        state = read_folder_state(path)
        ratings = state.get("ratings_by_media")
        ratings = dict(ratings) if isinstance(ratings, dict) else {}
        if normalized == 0:
            ratings.pop(key, None)
        else:
            ratings[key] = normalized
        state["ratings_by_media"] = ratings
        write_folder_state_atomic(path, state)
    return normalized


def set_last_training_archive(state_path, archive_fact):
    if not isinstance(archive_fact, dict) or not archive_fact:
        raise ValueError("Training archive marker must be a non-empty object.")

    path = Path(state_path)
    with _folder_state_mutation_lock:
        state = read_folder_state(path)
        state["last_training_archive"] = dict(archive_fact)
        write_folder_state_atomic(path, state)
    return dict(archive_fact)


def reject_wholesale_state_map_clear(previous_state, next_state):
    """Reject an ordinary save that would erase a populated protected map."""
    protected_maps = (
        "ratings_by_media",
        "caption_tags_by_media",
        "caption_group_tags_by_media",
        "flags",
    )
    for field in protected_maps:
        previous_value = previous_state.get(field)
        next_value = next_state.get(field)
        if not isinstance(previous_value, dict) or len(previous_value) < 2:
            continue
        if not isinstance(next_value, dict) or not next_value:
            raise FolderStateUnsafeWriteError(
                f"Refusing to clear all {field} entries from folder state. "
                "Reload the folder and retry the specific edit."
            )


def folder_state_exists(state_path):
    path = Path(state_path)
    try:
        path_stat = path.stat()
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise FolderStateReadError(f"Could not inspect folder state {path}: {exc}") from exc
    if not stat.S_ISREG(path_stat.st_mode):
        raise FolderStateReadError(f"Folder state path is not a file: {path}")
    return True


def read_folder_state(state_path, *, missing_ok=True):
    path = Path(state_path)
    if not folder_state_exists(path):
        if missing_ok:
            return {}
        raise FolderStateReadError(f"Folder state file does not exist: {path}")
    try:
        with path.open("r", encoding="utf-8") as handle:
            state = json.load(handle)
    except Exception as exc:
        raise FolderStateReadError(f"Could not read folder state {path}: {exc}") from exc
    if not isinstance(state, dict):
        raise FolderStateReadError(f"Folder state is not a JSON object: {path}")
    return state


def write_folder_state_atomic(state_path, state):
    path = Path(state_path)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(state, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        normalize_path_permissions(path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            try:
                temporary_path.unlink()
            except OSError:
                pass
