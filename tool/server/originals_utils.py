"""
originals_utils.py

Utility for managing the 'originals' folder for media safety.
- On folder load, creates/checks 'originals' subfolder (unless blacklisted).
- Copies all media files to 'originals' if not already present (by name and hash).
- Never processes blacklisted folders.
- All mutation operations should call ensure_original_exists() before proceeding.
"""

import os
import shutil
import hashlib

# Blacklisted folder names (never process or mutate)
BLACKLISTED_FOLDERS = {'originals', 'trash', 'auto_dataset'}

# Supported media extensions
MEDIA_EXTS = {'.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpg', '.mpeg', '.wmv'}

def is_blacklisted(folder_name):
    return folder_name.lower() in BLACKLISTED_FOLDERS

def file_hash(path, block_size=65536):
    """Return SHA256 hash of a file."""
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(block_size), b''):
            h.update(chunk)
    return h.hexdigest()


def ensure_originals_folder(working_dir):
        originals_dir = os.path.join(os.path.abspath(working_dir), 'originals')
        os.makedirs(originals_dir, exist_ok=True)
        return originals_dir

def copy_media_to_originals(working_dir):
    """Copy all media files in working_dir to originals/ if not already present (by name and hash)."""
    folder_name = os.path.basename(os.path.abspath(working_dir))
    if is_blacklisted(folder_name):
        return  # Never process blacklisted folders
    originals_dir = ensure_originals_folder(working_dir)
    for fname in os.listdir(working_dir):
        fpath = os.path.join(working_dir, fname)
        if not os.path.isfile(fpath):
            continue
        ext = os.path.splitext(fname)[1].lower()
        if ext not in MEDIA_EXTS:
            continue
        orig_path = os.path.join(originals_dir, fname)
        if os.path.exists(orig_path):
            # Compare hashes; skip if identical
            if file_hash(fpath) == file_hash(orig_path):
                continue
            # If not identical, skip (or could prompt user)
            continue
        shutil.copy2(fpath, orig_path)
        try:
            os.chmod(orig_path, 0o644)
        except Exception:
            pass  # Don't fail if chmod is not supported
