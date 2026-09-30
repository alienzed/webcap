from collections import Counter
import re


_WORD_RE = re.compile(r"\b[\w'-]+\b", re.UNICODE)


def _clean_caption(value):
    lines = [line.strip() for line in str(value or "").replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _scope_summary(rows):
    captioned = [row for row in rows if row["caption"]]
    missing = [row for row in rows if not row["caption"]]
    unique_captions = Counter(row["caption"] for row in captioned)
    duplicate_groups = sum(1 for count in unique_captions.values() if count > 1)
    word_counts = sorted(len(_WORD_RE.findall(row["caption"])) for row in captioned)
    if word_counts:
        mid = len(word_counts) // 2
        median_words = (
            word_counts[mid]
            if len(word_counts) % 2
            else int(round((word_counts[mid - 1] + word_counts[mid]) / 2))
        )
        min_words = word_counts[0]
        max_words = word_counts[-1]
    else:
        median_words = min_words = max_words = 0
    return {
        "total": len(rows),
        "captioned": len(captioned),
        "missing": len(missing),
        "uniqueCaptions": len(unique_captions),
        "exactDuplicateGroups": duplicate_groups,
        "minWords": min_words,
        "medianWords": median_words,
        "maxWords": max_words,
    }


def _corpus_lines(rows):
    by_caption = {}
    missing = []
    for row in rows:
        if not row["caption"]:
            missing.append(row["fileName"])
            continue
        by_caption.setdefault(row["caption"], []).append(row["fileName"])

    lines = []
    for caption, files in sorted(
        by_caption.items(),
        key=lambda item: (-len(item[1]), item[0].casefold()),
    ):
        lines.append(
            "[count="
            + str(len(files))
            + "] [files="
            + " | ".join(files)
            + "] "
            + caption
        )
    return lines, missing


def build_request(items, instruction=""):
    rows = []
    seen_files = set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        file_name = str(item.get("fileName") or "").strip()
        if not file_name or file_name in seen_files:
            continue
        seen_files.add(file_name)
        rows.append({
            "fileName": file_name,
            "caption": _clean_caption(item.get("caption")),
        })

    if not rows:
        raise ValueError("Review Dataset requires at least one media item.")

    scope = _scope_summary(rows)
    corpus, missing_files = _corpus_lines(rows)
    instruction = str(instruction or "").strip()
    if not instruction:
        instruction = "Perform a full read-only review of this caption set."

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["summary", "strengths", "findings", "focusSets", "conclusion"],
        "properties": {
            "summary": {
                "type": "string",
                "minLength": 1,
                "description": "A concise evidence-grounded characterization of the caption corpus.",
            },
            "strengths": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "description": "Concrete things the caption set is already doing well.",
            },
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["category", "priority", "title", "detail", "evidence"],
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": [
                                "consistency",
                                "coverage",
                                "balance",
                                "repetition",
                                "annotation-hygiene",
                                "outlier",
                                "training-signal",
                            ],
                        },
                        "priority": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                        "title": {"type": "string", "minLength": 1},
                        "detail": {"type": "string", "minLength": 1},
                        "evidence": {
                            "type": "array",
                            "items": {"type": "string", "minLength": 1},
                        },
                    },
                },
                "description": "The most useful corpus-level observations, prioritized by practical review value.",
            },
            "focusSets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["label", "reason", "files"],
                    "properties": {
                        "label": {"type": "string", "minLength": 1},
                        "reason": {"type": "string", "minLength": 1},
                        "files": {
                            "type": "array",
                            "items": {"type": "string", "minLength": 1},
                        },
                    },
                },
                "description": "Optional groups of supplied filenames worth inspecting together. Empty is valid.",
            },
            "conclusion": {
                "type": "string",
                "minLength": 1,
                "description": "A short bottom-line summary of what deserves human attention next.",
            },
        },
    }

    prompt = (
        "[ROLE]\n"
        "You are WebCap's Review Dataset Assistant. You are auditing captions from one image/video training Set. "
        "This is a read-only analysis task.\n\n"
        "[USER REQUEST]\n"
        + instruction
        + "\n\n"
        "[NON-NEGOTIABLE BOUNDARIES]\n"
        "- Analyze only the supplied caption text, filenames, and deterministic scope statistics.\n"
        "- You cannot see the underlying images or videos in this task. Never claim that you verified visual content.\n"
        "- Do not rewrite captions, propose replacement captions, or instruct WebCap to modify captions.\n"
        "- Do not invent missing attributes, desired categories, or problems that are not evidenced by the corpus.\n"
        "- Distinguish strong evidence from uncertain interpretation. If something is ambiguous, say so.\n"
        "- When citing an outlier or inconsistency, name supplied filenames and/or quote only short identifying phrases.\n"
        "- focusSets may contain only filenames that appear in the supplied corpus or missing-caption list.\n\n"
        "[WHAT TO ANALYZE]\n"
        "Look for the kinds of corpus-level issues a human can miss while quickly scanning hundreds of captions:\n"
        "1. Consistency: stable subject/identity tokens, recurring attributes, naming drift, contradictions, and inconsistent granularity.\n"
        "2. Semantic coverage: recurring dimensions such as pose/view, framing, action/expression, clothing/appearance, setting/background, lighting/time, and camera/composition when those dimensions actually appear.\n"
        "3. Balance: dominant versus sparse recurring modes inside dimensions that are present. Do not manufacture a checklist of categories that the Set never attempts to represent.\n"
        "4. Repetition: exact duplication, near-template repetition, copy/paste residue, and captions that vary only trivially.\n"
        "5. Annotation hygiene: suspicious one-off terminology, synonym drift, spelling/format artifacts, unusually short/long captions, and inconsistent descriptive detail.\n"
        "6. Outliers: captions whose language is unusually disconnected from the rest of the Set, plus missing captions.\n"
        "7. Training signal: places where important recurring concepts are described inconsistently, incidental details dominate, or rare wording may create noisy associations. Keep this evidence-based rather than speculative.\n"
        "8. Useful review focus sets: when several files share one concrete issue, group them so the user could inspect them together later. Prefer a few high-value groups over many weak ones.\n\n"
        "[REPORT QUALITY]\n"
        "- Prioritize findings that would actually change what a human reviews next.\n"
        "- Avoid generic advice such as 'add more diversity' unless the supplied captions demonstrate a specific skew.\n"
        "- Do not treat every rare term as an error; rarity can be legitimate. Explain why a rare pattern is suspicious before flagging it.\n"
        "- Strengths matter too: identify consistent, useful structure that should be preserved.\n"
        "- Usually return 4-10 findings. Fewer is better when the Set is clean.\n\n"
        "[DETERMINISTIC SCOPE]\n"
        "Files: " + str(scope["total"]) + "\n"
        "Captioned: " + str(scope["captioned"]) + "\n"
        "Missing captions: " + str(scope["missing"]) + "\n"
        "Unique exact captions: " + str(scope["uniqueCaptions"]) + "\n"
        "Exact duplicate caption groups: " + str(scope["exactDuplicateGroups"]) + "\n"
        "Caption word counts (min / median / max): "
        + str(scope["minWords"]) + " / " + str(scope["medianWords"]) + " / " + str(scope["maxWords"])
        + "\n\n"
        "[MISSING CAPTIONS]\n"
        + ("\n".join("- " + file_name for file_name in missing_files) if missing_files else "(none)")
        + "\n\n"
        "[CAPTION CORPUS]\n"
        + ("\n".join("- " + line for line in corpus) if corpus else "(no non-empty captions)")
        + "\n\n[OUTPUT]\n"
        "Return only the structured result requested by the JSON schema."
    )

    return {
        "operation": "analyze_caption_set",
        "output": "json",
        "prompt": prompt,
        "response_schema": schema,
        "scope": scope,
        "source_files": [row["fileName"] for row in rows],
    }


