from pathlib import Path
from flask import send_from_directory
import json
import os

# Load FS_ROOT from config.json
CONFIG_PATH = Path(__file__).resolve().parents[1] / 'config.json'
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)
FS_ROOT = Path(config['filesystem']['root'])

# Minimal safe join (strip .., normalize, join to FS_ROOT)
def safe_join_fs_root(rel_path):
    rel_path = rel_path.strip().replace('..', '').replace('\\', '/').replace('//', '/')
    if rel_path.startswith('/'):
        rel_path = rel_path[1:]
    abs_path = (FS_ROOT / rel_path).resolve()
    return abs_path
from .originals import MEDIA_ALL_EXTS


def _resolve_folder(folder: str) -> Path:
    folder = (folder or '').strip()
    if not folder:
        raise ValueError('Missing folder path')
    path = safe_join_fs_root(folder)
    if not path.exists() or not path.is_dir():
        raise ValueError('Folder does not exist')
    return path


def _validate_media_name(media_name: str) -> str:
    media_name = (media_name or '').strip()
    if not media_name:
        raise ValueError('Missing media filename')

    # Prevent nested paths and traversal in file parameters.
    if Path(media_name).name != media_name:
        raise ValueError('Invalid media filename')
    return media_name


def _caption_name_for_media(media_name: str) -> str:
    return f'{Path(media_name).stem}.txt'


def list_media_files(folder: str):
    folder_path = _resolve_folder(folder)
    files = [
        entry.name for entry in folder_path.iterdir()
        if entry.is_file() and entry.suffix.lower() in MEDIA_ALL_EXTS
    ]
    return sorted(files, key=lambda name: name.lower())


def load_caption_text(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    print(f'[BACKEND][READ] folder: {folder} file: {media_name} caption_file: {caption_name} path: {caption_path}')
    if not caption_path.exists():
        return {'caption': '', 'exists': False, 'caption_file': caption_name}
    text = caption_path.read_text(encoding='utf-8')
    print(f'[BACKEND][READ] FOUND caption: {text[:80]}...')
    return {
        'caption': text,
        'exists': True,
        'caption_file': caption_name
    }


def save_caption_text(folder: str, media_name: str, text: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    print(f'[BACKEND][WRITE] folder: {folder} file: {media_name} caption_file: {caption_name} path: {caption_path}')
    caption_path.parent.mkdir(parents=True, exist_ok=True)
    caption_path.write_text(text or '', encoding='utf-8')
    print(f'[BACKEND][WRITE] WROTE caption: {text[:80]}...')
    try:
        os.chmod(caption_path, 0o644)
    except Exception:
        pass
    return {'ok': True, 'caption_file': caption_name}


def serve_media_file(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError('Media file not found')

    return send_from_directory(folder_path, media_name)
