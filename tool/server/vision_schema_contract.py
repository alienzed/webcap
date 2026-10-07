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
                            "minItems": 1,
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
            "source": str(row.get("source") or ""),
            "category": str(row.get("category") or ""),
            "suggestedGroup": str(row.get("suggestedGroup") or ""),
            "label": str(row.get("label") or ""),
            "count": int(row.get("count") or 0),
            "examples": list(row.get("examples") or [])[:6],
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
        "The existing group structure is useful semantic context and should absorb evidence that belongs to it, but its current terms may be incomplete. "
        "Propose a new group only when recurring evidence represents a useful semantic dimension that the supplied groups do not cover. "
        "Prefer promptable, visually concrete distinctions: viewpoint, position, colors bound to things, shape, material, pattern, "
        "construction, accessories, setting/background, lighting, support/surface, and concept-specific details. "
        "Merge synonymous or near-synonymous observations into one canonical term, while preserving recurring visual distinctions that appear meaningfully different. "
        "Favor useful coverage over an artificially tiny vocabulary; proposed terms are available language, not requirements to use every term.\n\n"
        "[FILTER]\n"
        "Do not turn narration, connective language, generic image words, or incidental prose into vocabulary. "
        "Generic subject nouns are usually weak vocabulary unless subject type or count is actually a varying visual distinction. "
        "Do not propose decorative wording, mood, inferred intent, or facts not grounded in the supplied evidence. "
        "Silence is better than weak vocabulary.\n\n"
        "[GROUNDING]\n"
        "Every proposed term must cite one or more supplied evidence IDs. "
        "Use an exact existing group name in targetGroup when extending it. Use an empty targetGroup for a genuinely new group. "
        "Evidence may come from an open visual pass or a fresh schema-aware visual pass. A schema-aware suggestedGroup is a strong organizational hint, not a forced answer. "
        "Evidence counts and filenames are supplied by WebCap; semantic grouping and naming are your task. "
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


