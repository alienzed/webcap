"""
originals.py
Utility for managing the 'originals' folder for media safety.
"""
from pathlib import Path
import shutil
import hashlib
import json

# Blacklisted folder names (never process or mutate)
BLACKLISTED_FOLDERS = {'originals', 'auto_dataset', 'src_videos'}

# Supported media extensions (video + image)
MEDIA_ALL_EXTS = {
    '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.mpg', '.mpeg', '.wmv'
}
DETERMINISTIC_MUTATION_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
MEDIA_HASH_INDEX_FILE = 'media_hashes.json'
MEDIA_HASH_INDEX_VERSION = 1


def is_blacklisted_path(folder_path):
    """Return True if any part of the path is blacklisted (originals, auto_dataset)."""
    folder_path = Path(folder_path).resolve()
    return any(part.lower() in BLACKLISTED_FOLDERS for part in folder_path.parts)

def file_hash(path, block_size=65536):
    """Return SHA256 hash of a file."""
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(block_size), b''):
            h.update(chunk)
    return h.hexdigest()


def _read_media_hash_index(folder_path):
    path = Path(folder_path) / MEDIA_HASH_INDEX_FILE
    if not path.exists() or not path.is_file():
        return {"version": MEDIA_HASH_INDEX_VERSION, "files": {}}
    try:
        raw = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {"version": MEDIA_HASH_INDEX_VERSION, "files": {}}
    if not isinstance(raw, dict):
        return {"version": MEDIA_HASH_INDEX_VERSION, "files": {}}
    files = raw.get("files")
    if not isinstance(files, dict):
        files = {}
    return {"version": MEDIA_HASH_INDEX_VERSION, "files": files}


def _write_media_hash_index(folder_path, index_data):
    path = Path(folder_path) / MEDIA_HASH_INDEX_FILE
    payload = {
        "version": MEDIA_HASH_INDEX_VERSION,
        "files": index_data.get("files", {})
    }
    path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    safe_chmod(path, 0o644)


def _get_cached_or_compute_sha256(path, index_files, cache_key):
    path = Path(path)
    stat = path.stat()
    key = str(cache_key or path.name)
    current_size = int(stat.st_size)
    current_mtime_ns = int(stat.st_mtime_ns)
    row = index_files.get(key)
    if isinstance(row, dict):
        try:
            cached_size = int(row.get("size", -1))
        except Exception:
            cached_size = -1
        try:
            cached_mtime_ns = int(row.get("mtime_ns", -1))
        except Exception:
            cached_mtime_ns = -1
        cached_sha = row.get("sha256")
        if cached_size == current_size and cached_mtime_ns == current_mtime_ns and isinstance(cached_sha, str) and cached_sha:
            return cached_sha
    sha = file_hash(path)
    index_files[key] = {
        "size": current_size,
        "mtime_ns": current_mtime_ns,
        "sha256": sha
    }
    return sha

def safe_chmod(path, mode):
    try:
        path.chmod(mode)
    except Exception:
        pass


def ensure_originals_folder(folder_path):
    folder_path = Path(folder_path).resolve()
    if is_blacklisted_path(folder_path):
        # Never create originals in blacklisted folders or their subfolders
        return None
    originals_dir = folder_path / 'originals'
    originals_dir.mkdir(parents=True, exist_ok=True)
    return originals_dir


