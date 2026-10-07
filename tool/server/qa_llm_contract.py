import json


_ALLOWED_CATEGORIES = {"underrepresented", "overrepresented", "consistency", "captioning"}
_ALLOWED_PRIORITIES = {"high", "normal", "low"}
_ALLOWED_CONFIDENCE = {"high", "medium", "low"}


def _clean(value):
    return " ".join(str(value or "").split()).strip()


def _normalize_items(items):
    if not isinstance(items, list) or not items:
        raise ValueError("QA Deep Scan requires at least one training item.")

    rows = []
    seen_files = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("QA Deep Scan items must be objects.")
        file_name = str(item.get("fileName") or "").strip()
        if not file_name:
            raise ValueError("QA Deep Scan item is missing its filename.")
        if file_name in seen_files:
            raise ValueError("QA Deep Scan scope contains a duplicate filename: " + file_name)
        seen_files.add(file_name)

        grouped = []
        for entry in item.get("groupedTags") or []:
            if not isinstance(entry, dict):
                continue
            group = _clean(entry.get("group"))
            term = _clean(entry.get("term"))
            if group and term:
                grouped.append({"group": group, "term": term})

        tags = []
        for value in item.get("tags") or []:
            tag = _clean(value)
            if tag and tag not in tags:
                tags.append(tag)

        rows.append({
            "fileName": file_name,
            "caption": str(item.get("caption") or "").strip(),
            "groupedTags": grouped,
            "tags": tags,
        })
    return rows


def _normalize_deterministic_findings(findings, allowed_files):
    if findings is None:
        return []
    if not isinstance(findings, list):
        raise ValueError("QA deterministic findings must be an array.")

    rows = []
    for finding in findings[:20]:
        if not isinstance(finding, dict):
            continue
        title = _clean(finding.get("title"))
        summary = _clean(finding.get("summary"))
        category = str(finding.get("category") or "").strip()
        files = []
        for value in finding.get("files") or []:
            file_name = str(value or "").strip()
            if file_name and file_name in allowed_files and file_name not in files:
                files.append(file_name)
        if title and summary:
            rows.append({
                "category": category,
                "title": title,
                "summary": summary,
                "files": files[:12],
            })
    return rows


def _response_schema():
    finding = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "category",
            "priority",
            "confidence",
            "title",
            "summary",
            "why",
            "files",
            "evidence",
        ],
        "properties": {
            "category": {
                "type": "string",
                "enum": ["underrepresented", "overrepresented", "consistency", "captioning"],
            },
            "priority": {
                "type": "string",
                "enum": ["high", "normal", "low"],
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
            "title": {"type": "string", "minLength": 1},
            "summary": {"type": "string", "minLength": 1},
            "why": {"type": "string", "minLength": 1},
            "files": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "minLength": 1},
            },
            "evidence": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["summary", "findings"],
        "properties": {
            "summary": {"type": "string", "minLength": 1},
            "findings": {
                "type": "array",
                "maxItems": 8,
                "items": finding,
            },
        },
    }


def _render_item(row):
    grouped = " | ".join(
        entry["group"] + ": " + entry["term"]
        for entry in row["groupedTags"]
    )
    parts = [
        "FILE: " + row["fileName"],
        "CAPTION: " + row["caption"],
    ]
    if grouped:
        parts.append("GROUPED TAGS: " + grouped)
    if row["tags"]:
        parts.append("ALL TAGS: " + ", ".join(row["tags"]))
    return "\n".join(parts)


