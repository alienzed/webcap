"""Editable Epoch Finder concept dimensions and LLM proposal contract.

The existing Test wildcard prompt is the generation source of truth. Dimension
roles attach to its ordered, concrete {a|b} alternatives; never infer them from
substring/word matching in a generated caption.
"""
from .test_wildcard_contract import build_request as build_wildcard_request, normalize_result
from .epoch_test_bench import _parse_wildcard_nodes, _expand_wildcard_option, _normalize_wildcard_text, _strip_wildcard_comments


_ROLES = {"primary": 2.0, "leakage": 1.0, "vary": 0.0}
def prompt_options(prompt):
    """Use the same expanded, top-level vocabulary as Test Generations VL."""
    template = _strip_wildcard_comments(str(prompt or "").strip())
    if not template:
        raise ValueError("Provide a test prompt.")
    nodes = _parse_wildcard_nodes(template)
    groups = [value for kind, value in nodes if kind == "group"]
    if not groups:
        raise ValueError("Test prompt needs at least one {option|option} wildcard.")
    options = []
    for alternatives in groups:
        choices = []
        for alternative in alternatives:
            for expanded in _expand_wildcard_option(alternative):
                choice = _normalize_wildcard_text(expanded)
                if choice not in choices:
                    choices.append(choice)
        if len(choices) < 2:
            raise ValueError("Each scored wildcard needs at least two distinct resolved values.")
        options.append(choices)
    return options


def normalize_dimensions(prompt, dimensions=None):
    options = prompt_options(prompt)
    if dimensions is None:
        dimensions = [{"label": "Attribute " + str(i + 1), "options": values, "role": "primary"}
                      for i, values in enumerate(options)]
    if not isinstance(dimensions, list) or len(dimensions) != len(options):
        raise ValueError("Test attributes must match the prompt's wildcard groups in order.")
    normalized = []
    for index, (supplied, choices) in enumerate(zip(dimensions, options), start=1):
        if not isinstance(supplied, dict):
            raise ValueError("Each test attribute must be an object.")
        role = str(supplied.get("role") or "").strip().lower()
        if role not in _ROLES:
            raise ValueError("Attribute role must be primary, leakage, or vary only.")
        raw_choices = supplied.get("options")
        if not isinstance(raw_choices, list) or [str(x).strip() for x in raw_choices] != choices:
            raise ValueError("Attribute " + str(index) + " values must match its prompt wildcard.")
        name = str(supplied.get("label") or "").strip()
        if not name:
            raise ValueError("Every attribute needs a name.")
        normalized.append({"id": "G" + str(index), "label": name[:100], "options": choices,
                           "role": role, "weight": _ROLES[role]})
    if not any(item["weight"] > 0 for item in normalized):
        raise ValueError("Mark at least one attribute Primary or Leakage so VL has something to score.")
    return normalized


def build_proposal(captions, set_name="", focus="", vocabulary=None, reference_vocabulary=None):
    contract = build_wildcard_request(captions, set_name=set_name, focus=focus, vocabulary=vocabulary)
    contract["operation"] = "propose_epoch_finder_plan"
    schema = contract["response_schema"]
    schema["required"] = ["wildcard", "stableTerms", "variationGroups", "concept"]
    schema["properties"]["concept"] = {"type": "string", "minLength": 1}
    group = schema["properties"]["variationGroups"]["items"]
    group["required"] = ["label", "options", "role", "referenceTags"]
    group["properties"]["referenceTags"] = {"type": "array", "items": {"type": "object", "required": ["group", "tag"], "properties": {"group": {"type": "string"}, "tag": {"type": "string"}}}}
    group["properties"]["role"] = {"type": "string", "enum": ["primary", "leakage", "vary"]}
    import json
    contract["prompt"] += "\\n[ACTUAL SET REFERENCE TAGS]\\n" + json.dumps(reference_vocabulary or [], ensure_ascii=False) + "\\n"
    contract["prompt"] += (
        "\n\n[EPOCH FINDER ADDITION]\n"
        "You are proposing a *reviewable test plan*, not launching a campaign. "
        "Supply concept (one short specific description of the learned subject). "
        "Each variationGroup must match one {a|b|...} wildcard from left to right, "
        "with exactly the same option text and order. "
        "Assign role 'primary' for distinguishing features of the learned concept; "
        "'leakage' for secondary traits that should vary independently of the learned concept; "
        "'vary' for prompts' incidental variety (background, lighting, etc.) not worth scoring. "
        "Prefer precise independent construction/color/shape attributes to whole-product alternatives. "
         "For each Primary variationGroup, include referenceTags aligned one-to-one with options, using ONLY exact group/tag pairs from ACTUAL SET REFERENCE TAGS. " 
        "For Leakage/Vary use an empty referenceTags array. If no exact tag backs an option, use empty strings for its pair, never invent. " 
        "Offer concrete values consistent with the Set vocabulary. "
        "Never invent observed frequencies or conflate a term with its negation. "
        "At least one primary group is required. No new inference work should start."
    )
    return contract


def normalize_proposal(data):
    proposal = normalize_result(data)
    concept = str(data.get("concept") or "").strip() if isinstance(data, dict) else ""
    if not concept:
        raise ValueError("Epoch Finder proposal is missing its concept.")
    proposal["concept"] = concept
    proposal["variationGroups"] = normalize_dimensions(
        proposal["wildcard"], data.get("variationGroups"),
    )
    raw_groups = data.get("variationGroups") if isinstance(data, dict) else []
    for normalized, raw in zip(proposal["variationGroups"], raw_groups):
        tags = raw.get("referenceTags") if isinstance(raw, dict) else None
        if not isinstance(tags, list) or (normalized["role"] == "primary" and len(tags) != len(normalized["options"])):
            raise ValueError("Primary test options require aligned structured reference tags.")
        normalized["referenceTags"] = tags if normalized["role"] == "primary" else []
    return proposal
