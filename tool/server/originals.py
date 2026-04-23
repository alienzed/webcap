"""
originals.py
Utility for managing the 'originals' folder for media safety.
"""
from pathlib import Path
import shutil
import hashlib

# Blacklisted folder names (never process or mutate)
BLACKLISTED_FOLDERS = {'originals', 'auto_dataset'}

# Supported media extensions (video + image)
MEDIA_ALL_EXTS = {
    '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.mpg', '.mpeg', '.wmv'
}

def is_blacklisted(folder_name):
    return folder_name.lower() in BLACKLISTED_FOLDERS

def file_hash(path, block_size=65536):
    """Return SHA256 hash of a file."""
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(block_size), b''):
            h.update(chunk)
    return h.hexdigest()

def safe_chmod(path, mode):
    try:
        path.chmod(mode)
    except Exception:
        pass

def ensure_originals_folder(folder_path):
    folder_path = Path(folder_path).resolve()
    originals_dir = folder_path / 'originals'
    originals_dir.mkdir(parents=True, exist_ok=True)
    return originals_dir

def copy_media_to_originals(folder_path):
    """
    Copy all media files in folder_path to originals/ if not already present (by name and hash).
    folder_path: absolute or relative path to the folder
    """
    folder_path = Path(folder_path).resolve()
    if is_blacklisted(folder_path.name):
        return  # Never process blacklisted folders
    media_files = [entry for entry in folder_path.iterdir() if entry.is_file() and entry.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return  # Do not create originals folder if no media files
    originals_dir = ensure_originals_folder(folder_path)
    for entry in media_files:
        orig_path = originals_dir / entry.name
        if orig_path.exists() and file_hash(entry) == file_hash(orig_path):
            continue
        shutil.copy2(entry, orig_path)
        safe_chmod(orig_path, 0o644)

def ensure_original_by_hash(src_path, originals_dir):
    """
    Ensure src_path is backed up in originals_dir by hash.
    If a file with the same hash exists, return its path.
    If not, copy it (with unique name if needed), return new path.
    """
    src_path = Path(src_path)
    originals_dir = Path(originals_dir)
    src_hash = file_hash(src_path)
    # Check for existing file with same hash in originals
    for entry in originals_dir.iterdir():
        if entry.is_file() and file_hash(entry) == src_hash:
            return entry
    # No match: copy with unique name if needed
    base = src_path.stem
    ext = src_path.suffix
    candidate = originals_dir / (base + ext)
    i = 1
    while candidate.exists():
        # Avoid name collision
        if file_hash(candidate) == src_hash:
            return candidate
        candidate = originals_dir / (f"{base}-{i}{ext}")
        i += 1
    shutil.copy2(src_path, candidate)
    safe_chmod(candidate, 0o644)
    return candidate

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
    dest_media_path = folder_path / file_name
    if not orig_media_path.exists():
        return False
    shutil.copy2(orig_media_path, dest_media_path)
    safe_chmod(dest_media_path, 0o644)
    # Restore caption file if present (sidecar .txt)
    caption_name = Path(file_name).stem + '.txt'
    orig_caption_path = originals_dir / caption_name
    dest_caption_path = folder_path / caption_name
    if orig_caption_path.exists():
        shutil.copy2(orig_caption_path, dest_caption_path)
        safe_chmod(dest_caption_path, 0o644)
    return True

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
    return True