
from pathlib import Path
import json
import os
import tempfile
from flask import send_from_directory

from . import config as app_config
from .originals import MEDIA_ALL_EXTS, is_transient_media_name
from .permissions import normalize_path_permissions, run_with_directory_repair

def _resolve_folder(folder: str) -> Path:
    folder = (folder or '').strip()
    if not folder:
        # Treat empty string as root
        path = app_config.FS_ROOT
    else:
        path = app_config.safe_join_fs_root(folder)
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
    def collect():
        return [
            entry.name for entry in folder_path.iterdir()
            if entry.is_file() and entry.suffix.lower() in MEDIA_ALL_EXTS and not is_transient_media_name(entry.name)
        ]
    files = run_with_directory_repair(folder_path, collect)
    return sorted(files, key=lambda name: name.lower())

def load_caption_text(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    app_config.debug_print('[BACKEND][READ] Caption load requested.')
    def load():
        if not caption_path.exists():
            return {'caption': '', 'exists': False, 'caption_file': caption_name}
        text = caption_path.read_text(encoding='utf-8')
        app_config.debug_print('[BACKEND][READ] Caption loaded.')
        return {
            'caption': text,
            'exists': True,
            'caption_file': caption_name
        }
    return run_with_directory_repair(folder_path, load)

def save_caption_text(folder: str, media_name: str, text: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    app_config.debug_print('[BACKEND][WRITE] Caption save requested.')
    clean_text = text or ''
    caption_path.parent.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(caption_path.parent)
    if clean_text.strip():
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='w', encoding='utf-8', dir=caption_path.parent,
                prefix=f'.{caption_path.name}.', suffix='.tmp', delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                handle.write(clean_text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, caption_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                try:
                    temporary_path.unlink()
                except OSError:
                    pass
        app_config.debug_print('[BACKEND][WRITE] Caption written.')
        normalize_path_permissions(caption_path)
    elif caption_path.exists():
        caption_path.unlink()
        app_config.debug_print('[BACKEND][WRITE] Caption deleted.')
    return {'ok': True, 'caption_file': caption_name}

def serve_media_file(folder: str, media_name: str):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)

    media_path = folder_path / media_name
    def serve():
        if not media_path.exists() or not media_path.is_file():
            raise FileNotFoundError('Media file not found')
        with media_path.open('rb'):
            pass
        return send_from_directory(folder_path, media_name)
    return run_with_directory_repair(folder_path, serve)


CAPTION_ASSIST_SYSTEM_PROMPT = (
    "You write concise, natural-language training captions for media dataset items. "
    "The user's selected annotation tags are authoritative factual constraints. "
    "Represent every selected tag faithfully while combining redundant wording naturally. "
    "The existing draft may guide wording and may contain useful details, but it must never override selected tags. "
    "Do not invent identity, demographic traits, colors, objects, actions, setting details, camera properties, mood, "
    "or other visual facts that are not present in the selected annotations, required phrase, or draft. "
    "If a required phrase is provided, include it verbatim exactly once. "
    "Write one fluent caption, not a comma-separated tag dump. "
    "Return only the caption text with no quotes, labels, commentary, or markdown."
)


def build_caption_assist_messages(assignments=None, tags=None, required_phrase="", draft=""):
    grouped = []
    seen_grouped = set()
    for entry in assignments if isinstance(assignments, list) else []:
        if not isinstance(entry, dict):
            continue
        group = str(entry.get("group") or entry.get("requirement") or "").strip()
        term = str(entry.get("term") or entry.get("tag") or "").strip()
        if not term:
            continue
        key = (group.lower(), term.lower())
        if key in seen_grouped:
            continue
        seen_grouped.add(key)
        grouped.append({
            "group": group or "Annotation",
            "tag": term,
        })

    other_tags = []
    seen_tags = set()
    for value in tags if isinstance(tags, list) else []:
        tag = str(value or "").strip()
        key = tag.lower()
        if not tag or key in seen_tags:
            continue
        seen_tags.add(key)
        other_tags.append(tag)

    required_phrase = str(required_phrase or "").strip()
    draft = str(draft or "").strip()
    if not grouped and not other_tags and not required_phrase and not draft:
        raise ValueError("Caption Assist needs selected annotations, a required phrase, or an existing draft.")

    payload = {
        "requiredPhrase": required_phrase,
        "groupedAnnotations": grouped,
        "otherTags": other_tags,
        "currentDraft": draft,
    }
    user_prompt = (
        "Write the caption using these WebCap inputs. Group names explain the meaning of selected tags; "
        "they are not text that must appear in the caption.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )
    return [
        {"role": "system", "content": CAPTION_ASSIST_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
