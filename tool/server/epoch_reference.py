"""Read-only exact scoped-tag reference candidate lookup for dataset-aware evaluation."""
from pathlib import Path

from .caption_ops import _resolve_folder, list_media_files
from .folder_state_store import read_folder_state


def find_reference_candidates(folder, group, term):
    """Return deterministically sorted media annotated with exact group and term.

    Unsupported annotation shapes fail explicitly rather than silently matching text.
    This establishes membership, not whether the detail is visible.
    """
    group = str(group or "").strip()
    term = str(term or "").strip()
    if not group or not term:
        raise ValueError("Reference lookup requires a group and term.")
    root = _resolve_folder(folder)
    state = read_folder_state(root / ".webcap_state.json")
    by_media = state.get("caption_group_tags_by_media") or {}
    if not isinstance(by_media, dict):
        raise ValueError("Scoped tag map is invalid.")
    results = []
    for name in list_media_files(folder):
        annotations = by_media.get(name, {})
        if not isinstance(annotations, dict):
            raise ValueError("Invalid scoped tag annotations for " + name)
        values = annotations.get(group, [])
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            raise ValueError("Invalid scoped tag options for " + name + " / " + group)
        if term in values:
            path = root / name
            if path.is_symlink():
                raise ValueError("Reference cannot be a symlink: " + name)
            stat = path.stat()
            results.append({"media": name, "group": group, "term": term,
                            "size": stat.st_size, "mtimeNs": stat.st_mtime_ns})
    return results
