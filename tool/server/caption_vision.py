import json
from pathlib import Path

from . import config as app_config
from .caption_ops import _resolve_folder, _validate_media_name


VISION_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

CAPTION_VISION_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "type": {"type": "string", "enum": ["omitted", "incorrect"]},
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
                "required": ["description", "type", "confidence", "knownTag"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}


VISION_IMAGE_CAPTION_SYSTEM_PROMPT = (
    "You caption one image from visual evidence alone. "
    "Write one concise, information-dense natural-language description of what is clearly visible. "
    "Prioritize the main subject or subjects, appearance and clothing, pose or action, distinctive objects and details, "
    "spatial relationships, setting or background, lighting, and camera viewpoint when those details are visually clear. "
    "Use specific colors, materials, and shapes when they are clear in the image. "
    "Use natural descriptive prose grounded only in visible image evidence and independent of annotation vocabulary or hidden application context. "
    "Describe people through visible appearance, clothing, pose, and action rather than inferred identity or demographics. "
    "Return only the caption text with no label, commentary, quotes, or markdown."
)


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
                {"type": "image_url", "image_url": {"url": "file://" + str(media_relative_path or "").strip()}},
            ],
        },
    ]


CAPTION_VISION_SYSTEM_PROMPT = (
    "You verify a training caption against one image. "
    "For each candidate discrepancy, check both the image and the current caption before reporting it. "
    "Report a finding only when the image provides clear visual evidence and the caption fails to express the same fact, "
    "or expresses a conflicting fact. Treat semantically equivalent wording as present even when it differs from the "
    "supplied tag spelling. Use each annotation group as semantic context for what its known tag options describe and "
    "which caption phrase they correspond to. Prioritize visually meaningful, repeatable attributes represented by the "
    "supplied groups and exact known tag options; novel details should be rare and genuinely useful for training. "
    "An empty findings list is a successful result when the caption accurately represents the image. "
    "When a finding clearly maps to one supplied known tag, return that exact group and tag spelling. "
    "Keep descriptions concise and factual. Return JSON only."
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
    if media_path.suffix.casefold() not in VISION_IMAGE_EXTS:
        raise ValueError("Vision Caption validation currently supports image files only.")
    if not media_path.exists() or not media_path.is_file():
        raise FileNotFoundError("Media file not found")
    root = Path(app_config.FS_ROOT).resolve()
    try:
        relative = media_path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Vision media must be inside the configured dataset root.") from exc
    return relative.as_posix()


def build_caption_vision_messages(caption, groups, media_relative_path):
    normalized_groups = _normalize_groups(groups)
    payload = {
        "caption": str(caption or "").strip(),
        "groups": normalized_groups,
        "instructions": {
            "maxFindings": 4,
            "confidence": ["low", "medium", "high"],
            "types": ["omitted", "incorrect"],
            "knownTag": "Use null unless the finding clearly maps to one exact supplied group option.",
        },
        "responseShape": {
            "findings": [{
                "description": "short visual discrepancy",
                "type": "omitted|incorrect",
                "confidence": "low|medium|high",
                "knownTag": {"group": "exact supplied group", "term": "exact supplied option"},
            }]
        },
    }
    text = (
        "Verify the current training caption against the image and annotation vocabulary. "
        "Return at most four findings that meet the system criteria. Returning {\"findings\": []} is correct when "
        "the caption already covers the meaningful visual facts.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    return [
        {"role": "system", "content": CAPTION_VISION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": "file://" + media_relative_path}},
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
    for raw in findings[:4]:
        if not isinstance(raw, dict):
            continue
        description = str(raw.get("description") or "").strip()
        finding_type = str(raw.get("type") or "").strip().lower()
        confidence = str(raw.get("confidence") or "").strip().lower()
        if not description or finding_type not in {"omitted", "incorrect"} or confidence not in {"low", "medium", "high"}:
            continue
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
        normalized.append({
            "description": description,
            "type": finding_type,
            "confidence": confidence,
            "knownTag": known,
        })
    return {"findings": normalized}
