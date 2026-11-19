import json
from pathlib import Path

from .h3_prompt_contract import mode_from_reference_roles
from . import config as app_config


def _model_limitations(model_id):
    guidance = app_config.config.get("generation_model_guidance", {})
    if not isinstance(guidance, dict):
        return ""
    return str(guidance.get(model_id) or "").strip()


def _add_model_limitations(blocks, model_id):
    guidance = _model_limitations(model_id)
    if guidance:
        blocks.append("[MODEL TECHNICAL LIMITATIONS]\nUse these as generation capability information. Author-approved Project Concept, Visual / atmosphere, Invariants, and any populated legacy Guidelines are creative context.\n" + guidance)




DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
DIRECTOR_CONTEXT_PATH = DOCS_ROOT / "storyboard-director-context.txt"
H3_RUNTIME_CONTEXT_PATH = DOCS_ROOT / "mmh3-prompt-runtime-context.txt"
SCENE_PLAN_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-plan.schema.json"
INVARIANT_SCHEMA_PATH = DOCS_ROOT / "storyboard-invariants.schema.json"
SCENE_REPAIR_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-repair.schema.json"
VALID_OPERATIONS = {"interpret_atmosphere", "expand_concept", "define_invariants", "develop_story", "develop_story_outline", "develop_story_scene", "insert_scene", "extend_story", "repair_scenes", "write_prompt", "refine_prompt", "visual_direction", "check_coherence", "prompt_assist", "project_deep_qa"}


def _read_text(path, label):
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Could not read " + label + ".") from exc


def _clean(value):
    return str(value or "").strip()


def _prompt_response_schema(allow_duration=False, allow_unchanged=False):
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["prompt"],
        "properties": {
            "prompt": {
                "type": "string",
                "minLength": 1,
                "description": "Complete MiniMax H3 generation prompt, authored exactly as it should be stored.",
            },
        },
    }
    if allow_unchanged:
        schema["properties"]["changed"] = {
            "type": "boolean",
            "description": "False only when the requested refinement does not require any change to this Scene.",
        }
        schema["required"] = ["changed", "prompt"]
    if allow_duration:
        schema["properties"]["durationSeconds"] = {
            "type": "number",
            "minimum": 6,
            "maximum": 15,
            "description": (
                "Optional revised Scene duration in seconds. Include only when the requested refinement "
                "materially changes how much screen time the Scene needs."
            ),
        }
    return schema


def _prompt_assist_response_schema():
    finding = {
        "type": "object",
        "additionalProperties": False,
        "required": ["problem", "location", "suggestedFix", "targetText", "replacementText"],
        "properties": {
            "problem": {"type": "string", "minLength": 1},
            "location": {"type": "string", "minLength": 1},
            "suggestedFix": {"type": "string", "minLength": 1},
            "targetText": {
                "type": "string",
                "minLength": 1,
                "description": "An exact, contiguous excerpt copied from the existing prompt, unique within that prompt.",
            },
            "replacementText": {
                "type": "string",
                "minLength": 1,
                "description": "A focused replacement for targetText, preserving unrelated prompt material.",
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["findings"],
        "properties": {
            "findings": {"type": "array", "items": finding},
        },
    }


def _project_deep_qa_response_schema():
    finding = {
        "type": "object",
        "additionalProperties": False,
        "required": ["sceneId", "location", "problem", "whyItMatters", "suggestedFix"],
        "properties": {
            "sceneId": {"type": "string", "minLength": 1},
            "location": {"type": "string", "minLength": 1},
            "problem": {"type": "string", "minLength": 1},
            "whyItMatters": {"type": "string", "minLength": 1},
            "suggestedFix": {"type": "string", "minLength": 1},
            "proposedPrompt": {
                "type": "string",
                "description": "Optional complete prompt for the affected Scene with this one targeted correction applied.",
            },
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["findings"],
        "properties": {
            "findings": {"type": "array", "items": finding},
        },
    }


def _single_scene_response_schema():
    plan_schema = _read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema")
    try:
        scene_schema = plan_schema["properties"]["scenes"]["items"]
    except (KeyError, TypeError) as exc:
        raise RuntimeError("Storyboard Scene plan schema is missing its Scene item shape.") from exc
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["scene"],
        "properties": {"scene": scene_schema},
    }


def _story_outline_response_schema(target_scene_count=None):
    scene = {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "prompt", "suggestedDurationSeconds"],
        "properties": {
            "title": {"type": "string", "minLength": 1},
            "prompt": {"type": "string", "minLength": 1},
            "suggestedDurationSeconds": {
                "type": "number",
                "minimum": 6,
                "maximum": 15,
            },
        },
    }
    scenes = {
        "type": "array",
        "minItems": 1,
        "items": scene,
    }
    try:
        wanted = int(target_scene_count) if target_scene_count is not None else 0
    except (TypeError, ValueError):
        wanted = 0
    if wanted > 0:
        scenes["minItems"] = wanted
        scenes["maxItems"] = wanted
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["scenes"],
        "properties": {"scenes": scenes},
    }


