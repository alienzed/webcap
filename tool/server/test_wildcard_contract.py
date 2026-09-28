from collections import Counter


def _clean_caption(value):
    lines = [line.strip() for line in str(value or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


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


def normalize_result(data):
    if not isinstance(data, dict):
        raise ValueError("Wildcard analysis response must be an object.")

    wildcard = str(data.get("wildcard") or "").strip()
    if not wildcard:
        raise ValueError("Wildcard analysis response is missing its wildcard caption.")

    stable_terms = data.get("stableTerms")
    if not isinstance(stable_terms, list):
        raise ValueError("Wildcard analysis response stableTerms must be an array.")
    stable_terms = [str(value or "").strip() for value in stable_terms]
    if any(not value for value in stable_terms):
        raise ValueError("Wildcard analysis response contains an empty stable term.")

    groups = data.get("variationGroups")
    if not isinstance(groups, list):
        raise ValueError("Wildcard analysis response variationGroups must be an array.")

    normalized_groups = []
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("Wildcard analysis response contains an invalid variation group.")
        label = str(group.get("label") or "").strip()
        options = group.get("options")
        if not label or not isinstance(options, list):
            raise ValueError("Wildcard analysis response contains an invalid variation group.")
        options = [str(value or "").strip() for value in options]
        if len(options) < 2 or any(not value for value in options):
            raise ValueError("Wildcard analysis variation groups require at least two non-empty options.")
        normalized_groups.append({"label": label, "options": options})

    return {
        "wildcard": wildcard,
        "stableTerms": stable_terms,
        "variationGroups": normalized_groups,
    }
