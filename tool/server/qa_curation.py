"""QA-only concept prioritization contract for unattended training-set curation.

The Director ranks an aggregate concept inventory, never a list of images to
delete or captions to rewrite. WebCap owns the actual candidate selection.
"""
import json


def build_curation_request(concepts, training_focus="", item_count=0, set_variables=None):
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
        "Grouped tags are authoritative recurring dimensions for balancing. "
        "Distinctive caption observations are evaluated independently.\n"
        "The response guides a deterministic coverage-and-redundancy selector. "
        "It does not select specific images, edit the Set, or claim optimal "
        "training performance. Return existing IDs only; no invented concepts.\n"
        "[TRAINING FOCUS]\n" + (str(training_focus or "").strip()[:300] or
                                 "Not specified; infer visual focus from coherent annotations.") +
        ("\n[SET VARIABLES] " + json.dumps(set_variables, ensure_ascii=False, separators=(",", ":")) +
         "\nThese selected group terms establish the primary balancing objectives. Interpret the remaining inventory as complementary supporting variation; preserve meaningful distinctions." if set_variables else "") +
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


def build_caption_curation_request(captions, training_focus="", known_concepts=None, set_variables=None):
    """One small Director batch of authored captions; no Vision/Sight inference."""
    import re
    if not isinstance(captions, list) or not 1 <= len(captions) <= 24:
        raise ValueError("Curate caption analysis requires 1-24 media captions per batch.")
    known = known_concepts or []
    if (not isinstance(known, list) or len(known) > 80
            or any(not isinstance(value, str) or not 1 <= len(value.strip()) <= 100 for value in known)):
        raise ValueError("Curate caption concept references are invalid.")
    compact = []
    by_file = {}
    for item in captions:
        if not isinstance(item, dict):
            raise ValueError("Curate caption evidence item must be an object.")
        name = str(item.get("fileName") or "").strip()
        caption = str(item.get("caption") or "").strip()
        if (not name or name in by_file or not caption or len(caption) > 8000
                or len(name) > 255):
            raise ValueError("Curate caption batch contains invalid or duplicate media evidence.")
        by_file[name] = caption
        compact.append({"fileName": name, "caption": caption})
    if len(json.dumps(compact, ensure_ascii=False)) > 9500:
        raise ValueError("Curate caption batch exceeds its context budget.")
    prompt = (
        "[ROLE] You are extracting distinctive learnable visual information from human-authored "
        "training captions for image LoRA curation.\n"
        "[GOAL] Identify only visual structures, physical relationships, unusual garment "
        "construction and meaningful pose/viewpoint distinctions that contribute something "
        "beyond common tagged categories. Represent genuinely repeated visual ideas with "
        "the same short canonical concept label. Use an existing canonical label whenever "
        "it describes the same visual concept.\n"
        "[EVIDENCE] Use the supplied captions as the complete evidence source. For each "
        "observation, copy a short exact quote from that caption supporting the concept. "
        "Treat an empty observations list as a valid result when there are no distinctive "
        "facts worth preserving. Give recurring ordinary background and incidental wording "
        "low priority; preserve unusual relevant constructions even if they appear once.\n"
        "[TRAINING FOCUS] " + (str(training_focus or "").strip()[:300] or "Not specified") +
        ("\n[SET VARIABLES] " + json.dumps(set_variables, ensure_ascii=False, separators=(",", ":")) +
         "\nExtract complementary visual facts beyond the selected terms themselves. Retain genuinely distinctive constructions and relationships, including those involving a selected term." if set_variables else "") +
        "\n[KNOWN CANONICAL LABELS] " + json.dumps(known, ensure_ascii=False) +
        "\n[CAPTIONS] " + json.dumps(compact, ensure_ascii=False) +
        "\n[OUTPUT] Return up to 64 observations. Each observation has fileName "
        "(copy exactly from the supplied caption entry), concept (short canonical visual "
        "concept, 1-100 characters), quote (exact nonempty caption substring)."
    )
    return {
        "operation": "qa_curate_caption", "output": "json", "prompt": prompt,
        "max_tokens": 3072, "caption_sources": by_file,
        "response_schema": {
            "type": "object", "additionalProperties": False,
            "required": ["observations"],
            "properties": {"observations": {
                "type": "array", "maxItems": 64,
                "items": {"type": "object", "additionalProperties": False,
                          "required": ["fileName", "concept", "quote"],
                          "properties": {"fileName": {"type": "string"},
                                         "concept": {"type": "string"},
                                         "quote": {"type": "string"}}}
            }}
        }
    }


def normalize_caption_curation_result(data, captions_by_file, rejected=None):
    import re
    if not isinstance(data, dict) or not isinstance(data.get("observations"), list):
        raise ValueError("Curate caption analysis returned no structured observations.")
    result, seen = [], set()
    for index, entry in enumerate(data["observations"], 1):
        reason = None
        if not isinstance(entry, dict):
            reason = "expected an observation object"
        else:
            name = entry.get("fileName")
            concept = entry.get("concept")
            quote = entry.get("quote")
            name = name.strip() if isinstance(name, str) else ""
            concept = concept.strip() if isinstance(concept, str) else ""
            quote = quote.strip() if isinstance(quote, str) else ""
            if name not in captions_by_file:
                reason = "filename does not match a supplied caption"
            elif not 1 <= len(concept) <= 100:
                reason = "concept is missing or exceeds 100 characters"
            elif not quote:
                reason = "supporting quote is missing"
            else:
                source = re.sub(r"\s+", " ", captions_by_file[name]).casefold()
                evidence = re.sub(r"\s+", " ", quote).casefold()
                if evidence not in source:
                    reason = "quote is not supported by its source caption"
        if reason is not None:
            if rejected is not None:
                rejected.append(f"Observation {index}: {reason}.")
            continue
        key = (name, concept.casefold())
        if key not in seen:
            seen.add(key)
            result.append({"fileName": name, "concept": concept, "quote": quote})
    return result
