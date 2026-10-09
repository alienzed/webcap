
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
    "You write concise, information-dense natural-language training captions for media dataset items. "
    "Every tag in groupedAnnotations and otherTags is a deliberate user-selected caption fact. Attempt to convey "
    "every distinct selected tag's meaning, including specific small details, rather than choosing a subset. "
    "Combine redundant values naturally, but never silently omit a nonredundant selected value just to shorten "
    "the caption, because the draft lacks it, or because Sight does not independently repeat it. "
    "Prefer compact visual phrases over prose padding: do not add phrases "
    "such as 'the photo shows', 'can be seen', or 'the photo was taken' when they add no visual fact. "
    "Rewrite the existing draft into the best natural caption; retain its meaningful details and improve its coherence. "
    "The existing draft is not more authoritative than deliberate selected tags. "
    "Use Context Sight to preserve visible relationships, including which person's attributes, garments, "
    "and actions belong to which person; do not flatten those relationships into generic shared traits. "
    "Include convincing Sight-only visual details even when no selected tag names them, but avoid uncertain "
    "or unsupported details and never force every Vision observation into the caption. "
    "Do not invent identity, demographic traits, colors, objects, actions, setting details, camera properties, mood, "
    "or other visual facts absent from Open Sight, Context Sight, selected annotations, required phrase, or draft, apart from an "
    "explicit subject description authored in captionTemplate. If a required phrase is provided, include it verbatim "
    "exactly once. captionTemplate and renderedPrimer are loose guidance for structure, vocabulary, affixes, "
    "and resolved tag meaning, not prescribed phrasing or mandatory facts. The order of groupedAnnotations also does not define "
    "caption order. Omit unpopulated facts and never invent content to fill a group. Keep each action and trait clearly "
    "attached to its subject. Preserve distinctive multiword tag phrases verbatim where they already read naturally. "
    "Treat concise camera and viewpoint wording as a preferred surface form: compose supplied angle and orientation "
    "facts into compact photographic phrases such as 'front view', 'low-angle side view', or "
    "'high-angle three-quarter rear view'. Do not rewrite these as 'viewed from the front', 'from a front view', "
    "'seen from the side', or similar verbose variants. Write complete, natural sentences using only the connective "
    "language needed for grammatical and semantic clarity. Interpret each selected value through its annotation group: "
    "use the group meaning to understand what the value modifies or describes, and when the group meanings establish "
    "a clear relationship among supplied details, express those details together as a coherent phrase or clause. "
    "Keep the caption concise and information-dense while preserving the supplied visual facts and distinctive tag wording. "
    "Return only the caption text with no quotes, labels, commentary, or markdown."
)


