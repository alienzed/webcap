import json
import os
import stat
import tempfile
from pathlib import Path

from .permissions import normalize_path_permissions


class FolderStateReadError(RuntimeError):
    pass


class FolderStateUnsafeWriteError(RuntimeError):
    pass


def reject_wholesale_state_map_clear(previous_state, next_state):
    """Reject an ordinary save that would erase a populated protected map."""
    protected_maps = (
        "ratings_by_media",
        "caption_tags_by_media",
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
