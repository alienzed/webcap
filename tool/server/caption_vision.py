import base64
import json
from pathlib import Path

from . import config as app_config
from .caption_ops import _resolve_folder, _validate_media_name
from .video_frame_ops import VIDEO_EXTS, extract_boundary_frame_png


VISION_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
VISION_MEDIA_EXTS = VISION_IMAGE_EXTS | VIDEO_EXTS

CAPTION_VISION_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "replace", "remove"]},
                    "sourceText": {"type": "string"},
                    "replacementText": {"type": "string"},
                    "anchorText": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                    "knownTag": {
                        "anyOf": [
                            {"type": "null"},
                            {
                                "type": "object",
                                "properties": {
                                    "group": {"type": "string"},
                                    "term": {"type": "string"},
                                },
                                "required": ["group", "term"],
                                "additionalProperties": False,
                            },
                        ]
                    },
                },
                "required": [
                    "action",
                    "sourceText",
                    "replacementText",
                    "anchorText",
                    "confidence",
                    "knownTag",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}

VISION_CAPTION_EXTRAS_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "extras": {
            "type": "array",
            "maxItems": 10,
            "items": {"type": "string", "minLength": 1},
        }
    },
    "required": ["extras"],
    "additionalProperties": False,
}

VISION_CAPTION_EXTRAS_SYSTEM_PROMPT = (
    "You inspect one image alongside its current candidate caption. "
    "Compare them and identify additional visible details that would meaningfully extend the caption. "
    "Phrase each detail as compact annotation-ready wording, normally one to four words, such as 'braid', 'table lamp', "
    "'hoop earrings', or 'looking left'. Favor specific visible nouns, attributes, and short relationships. "
    "An empty extras list is correct when no useful addition is needed. Return JSON only."
)


def build_vision_caption_extras_messages(caption, media_relative_path):
    current_caption = str(caption or "").strip()
    text = (
        "Inspect the image and current candidate caption. Return compact visible extras that would add useful information.\n\n"
        + json.dumps({"caption": current_caption}, ensure_ascii=False)
    )
    return [
        {"role": "system", "content": VISION_CAPTION_EXTRAS_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": _vision_media_url(media_relative_path)}},
            ],
        },
    ]


def normalize_vision_caption_extras_result(raw_text):
    text = str(raw_text or "").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Vision extras model returned invalid JSON.") from exc
    extras = payload.get("extras") if isinstance(payload, dict) else None
    if not isinstance(extras, list):
        raise ValueError("Vision extras response is missing extras.")

    normalized = []
    seen = set()
    for raw in extras[:10]:
        value = " ".join(str(raw or "").split()).strip(" ,.;:")
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return {"extras": normalized}


VISION_IMAGE_CAPTION_SYSTEM_PROMPT = (
    "You caption one image from visual evidence alone. "
    "Write one concise, information-dense natural-language description of what is clearly visible. "
    "Prioritize the main subject or subjects, appearance and clothing, pose or action, distinctive objects and details, "
    "spatial relationships, setting or background, lighting, and camera viewpoint when those details are visually clear. "
    "Use specific colors, materials, and shapes when they are clear in the image. "
    "Describe people through visible appearance, clothing, pose, and action when relevant. "
    "Return only the caption text with no label, commentary, quotes, or markdown."
)


def _vision_media_url(media_reference):
    value = str(media_reference or "").strip()
    if value.startswith("data:image/"):
        return value
    return "file://" + value


def build_vision_image_caption_messages(media_relative_path):
    return [
        {"role": "system", "content": VISION_IMAGE_CAPTION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Describe this image accurately and concisely. Include distinctive visible details and relationships "
                        "that would make the description useful on its own."
                    ),
                },
                {"type": "image_url", "image_url": {"url": _vision_media_url(media_relative_path)}},
            ],
        },
    ]


CAPTION_VISION_SYSTEM_PROMPT = (
    "You verify a training caption against one image and return only exact, actionable caption edits. "
    "Report a finding only when the image provides clear visual evidence and the current caption is meaningfully missing "
    "that fact or expresses a conflicting fact. Treat semantically equivalent wording as already present. "
    "Every finding must be one deterministic edit: add, replace, or remove. "
    "For replace/remove, sourceText MUST be an exact substring copied from the supplied current caption. "
    "For replace, replacementText is the exact replacement wording. For remove, replacementText must be empty. "
    "For add, replacementText is the compact annotation-ready wording to add; sourceText must be empty. "
    "For add, anchorText may be one exact substring copied from the caption when there is a clearly appropriate insertion "
    "location; otherwise return an empty anchorText so WebCap can offer insertion at the user's caret. "
    "Do not return explanations, warnings, stylistic rewrites, or approximate source text. "
    "Prefer short concrete wording and at most a few high-value edits. "
    "Use annotation groups as semantic context; knownTag is optional and must use exact supplied group/term spelling. "
    "An empty findings list is correct when there is no precise edit worth offering. Return JSON only."
)