def build_challenge_request(analysis, existing_groups, draft_schema):
    evidence = analysis.get("evidence") if isinstance(analysis, dict) else []
    normalized_existing = _normalize_existing_groups(existing_groups)
    draft_groups = draft_schema.get("groups") if isinstance(draft_schema, dict) else []
    compact_evidence = [
        {
            "id": str(row.get("id") or ""),
            "source": str(row.get("source") or ""),
            "category": str(row.get("category") or ""),
            "suggestedGroup": str(row.get("suggestedGroup") or ""),
            "label": str(row.get("label") or ""),
            "count": int(row.get("count") or 0),
            "examples": list(row.get("examples") or [])[:6],
        }
        for row in evidence
        if isinstance(row, dict) and row.get("id")
    ]
    payload = {
        "dataset": {
            "itemsWithSight": int((analysis or {}).get("itemCount") or 0),
            "evidence": compact_evidence,
        },
        "existingGroups": normalized_existing,
        "draftVocabulary": draft_groups if isinstance(draft_groups, list) else [],
    }
    prompt = (
        "[ROLE]\n"
        "You are the final challenge pass for annotation-vocabulary discovery. "
        "A first reasoning pass proposed a draft vocabulary from two independent Vision reads.\n\n"
        "[GOAL]\n"
        "Stress-test the draft before a human sees it. Return the corrected vocabulary proposals, not commentary. "
        "Preserve useful existing-group extensions, merge duplicate or synonymous proposed terms, restore recurring distinctions "
        "that the draft collapsed too aggressively, remove weak or ungrounded suggestions, and add genuinely missing groups only "
        "when the supplied evidence shows an important visual dimension that existing groups do not cover. "
        "It is acceptable for the vocabulary to be somewhat overcomplete: terms are available language, not requirements to use every term. "
        "Missing a meaningful recurring distinction is worse than retaining an extra plausible term.\n\n"
        "[GROUNDING]\n"
        "Every returned term must cite supplied evidence IDs. Use exact existing group names in targetGroup when extending them. "
        "Use an empty targetGroup only for a genuinely new group. Existing terms are context, not proof that a concept is visible. "
        "Do not invent evidence, filenames, or counts.\n\n"
        "[INPUT]\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\n\n[OUTPUT]\nReturn only JSON matching the supplied schema."
    )
    return {
        "operation": "vision_schema_challenge",
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
    groups_by_key = {}

    def normalized_term_payload(term, evidence_ids, existing_terms):
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
        return {
            "term": term,
            "evidenceIds": list(evidence_ids),
            "support": len(media),
            "examples": media[:6],
            "evidence": labels[:6],
            "evidenceCategories": categories[:6],
            "alreadyExists": term.casefold() in existing_terms,
        }

    for group_index, raw_group in enumerate(data["groups"][:16], start=1):
        if not isinstance(raw_group, dict):
            raise ValueError("Schema Assist group {} is not an object.".format(group_index))

        name = _clean(raw_group.get("name"), 80)
        if not name:
            raise ValueError("Schema Assist group {} has an empty name.".format(group_index))

        raw_target = _clean(raw_group.get("targetGroup"), 80)
        if raw_target:
            target = existing_by_key.get(raw_target.casefold())
            if target is None:
                raise ValueError(
                    "Schema Assist referenced unknown targetGroup '{}'."
                    .format(raw_target)
                )
        else:
            target = existing_by_key.get(name.casefold())

        effective_name = target["group"] if target else name
        group_key = target["group"].casefold() if target else "new:" + name.casefold()
        existing_terms = {term.casefold() for term in (target or {}).get("terms", [])}

        group = groups_by_key.get(group_key)
        if group is None:
            group = {
                "name": effective_name,
                "targetGroup": target["group"] if target else "",
                "action": "extend" if target else "new",
                "rationale": _clean(raw_group.get("rationale"), 500),
                "terms": [],
                "_termsByKey": {},
            }
            groups_by_key[group_key] = group
            normalized_groups.append(group)
        else:
            rationale = _clean(raw_group.get("rationale"), 500)
            if rationale and rationale not in group["rationale"]:
                group["rationale"] = _clean(
                    (group["rationale"] + " " + rationale).strip(),
                    500,
                )

        raw_terms = raw_group.get("terms")
        if not isinstance(raw_terms, list) or not raw_terms:
            raise ValueError(
                "Schema Assist group '{}' contains no term proposals."
                .format(effective_name)
            )

        for term_index, raw_term in enumerate(raw_terms[:24], start=1):
            if not isinstance(raw_term, dict):
                raise ValueError(
                    "Schema Assist term {} in group '{}' is not an object."
                    .format(term_index, effective_name)
                )
            term = _clean(raw_term.get("term"), 80)
            if not term:
                raise ValueError(
                    "Schema Assist term {} in group '{}' is empty."
                    .format(term_index, effective_name)
                )

            raw_evidence_ids = raw_term.get("evidenceIds")
            if not isinstance(raw_evidence_ids, list) or not raw_evidence_ids:
                raise ValueError(
                    "Schema Assist term '{}' in group '{}' has no evidence IDs."
                    .format(term, effective_name)
                )

            evidence_ids = []
            unknown_ids = []
            for raw_id in raw_evidence_ids:
                evidence_id = str(raw_id or "").strip()
                if not evidence_id:
                    continue
                if evidence_id not in evidence:
                    if evidence_id not in unknown_ids:
                        unknown_ids.append(evidence_id)
                    continue
                if evidence_id not in evidence_ids:
                    evidence_ids.append(evidence_id)

            if unknown_ids:
                raise ValueError(
                    "Schema Assist term '{}' in group '{}' referenced unknown evidence ID{}: {}."
                    .format(
                        term,
                        effective_name,
                        "" if len(unknown_ids) == 1 else "s",
                        ", ".join(unknown_ids),
                    )
                )
            if not evidence_ids:
                raise ValueError(
                    "Schema Assist term '{}' in group '{}' has no usable evidence IDs."
                    .format(term, effective_name)
                )

            term_key = term.casefold()
            existing_term = group["_termsByKey"].get(term_key)
            if existing_term is None:
                normalized = normalized_term_payload(term, evidence_ids, existing_terms)
                group["_termsByKey"][term_key] = normalized
                group["terms"].append(normalized)
            else:
                merged_ids = list(existing_term["evidenceIds"])
                for evidence_id in evidence_ids:
                    if evidence_id not in merged_ids:
                        merged_ids.append(evidence_id)
                refreshed = normalized_term_payload(
                    existing_term["term"],
                    merged_ids,
                    existing_terms,
                )
                existing_term.clear()
                existing_term.update(refreshed)

    for group in normalized_groups:
        group.pop("_termsByKey", None)

    existing_order = {
        row["group"].casefold(): index
        for index, row in enumerate(existing)
    }
    normalized_groups.sort(key=lambda group: (
        0 if group["targetGroup"] else 1,
        existing_order.get(str(group["targetGroup"] or "").casefold(), 10**6),
        str(group["name"] or "").casefold(),
    ))
    return {"version": 3, "groups": normalized_groups}



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
    vocabulary_boundary = (
        "- Use only supplied existing terms; never invent or rename vocabulary.\n"
        if existing_only else
        "- New terms should be short reusable vocabulary, not prose.\n"
    )
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
        + vocabulary_boundary
        + "- Empty candidates is a successful result when nothing should be added.\n\n"
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
