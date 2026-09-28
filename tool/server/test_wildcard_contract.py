from collections import Counter

from .originals import MEDIA_ALL_EXTS, is_transient_media_name


def _clean_caption(value):
    return " ".join(str(value or "").strip().split())


def build_request(captions):
    cleaned = [_clean_caption(value) for value in (captions or [])]
    cleaned = [value for value in cleaned if value]
    if not cleaned:
        raise ValueError("This Set has no captions to analyze.")

    counts = Counter(cleaned)
    corpus = []
    for caption, count in counts.most_common():
        prefix = ("x" + str(count) + " ") if count > 1 else ""
        corpus.append(prefix + caption)

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["wildcard", "stableTerms", "variationGroups"],
        "properties": {
            "wildcard": {
                "type": "string",
                "minLength": 1,
                "description": "One reusable wildcard caption using {a|b|c} syntax.",
            },
            "stableTerms": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "description": "Meaningful terms or phrases that stay stable across the Set.",
            },
            "variationGroups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["label", "options"],
                    "properties": {
                        "label": {"type": "string", "minLength": 1},
                        "options": {
                            "type": "array",
                            "minItems": 2,
                            "items": {"type": "string", "minLength": 1},
                        },
                    },
                },
                "description": "Semantic categories that vary across captions and the observed alternatives in each category.",
            },
        },
    }

    prompt = (
        "[ROLE]\n"
        "You are analyzing captions from one image/video training Set to build a useful Test Generations wildcard prompt.\n\n"
        "[GOAL]\n"
        "Find what is genuinely common across the Set, identify the semantic dimensions that vary, and express those observed variations as one compact wildcard caption.\n\n"
        "[RULES]\n"
        "- Use only information present in the supplied captions. Do not invent new attributes or options.\n"
        "- Keep stable subject tokens, identity terms, and consistently recurring descriptors outside wildcard braces.\n"
        "- Put genuinely varying alternatives in {a|b|c} groups. Do not create a wildcard for something that is effectively constant.\n"
        "- Consolidate obvious synonymous wording only when the alternatives mean the same thing.\n"
        "- Prefer meaningful phrases over isolated words when that preserves grammar or meaning.\n"
        "- Keep the resulting caption grammatically usable for every alternative. Avoid nested wildcard braces.\n"
        "- Preserve useful variation instead of flattening the Set into one generic description.\n"
        "- stableTerms should summarize the meaningful common content, not punctuation or filler words.\n"
        "- variationGroups should describe the semantic category and list the observed alternatives represented in the wildcard.\n\n"
        "[SET CAPTIONS]\n"
        + "\n".join("- " + item for item in corpus)
        + "\n\n[OUTPUT]\n"
        "Return only the structured result requested by the JSON schema."
    )

    return {
        "operation": "analyze_caption_wildcard",
        "output": "json",
        "prompt": prompt,
        "response_schema": schema,
    }



def captions_from_folder(folder_path):
    captions = []
    for media_path in sorted(folder_path.iterdir(), key=lambda path: path.name.lower()):
        if (
            not media_path.is_file()
            or media_path.suffix.lower() not in MEDIA_ALL_EXTS
            or is_transient_media_name(media_path.name)
        ):
            continue
        caption_path = media_path.with_suffix(".txt")
        if not caption_path.is_file():
            continue
        try:
            text = caption_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError("Could not read Set caption: " + caption_path.name) from exc
        if text:
            captions.append(text)
    return captions
