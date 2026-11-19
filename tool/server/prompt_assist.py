"""Prompt Assist context preparation and task contracts.

The context builder is deliberately deterministic: it extracts authored H3
sections and timed shots, preserving Scene IDs and shot numbers. It does not
invent a second creative summary or silently discard source material.
"""
import hashlib
import json
import re


_ROLE_NAMES = {
    "visual": "Visual Director",
    "continuity": "Continuity & State Analyst",
    "sequence": "Sequence Director",
    "editor": "Creative Editor",
}
_REVIEW_ROLES = {"visual", "continuity", "sequence"}
_FOLLOWUP_ROLES = set(_ROLE_NAMES)

_SECTION = re.compile(
    r"^[ \t]*(Subject|Scene Overview|Environment / Continuity Anchors|"
    r"Style / Visual Treatment|integrated_multimodal_description|"
    r"overall_soundscape|non_diegetic_music)[ \t]*:[ \t]*\r?$",
    re.I | re.M,
)
_SHOT = re.compile(r"^[ \t]*\[Shot[ \t]+(\d+)\][^\r\n]*", re.I | re.M)


def _text(value):
    return str(value or "").strip()


def _sections(prompt):
    headings = list(_SECTION.finditer(prompt))
    result = {}
    for index, heading in enumerate(headings):
        key = heading.group(1).lower()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(prompt)
        line_end = prompt.find("\n", heading.end())
        start = line_end + 1 if line_end >= 0 else heading.end()
        result[key] = prompt[start:end].strip()
    return result


def _shots(timed_text, prompt):
    if not timed_text:
        # Older or custom prompts may not use the standard timed-shot section.
        # Keep the complete prompt as one source-addressable unit.
        return [{"shotNumber": 1, "text": prompt, "source": "complete_prompt"}]
    matches = list(_SHOT.finditer(timed_text))
    if not matches:
        return [{"shotNumber": 1, "text": timed_text, "source": "timed_shots"}]
    shots = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(timed_text)
        shots.append({
            "shotNumber": int(match.group(1)),
            "text": timed_text[match.start():end].strip(),
            "source": "timed_shots",
        })
    return shots


def build_context(story, scope="scene", scene_id=""):
    """Build a compact, source-addressable review context from saved Story data."""
    if not isinstance(story, dict):
        raise ValueError("Project data is required.")
    scope = _text(scope).lower()
    if scope not in {"scene", "project"}:
        raise ValueError("Prompt Assist scope must be Scene or Project.")

    order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
    scenes_by_id = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    if not order:
        raise ValueError("Develop at least one Scene before using Prompt Assist.")

    if scope == "scene":
        scene_id = _text(scene_id)
        if not scene_id or scene_id not in order:
            raise ValueError("Select an existing Scene for Prompt Assist.")
        selected_ids = [scene_id]
    else:
        selected_ids = list(order)

    scene_contexts = []
    source_prompts = {}
    for scene_number, current_id in enumerate(order, start=1):
        if current_id not in selected_ids:
            continue
        scene = scenes_by_id.get(current_id)
        if not isinstance(scene, dict):
            raise ValueError("Project Scene index contains a missing Scene: " + str(current_id))
        raw_prompt = scene.get("prompt")
        prompt = raw_prompt if isinstance(raw_prompt, str) else ""
        if not prompt.strip():
            if scope == "project":
                raise ValueError(
                    "Project Prompt Assist requires saved prompts. Scene "
                    + (_text(scene.get("title")) or str(current_id))
                    + " has no saved prompt yet."
                )
            continue
        sections = _sections(prompt)
        shots = _shots(sections.get("integrated_multimodal_description", ""), prompt)
        scene_contexts.append({
            "sceneId": str(current_id),
            "sceneNumber": scene_number,
            "title": _text(scene.get("title")) or ("Scene " + str(scene_number)),
            "durationSeconds": scene.get("durationSeconds"),
            "subject": sections.get("subject", ""),
            "sceneOverview": sections.get("scene overview", ""),
            "continuityAnchors": sections.get("environment / continuity anchors", ""),
            "visualTreatment": sections.get("style / visual treatment", ""),
            "overallSoundscape": sections.get("overall_soundscape", ""),
            "nonDiegeticMusic": sections.get("non_diegetic_music", ""),
            "shots": shots,
        })
        source_prompts[str(current_id)] = prompt

    if not scene_contexts:
        raise ValueError("The selected scope has no saved Scene prompts to review.")

    invariants = story.get("invariants") if isinstance(story.get("invariants"), list) else []
    project = {
        "title": _text(story.get("title")),
        "concept": _text(story.get("concept")),
        "visualAtmosphere": _text(story.get("style")),
        "invariants": [
            {
                "kind": _text(item.get("kind")),
                "title": _text(item.get("title")),
                "text": _text(item.get("text")),
            }
            for item in invariants
            if isinstance(item, dict) and _text(item.get("text"))
        ],
    }
    return {
        "scope": scope,
        "project": project,
        "scenes": scene_contexts,
        "sourcePrompts": source_prompts,
        "sourceUpdatedAt": _text(story.get("updatedAt")),
    }


