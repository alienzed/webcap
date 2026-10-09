import json


_ALLOWED_CATEGORIES = {"consistency", "captioning"}
_ALLOWED_PRIORITIES = {"high", "normal", "low"}
_ALLOWED_CONFIDENCE = {"high", "medium", "low"}


def _clean(value):
    return " ".join(str(value or "").split()).strip()


def _normalize_analysis(value):
    if not isinstance(value, dict):
        return {}
    out = {}
    face = value.get("faceFocus")
    if isinstance(face, dict):
        out["faceFocus"] = {
            "bucket": _clean(face.get("bucket")) or "unknown",
            "faceCount": int(face.get("faceCount") or 0),
            "largestHeightPct": float(face.get("largestHeightPct") or 0),
        }
    pose = value.get("selectionPose")
    if isinstance(pose, dict):
        out["selectionPose"] = {
            "faceDirection": _clean(pose.get("faceDirection")) or "unknown",
            "expression": _clean(pose.get("expression")) or "unknown",
            "bodyOrientation": _clean(pose.get("bodyOrientation")) or "unknown",
            "poseClass": _clean(pose.get("poseClass")) or "unknown",
            "armPosition": _clean(pose.get("armPosition")) or "unknown",
        }
    complexity = value.get("sceneComplexity")
    if isinstance(complexity, dict):
        out["sceneComplexity"] = {
            "bucket": _clean(complexity.get("bucket")) or "unknown",
            "score": float(complexity.get("score") or 0),
        }
    sight = value.get("visionSight")
    if isinstance(sight, dict):
        description = _clean(sight.get("description"))[:1200]
        inventory = sight.get("inventory") if isinstance(sight.get("inventory"), dict) else {}
        if description:
            out["visionSight"] = {
                "model": _clean(sight.get("model"))[:160],
                "description": description,
                "inventory": inventory,
            }
    context = value.get("contextSight")
    if isinstance(context, dict):
        caption = _clean(context.get("caption"))[:1200]
        matches = []
        for match in (context.get("matches") or [])[:16]:
            if not isinstance(match, dict):
                continue
            group = _clean(match.get("group"))
            terms = [_clean(term) for term in (match.get("terms") or [])[:16] if _clean(term)]
            if group and terms:
                matches.append({"group": group, "terms": terms})
        if caption or matches:
            out["contextSight"] = {"caption": caption, "matches": matches}
    return out


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
                grouped.append({"group": group, "alias": _clean(entry.get("alias")), "term": term})

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
            "analysis": _normalize_analysis(item.get("analysis")),
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
            "patches",
        ],
        "properties": {
            "category": {
                "type": "string",
                "enum": ["consistency", "captioning"],
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
            "patches": {
                "type": "array",
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["file", "action", "sourceText", "replacementText", "anchorText"],
                    "properties": {
                        "file": {"type": "string", "minLength": 1},
                        "action": {"type": "string", "enum": ["add", "replace", "remove"]},
                        "sourceText": {"type": "string"},
                        "replacementText": {"type": "string"},
                        "anchorText": {"type": "string"},
                    },
                },
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
        entry["group"] + (" (" + entry["alias"] + ")" if entry["alias"] else "") + ": " + entry["term"]
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
    if row.get("analysis"):
        parts.append("NORMALIZED VISUAL ANALYSIS: " + json.dumps(row["analysis"], ensure_ascii=False, separators=(",", ":")))
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
        "Deterministic code has already handled exact counts, technical media problems, duplicates, obvious annotation statistics, and selected high-confidence cross-signal checks. "
        "Some items also include normalized Face Focus, MediaPipe pose, Scene Complexity, and cached Vision Sight evidence. "
        "Your job is to find or interpret a small number of training-relevant semantic issues that deterministic rules cannot judge well.\n\n"
        "[PRIMARY GOAL]\n"
        "Reduce how much material a human must inspect while preserving confidence that meaningful training problems are noticed. "
        "Silence is better than weak advice. Return zero findings when there is nothing genuinely useful to add.\n\n"
        "[LOOK FOR]\n"
        "- actionable missing or conflicting grouped tags: compare saved assignments against cached Open Sight and Context Sight; identify exact files and groups\\n"
        "- caption omissions and contradictions: compare saved captions with assigned tags and cached visual descriptions\\n"
        "- semantic vocabulary drift: synonyms, near-synonyms, inconsistent naming, spelling or hyphenation families that may fragment one concept\n"
        "- natural-language oddity: copy residue, contradictory wording, inconsistent subject naming, or unusually different descriptive granularity\n"
        "- meaningful cross-group or caption/tag relationships only when there is evidence of an actual annotation omission, inconsistency, or contradiction\n"
        "- semantically duplicated or template-like captions that exact string matching can miss\n"

        "[BOUNDARIES]\n"
        "- This is analysis only. Do not return full rewritten captions and do not tell WebCap to mutate data; exact proposed patches are allowed.\n"
        "- You cannot see the media directly. Treat normalized visual analysis as supplied evidence, not as perfect ground truth, and never claim direct visual verification.\n"
        "- Do not infer standing, sitting, or a grounded posture from cropped framing (including cowboy shots) unless visible evidence actually establishes that posture. Missing feet or floor contact does not prove standing. If the framing cannot establish the posture, return no posture-related finding.\n"
        "- Open Sight is vocabulary-agnostic; Context Sight follows current vocabulary. Their agreement is stronger than either one alone.\\n"
        "- Context Sight matches are candidate observations, not proof that a tag must be added. Cross-check them.\\n"
        "- Prefer specific corrections that can be made in the existing item editor.\\n"
        "- For captioning findings, include exact patches whenever the supplied evidence supports a concrete edit. Use only add, replace, or remove.\\n"
        "- For replace/remove, sourceText must be copied exactly from that file's supplied current caption. For add, sourceText must be empty and replacementText must be compact caption-ready wording.\\n"
        "- For add, anchorText may be one exact substring from the current caption when placement is clear; otherwise leave anchorText empty for insertion at the user's caret.\\n"
        "- Patches are optional evidence-backed actions, not a quota. Return an empty patches array rather than guessing.\\n"
        "- Prefer issues supported by agreement between independent sources such as annotations, MediaPipe, Face Focus, or Vision Sight.\n"
        "- Do not invent desired categories, missing visual attributes, or training goals not supported by the supplied focus and data.\n"
        "- Rare does not mean wrong. Common does not mean bad. Association does not mean correctness.\n"
        "- Treat unverified statistical associations as investigation hints, never as findings to repeat automatically. Independently assess the current item's caption, tags and visual evidence. If the exception is a legitimate variation, return no finding.\n"
        "- QA is about annotation accuracy, not dataset balance: do not report overrepresentation, underrepresentation, or legitimate attribute combinations as annotation errors. Correct explicit attribute tagging is valuable.\n"
        "- The supplied candidates may carry full-scope counts; do not reinterpret batch-local prevalence as Set-level under/overrepresentation.\n"
        "- Do not repeat a deterministic finding unless semantic interpretation materially changes why a human should care.\n"
        "- Every returned finding must name the supplied filenames that a human should inspect. Use only filenames from the training selection.\n"
        "- Prefer 0-6 strong findings. Never pad the response to fill a quota.\n\n"
        "[CATEGORY CONTRACT]\n"
        "consistency = semantic naming, relationship, annotation, or descriptive consistency\n"
        "captioning = language quality, semantic repetition, terminology, or caption structure\n\n"
        "[TRAINING FOCUS]\n"
        + (_clean(training_focus) or "Not specified; use generic training-quality priorities.")
        + "\n\n[DETERMINISTIC QA FINDINGS AND UNVERIFIED CANDIDATES]\n"
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


def normalize_result(data, allowed_files=None, captions_by_file=None):
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
    patch_warnings = []
    finding_warnings = []
    for finding_index, finding in enumerate(findings):
        try:
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
            patches = finding.get("patches")

            if (
                category not in _ALLOWED_CATEGORIES
                or priority not in _ALLOWED_PRIORITIES
                or confidence not in _ALLOWED_CONFIDENCE
                or not title
                or not finding_summary
                or not why
                or not isinstance(files, list)
                or not isinstance(evidence, list)
                or not isinstance(patches, list)
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

            caption_lookup = captions_by_file if isinstance(captions_by_file, dict) else {}
            normalized_patches = []
            seen_patches = set()
            for patch in patches[:8]:
                try:
                    if not isinstance(patch, dict):
                        raise ValueError("QA Deep Scan response contains an invalid caption patch.")
                    file_name = str(patch.get("file") or "").strip()
                    action = str(patch.get("action") or "").strip().lower()
                    source_text = str(patch.get("sourceText") or "")
                    replacement_text = str(patch.get("replacementText") or "")
                    anchor_text = str(patch.get("anchorText") or "")
                    if file_name not in normalized_files or action not in {"add", "replace", "remove"}:
                        raise ValueError("QA Deep Scan caption patch is outside its finding.")
                    if file_name not in caption_lookup:
                        raise ValueError("QA Deep Scan caption patch is missing its submitted caption.")
                    caption = str(caption_lookup.get(file_name) or "")
                    if action == "add":
                        if source_text.strip() or not replacement_text.strip():
                            raise ValueError("QA Deep Scan add patch is invalid.")
                        # A proposal is not an edit. Check exact text only when applying it.
                    elif action == "replace":
                        if not source_text.strip() or not replacement_text.strip() or source_text == replacement_text:
                            raise ValueError("QA Deep Scan replace patch is invalid.")
                        # A proposal is not an edit. Check exact text only when applying it.
                        anchor_text = ""
                    else:
                        if not source_text.strip() or replacement_text:
                            raise ValueError("QA Deep Scan remove patch is invalid.")
                        # A proposal is not an edit. Check exact text only when applying it.
                        anchor_text = ""
                    key = (file_name, action, source_text, replacement_text, anchor_text)
                    if key in seen_patches:
                        continue
                    seen_patches.add(key)
                    normalized_patches.append({
                        "file": file_name,
                        "action": action,
                        "sourceText": source_text,
                        "replacementText": replacement_text,
                        "anchorText": anchor_text,
                    })
        
                except ValueError as exc:
                    patch_warnings.append(str(exc) + " (" + str(patch.get("file") if isinstance(patch, dict) else "unknown file") + ")")
            normalized.append({
                "category": category,
                "priority": priority,
                "confidence": confidence,
                "title": title,
                "summary": finding_summary,
                "why": why,
                "files": normalized_files,
                "evidence": normalized_evidence[:6],
                "patches": normalized_patches,
            })

        except ValueError as exc:
            finding_warnings.append('Finding ' + str(finding_index + 1) + ': ' + str(exc))
    result = {"summary": summary, "findings": normalized[:8]}
    if patch_warnings:
        result["patchWarnings"] = patch_warnings
    if finding_warnings:
        result["findingWarnings"] = finding_warnings
    return result
