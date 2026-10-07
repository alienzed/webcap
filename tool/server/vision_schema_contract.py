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
                                "required": ["term", "evidenceIds"],
                                "properties": {
                                    "term": {"type": "string", "minLength": 1},
                                    "evidenceIds": {
                                        "type": "array",
                                        "minItems": 1,
                                        "maxItems": 16,
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
    evidence = analysis.get("evidence") if isinstance(analysis, dict) else []
    compact_evidence = [
        {
            "id": str(row.get("id") or ""),
            "category": str(row.get("category") or ""),
            "label": str(row.get("label") or ""),
            "count": int(row.get("count") or 0),
            "examples": list(row.get("examples") or [])[:6],
            "contexts": [
                _clean(value, 260)
                for value in list(row.get("contexts") or [])[:2]
                if _clean(value)
            ],
        }
        for row in evidence
        if isinstance(row, dict) and row.get("id")
    ]
    normalized_existing = _normalize_existing_groups(existing_groups)
    payload = {
        "dataset": {
            "itemsWithSight": int((analysis or {}).get("itemCount") or 0),
            "evidence": compact_evidence,
        },
        "existingGroups": normalized_existing,
    }
    prompt = (
        "[ROLE]\n"
        "You design a compact annotation vocabulary from structured visual evidence. "
        "Groups are independent semantic dimensions; terms are reusable normalized values inside those dimensions.\n\n"
        "[GOAL]\n"
        "Bridge schema-blind Vision observations into tight concept-guided annotation vocabulary. "
        "The existing groups are already mature and should absorb evidence that belongs to them. "
        "Propose a new group only when recurring evidence represents a useful semantic dimension that the supplied groups do not cover. "
        "Prefer promptable, visually concrete distinctions: viewpoint, position, colors bound to things, shape, material, pattern, "
        "construction, accessories, setting/background, lighting, support/surface, and concept-specific details. "
        "Merge synonymous or near-synonymous observations into one canonical term.\n\n"
        "[FILTER]\n"
        "Do not turn narration, connective language, generic image words, or incidental prose into vocabulary. "
        "Generic subject nouns are usually weak vocabulary unless subject type or count is actually a varying visual distinction. "
        "Do not propose decorative wording, mood, inferred intent, or facts not grounded in the supplied evidence. "
        "Silence is better than weak vocabulary.\n\n"
        "[GROUNDING]\n"
        "Every proposed term must cite one or more supplied evidence IDs. "
        "Use an exact existing group name in targetGroup when extending it. Use an empty targetGroup for a genuinely new group. "
        "Evidence counts, filenames, and contexts are supplied by WebCap; semantic grouping and naming are your task. "
        "Existing terms are organizational context, not visual evidence: do not infer that an existing term appears unless the Sight evidence supports it.\n\n"
        "[INPUT]\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\n\n[OUTPUT]\nReturn only JSON matching the supplied schema."
    )
    return {
        "operation": "vision_schema_suggest",
        "output": "json",
        "prompt": prompt,
        "response_schema": _response_schema(),
        "sight_evidence": list(evidence or []),
        "existing_groups": normalized_existing,
    }


def normalize_result(data, sight_evidence=None, existing_groups=None):
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        raise ValueError("Schema Assist response is missing its groups array.")

    evidence = {
        str(row.get("id") or ""): row
        for row in (sight_evidence or [])
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
            evidence_ids = []
            for raw_id in raw_term.get("evidenceIds") if isinstance(raw_term.get("evidenceIds"), list) else []:
                evidence_id = str(raw_id or "").strip()
                if evidence_id in evidence and evidence_id not in evidence_ids:
                    evidence_ids.append(evidence_id)
            if not term or term_key in seen_terms or not evidence_ids:
                continue

            support_media = set()
            labels = []
            categories = []
            for evidence_id in evidence_ids:
                row = evidence[evidence_id]
                support_media.update(str(value) for value in row.get("media") or [] if str(value))
                label = _clean(row.get("label"))
                category = _clean(row.get("category"))
                if label and label not in labels:
                    labels.append(label)
                if category and category not in categories:
                    categories.append(category)
            media = sorted(support_media, key=str.casefold)
            seen_terms.add(term_key)
            terms.append({
                "term": term,
                "evidenceIds": evidence_ids,
                "support": len(media),
                "examples": media[:6],
                "evidence": labels[:6],
                "evidenceCategories": categories[:6],
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

    return {"version": 2, "groups": normalized_groups}



def _assignment_response_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "maxItems": 80,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["file", "candidates"],
                    "properties": {
                        "file": {"type": "string", "minLength": 1},
                        "candidates": {
                            "type": "array",
                            "maxItems": 40,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["group", "term", "confidence", "why"],
                                "properties": {
                                    "group": {"type": "string", "minLength": 1},
                                    "term": {"type": "string", "minLength": 1},
                                    "confidence": {
                                        "type": "string",
                                        "enum": ["high", "medium"],
                                    },
                                    "why": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            }
        },
    }


def build_assignment_request(records, existing_groups, current_assignments=None, existing_only=False):
    normalized_existing = _normalize_existing_groups(existing_groups)
    groups_by_key = {row["group"].casefold(): row for row in normalized_existing}
    assignments = current_assignments if isinstance(current_assignments, dict) else {}
    compact_items = []
    allowed_files = []
    for raw in records if isinstance(records, list) else []:
        if not isinstance(raw, dict):
            continue
        file_name = str(raw.get("file") or "").strip()
        description = _clean(raw.get("description"), 1200)
        inventory = raw.get("inventory") if isinstance(raw.get("inventory"), dict) else {}
        if not file_name or not description:
            continue
        allowed_files.append(file_name)
        compact_items.append({
            "file": file_name,
            "description": description,
            "inventory": inventory,
            "currentAssignments": assignments.get(file_name) if isinstance(assignments.get(file_name), list) else [],
        })

    if not compact_items:
        raise ValueError("Tag Assist needs structured Sight for at least one media item.")
    if not normalized_existing:
        raise ValueError("Tag Assist needs at least one configured annotation group.")

    payload = {
        "groups": normalized_existing,
        "items": compact_items,
    }
    prompt = (
        "[ROLE]\n"
        "You map visual Sight evidence onto WebCap's mature annotation vocabulary. "
        "The supplied group names define semantic dimensions. Existing terms are preferred whenever they accurately describe what is visible.\n\n"
        "[GOAL]\n"
        "For each media item, return only tags that a human can confidently add from the supplied visual evidence. "
        + (
            "Use only exact existing terms from the supplied vocabulary. Do not propose new terms or groups. "
            if existing_only else
            "Use an exact existing term when one fits. When an important clearly visible concept belongs to a supplied group but no existing term expresses it, "
            "you may propose a concise new term for that same group. Do not create new groups. "
        )
        + "\n\n"
        "[BOUNDARIES]\n"
        "- Sight evidence is authoritative; do not infer facts merely because a term exists in the vocabulary.\n"
        "- Do not repeat tags already present in currentAssignments.\n"
        "- Prefer high confidence. Use medium only when useful and visually well supported. Omit weak or speculative candidates.\n"
        "- Respect the group meaning. A term must belong semantically to the exact group you name.\n"
        "- Preserve existing term spelling exactly when using existing vocabulary.\n"
        "- New terms should be short reusable vocabulary, not prose.\n"
        "- Empty candidates is a successful result when nothing should be added.\n\n"
        "[INPUT]\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\n\n[OUTPUT]\nReturn only JSON matching the supplied schema."
    )
    return {
        "operation": "vision_tag_suggest",
        "output": "json",
        "prompt": prompt,
        "response_schema": _assignment_response_schema(),
        "existing_groups": normalized_existing,
        "source_files": allowed_files,
        "current_assignments": assignments,
        "existing_only": bool(existing_only),
    }


def normalize_assignment_result(data, existing_groups=None, allowed_files=None, current_assignments=None, existing_only=False):
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ValueError("Tag Assist response is missing its items array.")

    existing = _normalize_existing_groups(existing_groups)
    group_by_key = {row["group"].casefold(): row for row in existing}
    allowed = {
        str(value or "").strip()
        for value in (allowed_files or [])
        if str(value or "").strip()
    }
    assigned = current_assignments if isinstance(current_assignments, dict) else {}
    out = []
    seen_files = set()

    for raw_item in data["items"]:
        if not isinstance(raw_item, dict):
            continue
        file_name = str(raw_item.get("file") or "").strip()
        if not file_name or (allowed and file_name not in allowed) or file_name in seen_files:
            continue
        seen_files.add(file_name)

        existing_assigned = set()
        for row in assigned.get(file_name) if isinstance(assigned.get(file_name), list) else []:
            if not isinstance(row, dict):
                continue
            group = _clean(row.get("group"))
            term = _clean(row.get("term"))
            if group and term:
                existing_assigned.add((group.casefold(), term.casefold()))

        candidates = []
        seen = set()
        for raw in raw_item.get("candidates") if isinstance(raw_item.get("candidates"), list) else []:
            if not isinstance(raw, dict):
                continue
            raw_group = _clean(raw.get("group"), 80)
            target = group_by_key.get(raw_group.casefold())
            term = _clean(raw.get("term"), 80)
            confidence = str(raw.get("confidence") or "").strip().lower()
            why = _clean(raw.get("why"), 240)
            if target is None or not term or confidence not in {"high", "medium"}:
                continue

            exact_terms = {value.casefold(): value for value in target["terms"]}
            canonical = exact_terms.get(term.casefold(), term)
            if existing_only and canonical.casefold() not in exact_terms:
                continue
            key = (target["group"].casefold(), canonical.casefold())
            if key in seen or key in existing_assigned:
                continue
            seen.add(key)
            candidates.append({
                "group": target["group"],
                "term": canonical,
                "existing": canonical.casefold() in exact_terms,
                "confidence": confidence,
                "why": why,
            })

        out.append({"file": file_name, "candidates": candidates})

    by_file = {row["file"]: row for row in out}
    ordered = []
    for file_name in (allowed_files or []):
        file_name = str(file_name or "").strip()
        if file_name and file_name in allowed:
            ordered.append(by_file.get(file_name, {"file": file_name, "candidates": []}))
    if not ordered:
        ordered = out
    for row in ordered:
        row["candidates"].sort(key=lambda candidate: (
            0 if candidate["confidence"] == "high" else 1,
            candidate["group"].casefold(),
            candidate["term"].casefold(),
        ))
    return {"version": 1, "items": ordered}