def review_context(context):
    """Exclude full source prompts while retaining exact extracted shot evidence."""
    return {
        "scope": context["scope"],
        "project": context["project"],
        "scenes": context["scenes"],
    }


_FINDING = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sceneId", "shotNumber", "priority", "issue", "evidence", "recommendation"],
    "properties": {
        "sceneId": {"type": "string"},
        "shotNumber": {"type": "integer", "minimum": 0},
        "priority": {"type": "string", "enum": ["important", "useful", "optional"]},
        "issue": {"type": "string"},
        "evidence": {"type": "string"},
        "recommendation": {"type": "string"},
    },
}
_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "findings"],
    "properties": {
        "summary": {"type": "string"},
        "findings": {"type": "array", "items": _FINDING},
    },
}
_EDITOR_RECOMMENDATION = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sceneId", "shotNumber", "priority", "issue", "rationale", "recommendation", "sources"],
    "properties": {
        "sceneId": {"type": "string"},
        "shotNumber": {"type": "integer", "minimum": 0},
        "priority": {"type": "string", "enum": ["important", "useful", "optional"]},
        "issue": {"type": "string"},
        "rationale": {"type": "string"},
        "recommendation": {"type": "string"},
        "sources": {"type": "array", "items": {"type": "string"}},
    },
}
_EDITOR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "recommendations", "disagreements"],
    "properties": {
        "summary": {"type": "string"},
        "recommendations": {"type": "array", "items": _EDITOR_RECOMMENDATION},
        "disagreements": {"type": "array", "items": {"type": "string"}},
    },
}
_REVISION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["revisions"],
    "properties": {
        "revisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["sceneId", "prompt"],
                "properties": {
                    "sceneId": {"type": "string"},
                    "prompt": {"type": "string", "minLength": 1},
                },
            },
        },
    },
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, indent=2)


def _role_instruction(role):
    if role == "visual":
        return (
            "Review each cut independently for visual communication. Determine whether the intended "
            "subject, action and most important focal element will actually be visible and legible. "
            "Check camera framing, angle, focus and shot description against the action. A slow-motion "
            "bat striking a ball should make the bat-ball contact and ball trajectory visually legible; "
            "a close-up of hands that hides the defining action is a failure of visual emphasis. "
            "Report only concrete issues grounded in the supplied shot text. Do not rewrite the prompt."
        )
    if role == "continuity":
        return (
            "Review chronological state progression between cuts within each Scene. Track relevant "
            "clothing, props, object states, positions and physical relationships. Catch regressions "
            "where a later cut reverts to a state that was explicitly changed earlier, unless a new "
            "change is described. Check physical interactions for implausible positioning, ambiguous "
            "hand-offs, merged or entangled bodies, and missing state transitions. Treat each Project "
            "Scene as independently rendered: do not flag ordinary differences in a person's generated "
            "appearance between separate Scenes as continuity failures. Do not demand identical faces "
            "or pixel-level consistency. Do not rewrite the prompt."
        )
    if role == "sequence":
        return (
            "Review the complete ordered sequence of cuts for creative usefulness. Ask why each cut "
            "exists, whether it contributes meaningful visual information, whether the selected subject "
            "and moment deserve the viewer's attention, and whether pacing, repetition and transitions "
            "make sense. Flag irrelevant or poorly selected shots (for example, an unexplained ceiling-fan "
            "close-up in a sequence about a decisive baseball hit). Do not duplicate the Visual Director's "
            "camera-detail audit or the Continuity Analyst's state tracking. Do not rewrite the prompt."
        )
    raise ValueError("Unknown Prompt Assist specialist.")