def normalize_result(data, allowed_files=None):
    if not isinstance(data, dict):
        raise ValueError("Review Dataset response must be an object.")

    summary = str(data.get("summary") or "").strip()
    conclusion = str(data.get("conclusion") or "").strip()
    if not summary or not conclusion:
        raise ValueError("Review Dataset response is missing its summary or conclusion.")

    strengths = data.get("strengths")
    findings = data.get("findings")
    focus_sets = data.get("focusSets")
    if not isinstance(strengths, list) or not isinstance(findings, list) or not isinstance(focus_sets, list):
        raise ValueError("Review Dataset response arrays are malformed.")

    normalized_strengths = [str(value or "").strip() for value in strengths]
    normalized_strengths = [value for value in normalized_strengths if value]

    allowed_categories = {
        "consistency",
        "coverage",
        "balance",
        "repetition",
        "annotation-hygiene",
        "outlier",
        "training-signal",
    }
    allowed_priorities = {"high", "medium", "low"}
    normalized_findings = []
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError("Review Dataset response contains an invalid finding.")
        category = str(finding.get("category") or "").strip()
        priority = str(finding.get("priority") or "").strip()
        title = str(finding.get("title") or "").strip()
        detail = str(finding.get("detail") or "").strip()
        evidence = finding.get("evidence")
        if (
            category not in allowed_categories
            or priority not in allowed_priorities
            or not title
            or not detail
            or not isinstance(evidence, list)
        ):
            raise ValueError("Review Dataset response contains an invalid finding.")
        normalized_findings.append({
            "category": category,
            "priority": priority,
            "title": title,
            "detail": detail,
            "evidence": [str(value or "").strip() for value in evidence if str(value or "").strip()],
        })

    allowed = {str(value or "").strip() for value in (allowed_files or []) if str(value or "").strip()}
    normalized_focus_sets = []
    for focus_set in focus_sets:
        if not isinstance(focus_set, dict):
            raise ValueError("Review Dataset response contains an invalid focus set.")
        label = str(focus_set.get("label") or "").strip()
        reason = str(focus_set.get("reason") or "").strip()
        files = focus_set.get("files")
        if not label or not reason or not isinstance(files, list):
            raise ValueError("Review Dataset response contains an invalid focus set.")
        normalized_files = []
        for value in files:
            file_name = str(value or "").strip()
            if not file_name:
                continue
            if allowed and file_name not in allowed:
                raise ValueError("Review Dataset response invented a focus-set filename: " + file_name)
            if file_name not in normalized_files:
                normalized_files.append(file_name)
        if normalized_files:
            normalized_focus_sets.append({
                "label": label,
                "reason": reason,
                "files": normalized_files,
            })

    return {
        "summary": summary,
        "strengths": normalized_strengths,
        "findings": normalized_findings,
        "focusSets": normalized_focus_sets,
        "conclusion": conclusion,
    }


