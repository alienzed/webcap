import json


def _clean(value, limit=0):
    text = " ".join(str(value or "").split()).strip()
    return text[:limit] if limit else text


def _normalize_existing_groups(groups):
    out = []
    seen = set()
    for raw in groups if isinstance(groups, list) else []:
        if not isinstance(raw, dict):
            continue
        name = _clean(raw.get("group") or raw.get("name"))
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        terms = []
        term_seen = set()
        for value in raw.get("terms") if isinstance(raw.get("terms"), list) else []:
            term = _clean(value)
            low = term.casefold()
            if term and low not in term_seen:
                term_seen.add(low)
                terms.append(term)
        out.append({"group": name, "terms": terms})
    return out


def _response_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["groups"],
        "properties": {
            "groups": {
                "type": "array",
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "targetGroup", "rationale", "terms"],
                    "properties": {
                        "name": {"type": "string", "minLength": 1},
                        "targetGroup": {"type": "string"},
                        "rationale": {"type": "string"},
                        "terms": {
                            "type": "array",
                            "maxItems": 24,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["term", "patternIds"],
                                "properties": {
                                    "term": {"type": "string", "minLength": 1},
                                    "patternIds": {
                                        "type": "array",
                                        "minItems": 1,
                                        "maxItems": 12,
                                        "items": {"type": "string", "minLength": 1},
                                    },
                                },
                            },
                        },
                    },
                },
            }
        },
    }


def build_request(analysis, existing_groups):
    patterns = analysis.get("patterns") if isinstance(analysis, dict) else []
    compact_patterns = [
        {
            "id": str(row.get("id") or ""),
            "label": str(row.get("label") or ""),
            "count": int(row.get("count") or 0),
            "examples": list(row.get("examples") or [])[:6],
        }
        for row in patterns if isinstance(row, dict) and row.get("id")
    ]
    normalized_existing = _normalize_existing_groups(existing_groups)
    payload = {
        "dataset": {
            "itemsWithSight": int((analysis or {}).get("itemCount") or 0),
            "patterns": compact_patterns,
        },
        "existingGroups": normalized_existing,
    }
    prompt = (
        "[ROLE]\n"
        "You design a compact annotation vocabulary from recurring visual evidence. "
        "Groups are independent semantic dimensions; terms are reusable normalized values inside those dimensions.\n\n"
        "[GOAL]\n"
        "Find the smallest useful vocabulary that captures recurring visual distinctions in this dataset. "
        "Prefer reusable distinctions with meaningful support. Merge synonymous or near-synonymous evidence into one canonical term. "
        "Extend an existing group when the evidence belongs to that dimension; otherwise propose a concise new group.\n\n"
        "[GROUNDING]\n"
        "Every proposed term cites one or more supplied pattern IDs. "
        "Use an exact existing group name in targetGroup when extending it. Use an empty targetGroup for a new group. "
        "Pattern counts and example filenames are evidence supplied by WebCap; semantic grouping and naming are your task.\n\n"
        "[INPUT]\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\n\n[OUTPUT]\nReturn only JSON matching the supplied schema."
    )
    return {
        "operation": "vision_schema_suggest",
        "output": "json",
        "prompt": prompt,
        "response_schema": _response_schema(),
        "pattern_evidence": list(patterns or []),
        "existing_groups": normalized_existing,
    }


def normalize_result(data, pattern_evidence=None, existing_groups=None):
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        raise ValueError("Schema Assist response is missing its groups array.")

    patterns = {
        str(row.get("id") or ""): row
        for row in (pattern_evidence or [])
        if isinstance(row, dict) and row.get("id")
    }
    existing = _normalize_existing_groups(existing_groups)
    existing_by_key = {row["group"].casefold(): row for row in existing}
    normalized_groups = []
    seen_groups = set()

    for raw_group in data["groups"][:16]:
        if not isinstance(raw_group, dict):
            continue
        name = _clean(raw_group.get("name"), 80)
        raw_target = _clean(raw_group.get("targetGroup"), 80)
        target = existing_by_key.get(raw_target.casefold()) if raw_target else None
        if target is None and name.casefold() in existing_by_key:
            target = existing_by_key[name.casefold()]
        effective_name = target["group"] if target else name
        group_key = target["group"].casefold() if target else "new:" + name.casefold()
        if not effective_name or group_key in seen_groups:
            continue

        existing_terms = {term.casefold() for term in (target or {}).get("terms", [])}
        terms = []
        seen_terms = set()
        raw_terms = raw_group.get("terms") if isinstance(raw_group.get("terms"), list) else []
        for raw_term in raw_terms[:24]:
            if not isinstance(raw_term, dict):
                continue
            term = _clean(raw_term.get("term"), 80)
            term_key = term.casefold()
            pattern_ids = []
            for raw_id in raw_term.get("patternIds") if isinstance(raw_term.get("patternIds"), list) else []:
                pattern_id = str(raw_id or "").strip()
                if pattern_id in patterns and pattern_id not in pattern_ids:
                    pattern_ids.append(pattern_id)
            if not term or term_key in seen_terms or not pattern_ids:
                continue

            support_media = set()
            evidence = []
            for pattern_id in pattern_ids:
                pattern = patterns[pattern_id]
                support_media.update(str(value) for value in pattern.get("media") or [] if str(value))
                label = _clean(pattern.get("label"))
                if label and label not in evidence:
                    evidence.append(label)
            media = sorted(support_media, key=str.casefold)
            seen_terms.add(term_key)
            terms.append({
                "term": term,
                "patternIds": pattern_ids,
                "support": len(media),
                "examples": media[:6],
                "evidence": evidence[:6],
                "alreadyExists": term_key in existing_terms,
            })

        if not terms:
            continue
        seen_groups.add(group_key)
        normalized_groups.append({
            "name": effective_name,
            "targetGroup": target["group"] if target else "",
            "action": "extend" if target else "new",
            "rationale": _clean(raw_group.get("rationale"), 500),
            "terms": terms,
        })

    return {"version": 1, "groups": normalized_groups}