def copy_media_to_originals(folder_path):
    """
    Back up all media files in folder_path to originals/ if canonical name not already present.
    Baseline-only: no rotation of existing originals, no edited-version tracking.
    folder_path: absolute or relative path to the folder
    """
    folder_path = Path(folder_path).resolve()
    if is_blacklisted_path(folder_path):
        return  # Never process blacklisted folders or their subfolders
    media_files = [entry for entry in folder_path.iterdir() if entry.is_file() and entry.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return  # Do not create originals folder if no media files
    originals_dir = ensure_originals_folder(folder_path)
    if originals_dir is None:
        return
    for entry in media_files:
        ensure_canonical_exists(entry, originals_dir)

def ensure_original_by_hash(src_path, originals_dir):
    """
    Ensure src_path is backed up in originals_dir as baseline-only (single-file entry point).
    If canonical name does not exist in originals, copy once. Otherwise do nothing.
    """
    src_path = Path(src_path)
    originals_dir = Path(originals_dir)
    canonical = originals_dir / src_path.name
    if not canonical.exists():
        shutil.copy2(src_path, canonical)
        safe_chmod(canonical, 0o644)
        return canonical
    # Canonical already exists; do nothing (baseline stays immutable)
    return canonical

def restore_original_media(folder_path, file_name):
    """
    Restore the media file (and its caption, if present) from the originals folder to the working folder.
    Returns True if successful, False if the original media does not exist.
    folder_path: absolute or relative path to the folder
    file_name: name of the media file to restore
    """
    folder_path = Path(folder_path).resolve()
    originals_dir = folder_path / 'originals'
    orig_media_path = originals_dir / file_name
    is_pruned = file_name.startswith("pruned_")
    # Remove pruned_ prefix if present for destination
    if is_pruned:
        dest_file_name = file_name[len("pruned_"):]
        # Also handle -1, -2, etc. (pruned_name-1.ext -> name-1.ext)
        # This is handled by just removing the prefix
    else:
        dest_file_name = file_name
    dest_media_path = folder_path / dest_file_name
    if not orig_media_path.exists():
        return "not_found"
    if dest_media_path.exists():
        return "exists"
    if is_pruned:
        shutil.move(str(orig_media_path), str(dest_media_path))
    else:
        shutil.copy2(orig_media_path, dest_media_path)
    safe_chmod(dest_media_path, 0o644)
    # Restore caption file if present (sidecar .txt)
    caption_name = Path(file_name).stem + '.txt'
    dest_caption_name = Path(dest_file_name).stem + '.txt'
    orig_caption_path = originals_dir / caption_name
    dest_caption_path = folder_path / dest_caption_name
    if orig_caption_path.exists():
        if is_pruned:
            shutil.move(str(orig_caption_path), str(dest_caption_path))
        else:
            shutil.copy2(orig_caption_path, dest_caption_path)
        safe_chmod(dest_caption_path, 0o644)
    return "ok"

def restore_original_media_video_only(folder_path, file_name):
    """
    Restore only the media file from the originals folder to the working folder (do NOT restore caption).
    Returns True if successful, False if the original media does not exist.
    """
    folder_path = Path(folder_path).resolve()
    originals_dir = folder_path / 'originals'
    orig_media_path = originals_dir / file_name
    dest_media_path = folder_path / file_name
    if not orig_media_path.exists():
        return False
    shutil.copy2(orig_media_path, dest_media_path)
    safe_chmod(dest_media_path, 0o644)
    # Do NOT overwrite caption file if it exists
    caption_name = Path(file_name).stem + '.txt'
    orig_caption_path = originals_dir / caption_name
    dest_caption_path = folder_path / caption_name
    if orig_caption_path.exists() and not dest_caption_path.exists():
        shutil.copy2(orig_caption_path, dest_caption_path)
        safe_chmod(dest_caption_path, 0o644)
    return True

def ensure_canonical_exists(src_path, originals_dir):
    """
    Ensure canonical name exists in originals_dir as immutable baseline.
    - If canonical name does not exist, copy once.
    - If canonical name exists, do nothing.
    Returns path to canonical file, or None if copy failed.
    """
    src_path = Path(src_path)
    originals_dir = Path(originals_dir)
    canonical = originals_dir / src_path.name
    if not canonical.exists():
        try:
            shutil.copy2(src_path, canonical)
            safe_chmod(canonical, 0o644)
        except Exception:
            return None
    return canonical


def image_mutation_status_by_hash(folder_path):
    """
    Deterministically report mutation status for still images in `folder_path` by
    comparing current file hash against `originals/<name>` hash.
    Returns a dict keyed by media file name.
    """
    folder_path = Path(folder_path).resolve()
    originals_dir = folder_path / 'originals'
    if not originals_dir.exists() or not originals_dir.is_dir():
        return {}

    index_data = _read_media_hash_index(folder_path)
    index_files = index_data.get("files", {})
    keep_keys = set()
    status = {}

    for entry in sorted(folder_path.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in DETERMINISTIC_MUTATION_IMAGE_EXTS:
            continue
        original_entry = originals_dir / entry.name
        if not original_entry.exists() or not original_entry.is_file():
            continue

        entry_cache_key = entry.name
        original_cache_key = str(Path('originals') / original_entry.name)
        current_sha = _get_cached_or_compute_sha256(entry, index_files, entry_cache_key)
        original_sha = _get_cached_or_compute_sha256(original_entry, index_files, original_cache_key)
        keep_keys.add(entry_cache_key)
        keep_keys.add(original_cache_key)

        status[entry.name] = {
            "mutated": current_sha != original_sha,
            "deterministic_available": True,
            "source": "deterministic"
        }

    stale_keys = [key for key in list(index_files.keys()) if key not in keep_keys]
    for key in stale_keys:
        index_files.pop(key, None)

    _write_media_hash_index(folder_path, index_data)
    return status
