import json
import re
from collections import Counter


def _clean_caption(value):
    lines = [line.strip() for line in str(value or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _clean_context(value):
    return " ".join(str(value or "").strip().split())


def _representative_captions(captions, max_items=150, max_chars=24000):
    """Bound Director input while retaining examples across the whole Set."""
    counts = Counter(captions)
    unique = list(counts)
    if not unique:
        return [], 0
    count = min(len(unique), max_items)
    while True:
        indices = [index * len(unique) // count for index in range(count)]
        examples = ["[count=" + str(counts[unique[index]]) + "] " + unique[index]
                    for index in indices]
        if sum(len(example) + 2 for example in examples) <= max_chars or count == 1:
            return examples, len(unique)
        count -= 1


def build_request(captions, set_name="", focus="", vocabulary=None):
    cleaned = [_clean_caption(value) for value in (captions or [])]
    cleaned = [value for value in cleaned if value]
    if not cleaned:
        raise ValueError("This Set has no captions to analyze.")

    set_name = _clean_context(set_name)
    focus = _clean_context(focus)

    groups = []
    for raw in vocabulary if isinstance(vocabulary, list) else []:
        if not isinstance(raw, dict):
            continue
        group = _clean_context(raw.get("group"))
        if not group:
            continue
        terms = (
            [_clean_context(term) for term in raw.get("terms", []) if str(term or "").strip()]
            if isinstance(raw.get("terms"), list) else []
        )
        groups.append({"group": group, "alias": _clean_context(raw.get("alias")), "terms": terms})

    corpus, unique_count = _representative_captions(cleaned)

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["wildcard", "stableTerms", "variationGroups"],
        "properties": {
            "wildcard": {
                "type": "string",
                "minLength": 1,
                "description": "One reusable wildcard caption using observed training values in concrete {a|b|c} syntax.",
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
                        "annotationGroup": {"type": "string", "description": "Exact Set annotation group name when options are tags; empty for free prompt variation."},
                        "options": {
                            "type": "array",
                            "minItems": 2,
                            "items": {"type": "string"},
                        },
                    },
                },
                "description": "Semantic dimensions represented by wildcard groups. Empty string is allowed only for an optional attribute.",
            },
        },
    }

    context_lines = [
        "Set name: " + (set_name or "(not supplied)"),
        "Explicit focus: " + (focus or "(auto - infer from Set name and repeated caption language)"),
        "Annotation groups and terms: " + (json.dumps(groups, ensure_ascii=False) if groups else "(none supplied)"),
        "Caption sampling: " + str(len(corpus)) + " representative examples from " +
        str(unique_count) + " distinct captions. [count=N] indicates exact duplicates.",
    ]

    prompt = (
        "[ROLE]\n"
        "You are mining captions from one image/video training Set to build a useful Test Generations wildcard prompt. "
        "This is structured variation extraction, not summarization.\n\n"
        "[CONTEXT]\n"
        + "\n".join(context_lines)
        + "\n\n"
        "[GOAL]\n"
        "Identify the Set's dominant trained concept, decompose its meaningful variation into reusable composable dimensions, "
        "and express those dimensions as one natural wildcard caption. Keep useful secondary dimensions too when the captions support them.\n\n"
        "[FOCUS PRIORITY]\n"
        "- If Explicit focus is provided, treat it as the primary concept to mine deeply.\n"
        "- Otherwise infer the primary concept from the Set name first, then from repeated caption language and frequency.\n"
        "- Prioritize the trained subject's construction, distinct components, shape, material, and color. "
        "A description may mention both a top and a bottom with identically named strap types: "
        "treat those as different attributes tied to their respective components.\n"
        "- Pose, hair, setting, lighting and camera are context. Keep them stable or, at most, "
        "include one or two useful secondary variations; do not build a wildcard around every detail.\n\n"
        "[COMPOSITION RULES]\n"
        "- Each wildcard group must vary exactly one attribute, even when captions combine several. "
        "For example write '{brown|black|blonde|ginger} hair', not "
        "'{brown hair|black hair in braids|blonde wavy hair|ginger ponytail hair}'. "
        "Keep hair style and hair color separate.\n"
        "- Prefer independent, composable attributes over whole-phrase alternatives. "
        "For example, separate color, pattern, trim, top shape, and bottom shape rather than collapsing them into a single 'style' wildcard.\n"
        "- Set annotationGroup to a Set group ONLY when every option is an exact observed tag of that group. "
        "Otherwise use an empty annotationGroup. Never infer group identity from shared words alone.\n"
        "- Position/pose wildcard options may be descriptive phrases rather than exact Position tags. "
        "For example 'standing upright' is not the same tag as 'standing'. If ANY option is not an exact "
        "tag name, leave annotationGroup empty for that dimension rather than claiming a tag mapping.\n"
        "- Do not recombine mutually exclusive shapes into one choice. "
        "Independently vary actual components, but keep each resolved prompt physically meaningful.\n"
        "- Recombine attributes across dimensions so tests exercise independently selectable properties, "
        "not merely replay complete caption fragments.\n"
        "- The one-time group vocabulary is semantic context, not per-item truth. "
        "The caption examples are selected-run evidence; omitted captions may contain additional variations.\n"
        "- Prefer observed variations. If a useful value is unsupported by these examples, do not claim it was trained.\n"
        "- Use supplied garment-construction terms accurately; do not invent nonsensical hardware or garment structures.\n"
        "- Every wildcard option must itself be usable prompt text. Never emit category placeholders such as 'various styles', "
        "'other background', 'different poses', 'multiple colors', 'etc.', or similar descriptions of options you failed to enumerate.\n"
        "- Empty alternatives are allowed when an attribute is genuinely optional, for example {striped|ruched|}. "
        "Use them only where the surrounding grammar remains valid.\n"
        "- For the primary concept, do not discard a concrete value merely because it is rare if it is clearly a deliberate trained variation. "
        "For incidental secondary dimensions, prefer recurring values and omit noisy one-off detail.\n\n"
        "[GENERAL RULES]\n"
        "- Each caption is prefixed with [count=N] frequency metadata. Use the count as evidence of prevalence; it is not caption text.\n"
        "- Keep stable subject tokens, identity terms, and consistently recurring descriptors outside wildcard braces.\n"
        "- Put concrete interchangeable alternatives in {a|b|c} groups; leave consistent terms outside braces.\n"
        "- Consolidate obvious synonymous wording only when the alternatives mean the same thing.\n"
        "- Put shared nouns and grammar outside braces; use the shortest interchangeable option that keeps every result natural. "
        "Whole phrases are appropriate only for a genuinely inseparable single attribute.\n"
        "- Write the wildcard as natural caption prose. Prefer complete, readable sentences over comma-heavy fragments.\n"
        "- Preserve useful sentence or paragraph breaks when the caption content supports them; do not collapse unrelated ideas into one run-on line.\n"
        "- Keep the resulting caption grammatically usable for every alternative. Avoid nested wildcard braces.\n"
        "- stableTerms should summarize meaningful common content, not punctuation or filler words.\n"
        "- variationGroups must correspond to concrete wildcard dimensions in the wildcard and list their concrete options.\n\n"
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
    if not re.search(r"\{[^{}]*\|[^{}]*\}", wildcard):
        raise ValueError("Wildcard analysis response does not contain a usable wildcard group.")

    for raw_group in re.findall(r"\{([^{}]*\|[^{}]*)\}", wildcard):
        for option in raw_group.split("|"):
            str(option or "").strip()

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
        if len(options) < 2 or not any(options):
            raise ValueError("Wildcard analysis variation groups require at least two options and one concrete value.")
        normalized = {"label": label, "options": options}
        if "annotationGroup" in group:
            normalized["annotationGroup"] = str(group.get("annotationGroup") or "").strip()
        normalized_groups.append(normalized)

    return {
        "wildcard": wildcard,
        "stableTerms": stable_terms,
        "variationGroups": normalized_groups,
    }
