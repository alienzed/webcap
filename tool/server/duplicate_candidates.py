import logging
from pathlib import Path

from flask import jsonify

from . import config as app_config
from .media import VIDEO_EXTS, update_media_metadata, write_media_metadata_file
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .permissions import run_with_directory_repair
from .visual_hash import VISUAL_HASH_VERSION, fingerprint_media


logger = logging.getLogger(__name__)

DUPLICATE_CANDIDATES_VERSION = 1
MAX_DHASH_DISTANCE = 6
ASPECT_RATIO_TOLERANCE = 0.05


def _kind_for(path):
    return "video" if Path(path).suffix.lower() in VIDEO_EXTS else "image"


def _parse_resolution(value):
    text = str(value or "").strip().lower()
    if "x" not in text:
        return None
    left, right = text.split("x", 1)
    try:
        width = int(left)
        height = int(right)
    except (TypeError, ValueError):
        return None
    return (width, height) if width > 0 and height > 0 else None


def _aspect_matches(left, right):
    left_dims = _parse_resolution(left.get("resolution"))
    right_dims = _parse_resolution(right.get("resolution"))
    if not left_dims or not right_dims:
        return False
    left_ratio = float(left_dims[0]) / float(left_dims[1])
    right_ratio = float(right_dims[0]) / float(right_dims[1])
    return abs(left_ratio - right_ratio) / max(left_ratio, right_ratio) <= ASPECT_RATIO_TOLERANCE


def _hamming_distance(left, right):
    return (int(left, 16) ^ int(right, 16)).bit_count()


def _valid_dhash(value):
    text = str(value or "")
    if len(text) != 16:
        return False
    try:
        int(text, 16)
    except ValueError:
        return False
    return True


def _fuzzy_matches(left, right):
    if left["kind"] != right["kind"]:
        return False
    left_hash = left["visual_hash"].get("dhash")
    right_hash = right["visual_hash"].get("dhash")
    if not _valid_dhash(left_hash) or not _valid_dhash(right_hash):
        return False
    return _aspect_matches(left["info"], right["info"]) and _hamming_distance(left_hash, right_hash) <= MAX_DHASH_DISTANCE


def _clusters_are_compatible(left, right):
    for left_record in left:
        for right_record in right:
            if left_record["visual_hash"]["sha256"] == right_record["visual_hash"]["sha256"]:
                continue
            if not _fuzzy_matches(left_record, right_record):
                return False
    return True


def _record_payload(record):
    info = record["info"]
    return {
        "file": record["file"],
        "kind": record["kind"],
        "resolution": info.get("resolution"),
        "size_bytes": info.get("size"),
        "duration": info.get("duration") if record["kind"] == "video" else None,
        "fps": info.get("fps") if record["kind"] == "video" else None,
    }


def _group_payload(records):
    ordered = sorted(records, key=lambda record: record["file"].lower())
    hashes = {record["visual_hash"]["sha256"] for record in ordered}
    return {
        "match_type": "exact" if len(hashes) == 1 else "similar",
        "items": [_record_payload(record) for record in ordered],
    }


def build_duplicate_candidates(folder_path, metadata, selected_media=None):
    folder = Path(folder_path)
    selected_names = None if selected_media is None else {
        str(name or "").strip() for name in selected_media if str(name or "").strip()
    }
    records = []
    for path in sorted(folder.iterdir(), key=lambda entry: entry.name.lower()):
        if not path.is_file() or path.suffix.lower() not in MEDIA_ALL_EXTS or is_transient_media_name(path.name):
            continue
        if selected_names is not None and path.name not in selected_names:
            continue
        info = metadata.get(path.name) if isinstance(metadata.get(path.name), dict) else {}
        visual_hash = info.get("visual_hash") if isinstance(info.get("visual_hash"), dict) else {}
        if not visual_hash.get("sha256"):
            continue
        records.append({
            "file": path.name,
            "kind": _kind_for(path),
            "info": info,
            "visual_hash": visual_hash,
        })

    by_sha = {}
    for record in records:
        by_sha.setdefault(record["visual_hash"]["sha256"], []).append(record)
    seed_clusters = sorted(
        by_sha.values(),
        key=lambda cluster: min(record["file"].lower() for record in cluster),
    )
    groups = []
    for cluster in seed_clusters:
        for group in groups:
            if _clusters_are_compatible(group, cluster):
                group.extend(cluster)
                break
        else:
            groups.append(list(cluster))

    payload_groups = [_group_payload(group) for group in groups if len(group) >= 2]
    payload_groups.sort(key=lambda group: (
        0 if group["match_type"] == "exact" else 1,
        group["items"][0]["file"].lower(),
    ))
    return {
        "version": DUPLICATE_CANDIDATES_VERSION,
        "folder": str(folder),
        "population_count": len(records),
        "group_count": len(payload_groups),
        "groups": payload_groups,
    }


def _ensure_visual_hashes(folder_path, metadata, selected_media):
    changed = False
    selected_names = {str(name or "").strip() for name in selected_media if str(name or "").strip()}
    for path in sorted(Path(folder_path).iterdir(), key=lambda entry: entry.name.lower()):
        if path.name not in selected_names or not path.is_file() or path.suffix.lower() not in MEDIA_ALL_EXTS or is_transient_media_name(path.name):
            continue
        info = metadata.get(path.name)
        if not isinstance(info, dict):
            continue
        cached = info.get("visual_hash")
        if isinstance(cached, dict) and cached.get("version") == VISUAL_HASH_VERSION and cached.get("sha256"):
            continue
        visual_hash = fingerprint_media(path, _kind_for(path))
        if visual_hash.get("dhash_error"):
            logger.warning("Visual hash fuzzy decode failed for %s: %s", path.name, visual_hash["dhash_error"])
        info["visual_hash"] = visual_hash
        changed = True
    if changed:
        write_media_metadata_file(Path(folder_path) / "media_metadata.json", metadata)
    return metadata


def duplicate_candidates_response(rel_path, selected_media=None):
    rel_path = str(rel_path or "").strip()
    if not rel_path:
        return jsonify({"error": "Missing folder argument."}), 400
    if selected_media is not None and not isinstance(selected_media, list):
        return jsonify({"error": "selected_media must be a list when provided."}), 400
    selected_media = list(selected_media) if selected_media is not None else None
    try:
        folder_path = app_config.safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        if selected_media == []:
            payload = build_duplicate_candidates(folder_path, {}, [])
        else:
            def analyze():
                metadata = update_media_metadata(folder_path, scoped_filenames=selected_media)
                scoped = selected_media if selected_media is not None else [
                    path.name for path in folder_path.iterdir()
                    if path.is_file() and path.suffix.lower() in MEDIA_ALL_EXTS and not is_transient_media_name(path.name)
                ]
                metadata = _ensure_visual_hashes(folder_path, metadata, scoped)
                return build_duplicate_candidates(folder_path, metadata, selected_media)

            payload = run_with_directory_repair(folder_path, analyze)
        payload["folder"] = rel_path
        return jsonify(payload)
    except Exception as exc:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(exc)}), 500
