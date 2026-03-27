from pathlib import Path
from werkzeug.utils import secure_filename
from file_ops import ensure_dir
from page_ops import page_dir

ALLOWED_EXTENSIONS = {'.mp4', '.webm', '.ogg'}


def save_media(page: str, uploaded_file) -> str:
    media_dir = page_dir(page) / 'media'
    ensure_dir(media_dir)

    original_name = secure_filename(uploaded_file.filename or '')
    if not original_name:
        raise ValueError('Invalid filename')

    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError('Unsupported file type')

    stem = Path(original_name).stem
    candidate = original_name
    counter = 1
    while (media_dir / candidate).exists():
        candidate = f'{stem}_{counter}{suffix}'
        counter += 1

    uploaded_file.save(media_dir / candidate)
    return candidate
