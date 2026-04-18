"""
fs_utils.py

Unified filesystem utilities: path safety, config, and file I/O.
"""
from pathlib import Path
import json
import os
import shutil

# --- Config and Path Safety ---
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

# --- File I/O Utilities ---
def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)

def read_text(path: Path) -> str:
    return path.read_text(encoding='utf-8')

def write_text(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content, encoding='utf-8')
