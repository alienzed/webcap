import json
import re
from collections import Counter


def _clean_caption(value):
    lines = [line.strip() for line in str(value or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _clean_context(value):
    return " ".join(str(value or "").strip().split())


def observed_group_combinations(annotations, eligible_media):
    """Actual co-occurring scoped tag sets, scoped to eligible Set media."""
    observed = {}
    for media in eligible_media:
        scoped = annotations.get(media, {})
        if not isinstance(scoped, dict):
            continue
        for group, tags in scoped.items():
            if not isinstance(tags, list):
                continue
            values = tuple(sorted({tag for tag in tags if isinstance(tag, str) and tag.strip()}))
            if values:
                observed.setdefault(group, set()).add(values)
    return {group: [list(combo) for combo in sorted(combos)]
            for group, combos in sorted(observed.items())}


def build_request(captions, set_name="", focus="", vocabulary=None, group_combinations=None):
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

    counts = Counter(cleaned)
    corpus = []
    for caption, count in counts.most_common():
        corpus.append("[count=" + str(count) + "] " + caption)

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["wildcard", "stableTerms", "variationGroups"],
        "properties": {
            "wildcard": {
                "type": "string",
                "minLength": 1,
                "description": "One reusable wildcard caption using concrete {a|b|c} syntax.",
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
                    "required": ["label", "options", "annotationGroup"],
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
        "Observed same-group tag combinations: " + json.dumps(group_combinations or {}, ensure_ascii=False),
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
        "- The primary concept should receive the richest decomposition. Secondary recurring dimensions such as pose, camera/view, "
        "physical appearance, background, and lighting are valid and useful, but they must not crowd out the primary concept.\n\n"
        "[COMPOSITION RULES]\n"
        "- Each wildcard group must vary exactly one attribute, even when captions combine several. "
        "For example write '{brown|black|blonde|ginger} hair', not "
        "'{brown hair|black hair in braids|blonde wavy hair|ginger ponytail hair}'. "
        "Keep hair style and hair color separate.\n"
        "- Prefer independent, composable attributes over whole-phrase alternatives. "
        "For example, separate color, pattern, trim, top shape, and bottom shape rather than collapsing them into a single 'style' wildcard.\n"
        "- Set annotationGroup to the exact annotation group name for tag-grounded dimensions; use empty string for general prompt-only variation. " 
        "Never guess an annotation group from similar words.\n"
        "- For tags in the SAME annotation group, only use joint combinations observed together in Set media. "
        "If a pair was never observed together in that group, treat it as mutually exclusive. "
        "Prefer one option from that group in each resolved caption unless an observed tag combination requires several. "
        "Do not apply this restriction across DIFFERENT annotation groups; cross-group recombination tests generalization.\n"
        "- Recombine attributes across dimensions so tests exercise independently selectable properties, "
        "not merely replay complete caption fragments.\n"
        "- Annotation groups, aliases, and terms reveal the important dimensions and preferred terminology. "
        "They are guidance, not a closed list of test values or proof that every term occurs in the captions.\n"
        "- Include sensible concrete unseen alternatives where useful for testing generalization. "
        "For example, black hair can be tested even when the captions mention only brown and blonde hair. "
        "Do not claim unseen values were learned or observed. Avoid implausible combinations.\n"
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
        "- Put meaningful test alternatives in {a|b|c} groups. An attribute may be worth testing even if rare or constant in the captions.\n"
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


def validate_group_compatibility(data, combinations):
    """Reject proposed same-group choices with unobserved co-occurrence.

    The explicit annotationGroup field is the identity contract. Unmapped
    dimensions are general prompt variation, not inferred trained tags.
    """
    groups = data.get("variationGroups") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        raise ValueError("Wildcard proposal must include variation groups.")
    from .epoch_finder_plan import prompt_options
    resolved = prompt_options(str(data.get("wildcard") or ""))
    if len(resolved) != len(groups):
        raise ValueError("Wildcard group count does not match its annotation dimensions.")
    assigned = {}
    for index, item in enumerate(groups):
        if not isinstance(item, dict):
            raise ValueError("Invalid wildcard dimension.")
        if [str(option).strip() for option in (item.get("options") or [])] != resolved[index]:
            raise ValueError("Wildcard group options do not match the generated prompt.")
        group = str(item.get("annotationGroup") or "").strip()
        if not group:
            known = {tag for combos in combinations.values() for combo in combos for tag in combo}
            if item.get("options") and all(option in known for option in item["options"]):
                raise ValueError("Tag-grounded wildcard dimension " + str(item.get("label") or "") +
                                 " must identify its annotationGroup.")
            continue
        if group not in combinations:
            raise ValueError("Unknown wildcard annotation group: " + group)
        allowed = {tag for combo in combinations[group] for tag in combo}
        options = item.get("options") or []
        if not isinstance(options, list) or any(option not in allowed for option in options):
            raise ValueError("Wildcard values must be exact tags in group " + group)
        assigned.setdefault(group, []).append(options)
    from itertools import product
    for group, dimensions in assigned.items():
        if len(dimensions) < 2:
            continue
        observed = [set(combo) for combo in combinations[group]]
        for selected in product(*dimensions):
            if not any(set(selected).issubset(combo) for combo in observed):
                raise ValueError("Unobserved same-group wildcard combination in " +
                                 group + ": " + " + ".join(selected))
    return True


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
        normalized = {"label": label, "options": options}\n        if "annotationGroup" in group:\n            normalized["annotationGroup"] = str(group.get("annotationGroup") or "").strip()\n        normalized_groups.append(normalized)

    return {
        "wildcard": wildcard,
        "stableTerms": stable_terms,
        "variationGroups": normalized_groups,
    }
