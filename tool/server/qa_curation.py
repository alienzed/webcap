"""QA-only concept prioritization contract for unattended training-set curation.

The Director ranks an aggregate concept inventory, never a list of images to
delete or captions to rewrite. WebCap owns the actual candidate selection.
"""
import json


def build_curation_request(concepts, training_focus="", item_count=0):
    if not isinstance(concepts, list) or not concepts or len(concepts) > 180:
        raise ValueError("QA Curation needs 1-180 aggregated concept entries.")
    if not 1 <= int(item_count) <= 5000:
        raise ValueError("QA Curation requires a non-empty training selection.")
    compact = []
    allowed = set()
    for raw in concepts:
        if not isinstance(raw, dict):
            raise ValueError("QA Curation concept must be an object.")
        identity = str(raw.get("id") or "").strip()
        group = str(raw.get("group") or "").strip()[:80]
        term = str(raw.get("term") or "").strip()[:160]
        count = raw.get("count")
        if (not identity or identity in allowed or not identity.isascii()
                or not identity.replace("_", "").isalnum() or not group or not term
                or type(count) is not int or not 1 <= count <= item_count):
            raise ValueError("QA Curation received an invalid or duplicate concept.")
        allowed.add(identity)
        compact.append({
            "id": identity, "group": group, "term": term, "count": count,
            "example": str(raw.get("example") or "").strip()[:140],
        })
    prompt = (
        "[ROLE] You are preparing a focused LoRA training dataset. Identify what "
        "the images should teach, not what incidental words are frequent.\n"
        "[TASK] Classify ONLY the supplied concept IDs into CORE (visual identity "
        "and distinctive constructions) and SUPPORTING (viewpoint, context, useful "
        "variation). Omit irrelevant, incidental, speculative, or redundant terms.\n"
        "Preserve important uncommon constructions even when they have only one "
        "or two examples. Do not enforce equal quotas for viewpoints, colors, "
        "poses, or scene backgrounds. Avoid counting descriptive complexity or "
        "caption length as image quality. Supporting dimensions may occur much "
        "more or less often than core dimensions.\n"
        "Human-approved grouped tags are strong evidence; cached Sight terms are "
        "fallible observations. 'Sight' groups deserve more caution.\n"
        "The response guides a deterministic coverage-and-redundancy selector. "
        "It does not select specific images, edit the Set, or claim optimal "
        "training performance. Return existing IDs only; no invented concepts.\n"
        "[TRAINING FOCUS]\n" + (str(training_focus or "").strip()[:300] or
                                 "Not specified; infer visual focus from coherent annotations.") +
        "\n[IMAGE COUNT] " + str(item_count) +
        "\n[CONCEPT INVENTORY]\n" +
        json.dumps(compact, ensure_ascii=False, separators=(",", ":")) +
        "\n[OUTPUT] Give a concise summary (max 30 words), then coreIds and "
        "supportingIds. An ID may appear in at most one list."
    )
    return {
        "operation": "qa_curate_set", "output": "json", "prompt": prompt,
        "max_tokens": 2048, "concept_ids": sorted(allowed),
        "response_schema": {
            "type": "object", "additionalProperties": False,
            "required": ["summary", "coreIds", "supportingIds"],
            "properties": {
                "summary": {"type": "string"},
                "coreIds": {"type": "array", "maxItems": 180,
                            "items": {"type": "string"}},
                "supportingIds": {"type": "array", "maxItems": 180,
                                  "items": {"type": "string"}},
            },
        },
    }


def normalize_curation_result(data, allowed_ids):
    if not isinstance(data, dict):
        raise ValueError("QA Curation Director response must be a JSON object.")
    allowed = set(allowed_ids)
    used = set()
    result = {}
    for source, target in (("coreIds", "coreIds"), ("supportingIds", "supportingIds")):
        entries = data.get(source)
        if not isinstance(entries, list):
            raise ValueError("QA Curation Director response has no " + source + ".")
        cleaned = []
        for value in entries:
            if not isinstance(value, str) or value not in allowed or value in used:
                raise ValueError("QA Curation Director returned an unknown or duplicate concept ID.")
            used.add(value)
            cleaned.append(value)
        result[target] = cleaned
    if not result["coreIds"]:
        raise ValueError("QA Curation Director identified no core training concepts.")
    summary = str(data.get("summary") or "").strip()
    result["summary"] = summary[:240]
    return result
