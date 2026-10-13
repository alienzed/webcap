import json
from pathlib import Path


_CAPABILITIES_PATH = Path(__file__).resolve().parents[1] / "data" / "director_model_capabilities.json"


def _load_capabilities(path=_CAPABILITIES_PATH):
    with path.open(encoding="utf-8") as handle:
        capabilities = json.load(handle)
    if not isinstance(capabilities, list) or not capabilities:
        raise ValueError("Director capability catalogue must be a non-empty JSON array.")

    for index, capability in enumerate(capabilities):
        if not isinstance(capability, dict):
            raise ValueError(f"Director capability entry {index} must be an object.")
        matches = capability.get("match")
        if not isinstance(matches, list) or not matches or not all(
            isinstance(value, str) and value.strip() for value in matches
        ):
            raise ValueError(f"Director capability entry {index} requires non-empty match strings.")
        for field in (
            "contextTokens", "extendedContextTokens", "runtimeContextTokens",
            "recommendedContextMin", "recommendedContextMax",
            "recommendedOutputTokens", "extendedRecommendedOutputTokens",
        ):
            if field in capability and (type(capability[field]) is not int or capability[field] <= 0):
                raise ValueError(f"Director capability entry {index} has invalid {field}.")
        for field in ("contextLabel", "contextKind", "sourceUrl"):
            if field in capability and not isinstance(capability[field], str):
                raise ValueError(f"Director capability entry {index} has invalid {field}.")
        if "notes" in capability and (
            not isinstance(capability["notes"], list)
            or not all(isinstance(note, str) for note in capability["notes"])
        ):
            raise ValueError(f"Director capability entry {index} has invalid notes.")
    return capabilities


ADVERTISED_CAPABILITIES = _load_capabilities()


def capability_for_model(model_ref="", model_id="", label=""):
    haystack = " ".join(
        str(value or "").strip().lower()
        for value in (model_ref, model_id, label)
        if str(value or "").strip()
    )
    if not haystack:
        return None
    for capability in ADVERTISED_CAPABILITIES:
        matches = capability.get("match") if isinstance(capability.get("match"), list) else []
        if any(str(token or "").lower() in haystack for token in matches):
            value = {key: item for key, item in capability.items() if key != "match"}
            return json.loads(json.dumps(value))
    return None


def list_capability_hints():
    return json.loads(json.dumps(ADVERTISED_CAPABILITIES))