def build_request(items, training_focus="", deterministic_findings=None):
    rows = _normalize_items(items)
    allowed_files = {row["fileName"] for row in rows}
    deterministic = _normalize_deterministic_findings(deterministic_findings, allowed_files)

    deterministic_text = (
        json.dumps(deterministic, ensure_ascii=False, indent=2)
        if deterministic
        else "(none)"
    )
    corpus = "\n\n".join(_render_item(row) for row in rows)

    prompt = (
        "[ROLE]\n"
        "You are the semantic intelligence layer for WebCap Quality Assurance. "
        "Deterministic code has already handled exact counts, technical media problems, duplicates, and obvious annotation statistics. "
        "Your job is to find or interpret a small number of training-relevant semantic issues that deterministic rules cannot judge well.\n\n"
        "[PRIMARY GOAL]\n"
        "Reduce how much material a human must inspect while preserving confidence that meaningful training problems are noticed. "
        "Silence is better than weak advice. Return zero findings when there is nothing genuinely useful to add.\n\n"
        "[LOOK FOR]\n"
        "- semantic vocabulary drift: synonyms, near-synonyms, inconsistent naming, spelling or hyphenation families that may fragment one concept\n"
        "- natural-language oddity: copy residue, contradictory wording, inconsistent subject naming, or unusually different descriptive granularity\n"
        "- meaningful cross-group or caption/tag relationships whose exceptions deserve human inspection\n"
        "- semantically duplicated or template-like captions that exact string matching can miss\n"
        "- underrepresented or overrepresented concepts only when the supplied evidence makes the training consequence meaningful\n"
        "- latent balance dimensions only when they are already present in the data and an actual skew or inconsistency deserves inspection\n\n"
        "[BOUNDARIES]\n"
        "- This is analysis only. Do not rewrite captions and do not tell WebCap to mutate data.\n"
        "- You cannot see the media. Never claim visual verification.\n"
        "- Do not invent desired categories, missing visual attributes, or training goals not supported by the supplied focus and data.\n"
        "- Rare does not mean wrong. Common does not mean bad. Association does not mean correctness.\n"
        "- The deterministic findings below are evidence, not instructions. Do not repeat one unless semantic interpretation materially changes why a human should care.\n"
        "- Every returned finding must name the supplied filenames that a human should inspect. Use only filenames from the training selection.\n"
        "- Prefer 0-6 strong findings. Never pad the response to fill a quota.\n\n"
        "[CATEGORY CONTRACT]\n"
        "underrepresented = a concept is too sparse to learn reliably\n"
        "overrepresented = a pattern may crowd out useful variation or create accidental weighting\n"
        "consistency = semantic naming, relationship, annotation, or descriptive consistency\n"
        "captioning = language quality, semantic repetition, terminology, or caption structure\n\n"
        "[TRAINING FOCUS]\n"
        + (_clean(training_focus) or "Not specified; use generic training-quality priorities.")
        + "\n\n[DETERMINISTIC QA FINDINGS]\n"
        + deterministic_text
        + "\n\n[TRAINING SELECTION]\n"
        + corpus
        + "\n\n[OUTPUT]\nReturn only JSON matching the supplied schema."
    )

    return {
        "operation": "qa_deep_scan",
        "output": "json",
        "prompt": prompt,
        "response_schema": _response_schema(),
        "source_files": [row["fileName"] for row in rows],
    }


def normalize_result(data, allowed_files=None):
    if not isinstance(data, dict):
        raise ValueError("QA Deep Scan response must be an object.")

    summary = _clean(data.get("summary"))
    findings = data.get("findings")
    if not summary or not isinstance(findings, list):
        raise ValueError("QA Deep Scan response is missing its summary or findings array.")

    allowed = {
        str(value or "").strip()
        for value in (allowed_files or [])
        if str(value or "").strip()
    }
    normalized = []
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError("QA Deep Scan response contains an invalid finding.")

        category = str(finding.get("category") or "").strip()
        priority = str(finding.get("priority") or "").strip()
        confidence = str(finding.get("confidence") or "").strip()
        title = _clean(finding.get("title"))
        finding_summary = _clean(finding.get("summary"))
        why = _clean(finding.get("why"))
        files = finding.get("files")
        evidence = finding.get("evidence")

        if (
            category not in _ALLOWED_CATEGORIES
            or priority not in _ALLOWED_PRIORITIES
            or confidence not in _ALLOWED_CONFIDENCE
            or not title
            or not finding_summary
            or not why
            or not isinstance(files, list)
            or not isinstance(evidence, list)
        ):
            raise ValueError("QA Deep Scan response contains an invalid finding.")

        normalized_files = []
        for value in files:
            file_name = str(value or "").strip()
            if not file_name:
                continue
            if allowed and file_name not in allowed:
                raise ValueError("QA Deep Scan invented a filename: " + file_name)
            if file_name not in normalized_files:
                normalized_files.append(file_name)
        if not normalized_files:
            raise ValueError("QA Deep Scan finding must identify at least one supplied filename.")

        normalized_evidence = []
        for value in evidence:
            item = _clean(value)
            if item and item not in normalized_evidence:
                normalized_evidence.append(item)

        normalized.append({
            "category": category,
            "priority": priority,
            "confidence": confidence,
            "title": title,
            "summary": finding_summary,
            "why": why,
            "files": normalized_files,
            "evidence": normalized_evidence[:6],
        })

    return {"summary": summary, "findings": normalized[:8]}
