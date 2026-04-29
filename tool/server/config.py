"""
config.py

Centralized config and root path logic for the backend.
"""

from pathlib import Path
import json

CONFIG_PATH = Path(__file__).resolve().parents[1] / 'config.json'
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)
FS_ROOT = Path(config['filesystem']['root'])
FS_DEBUG = config.get('debug', False)

def safe_join_fs_root(rel_path):
    rel_path = rel_path.strip().replace('..', '').replace('\\', '/').replace('//', '/')
    if rel_path.startswith('/'):
        rel_path = rel_path[1:]
    abs_path = (FS_ROOT / rel_path).resolve()
    return abs_path

def list_toml_files(folder_path):
    """
    Returns a list of .toml files (names only) in the given folder.
    """
    folder = safe_join_fs_root(folder_path)
    if not folder.exists() or not folder.is_dir():
        return []
    return [f.name for f in folder.iterdir() if f.is_file() and f.name.endswith('.toml')]

def read_toml_file(folder_path, filename):
    """
    Reads and returns the contents of a .toml file in the given folder.
    """
    if '/' in filename or '\\' in filename or '..' in filename or not filename.endswith('.toml'):
        raise ValueError('Invalid config filename')
    folder = safe_join_fs_root(folder_path)
    file_path = folder / filename
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(filename)
    return file_path.read_text(encoding='utf-8')

def save_toml_file(folder_path, filename, text):
    """
    Writes the given text to a .toml file in the given folder.
    """
    if '/' in filename or '\\' in filename or '..' in filename or not filename.endswith('.toml'):
        raise ValueError('Invalid config filename')
    folder = safe_join_fs_root(folder_path)
    file_path = folder / filename
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)
    try:
        import os
        os.chmod(file_path, 0o644)
    except Exception:
        pass
    return True