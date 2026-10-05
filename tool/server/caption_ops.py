
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

    group_order = []
    seen_groups = set()
    for entry in grouped:
        group = str(entry.get("group") or "").strip()
        key = group.lower()
        if not group or key in seen_groups:
            continue
        seen_groups.add(key)
        group_order.append(group)

    payload = {
        "requiredPhrase": required_phrase,
        "groupOrder": group_order,
        "groupedAnnotations": grouped,
        "otherTags": other_tags,
        "currentDraft": draft,
    }
    user_prompt = (
        "Write the caption using these WebCap inputs. Group names explain the meaning of selected tags; "
        "they are not text that must appear in the caption. groupOrder is the user's preferred semantic order: "
        "generally introduce facts in that order when natural, but never make the sentence awkward just to obey it.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )
    return [
        {"role": "system", "content": CAPTION_ASSIST_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


CAPTION_TEMPLATE_ASSIST_SYSTEM_PROMPT = """
You design deterministic WebCap Caption Primer templates from the user's configured annotation schema.

WebCap's Caption Primer is not a freeform caption generator. It resolves configured tag groups and custom mappings into
named values, then renders a reusable text template. Your job is to improve that reusable template so captions read
naturally across many combinations of selected values.

Primer data model and rendering rules:
1. Requirement/tag groups are ordered. Each group has a stable template key supplied in the input.
2. A group's selected terms are rendered before template substitution. For each term:
   - descriptorPrefix/descriptorSuffix are applied directly around the raw term first;
   - wrapperPrefix/wrapperSuffix are then applied around that descriptor-rendered result;
   - WebCap inserts a space between an affix and the text unless the affix already ends/starts with whitespace or
     punctuation that implies direct attachment.
   The input includes renderedDefault so you can see the resulting phrase for each vocabulary value.
3. When multiple terms from one group are selected, WebCap applies its learned per-group precedence and joins the
   rendered terms with that group's configured separator. The template receives the already-joined group value.
4. Custom Primer mappings are additional replacement patterns:
   - scope "tag": the mapping token matches an unscoped tag by normalized exact text;
   - scope "file": the token matches a whole token in the lowercased filename;
   - on match, the mapping contributes mapping.value (or its token when value is blank) to mapping.key.
   Mapping values and group values share the same template-key namespace. Do not invent or modify mappings.
5. Duplicate values are removed, and a shorter value is suppressed when it is wholly contained as a token inside a
   longer value for the same key.

Template grammar:
- {key} emits the resolved value only when that key has a non-empty value; otherwise it disappears.
- Punctuation/literal characters immediately around a simple key can be conditional by putting them inside the braces.
  Example: {surface, } emits "wood floor, " only when surface exists.
- {key|suffix} emits value + suffix only when key exists.
- {prefix|key|suffix} emits prefix + value + suffix only when key exists.
- Literal text outside braces is unconditional. Therefore words such as "lighting", "view", articles, prepositions,
  commas, and sentence glue that depend on an optional value should usually be inside the same conditional placeholder.
- Placeholders cannot nest.
- WebCap trims trailing whitespace on each line, collapses three or more blank lines to two, and trims the final result.

Design requirements:
- Use only keys listed in availableKeys.
- Preserve the user's actual group vocabulary, separators, affixes, mappings, and group order; do not invent facts,
  groups, tags, affixes, or replacement rules.
- Design for arbitrary subsets of groups being populated. A template that reads well only when every group is present
  is not good enough.
- Prefer concise natural training-caption prose over a raw comma-separated tag dump, while retaining deterministic
  behavior.
- Treat currentTemplate as an editable draft: improve it when useful, but do not preserve awkward structure merely
  because it already exists.
- Return only the template text. No markdown fences, labels, explanation, alternatives, or commentary.
""".strip()


def build_caption_template_assist_messages(groups=None, mappings=None, current_template=""):
    clean_groups = []
    available_keys = []
    seen_keys = set()
    for raw_group in groups if isinstance(groups, list) else []:
        if not isinstance(raw_group, dict):
            continue
        label = str(raw_group.get("label") or raw_group.get("group") or "").strip()
        key = str(raw_group.get("key") or "").strip().lower()
        if not label or not key:
            continue
        if key not in seen_keys:
            available_keys.append(key)
            seen_keys.add(key)
        terms = []
        for raw_term in raw_group.get("terms") if isinstance(raw_group.get("terms"), list) else []:
            if not isinstance(raw_term, dict):
                continue
            value = str(raw_term.get("value") or raw_term.get("term") or "").strip()
            if not value:
                continue
            terms.append({
                "value": value,
                "descriptorPrefix": str(raw_term.get("descriptorPrefix") or ""),
                "descriptorSuffix": str(raw_term.get("descriptorSuffix") or ""),
                "wrapperPrefix": str(raw_term.get("wrapperPrefix") or ""),
                "wrapperSuffix": str(raw_term.get("wrapperSuffix") or ""),
                "renderedDefault": str(raw_term.get("renderedDefault") or value).strip(),
            })
        clean_groups.append({
            "label": label,
            "key": key,
            "separator": str(raw_group.get("separator") if raw_group.get("separator") is not None else ", "),
            "precedence": raw_group.get("precedence") if isinstance(raw_group.get("precedence"), dict) else {},
            "terms": terms,
        })

    clean_mappings = []
    for raw_mapping in mappings if isinstance(mappings, list) else []:
        if not isinstance(raw_mapping, dict) or raw_mapping.get("enabled") is False:
            continue
        scope = str(raw_mapping.get("scope") or "tag").strip().lower()
        if scope not in {"tag", "file"}:
            continue
        token = str(raw_mapping.get("token") or "").strip()
        key = str(raw_mapping.get("key") or "").strip().lower()
        value = str(raw_mapping.get("value") or "").strip()
        if not token or not key:
            continue
        if key not in seen_keys:
            available_keys.append(key)
            seen_keys.add(key)
        clean_mappings.append({
            "scope": scope,
            "token": token,
            "key": key,
            "value": value,
        })

    if not clean_groups and not clean_mappings:
        raise ValueError("Caption Template Assist needs at least one configured group or Primer mapping.")

    payload = {
        "availableKeys": available_keys,
        "groupsInOrder": clean_groups,
        "customMappings": clean_mappings,
        "currentTemplate": str(current_template or ""),
    }
    return [
        {"role": "system", "content": CAPTION_TEMPLATE_ASSIST_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Create one improved WebCap Caption Primer template from this exact schema. "
                "Use the vocabulary examples to choose grammatical placement and conditional glue.\n\n"
                + json.dumps(payload, ensure_ascii=False, indent=2)
            ),
        },
    ]