def _read_json(path, label):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read " + label + ".") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(label + " must contain a JSON object.")
    return payload


def _reference_roles(scene):
    roles = set()
    for reference in scene.get("references") or []:
        if not isinstance(reference, dict):
            continue
        role = _clean(reference.get("role"))
        if role not in {"first_frame", "last_frame"}:
            continue
        roles.add(role)
    return [role for role in ("first_frame", "last_frame") if role in roles]


def _reference_summary(scene):
    roles = _reference_roles(scene)
    if not roles:
        return ""
    return ", ".join(role + " exact visual anchor supplied" for role in roles)



def _scene_context(scene):
    lines = []
    fields = (
        ("Title", scene.get("title")),
        ("Prompt", scene.get("prompt")),
        ("Duration seconds", scene.get("durationSeconds")),
    )
    for label, value in fields:
        text = _clean(value)
        if text:
            lines.append(label + ": " + text)
    references = _reference_summary(scene)
    if references:
        lines.append("References: " + references)
    return "\n".join(lines)


def _story_invariants_text(story):
    lines = []
    invariants = story.get("invariants") if isinstance(story.get("invariants"), list) else []
    for item in invariants:
        if not isinstance(item, dict):
            continue
        text = _clean(item.get("text"))
        if not text:
            continue
        kind = _clean(item.get("kind")) or "custom"
        title = _clean(item.get("title"))
        label = kind.capitalize() + (": " + title if title else "")
        lines.append(label + "\n" + text)
    return "\n\n".join(lines)


def _story_guidelines_text(story):
    fields = (
        ("visualFocus", "Visual focus"),
        ("creativeDirection", "Creative direction"),
        ("variation", "Variation / repetition"),
        ("pacing", "Pacing / rhythm"),
        ("sceneRelationships", "Scene relationships"),
    )
    guidelines = story.get("guidelines") if isinstance(story.get("guidelines"), dict) else {}
    return "\n".join(label + ": " + _clean(guidelines.get(key)) for key, label in fields if _clean(guidelines.get(key)))


def _repair_scene_plan(story):
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
    result = []
    for index, scene_id in enumerate(order, start=1):
        scene = scenes.get(scene_id)
        if not isinstance(scene, dict):
            continue
        result.append({
            "sceneNumber": index,
            "title": _clean(scene.get("title")),
            "durationSeconds": scene.get("durationSeconds"),
            "referenceRoles": _reference_roles(scene),
            "invariantRefs": scene.get("invariantRefs") if isinstance(scene.get("invariantRefs"), list) else [],
            "prompt": _clean(scene.get("prompt")),
        })
    return result


def _previous_scene_context(story, scene_id):
    order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
    if scene_id not in order:
        return ""
    index = order.index(scene_id)
    if index <= 0:
        return ""
    scene = (story.get("scenes") or {}).get(order[index - 1])
    if not isinstance(scene, dict):
        return ""
    fields = (
        ("Title", scene.get("title")),
        ("Prompt", scene.get("prompt")),
    )
    return "\n".join(
        label + ": " + _clean(value)
        for label, value in fields
        if _clean(value)
    )


def approved_lora_vocabulary(story, scene_id):
    if story.get("directorLoraPlanning") is not True:
        return ""
    from .storyboard_store import resolve_scene_loras
    scene = (story.get("scenes") or {}).get(scene_id) or {}
    active = {item["name"].casefold() for item in resolve_scene_loras(story, scene)}
    chosen = []
    for selections in (story.get("directorLoraPhrases") or {}, scene.get("directorLoraPhrases") or {}):
        for name, phrases in selections.items():
            if name.casefold() in active:
                chosen.extend(phrases)
    chosen = list(dict.fromkeys(chosen))
    return ("[APPROVED LORA VOCABULARY]\nPreserve these approved phrases where consistent "
            "with the Scene: " + ", ".join(chosen) + "\nNever write loader syntax.") if chosen else ""


