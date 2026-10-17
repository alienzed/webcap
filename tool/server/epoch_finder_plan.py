"""Editable Epoch Finder concept dimensions and LLM proposal contract.

The existing Test wildcard prompt is the generation source of truth. Dimension
roles attach to its ordered, concrete {a|b} alternatives; never infer them from
substring/word matching in a generated caption.
"""
import re

from .test_wildcard_contract import build_request as build_wildcard_request, normalize_result


_ROLES = {"primary": 2.0, "leakage": 1.0, "vary": 0.0}
_GROUP = re.compile(r"\{([^{}]*\|[^{}]*)\}")


def prompt_options(prompt):
    template = str(prompt or "").strip()
    if not template:
        raise ValueError("Provide a test prompt.")
    matches = list(_GROUP.finditer(template))
    if not matches or template.count("{") != len(matches) or template.count("}") != len(matches):
        raise ValueError("Test prompt needs flat {option|option} wildcards (no nested or unmatched braces).")
    options = []
    for match in matches:
        values = [term.strip() for term in match.group(1).split("|")]
        if len(values) < 2 or len(set(values)) != len(values):
            raise ValueError("Each wildcard needs at least two distinct values.")
        options.append(values)
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


def build_proposal(captions, set_name="", focus="", vocabulary=None):
    contract = build_wildcard_request(captions, set_name=set_name, focus=focus, vocabulary=vocabulary)
    contract["operation"] = "propose_epoch_finder_plan"
    schema = contract["response_schema"]
    schema["required"] = ["wildcard", "stableTerms", "variationGroups", "concept"]
    schema["properties"]["concept"] = {"type": "string", "minLength": 1}
    group = schema["properties"]["variationGroups"]["items"]
    group["required"] = ["label", "options", "role"]
    group["properties"]["role"] = {"type": "string", "enum": ["primary", "leakage", "vary"]}
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
        proposal["wildcard"], proposal["variationGroups"],
    )
    return proposal