def build_contract(operation, context, role="", findings=None, accepted=None, conversation=None, question=""):
    """Return a chat-client contract for one isolated analytical or conversational pass."""
    operation = _text(operation).lower()
    role = _text(role).lower()
    if operation == "review":
        if role not in _REVIEW_ROLES:
            raise ValueError("Select a supported Prompt Assist specialist.")
        system = (
            "You are " + _ROLE_NAMES[role] + " in WebCap Prompt Assist. "
            + _role_instruction(role)
            + " Prepared Project Deep QA intelligence, when supplied, is secondary derived context, not ground truth. "
            + "Verify its observations against the original source prompt; the prompt remains authoritative. "
            + "If prepared intelligence conflicts with the source, flag the conflict rather than repeating it as fact. "
            + " Return a concise summary and only actionable findings. Each finding must cite a valid "
            "sceneId from the supplied context, use shotNumber 0 for a Scene-level issue, and include "
            "a short evidence excerpt from the source. If no meaningful issue exists, return an empty "
            "findings array. Do not invent missing story facts or manufacture criticism."
        )
        return {
            "operation": "prompt_assist_review",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "Review this source-addressable creative context:\n" + _json(review_context(context))},
            ],
            "response_schema": _REVIEW_SCHEMA,
        }

    if operation == "synthesize":
        if role != "editor":
            raise ValueError("Creative Editor is required for synthesis.")
        system = (
            "You are WebCap's Creative Editor. Synthesize independent specialist findings into a "
            "small, coherent set of useful recommendations. Every supplied finding has a findingId; "
            "copy those exact IDs into each recommendation's sources array. Merge duplicates, preserve "
            "distinct issues, identify genuine disagreements, and retain each recommendation's source "
            "finding IDs. Prioritize problems that materially affect the intended visuals. Do not invent new "
            "issues, silently discard minority concerns, or rewrite the prompts. Return empty arrays "
            "when there are no useful recommendations."
        )
        user = {
            "sourceContext": review_context(context),
            "independentReviews": findings if isinstance(findings, list) else [],
        }
        return {
            "operation": "prompt_assist_synthesis",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "Synthesize these independent reviews:\n" + _json(user)},
            ],
            "response_schema": _EDITOR_SCHEMA,
        }

    if operation == "revise":
        if role != "editor":
            raise ValueError("Creative Editor must prepare the revised prompts.")
        source_prompts = context["sourcePrompts"]
        selected = accepted if isinstance(accepted, list) else []
        selected_ids = {str(item.get("sceneId") or "") for item in selected if isinstance(item, dict)}
        revisions = [
            {"sceneId": scene_id, "title": scene["title"], "originalPrompt": source_prompts[scene_id]}
            for scene in context["scenes"]
            for scene_id in [scene["sceneId"]]
            if scene_id in selected_ids
        ]
        if not revisions:
            raise ValueError("Accept at least one recommendation before preparing revised prompts.")
        system = (
            "You are WebCap's Creative Editor preparing complete revised H3 prompts from explicitly "
            "accepted recommendations. Apply only the accepted recommendations to the corresponding "
            "Scene. Preserve all unaffected creative decisions, H3 section structure, timing, audio and "
            "other prompt content. Resolve accepted state regressions by describing the correct resulting "
            "state in each later cut. Make the intended focal action visible through appropriate framing "
            "and focus. Return one complete replacement prompt for each supplied Scene ID. Never invent "
            "additional story events or alter a Scene that has no accepted recommendation."
        )
        return {
            "operation": "prompt_assist_revision",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "Original prompts and accepted recommendations:\n" + _json({
                    "scenes": revisions,
                    "acceptedRecommendations": selected,
                })},
            ],
            "response_schema": _REVISION_SCHEMA,
        }

    if operation == "followup":
        if role not in _FOLLOWUP_ROLES:
            raise ValueError("Select a supported specialist for discussion.")
        question = _text(question)
        if not question:
            raise ValueError("Enter a question for the selected specialist.")
        if role == "editor":
            instruction = (
                "You are the Creative Editor. Discuss the consolidated recommendations, trade-offs and "
                "disagreements. Be concise, answer the author's actual question, and do not revise or "
                "apply prompts unless explicitly asked."
            )
        else:
            instruction = (
                "You are " + _ROLE_NAMES[role] + ". Continue as the same specialist who produced the "
                "supplied findings. Answer the author's question directly, explain or reconsider your "
                "own findings when asked, and distinguish source facts from your interpretation. Be "
                "concise. Do not rewrite or apply prompts unless explicitly asked."
            )
        history = []
        for item in conversation if isinstance(conversation, list) else []:
            if not isinstance(item, dict):
                continue
            message_role = _text(item.get("role")).lower()
            content = item.get("content")
            if message_role in {"user", "assistant"} and isinstance(content, str) and content.strip():
                history.append({"role": message_role, "content": content})
        messages = [
            {"role": "system", "content": instruction},
            {"role": "user", "content": "Relevant source context:\n" + _json(review_context(context))},
            {"role": "user", "content": "Available specialist findings:\n" + _json(findings if findings is not None else [])},
        ] + history
        messages.append({"role": "user", "content": question})
        return {"operation": "prompt_assist_followup", "messages": messages}

    raise ValueError("Unsupported Prompt Assist operation.")


