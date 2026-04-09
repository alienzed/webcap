from pathlib import Path
from flask import send_from_directory
from file_ops import read_text, write_text

MEDIA_EXTENSIONS = {
    '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
}


def _resolve_folder(folder: str) -> Path:
    folder = (folder or '').strip()
    if not folder:
        raise ValueError('Missing folder path')

    path = Path(folder).expanduser().resolve()
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


def rename_media(folder: str, old_media_name: str, new_media_name: str):
    folder_path = _resolve_folder(folder)
    old_media_name = _validate_media_name(old_media_name)
    new_media_name = _validate_media_name(new_media_name)

    new_suffix = Path(new_media_name).suffix.lower()
    if new_suffix not in MEDIA_EXTENSIONS:
        raise ValueError('Unsupported media file type')

    old_media_path = folder_path / old_media_name
    if not old_media_path.exists() or not old_media_path.is_file():
        raise FileNotFoundError('Media file not found')

    new_media_path = folder_path / new_media_name
    if new_media_path.exists():
        raise ValueError('Target media filename already exists')

    old_caption_path = folder_path / _caption_name_for_media(old_media_name)
    new_caption_path = folder_path / _caption_name_for_media(new_media_name)
    if old_caption_path.exists() and old_caption_path != new_caption_path and new_caption_path.exists():
        raise ValueError('Target caption filename already exists')

    old_media_path.rename(new_media_path)
    if old_caption_path.exists() and old_caption_path != new_caption_path:
        old_caption_path.rename(new_caption_path)

    return {
        'ok': True,
        'media': new_media_name,
        'caption_file': new_caption_path.name
    }


def serve_media_file(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    media_path = folder_path / media_name
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError('Media file not found')

    return send_from_directory(folder_path, media_name)