def build_request(story, scene_id, operation, instruction="", development=None, scene_count=1, continuity_context=False, refresh_guidelines=False, deep_qa_findings=None):
    if not isinstance(story, dict):
        raise ValueError("Story data must be an object.")
    operation = _clean(operation).lower()
    if operation not in VALID_OPERATIONS:
        raise ValueError("Unsupported Storyboard LLM operation.")

    if operation == "project_deep_qa":
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
        if not order:
            raise ValueError("Project Deep QA requires at least one Scene.")
        rows = []
        for index, target_id in enumerate(order, start=1):
            scene = scenes.get(target_id)
            if not isinstance(scene, dict):
                continue
            prompt = _clean(scene.get("prompt"))
            if not prompt:
                continue
            rows.append({
                "sceneId": str(target_id),
                "sceneNumber": index,
                "title": _clean(scene.get("title")),
                "durationSeconds": scene.get("durationSeconds"),
                "prompt": prompt,
            })
        if not rows:
            raise ValueError("Project Deep QA requires at least one saved Scene prompt.")
        blocks = []
        title = _clean(story.get("title"))
        concept = _clean(story.get("concept"))
        style = _clean(story.get("style"))
        if title:
            blocks.append("[PROJECT TITLE]\n" + title)
        if concept:
            blocks.append("[PROJECT CONCEPT / OVERVIEW]\n" + concept)
        if style:
            blocks.append("[PROJECT VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[PROJECT INVARIANTS]\n" + invariants)
        guidelines = _story_guidelines_text(story)
        if guidelines:
            blocks.append("[PROJECT DIRECTING GUIDELINES]\n" + guidelines)
        blocks.append("[COMPLETE PROJECT SCENE TEXT]\n" + json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
        blocks.append(
            "[CURRENT TASK]\nInspect the complete Project for practical prompt problems. Review each Scene and its "
            "timed cuts individually, then check continuity and progression across cuts and between Scenes. "
            "Look for missing explicit visual details, incomplete changes, accidental reversion of established "
            "states, contradictions, unclear action progression, and camera/framing/focus instructions that "
            "would likely direct attention away from the intended action. Treat the Project's own stated intent "
            "as authoritative. Return only actionable findings tied to an exact Scene ID and a useful cut, "
            "timestamp, or prompt-section location. Each finding must describe one concrete problem and one "
            "practical correction. Prioritize concrete, high-value problems and concise fixes. Include a proposed "
            "complete Scene prompt when one targeted correction can be made confidently. Leave saved Project "
            "content unchanged."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "system_prompt": (
                "You are Project Deep QA for a text-to-video production project. Help the author avoid preventable "
                "prompt failures with useful, specific corrections. Make relevant appearance, action, continuity, "
                "and transitions explicit wherever the supplied Project text leaves them under-specified. Ground "
                "every finding in the supplied Project text and preserve the author's creative intent. Use the "
                "saved Project and Scene prompt text as the evidence for your assessment."
            ),
            "response_schema": _project_deep_qa_response_schema(),
        }

    if operation == "prompt_assist":
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        scene = scenes.get(_clean(scene_id))
        if not isinstance(scene, dict):
            raise FileNotFoundError("Scene does not exist.")
        original = _clean(scene.get("prompt"))
        if not original:
            raise ValueError("Scene generation prompt is required for Prompt Assist.")
        blocks = []
        title = _clean(story.get("title"))
        concept = _clean(story.get("concept"))
        style = _clean(story.get("style"))
        if title:
            blocks.append("[PROJECT TITLE]\n" + title)
        if concept:
            blocks.append("[PROJECT CONCEPT / OVERVIEW]\n" + concept)
        if style:
            blocks.append("[PROJECT VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[PROJECT INVARIANTS]\n" + invariants)
        scene_details = []
        for label, value in (
            ("Scene title", scene.get("title")),
            ("Duration seconds", scene.get("durationSeconds")),
            ("Scene notes", scene.get("notes")),
        ):
            text = _clean(value)
            if text:
                scene_details.append(label + ": " + text)
        if scene_details:
            blocks.append("[SCENE DETAILS]\n" + "\n".join(scene_details))
        blocks.append("[EXISTING SCENE PROMPT]\n" + original)
        if isinstance(deep_qa_findings, list) and deep_qa_findings:
            blocks.append(
                "[CURRENT PROJECT DEEP QA FINDINGS - OPTIONAL CONTEXT]\n"
                + json.dumps(deep_qa_findings, ensure_ascii=False, separators=(",", ":"))
            )
        blocks.append(
            "[CURRENT TASK]\nFind practical weaknesses in this one Scene's written instructions that could "
            "cause the rendered result to differ from the author's intent. Treat this as focused text assistance, "
            "not a repeat of the standalone Visual Direction pass. Be especially useful for specific omissions, "
            "ambiguous states, incomplete changes between timed cuts, continuity details that may revert, and "
            "camera/framing/focus instructions that do not emphasize the intended action. Return a concise set "
            "of actionable findings. Each finding must identify one problem, its cut/timestamp/section location, "
            "one practical fix, and an exact unique excerpt plus its focused replacement. The excerpt must be "
            "copied verbatim from the existing prompt and must occur exactly once. Make each replacement "
            "independently applicable so the author can accept several findings one at a time without overwriting "
            "earlier accepted corrections. "
            "Preserve unrelated text and creative intent. Return an empty findings array when no meaningful "
            "improvement is warranted. Keep the response practical, concise, and focused on one best correction "
            "per finding."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "system_prompt": (
                "You are Prompt Assist, a text-only production helper for one Scene. Visual Direction is a separate "
                "capability and the primary visual-completeness pass. Improve practical issues that remain in the "
                "written prompt. Make relevant appearance, action, state changes, continuity, and framing explicit "
                "rather than relying on inference. Each suggestion is one problem and one small, actionable "
                "correction. Keep explanations short, provide one best fix, and preserve the author's intent and "
                "all unrelated prompt material. Work only from the supplied Project and Scene text."
            ),
            "response_schema": _prompt_assist_response_schema(),
        }

    if operation == "check_coherence":
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        scene = scenes.get(_clean(scene_id))
        if not isinstance(scene, dict):
            raise FileNotFoundError("Scene does not exist.")
        original = _clean(scene.get("prompt"))
        if not original:
            raise ValueError("Scene generation prompt is required for Check Coherence.")
        blocks = []
        guidance = _story_guidelines_text(story)
        if guidance:
            blocks.append("[STORY DIRECTING GUIDELINES]\n" + guidance)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append("[EXISTING H3 PROMPT]\n" + original)
        blocks.append(
            "[CURRENT TASK]\nReview the H3 prompt for concrete audiovisual contradictions, timing inconsistencies, "
            "and duplicated explanatory text that obscures execution. Preserve the author's subject, "
            "choreography, pacing, repetition, and creative intent. Return a minimally corrected complete "
            "prompt, or the original unchanged when it is already coherent."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks),
            "response_schema": _prompt_response_schema(),
        }

    director_context = _read_text(DIRECTOR_CONTEXT_PATH, "Storyboard director context")
    if operation in {"expand_concept", "develop_story", "develop_story_outline", "develop_story_scene", "insert_scene", "extend_story", "write_prompt", "repair_scenes"}:
        guidance = _story_guidelines_text(story)
        if guidance:
            director_context += "\n\n[STORY DIRECTING GUIDELINES - AUTHOR INTENT]\n" + guidance
    h3_runtime_context = _read_text(H3_RUNTIME_CONTEXT_PATH, "MiniMax H3 runtime context")

    if operation == "define_invariants":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to define Story invariants.")
        blocks = []
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        blocks.append("[STORY CONCEPT]\n" + concept)
        existing_guidelines = _story_guidelines_text(story)
        if existing_guidelines:
            blocks.append("[EXISTING STORY GUIDELINES]\n" + existing_guidelines)
        existing = _story_invariants_text(story)
        if existing:
            blocks.append("[EXISTING STORY INVARIANTS]\n" + existing)
        blocks.append(
            "[CURRENT TASK]\nDefine stable visual identities for recurring characters and locations "
            "in this Story. Reuse existing invariants and preserve explicit Story facts. "
            "For characters, describe consistent physical appearance and distinctive visible traits. "
            "For locations, describe consistent layout, materials, and fixed features. "
            "Choose grounded details that aid reproducible generation. "
            "Return only JSON matching the supplied invariant schema, with an empty invariants array "
            "when no recurring identity needs defining. Preserve existing Project Concept, Visual / atmosphere "
            "and author-approved legacy Directing Guidelines without creating new guideline fields."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(INVARIANT_SCHEMA_PATH, "Storyboard invariant schema"),
        }

    if operation == "interpret_atmosphere":
        style = _clean(story.get("style"))
        if not style:
            raise ValueError("Enter a Visual / Atmosphere description first.")
        blocks = ["[USER VISUAL INTENT]\n" + style]
        concept = _clean(story.get("concept"))
        if concept:
            blocks.append("[STORY CONTEXT — FOR INTERPRETATION ONLY]\n" + concept[:3500])
        blocks.append(
            "[TASK]\nTranslate the supplied visual intent into practical video-generation direction. "
            "Describe relevant camera perspective, light, movement, texture, and mood while retaining "
            "the author's visual identity. Return 1-3 short lines of prose."
        )
        return {"operation": operation, "output": "text", "prompt": "\n\n".join(blocks)}
    if operation == "expand_concept":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to expand a Story.")
        blocks = ["[DIRECTOR CONTEXT]\n" + director_context]
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        blocks.append("[CURRENT CONCEPT]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append(
            "[CURRENT TASK]\nExpand the author's concept into a useful creative overview for Scene planning. "
            "Develop details that serve the Project Concept / overview. "
            "Preserve established Story facts, invariants, and Visual / Atmosphere. "
            "Return the expanded concept as concise polished prose."
        )
        return {
            "operation": operation,
            "output": "text",
            "prompt": "\n\n".join(blocks).strip() + "\n",
        }

    if operation == "develop_story":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to develop a Story.")
        blocks = [
            "[DIRECTOR CONTEXT]\n" + director_context,
        ]
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        blocks.append("[STORY CONCEPT]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
        _add_model_limitations(blocks, "minimax_h3")
        target_scene_count = story.get("targetSceneCount")
        scene_count_guidance = (
            "Create exactly " + str(int(target_scene_count)) + " Scenes. "
            if target_scene_count is not None
            else "Choose the Scene count that best serves the concept and the amount of useful coverage it supports. "
        )
        blocks.append(
            "[CURRENT TASK]\nDevelop the Story into independently generatable MiniMax H3 Scenes. "
            + scene_count_guidance
            + "Use the Project Concept, Visual / atmosphere, Invariants and established facts to author "
            "the Scene content and relationships. Return each Scene's title, optional entry/exit "
            "state, duration, and complete H3 prompt in the supplied JSON schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema"),
        }

    if operation == "develop_story_outline":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to develop a Story.")
        blocks = ["[DIRECTOR CONTEXT]\n" + director_context]
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        blocks.append("[STORY CONCEPT]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        _add_model_limitations(blocks, "minimax_h3")
        target_scene_count = story.get("targetSceneCount")
        scene_count_guidance = (
            "Create exactly " + str(int(target_scene_count)) + " planned Scenes. "
            if target_scene_count is not None
            else "Choose the Scene count that best serves the concept and useful coverage. "
        )
        blocks.append(
            "[CURRENT TASK]\nPlan the Story as ordered, complete Scenes. "
            + scene_count_guidance
            + "Use the Project Concept, Visual / atmosphere and Invariants. For each Scene return a title, "
            "complete H3 prompt and suggested duration. "
            "Return JSON matching the supplied schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _story_outline_response_schema(target_scene_count),
        }

    if operation == "develop_story_scene":
        development = development if isinstance(development, dict) else {}
        outline = development.get("outline")
        scene_index = development.get("sceneIndex")
        previous_scene = development.get("previousScene")
        if not isinstance(outline, dict) or not isinstance(outline.get("scenes"), list) or not outline["scenes"]:
            raise ValueError("Individual Story development requires a Scene outline.")
        try:
            scene_index = int(scene_index)
        except (TypeError, ValueError) as exc:
            raise ValueError("Individual Story development sceneIndex must be an integer.") from exc
        if scene_index < 0 or scene_index >= len(outline["scenes"]):
            raise ValueError("Individual Story development sceneIndex is out of range.")
        planned_scene = outline["scenes"][scene_index]
        if not isinstance(planned_scene, dict):
            raise ValueError("Individual Story development planned Scene is invalid.")

        blocks = ["[DIRECTOR CONTEXT]\n" + director_context]
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        concept = _clean(story.get("concept"))
        if concept:
            blocks.append("[STORY CONCEPT / OVERVIEW]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
        _add_model_limitations(blocks, "minimax_h3")
        blocks.append("[COMPLETE SCENE OUTLINE]\n" + json.dumps(outline, indent=2, ensure_ascii=False))
        blocks.append(
            "[CURRENT PLANNED SCENE]\nScene "
            + str(scene_index + 1)
            + " of "
            + str(len(outline["scenes"]))
            + "\n"
            + json.dumps(planned_scene, indent=2, ensure_ascii=False)
        )
        if isinstance(previous_scene, dict):
            blocks.append(
                "[PREVIOUS AUTHORED SCENE - RELATIONSHIP CONTEXT]\n"
                + json.dumps({
                    key: previous_scene.get(key)
                    for key in ("title", "prompt")
                    if _clean(previous_scene.get(key))
                }, indent=2, ensure_ascii=False)
                + "\n\nThe planned outline and author direction establish this Scene's creative scope."
            )
        blocks.append(
            "[CURRENT TASK]\nAuthor exactly this one planned Scene as a complete MiniMax H3 Scene. "
            "Preserve the planned Scene's purpose and its place in the complete outline. "
            "Return the complete title, suggestedDurationSeconds, and the full H3 generation prompt exactly as it should be stored. "
            "Follow the supplied Director and H3 guidance. Return only JSON matching the supplied schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _single_scene_response_schema(),
        }

    if operation == "insert_scene":
        order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        if scene_id not in order:
            raise FileNotFoundError("Scene does not exist.")
        index = order.index(scene_id)
        before_scene = scenes.get(scene_id)
        after_scene = scenes.get(order[index + 1]) if index + 1 < len(order) else None
        if not isinstance(before_scene, dict) or (after_scene is not None and not isinstance(after_scene, dict)):
            raise RuntimeError("Storyboard Scene order is invalid.")

        custom_instruction = _clean(instruction)
        blocks = []
        if custom_instruction:
            blocks.append("[USER DIRECTION - PRIMARY CREATIVE BRIEF]\n" + custom_instruction)
        blocks.append("[DIRECTOR CONTEXT]\n" + director_context)
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        concept = _clean(story.get("concept"))
        if concept and not custom_instruction:
            blocks.append("[STORY CONCEPT]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE - CONSTRAINT]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS - CONSTRAINTS]\n" + invariants)
        blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
        _add_model_limitations(blocks, "minimax_h3")
        blocks.append("[SCENE BEFORE - PLACEMENT CONTEXT]\n" + _scene_context(before_scene))
        if after_scene is not None:
            blocks.append("[SCENE AFTER - PLACEMENT CONTEXT]\n" + _scene_context(after_scene))
        if not custom_instruction:
            blocks.append("[EXISTING SCENE PROMPTS]\n" + "\n".join(
                str(number) + ". " + _clean(scenes.get(ordered_id, {}).get("title"))
                + ": " + _clean(scenes.get(ordered_id, {}).get("prompt"))
                for number, ordered_id in enumerate(order, start=1)
            ))
        blocks.append(
            "[CURRENT TASK]\nCreate exactly one new Scene after SCENE BEFORE"
            + (" and before SCENE AFTER. " if after_scene is not None else ", at the end of the Story. ")
            + (
                "Follow USER DIRECTION as the source of the new Scene's content. "
                "Other Story and Scene details are constraints for visual consistency or placement, not alternative creative briefs. "
                if custom_instruction else
                "Use the complete Story concept and outline as the new Scene\'s creative brief. "
            )
            + "Use neighbouring Scene descriptions as placement context and the supplied author direction for creative choices. "
            "Return the new Scene and its complete standalone H3 prompt in the supplied JSON schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _single_scene_response_schema(),
        }

    if operation == "extend_story":
        order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        if not order:
            raise ValueError("Extend Story requires an existing Scene.")
        if isinstance(scene_count, bool) or not isinstance(scene_count, int) or scene_count < 1:
            raise ValueError("Extend Story scene count must be a positive integer.")
        blocks = ["[DIRECTOR CONTEXT]\n" + director_context]
        for label, value in (
            ("STORY TITLE", story.get("title")),
            ("STORY CONCEPT", story.get("concept")),
            ("STORY VISUAL / ATMOSPHERE", story.get("style")),
        ):
            if _clean(value):
                blocks.append("[" + label + "]\n" + _clean(value))
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
        _add_model_limitations(blocks, "minimax_h3")
        blocks.append("[EXISTING SCENE PROMPTS]\n" + "\n".join(
            str(number) + ". " + _clean(scenes[ordered_id].get("title"))
            + ": " + _clean(scenes[ordered_id].get("prompt"))
            for number, ordered_id in enumerate(order, start=1)
        ))
        if _clean(instruction):
            blocks.append("[USER DIRECTION]\n" + _clean(instruction))
        blocks.append(
            "[CURRENT TASK]\nAppend exactly " + str(scene_count) + " new Scenes after the existing sequence. "
            "Use the Project Concept, Visual / atmosphere, Invariants, established facts and existing Scene Prompts to author the new material. "
            "Return only the new Scenes, each with a complete standalone H3 generation prompt, as JSON matching the supplied schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": {
                **_read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema"),
                "properties": {
                    "scenes": {
                        **_read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema")["properties"]["scenes"],
                        "minItems": scene_count,
                        "maxItems": scene_count,
                    }
                },
            },
        }

    if operation == "repair_scenes":
        correction = _clean(instruction)
        if not correction:
            raise ValueError("A Revise Scenes instruction is required.")
        scene_plan = _repair_scene_plan(story)
        if not scene_plan:
            raise ValueError("Story must have Scenes before Revise Scenes can run.")

        blocks = ["[DIRECTOR CONTEXT]\n" + director_context]
        title = _clean(story.get("title"))
        if title:
            blocks.append("[STORY TITLE]\n" + title)
        concept = _clean(story.get("concept"))
        if concept:
            blocks.append("[STORY CONCEPT]\n" + concept)
        style = _clean(story.get("style"))
        if style:
            blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
        invariants = _story_invariants_text(story)
        if invariants:
            blocks.append("[STORY INVARIANTS]\n" + invariants)
        blocks.append("[H3 WRITING RULES]\n" + h3_runtime_context)
        _add_model_limitations(blocks, "minimax_h3")
        blocks.append("[CURRENT SCENE PLAN]\n" + json.dumps(scene_plan, indent=2, ensure_ascii=False))
        blocks.append(
            "[USER REPAIR INSTRUCTION]\n" + correction
            + "\n\n[CURRENT TASK]\nApply the user's instruction to the current Scene plan. "
            "Return sparse updates to existing Scenes, preserving their order and count. "
            "Include only affected Scenes with a complete revised H3 prompt. "
            "Use the supplied 1-based sceneNumber for each affected Scene, once per Scene. "
            "Return {\"changes\":[]} when the instruction is already satisfied."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(SCENE_REPAIR_SCHEMA_PATH, "Storyboard Scene repair schema"),
        }

    scene_id = _clean(scene_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    scene = scenes.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")

    style = _clean(story.get("style"))
    story_invariants = _story_invariants_text(story)
    scene_context = _scene_context(scene)
    vocabulary = approved_lora_vocabulary(story, scene_id)
    h3_mode = mode_from_reference_roles(_reference_roles(scene))

    blocks = ["[DIRECTOR CONTEXT]\n" + director_context] if operation == "write_prompt" else []
    concept = _clean(story.get("concept"))
    title = _clean(story.get("title"))
    if title and operation == "visual_direction":
        blocks.append("[PROJECT TITLE]\n" + title)
    if concept and operation == "write_prompt":
        blocks.append("[STORY CONCEPT / OVERVIEW]\n" + concept)
    elif concept and operation == "visual_direction":
        blocks.append("[PROJECT OVERVIEW]\n" + concept)
    if style:
        blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
    if story_invariants:
        invariant_guidance = (
            "\n\nUse these as established facts. Include relevant visible details in this Scene's prompt when needed for a complete standalone render; leave unrelated invariant details out."
            if operation == "visual_direction"
            else "\n\nTreat these as established constraints, not material to add to this Scene."
        )
        blocks.append("[STORY INVARIANTS]\n" + story_invariants + invariant_guidance)
    if scene_context and operation != "visual_direction":
        blocks.append("[SCENE]\n" + scene_context)
    if vocabulary:
        blocks.append(vocabulary)
    if operation in {"write_prompt", "visual_direction"}:
        blocks.append("[H3 PROMPTING GUIDANCE]\n" + h3_runtime_context)
    _add_model_limitations(blocks, "minimax_h3")
    blocks.append("[REFERENCE MODE]\n" + h3_mode)

    if operation == "write_prompt":
        blocks.append(
            "[CURRENT TASK]\nWrite the complete MiniMax H3 generation prompt for this Scene exactly as it should be used, following the supplied guidance and Scene context."
        )
    elif operation == "visual_direction":
        existing_prompt = _clean(scene.get("prompt"))
        if not existing_prompt:
            raise ValueError("Scene generation prompt is required for Visual Direction.")
        if _clean(instruction):
            blocks.append("[AUTHOR'S ADDITIONAL DIRECTION]\n" + _clean(instruction))
        scene_details = []
        for label, value in (
            ("Title", scene.get("title")),
            ("Summary", scene.get("summary")),
            ("Duration seconds", scene.get("durationSeconds")),
        ):
            text = _clean(value)
            if text:
                scene_details.append(label + ": " + text)
        if scene_details:
            blocks.append("[SCENE DETAILS]\n" + "\n".join(scene_details))
        blocks.append("[EXISTING H3 PROMPT]\n" + existing_prompt)
        blocks.append(
            "[CURRENT TASK]\nImprove this Scene's existing H3 prompt using the supplied context."
        )
    else:
        existing_prompt = _clean(scene.get("prompt"))
        correction = _clean(instruction)
        if not existing_prompt:
            raise ValueError("Scene generation prompt is required to refine a prompt.")
        if not correction:
            raise ValueError("A refinement instruction is required.")
        if continuity_context:
            relevant_guidelines = _story_guidelines_text(story)
            if relevant_guidelines:
                blocks.append("[STORY DIRECTING GUIDELINES]\n" + relevant_guidelines)
            previous_scene_context = _previous_scene_context(story, scene_id)
            if previous_scene_context:
                blocks.append(
                    "[PREVIOUS SCENE - CONTINUITY FACTS ONLY]\n" + previous_scene_context
                    + "\n\nUse these facts as context for the explicitly requested continuity review."
                )
        blocks.append("[EXISTING PROMPT]\n" + existing_prompt)
        blocks.append(
            "[CURRENT TASK]\nApply this correction to the existing Scene prompt with the smallest relevant edit:\n"
            + correction
            + "\n\nPreserve all authored material outside the requested scope. "
            "Return changed=false with the original prompt when the correction is already satisfied. "
            "Otherwise return the complete minimally revised prompt. "
            "Duration updates, when needed, must be between 6 and 15 seconds."
        )

    return {
        "operation": operation,
        "output": "json",
        "prompt": "\n\n".join(blocks).strip() + "\n",
        **({
            "system_prompt": (
                "You are refining prompts for a text-to-video model. Your job is to describe the intended moving visuals so the model can render them accurately. "
                "Be exceptionally thorough and specific about the visuals that will actually be rendered. "
                "Explicitly establish relevant visual details that are implied by context or not yet specified. "
                "Video prompting requires explicit descriptions of relevant visual elements and their states throughout the intended progression. "
                "Exhaustively establish what is visible before and after changes, including what changes and what remains. "
                "Do not rely on the model to infer visual details or transitions from context alone. "
                "Prioritize details that materially affect what the viewer will see or how the intended actions will be rendered. "
                "Make appropriate creative decisions to complete the intended visuals, consistent with the established creative direction. "
                "Make the Scene prompt sufficiently complete to guide the intended render on its own. "
                "Keep your work focused on this Scene; do not introduce your own story, narrative direction, or unrelated creative developments. "
                "Return the complete revised H3 prompt; if no meaningful improvement is needed, return changed=false with the original prompt."
            )
        } if operation == "visual_direction" else {}),
        "response_schema": _prompt_response_schema(
            allow_duration=operation == "refine_prompt",
            allow_unchanged=operation in {"refine_prompt", "visual_direction"},
        ),
    }