def source_fingerprint(context):
    """Stable fingerprint of the exact Project/Scene material used for review."""
    payload = {
        "project": context["project"],
        "scenes": context["scenes"],
        "sourcePrompts": context["sourcePrompts"],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


_DEEP_QA_CUT = {
    "type": "object", "additionalProperties": False,
    "required": ["shotNumber", "visualIntent", "focalElement", "action", "stateChanges", "carryForward", "physicalInteractions", "concerns"],
    "properties": {
        "shotNumber": {"type": "integer", "minimum": 0},
        "visualIntent": {"type": "string"},
        "focalElement": {"type": "string"},
        "action": {"type": "string"},
        "stateChanges": {"type": "array", "items": {"type": "string"}},
        "carryForward": {"type": "array", "items": {"type": "string"}},
        "physicalInteractions": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
    },
}
_DEEP_QA_SCENE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["sceneId", "summary", "purpose", "keyVisualMoments", "cuts"],
    "properties": {
        "sceneId": {"type": "string"},
        "summary": {"type": "string"},
        "purpose": {"type": "string"},
        "keyVisualMoments": {"type": "array", "items": {"type": "string"}},
        "cuts": {"type": "array", "items": _DEEP_QA_CUT},
    },
}
_DEEP_QA_PROJECT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "recurringElements", "sceneRelationships", "projectContinuityPrinciples", "concerns"],
    "properties": {
        "summary": {"type": "string"},
        "recurringElements": {
            "type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["element", "scenes", "basis"],
                "properties": {
                    "element": {"type": "string"},
                    "scenes": {"type": "array", "items": {"type": "string"}},
                    "basis": {"type": "string"},
                },
            },
        },
        "sceneRelationships": {
            "type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["fromSceneId", "toSceneId", "relationship", "basis"],
                "properties": {
                    "fromSceneId": {"type": "string"},
                    "toSceneId": {"type": "string"},
                    "relationship": {"type": "string"},
                    "basis": {"type": "string"},
                },
            },
        },
        "projectContinuityPrinciples": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
    },
}