def _normalize_groups(groups):
    normalized = []
    for raw in groups if isinstance(groups, list) else []:
        if not isinstance(raw, dict):
            continue
        group = str(raw.get("group") or "").strip()
        if not group:
            continue
        seen = set()
        options = []
        for value in raw.get("options") if isinstance(raw.get("options"), list) else []:
            term = str(value or "").strip()
            key = term.casefold()
            if not term or key in seen:
                continue
            seen.add(key)
            options.append(term)
        selected = []
        for value in raw.get("selected") if isinstance(raw.get("selected"), list) else []:
            term = str(value or "").strip()
            if term:
                selected.append(term)
        normalized.append({
            "group": group,
            "options": options,
            "selected": selected,
        })
    return normalized


def resolve_caption_vision_media(folder, media_name):
    folder_path = _resolve_folder(folder)
    media_name = _validate_media_name(media_name)
    media_path = (folder_path / media_name).resolve()
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    suffix = media_path.suffix.casefold()
    if suffix not in VISION_MEDIA_EXTS:
        raise ValueError("Vision currently supports image files and video first frames.")

    root = Path(app_config.FS_ROOT).resolve()
    try:
        relative = media_path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Vision media must be inside the configured dataset root.") from exc

    if suffix in VIDEO_EXTS:
        first_frame = extract_boundary_frame_png(media_path, "first")
        return "data:image/png;base64," + base64.b64encode(first_frame).decode("ascii")

    mime_by_suffix = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".gif": "image/gif",
    }
    mime_type = mime_by_suffix.get(suffix)
    if not mime_type:
        raise ValueError("Vision image format is unsupported.")
    return "data:" + mime_type + ";base64," + base64.b64encode(media_path.read_bytes()).decode("ascii")


def build_caption_vision_messages(caption, groups, media_relative_path):
    normalized_groups = _normalize_groups(groups)
    payload = {
        "caption": str(caption or "").strip(),
        "groups": normalized_groups,
        "instructions": {
            "maxFindings": 4,
            "confidence": ["low", "medium", "high"],
            "actions": ["add", "replace", "remove"],
            "knownTag": "Use null unless the proposed edit clearly maps to one exact supplied group option.",
        },
        "responseShape": {
            "findings": [{
                "action": "add|replace|remove",
                "sourceText": "exact current-caption substring for replace/remove; otherwise empty",
                "replacementText": "text to add/replace with; empty for remove",
                "anchorText": "optional exact current-caption substring for anchored add; otherwise empty",
                "confidence": "low|medium|high",
                "knownTag": {"group": "exact supplied group", "term": "exact supplied option"},
            }]
        },
    }
    text = (
        "Verify the current training caption against the image and annotation vocabulary. "
        "Return at most four exact caption edits. Do not return a finding unless it can be represented by the response "
        "shape without prose interpretation. Returning {\\\"findings\\\": []} is correct when no precise edit is warranted.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    return [
        {"role": "system", "content": CAPTION_VISION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": _vision_media_url(media_relative_path)}},
            ],
        },
    ], normalized_groups


def normalize_caption_vision_result(raw_text, groups):
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Vision model returned invalid JSON.") from exc
    findings = payload.get("findings") if isinstance(payload, dict) else None
    if not isinstance(findings, list):
        raise ValueError("Vision model response is missing findings.")

    allowed = {}
    display_groups = {}
    for group in _normalize_groups(groups):
        group_key = group["group"].casefold()
        display_groups[group_key] = group["group"]
        allowed[group_key] = {term.casefold(): term for term in group["options"]}

    normalized = []
    seen = set()
    for raw in findings[:4]:
        if not isinstance(raw, dict):
            continue
        action = str(raw.get("action") or "").strip().lower()
        source_text = str(raw.get("sourceText") or "").strip()
        replacement_text = str(raw.get("replacementText") or "").strip()
        anchor_text = str(raw.get("anchorText") or "").strip()
        confidence = str(raw.get("confidence") or "").strip().lower()
        if action not in {"add", "replace", "remove"} or confidence not in {"low", "medium", "high"}:
            continue
        if action == "add":
            if source_text or not replacement_text:
                continue
        elif action == "replace":
            if not source_text or not replacement_text or source_text == replacement_text:
                continue
            anchor_text = ""
        else:
            if not source_text or replacement_text:
                continue
            anchor_text = ""

        known = None
        raw_known = raw.get("knownTag")
        if isinstance(raw_known, dict):
            raw_group = str(raw_known.get("group") or "").strip()
            raw_term = str(raw_known.get("term") or "").strip()
            group_key = raw_group.casefold()
            term_key = raw_term.casefold()
            if group_key in allowed and term_key in allowed[group_key]:
                known = {
                    "group": display_groups[group_key],
                    "term": allowed[group_key][term_key],
                }

        key = (
            action,
            source_text.casefold(),
            replacement_text.casefold(),
            anchor_text.casefold(),
        )
        if key in seen:
            continue
        seen.add(key)
        normalized.append({
            "action": action,
            "sourceText": source_text,
            "replacementText": replacement_text,
            "anchorText": anchor_text,
            "confidence": confidence,
            "knownTag": known,
        })
    return {"findings": normalized}