def build_caption_assist_messages(
    assignments=None,
    tags=None,
    required_phrase="",
    draft="",
    template="",
    rendered_primer="",
    preferred_sequence="",
    corrections=None,
    open_sight=None,
    context_sight=None,
):
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
            "alias": str(entry.get("alias") or "").strip(),
            "key": str(entry.get("key") or "").strip(),
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
    preferred_sequence = str(preferred_sequence or "").replace("\r\n", "\n").strip()
    repair_corrections = []
    seen_corrections = set()
    for raw in corrections if isinstance(corrections, list) else []:
        if not isinstance(raw, dict):
            continue
        group = str(raw.get("group") or "").strip()
        term = str(raw.get("term") or "").strip()
        note = str(raw.get("note") or raw.get("description") or "").strip()
        if not term:
            continue
        key = (group.casefold(), term.casefold())
        if key in seen_corrections:
            continue
        seen_corrections.add(key)
        repair_corrections.append({
            "group": group or "Annotation",
            "term": term,
            "note": note,
        })
    if not grouped and not other_tags and not required_phrase and not draft and not open_sight and not context_sight:
        raise ValueError("Caption Assist needs selected annotations, a required phrase, or an existing draft.")

    payload = {
        "requiredPhrase": required_phrase,
        "groupedAnnotations": grouped,
        "otherTags": other_tags,
        "currentDraft": draft,
        "captionTemplate": str(template or "").strip(),
        "renderedPrimer": str(rendered_primer or "").strip(),
        "preferredCaptionSequence": preferred_sequence,
        "corrections": repair_corrections,
        "openSight": open_sight if isinstance(open_sight, dict) else None,
        "contextSight": context_sight if isinstance(context_sight, dict) else None,
    }
    if preferred_sequence:
        ordering = (
            "preferredCaptionSequence is the user's preferred order for caption content. Follow its broad sequence, "
            "making local moves only for natural grammar or to keep a detail attached to its subject. Groups not explicitly "
            "named in the sequence still belong in the caption; place those unlisted groups immediately before the "
            "final background, lighting, and view portion when that terminal portion is present. "
        )
    else:
        ordering = (
            "preferredCaptionSequence is blank, so do not impose a house order. Arrange every supplied fact in the "
            "most natural concise order while preserving all facts. "
        )
    repair_instruction = ""
    if repair_corrections:
        repair_instruction = (
            "This is a targeted repair of currentDraft, not a fresh rewrite. Keep the current wording and structure "
            "as intact as practical. Every item in corrections is a verified selected fact that the current candidate "
            "omitted or mishandled; explicitly fix those items while preserving all other valid caption content. "
        )
    user_prompt = (
        "Write the caption using these WebCap inputs. Cover every nonredundant tag in groupedAnnotations and otherTags; "
        "use group labels and optional semantic aliases to interpret selected values and express them naturally. Fresh Context Sight and "
        "reusable Open Sight are supplemental visual evidence, not replacements for the user's selected annotations. "
        "Before returning, check that each distinct selected tag's information is represented; compress phrasing "
        "rather than omitting it. Do not invent details unsupported by selected annotations, the required phrase, "
        "the draft, or visual evidence. "
        + repair_instruction
        + ordering +
        "Do not use annotation group order or captionTemplate placeholder order as caption order.\n\n"
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
1. Each group has a stable template key supplied in the input. groupsInOrder is the user's intended template order.
   Preserve the relative order of group placeholders by default; make only small local deviations when grammar requires
   a value to stay attached to related literal text.
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
- Include every available key so no configured group or mapping loses its place in the template.
- Preserve the user's actual group vocabulary, separators, affixes, and mappings; do not invent facts,
  groups, tags, affixes, or replacement rules.
- Infer each group's meaning from its label, optional semantic alias, AND vocabulary, including renderedDefault and affixes. Abbreviated or
  unfamiliar labels are not enough by themselves: values may reveal garment shape, limb positioning, accessories,
  a second subject, a relationship, or environmental detail. Do not expand uncertain abbreviations into invented facts.
- Treat groupsInOrder as the primary sequence. Infer what each group describes so you can write good conditional
  glue around it, but do not reorganize the schema into your own preferred semantic order. Keep adjacent related
  groups together when they are adjacent in groupsInOrder. Mapping-only keys may be placed where their meaning fits
  without disturbing the relative order of group keys. Do not drop unfamiliar groups or dump them at the end.
- Only include actions or other details through populated keys; a schema must also work for still images and
  items with no action annotations. Preserve the vocabulary's wording rather than substituting synonyms.
- Design for arbitrary subsets of groups being populated. A template that reads well only when every group is present
  is not good enough.
- Prefer concise natural training-caption prose over a raw comma-separated tag dump, while retaining deterministic
  behavior.
- Prefer compact compositional photographic wording for camera/view groups. When the schema supplies angle and
  orientation fragments, combine them as an "[angle] [orientation] view" phrase where that matches the vocabulary,
  such as "front view", "low-angle side view", or "high-angle three-quarter rear view". Keep the supplied vocabulary
  wording; do not expand it into "viewed from the front", "from a front view", "seen from the side", or similar prose.
  Conditional template glue should make the compact phrase work when either optional component is absent.
- Treat currentTemplate as an editable draft: improve it when useful, but do not preserve awkward structure merely
  because it already exists.
- Preserve an explicit subject description authored in currentTemplate, such as a generic person opening, even
  without a subject group. Do not infer gender or subject count from the vocabulary of clothing or traits.
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
            "alias": str(raw_group.get("alias") or "").strip(),
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
                "groupsInOrder is the user's intended template sequence: keep group placeholders in that relative "
                "order unless a small local move is necessary for grammatical attachment. Do not reorganize the "
                "groups into your own preferred semantic order. Use the vocabulary examples to choose grammatical "
                "placement and conditional glue.\n\n"
                + json.dumps(payload, ensure_ascii=False, indent=2)
            ),
        },
    ]
