import json
import re
from collections import Counter


def _clean_caption(value):
    lines = [line.strip() for line in str(value or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _clean_context(value):
    return " ".join(str(value or "").strip().split())


# Generic Set attributes are background context, not the learned concept.
_CORE_GROUPS = frozenset({
    "viewpoint", "position", "hair", "body", "clothing", "lighting", "background",
})


def _concept_tags(annotations):
    """Read exact Set annotations, retaining group identity for duplicate tag text."""
    if not isinstance(annotations, dict):
        raise ValueError("Scoped Set annotations must be a group-to-tags mapping.")
    tags = set()
    for group, values in annotations.items():
        if not isinstance(group, str) or not isinstance(values, list) or any(
            not isinstance(value, str) for value in values
        ):
            raise ValueError("Invalid scoped Set annotation group or tag list.")
        if group.strip().casefold() in _CORE_GROUPS:
            continue
        tags.update((group, value) for value in values if value.strip())
    return tags


def _sample_caption_examples(rows, max_items=24, max_chars=7200):
    """Prefer examples covering previously unseen, especially rare, concept tags."""
    counts = Counter()
    distinct = {}
    for caption, tags in rows:
        if not caption:
            continue
        counts[caption] += 1
        distinct.setdefault(caption, set()).update(tags)
    captions = list(distinct)
    if not captions:
        return [], 0
    tag_frequency = Counter(tag for _, tags in rows for tag in tags)
    chosen, covered, remaining, used_chars = [], set(), list(range(len(captions))), 0

    while remaining and len(chosen) < max_items:
        candidates = []
        for index in remaining:
            fresh = distinct[captions[index]] - covered
            # Gain is about group/tag diversity, never incidental wording.
            gain = sum(1 / tag_frequency[tag] for tag in fresh)
            size = len(captions[index]) + 22
            if size + used_chars <= max_chars:
                candidates.append((gain, len(fresh), -index, index, size))
        if not candidates:
            break
        winner = max(candidates)
        if chosen and winner[0] <= 0:
            break
        index, size = winner[3], winner[4]
        chosen.append(index)
        remaining.remove(index)
        covered.update(distinct[captions[index]])
        used_chars += size

    # A few spread-out examples retain caption style even when tags are sparse.
    target = min(6, len(captions), max_items)
    if len(chosen) < target:
        indices = [i * (len(captions) - 1) // (target - 1)
                   for i in range(target)] if target > 1 else [0]
        for index in indices:
            if len(chosen) >= target:
                break
            if index in chosen:
                continue
            size = len(captions[index]) + 22
            if size + used_chars <= max_chars:
                chosen.append(index)
                used_chars += size

    examples = ["[count=" + str(counts[captions[i]]) + "] " + captions[i]
                for i in chosen]
    return examples, len(captions)


def build_request(captions, set_name="", focus="", vocabulary=None, annotations=None):
    if annotations is not None and len(annotations) != len(captions):
        raise ValueError("Wildcard annotations must align with Set captions.")
    cleaned = [_clean_caption(value) for value in (captions or [])]
    if not any(cleaned):
        raise ValueError("This Set has no captions to analyze.")

    set_name = _clean_context(set_name)
    focus = _clean_context(focus)
    scoped = [_concept_tags(entry) for entry in annotations] if annotations is not None else [
        set() for _ in cleaned
    ]
    # Aggregate actual trained-media annotations, not the entire configured vocabulary.
    frequencies = Counter(tag for tags in scoped for tag in tags)
    aliases = {
        _clean_context(entry.get("group")): _clean_context(entry.get("alias"))
        for entry in vocabulary or [] if isinstance(entry, dict) and
        _clean_context(entry.get("group"))
    }
    groups = []
    for group in sorted({name for name, _ in frequencies}):
        terms = sorted(
            ((term, count) for (name, term), count in frequencies.items() if name == group),
            key=lambda item: (-item[1], item[0]),
        )
        groups.append({
            "group": group, "alias": aliases.get(group, ""),
            "terms": [{"term": term, "count": count} for term, count in terms],
        })

    corpus, unique_count = _sample_caption_examples(list(zip(cleaned, scoped)))

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
        "Observed concept tags (selected run; counts are annotated media): " +
        (json.dumps(groups, ensure_ascii=False, separators=(",", ":")) if groups else "(no scoped concept tags)"),
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
        "- The observed concept-tag inventory is the main evidence: each group and tag is distinct, "
        "and counts describe prevalence in the selected run. "
        "The sampled captions illustrate natural phrasing, not an exhaustive list.\n"
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
