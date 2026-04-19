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
