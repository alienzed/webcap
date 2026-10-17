"""Read-only exact scoped-tag reference candidate lookup for dataset-aware evaluation."""
from pathlib import Path

SUPPORTED_REFERENCE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

from .caption_ops import _resolve_folder, list_media_files
from .folder_state_store import read_folder_state


def reference_vocabulary(folder):
    root = _resolve_folder(folder)
    by_media = read_folder_state(root / ".webcap_state.json").get("caption_group_tags_by_media") or {}
    if not isinstance(by_media, dict):
        raise ValueError("Scoped tag map is invalid.")
    allowed = set(list_media_files(folder))
    vocabulary = {}
    for name, annotations in by_media.items():
        if name not in allowed or Path(name).suffix.lower() not in SUPPORTED_REFERENCE_EXTENSIONS:
            continue
        if not isinstance(annotations, dict):
            raise ValueError("Invalid scoped tags for " + name)
        for group, values in annotations.items():
            if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
                raise ValueError("Unsupported scoped tag shape for " + name + " / " + str(group))
            for value in values:
                vocabulary.setdefault(str(group), {}).setdefault(value, 0)
                vocabulary[str(group)][value] += 1
    return [{"group": g, "terms": [{"term": term, "count": count} for term, count in sorted(terms.items())]}
            for g, terms in sorted(vocabulary.items())]


def verified_reference(folder, group, term, media):
    matches = find_reference_candidates(folder, group, term)
    reference = next((entry for entry in matches if entry["media"] == media), None)
    if reference is None:
        raise ValueError("Approved reference does not match this dataset tag: " + group + " / " + term)
    return reference


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
        if Path(name).suffix.lower() not in SUPPORTED_REFERENCE_EXTENSIONS:
            continue
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