def scene_source_fingerprint(context, scene_id):
    """Fingerprint one Scene plus project context that can affect its interpretation."""
    scene = next((item for item in context["scenes"] if item["sceneId"] == str(scene_id)), None)
    if not scene:
        raise ValueError("Deep QA Scene is not present in the source context.")
    payload = {"project": context["project"], "scene": scene, "sourcePrompt": context["sourcePrompts"][str(scene_id)]}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def build_deep_qa_scene_contract(context, scene_id):
    scene_id = str(scene_id or "")
    scene = next((item for item in context["scenes"] if item["sceneId"] == scene_id), None)
    if not scene:
        raise ValueError("Select a Scene for Project Deep QA.")
    system = (
        "You are Project Deep QA preparing reusable, source-grounded intelligence for WebCap Prompt Assist. "
        "Analyze this ONE Scene, cut by cut. This is preparation, not a critique, rewrite, or approval. "
        "For each cut identify its apparent visual purpose, focal element, defining action, explicit state "
        "changes, and state that should carry into later cuts. Pay special attention to regressions: if a "
        "cut changes clothing, prop state, position, or an interaction, record what later cuts should retain "
        "unless an explicit new change is described. Note physical interactions that may produce ambiguous "
        "or entangled bodies, but do not invent problems. Distinguish what the prompt explicitly says from "
        "what is merely implied in the wording. Do not treat independent Project Scenes as continuous renders. "
        "Do not demand identical character appearance between independently generated Scenes. "
        "Only use supplied Scene IDs and actual cut numbers; use 0 for Scene-level facts. "
        "Return concise, reusable facts. Empty arrays are appropriate when nothing is specified."
    )
    return {
        "operation": "prompt_assist_deep_qa_scene",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "Prepare reusable intelligence for this Scene:\n" + _json({
                "project": context["project"],
                "scene": scene,
            })},
        ],
        "response_schema": _DEEP_QA_SCENE_SCHEMA,
    }


def build_deep_qa_project_contract(context, scene_results):
    allowed = {scene["sceneId"] for scene in context["scenes"]}
    compact = []
    seen_scene_ids = set()
    for item in scene_results if isinstance(scene_results, list) else []:
        scene_id = str(item.get("sceneId") or "") if isinstance(item, dict) else ""
        if scene_id not in allowed or scene_id in seen_scene_ids:
            continue
        seen_scene_ids.add(scene_id)
        compact.append({
            "sceneId": item["sceneId"],
            "summary": str(item.get("summary") or "")[:900],
            "purpose": str(item.get("purpose") or "")[:500],
            "keyVisualMoments": [str(x)[:240] for x in (item.get("keyVisualMoments") or [])[:8]],
            "cuts": [{
                "shotNumber": cut.get("shotNumber"),
                "visualIntent": str(cut.get("visualIntent") or "")[:240],
                "focalElement": str(cut.get("focalElement") or "")[:160],
                "stateChanges": [str(x)[:180] for x in (cut.get("stateChanges") or [])[:5]],
                "carryForward": [str(x)[:180] for x in (cut.get("carryForward") or [])[:5]],
            } for cut in (item.get("cuts") or [])[:12] if isinstance(cut, dict)],
        })
    if seen_scene_ids != allowed:
        raise ValueError("Project Deep QA needs one current preparation for every Scene.")
    system = (
        "You are Project Deep QA preparing a compact cross-Scene intelligence index for WebCap Prompt Assist. "
        "Use only the supplied ordered Scene briefs and Project context. Identify recurring people, places, "
        "props, visual motifs, and explicit project-level continuity requirements. Describe relationships "
        "between Scenes only when supported by their descriptions or Project invariants. Distinguish an "
        "explicit continuity requirement from a thematic resemblance or inference. Crucially, Scenes are "
        "independently generated: do not assume a character's face, clothing, or exact appearance persists "
        "between Scenes unless the Project context or Scene descriptions explicitly establish it. Do not "
        "invent a narrative, missing transition, or inconsistency. This is a reusable index, not a critique "
        "or prompt rewrite. Use only supplied Scene IDs."
    )
    return {
        "operation": "prompt_assist_deep_qa_project",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "Build the cross-Scene intelligence index:\n" + _json({
                "project": context["project"],
                "sceneOrder": [scene["sceneId"] for scene in context["scenes"]],
                "sceneBriefs": compact,
            })},
        ],
        "response_schema": _DEEP_QA_PROJECT_SCHEMA,
    }


