"""Read-only exact scoped-tag reference candidate lookup for dataset-aware evaluation."""
from pathlib import Path
import tomllib

from .training_action import read_action
from .training_runner import _candidate_run_snapshot

SUPPORTED_REFERENCE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

from .caption_ops import _resolve_folder, list_media_files
from .folder_state_store import read_folder_state



def training_image_members(folder, job_id):
    """Only images used by the selected run's effective captured dataset."""
    folder = str(folder or "").strip().replace(chr(92), "/").strip("/")
    job_id = str(job_id or "").strip()
    if not job_id:
        raise ValueError("Select a training run before choosing references.")
    _path, run = _candidate_run_snapshot(folder, job_id)
    action_id = str(run.get("actionId") or "").strip()
    stage = str(run.get("stages") or "").strip().lower()
    if not action_id or stage not in {"hi", "lo", "krea2", "wan21", "h3"}:
        raise ValueError("Training reference membership is unavailable for this run.")
    root, action = read_action(action_id)
    if str(action.get("folder") or "").strip().replace(chr(92), "/").strip("/") != folder:
        raise ValueError("Training action belongs to another Set.")
    input_path = str(run.get("inputPath") or "").strip()
    if not input_path:
        raise ValueError("This run has no recorded training input capture.")
    capture_base = (root / "captures").resolve()
    capture = Path(input_path).resolve()
    if not capture.is_relative_to(capture_base) or not capture.is_dir() or capture.is_symlink():
        raise ValueError("Recorded training capture is invalid or missing.")
    dataset = capture / ("dataset." + stage + ".toml")
    if not dataset.is_file() or dataset.is_symlink():
        raise FileNotFoundError("The captured dataset TOML is unavailable: " + str(dataset))
    config = tomllib.loads(dataset.read_text(encoding="utf-8"))
    directories = config.get("directory") or []
    if not isinstance(directories, list) or not directories:
        raise ValueError("Captured training dataset has no directory entries.")
    media_root = (capture / "media").resolve()
    members = set()
    for entry in directories:
        if not isinstance(entry, dict) or str(entry.get("group") or "").lower() != "images":
            continue
        raw = str(entry.get("path") or "").replace(chr(92), "/").rstrip("/")
        if "/media/" not in raw:
            raise ValueError("Captured image dataset path cannot be resolved: " + raw)
        subpath = raw.rsplit("/media/", 1)[1]
        directory = (media_root / subpath).resolve()
        if not directory.is_relative_to(media_root) or not directory.is_dir():
            raise ValueError("Captured image dataset directory is unavailable: " + raw)
        for file in directory.iterdir():
            if file.is_file() and file.suffix.lower() in SUPPORTED_REFERENCE_EXTENSIONS:
                members.add(file.name)
    if not members:
        raise ValueError("This training run has no verifiable trained images for references.")
    return members


def reference_vocabulary(folder, job_id):
    root = _resolve_folder(folder)
    by_media = read_folder_state(root / ".webcap_state.json").get("caption_group_tags_by_media") or {}
    if not isinstance(by_media, dict):
        raise ValueError("Scoped tag map is invalid.")
    allowed = set(list_media_files(folder)) & training_image_members(folder, job_id)
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


def verified_reference(folder, group, term, media, job_id):
    matches = find_reference_candidates(folder, group, term, job_id)
    reference = next((entry for entry in matches if entry["media"] == media), None)
    if reference is None:
        raise ValueError("Approved reference does not match this dataset tag: " + group + " / " + term)
    return reference


def find_reference_candidates(folder, group, term, job_id):
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
    allowed = training_image_members(folder, job_id)
    for name in list_media_files(folder):
        if name not in allowed:
            continue
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


def suggest_references(folder, job_id, option, limit=10):
    """Rank trained images by existing tag phrase coverage, order-independent.

    Each candidate includes an actual scoped group/tag anchor for the existing
    reference verifier. Partial matches remain suggestions, not proof.
    """
    import re
    words = set(re.findall(r"[a-z0-9]+", str(option or "").casefold()))
    if not words:
        return []
    root = _resolve_folder(folder)
    by_media = read_folder_state(root / ".webcap_state.json").get("caption_group_tags_by_media") or {}
    if not isinstance(by_media, dict):
        raise ValueError("Scoped tag map is invalid.")
    allowed = training_image_members(folder, job_id)
    candidates = []
    for name in sorted(set(list_media_files(folder)) & allowed):
        if Path(name).suffix.lower() not in SUPPORTED_REFERENCE_EXTENSIONS:
            continue
        annotations = by_media.get(name, {})
        if not isinstance(annotations, dict):
            raise ValueError("Invalid scoped tags for " + name)
        matched = []
        covered = set()
        for group, terms in annotations.items():
            if not isinstance(terms, list) or any(not isinstance(t, str) for t in terms):
                raise ValueError("Invalid scoped tags for " + name + " / " + str(group))
            for tag in terms:
                tag_words = set(re.findall(r"[a-z0-9]+", tag.casefold()))
                overlap = tag_words & words
                if not overlap:
                    continue
                # An annotation contributes only when all its meaningful terms match.
                if tag_words <= words:
                    covered.update(tag_words)
                    matched.append((str(group), tag, len(tag_words)))
        if not matched:
            continue
        matched.sort(key=lambda entry: (-entry[2], entry[0], entry[1]))
        group, tag, _ = matched[0]
        path = root / name
        if path.is_symlink():
            raise ValueError("Reference cannot be a symlink: " + name)
        stat = path.stat()
        candidates.append({
            "media": name, "group": group, "tag": tag, "term": tag,
            "matchedTags": [{"group": g, "tag": t} for g, t, _ in matched],
            "matchedWords": len(covered), "totalWords": len(words),
            "complete": covered == words, "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
        })
    candidates.sort(key=lambda entry: (-entry["matchedWords"], -len(entry["matchedTags"]), entry["media"]))
    return candidates[:max(1, min(int(limit), 10))]
