from pathlib import Path
from flask import send_from_directory
from .fs_utils import read_text, write_text, safe_join_fs_root

MEDIA_EXTENSIONS = {
    '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
}


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
        if entry.is_file() and entry.suffix.lower() in MEDIA_EXTENSIONS
    ]
    return sorted(files, key=lambda name: name.lower())


def load_caption_text(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    if not caption_path.exists():
        return {'caption': '', 'exists': False, 'caption_file': caption_name}

    return {
        'caption': read_text(caption_path),
        'exists': True,
        'caption_file': caption_name
    }


def save_caption_text(folder: str, media_name: str, text: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    write_text(caption_path, text or '')
    return {'ok': True, 'caption_file': caption_name}


def serve_media_file(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError('Media file not found')

    return send_from_directory(folder_path, media_name)