def validate_deep_qa_scene(result, scene_id, valid_shots):
    required = ("summary", "purpose", "keyVisualMoments", "cuts")
    if (not isinstance(result, dict) or str(result.get("sceneId") or "") != str(scene_id)
            or any(not isinstance(result.get(key), expected) for key, expected in (
                ("summary", str), ("purpose", str), ("keyVisualMoments", list), ("cuts", list)
            ))):
        raise ValueError("Project Deep QA returned an invalid Scene result.")
    valid = set(int(value) for value in valid_shots)
    seen = set()
    for cut in result["cuts"]:
        if (not isinstance(cut, dict) or type(cut.get("shotNumber")) is not int
                or cut["shotNumber"] not in valid or cut["shotNumber"] in seen):
            raise ValueError("Project Deep QA returned an unknown or duplicate cut reference.")
        seen.add(cut["shotNumber"])
        for key in ("visualIntent", "focalElement", "action"):
            if not isinstance(cut.get(key), str):
                raise ValueError("Project Deep QA cut is missing " + key + ".")
        for key in ("stateChanges", "carryForward", "physicalInteractions", "concerns"):
            if not isinstance(cut.get(key), list) or any(not isinstance(value, str) for value in cut[key]):
                raise ValueError("Project Deep QA cut has invalid " + key + ".")
    if any(not isinstance(value, str) for value in result["keyVisualMoments"]):
        raise ValueError("Project Deep QA key visual moments must be strings.")
    expected_cuts = valid - {0}
    if not expected_cuts.issubset(seen):
        missing = sorted(expected_cuts - seen)
        raise ValueError("Project Deep QA did not prepare every source cut: " + ", ".join(str(value) for value in missing))
    return result


def validate_deep_qa_project(result, scene_ids):
    required = ("summary", "recurringElements", "sceneRelationships", "projectContinuityPrinciples", "concerns")
    if (not isinstance(result, dict)
            or any(not isinstance(result.get(key), expected) for key, expected in (
                ("summary", str), ("recurringElements", list), ("sceneRelationships", list),
                ("projectContinuityPrinciples", list), ("concerns", list)
            ))):
        raise ValueError("Project Deep QA returned an invalid project index.")
    allowed = set(str(value) for value in scene_ids)
    for item in result["recurringElements"]:
        if (not isinstance(item, dict) or not isinstance(item.get("element"), str)
                or not isinstance(item.get("basis"), str) or not isinstance(item.get("scenes"), list)
                or any(str(value) not in allowed for value in item["scenes"])):
            raise ValueError("Project Deep QA returned an unknown or invalid Scene in a recurring element.")
    for item in result["sceneRelationships"]:
        if (not isinstance(item, dict) or str(item.get("fromSceneId") or "") not in allowed
                or str(item.get("toSceneId") or "") not in allowed
                or not isinstance(item.get("relationship"), str) or not isinstance(item.get("basis"), str)):
            raise ValueError("Project Deep QA returned an unknown or invalid Scene relationship.")
    if any(not isinstance(value, str) for key in ("projectContinuityPrinciples", "concerns") for value in result[key]):
        raise ValueError("Project Deep QA index lists must contain strings.")
    return result