def render_report(analysis, scope=None):
    analysis = analysis if isinstance(analysis, dict) else {}
    scope = scope if isinstance(scope, dict) else {}
    lines = ["DATASET CAPTION REVIEW"]

    if scope:
        lines.extend([
            "",
            (
                "Scope: "
                + str(scope.get("total") or 0)
                + " files · "
                + str(scope.get("captioned") or 0)
                + " captioned · "
                + str(scope.get("missing") or 0)
                + " missing · "
                + str(scope.get("uniqueCaptions") or 0)
                + " unique exact captions"
            ),
            (
                "Caption length: "
                + str(scope.get("minWords") or 0)
                + " / "
                + str(scope.get("medianWords") or 0)
                + " / "
                + str(scope.get("maxWords") or 0)
                + " words (min / median / max)"
            ),
        ])

    lines.extend(["", "SUMMARY", str(analysis.get("summary") or "").strip()])

    strengths = analysis.get("strengths") if isinstance(analysis.get("strengths"), list) else []
    if strengths:
        lines.extend(["", "WHAT LOOKS SOLID"])
        lines.extend("- " + str(value) for value in strengths)

    findings = analysis.get("findings") if isinstance(analysis.get("findings"), list) else []
    lines.extend(["", "FINDINGS"])
    if not findings:
        lines.append("- No material caption-corpus issues were identified.")
    for finding in findings:
        lines.append(
            "["
            + str(finding.get("priority") or "low").upper()
            + "] "
            + str(finding.get("title") or "")
            + " — "
            + str(finding.get("category") or "")
        )
        lines.append(str(finding.get("detail") or ""))
        evidence = finding.get("evidence") if isinstance(finding.get("evidence"), list) else []
        if evidence:
            lines.append("Evidence: " + "; ".join(str(value) for value in evidence))

    focus_sets = analysis.get("focusSets") if isinstance(analysis.get("focusSets"), list) else []
    if focus_sets:
        lines.extend(["", "POSSIBLE FOCUS SETS"])
        for focus_set in focus_sets:
            lines.append("- " + str(focus_set.get("label") or "") + ": " + str(focus_set.get("reason") or ""))
            lines.append("  Files: " + ", ".join(str(value) for value in focus_set.get("files") or []))

    lines.extend(["", "BOTTOM LINE", str(analysis.get("conclusion") or "").strip()])
    return "\n".join(lines).strip()
