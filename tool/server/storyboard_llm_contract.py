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
VALID_OPERATIONS = {"interpret_atmosphere", "expand_concept", "define_invariants", "develop_story", "develop_story_outline", "develop_story_scene", "insert_scene", "extend_story", "repair_scenes", "write_prompt", "refine_prompt", "check_coherence"}


def _read_text(path, label):
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Could not read " + label + ".") from exc


def _clean(value):
    return str(value or "").strip()


def _prompt_response_schema(allow_duration=False, allow_scene_fields=False, allow_unchanged=False):
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
    if allow_scene_fields:
        schema["properties"]["summary"] = {
            "type": "string",
            "minLength": 1,
            "description": "Optional revised Scene intent. Include only when the requested refinement requires it.",
        }
        schema["properties"]["entryState"] = {
            "type": "string",
            "description": "Optional revised Scene entry state.",
        }
        schema["properties"]["exitState"] = {
            "type": "string",
            "description": "Optional revised Scene exit state.",
        }
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
        "required": ["title", "summary", "suggestedDurationSeconds"],
        "properties": {
            "title": {"type": "string", "minLength": 1},
            "summary": {"type": "string", "minLength": 1},
            "entryState": {"type": "string"},
            "exitState": {"type": "string"},
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
        ("Summary / intent", scene.get("summary")),
        ("Entry state", scene.get("entryState")),
        ("Exit state", scene.get("exitState")),
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
            "summary": _clean(scene.get("summary")),
            "entryState": _clean(scene.get("entryState")),
            "exitState": _clean(scene.get("exitState")),
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
        ("Summary / intent", scene.get("summary")),
        ("Entry state", scene.get("entryState")),
        ("Exit state", scene.get("exitState")),
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


def build_request(story, scene_id, operation, instruction="", development=None, scene_count=1, continuity_context=False, refresh_guidelines=False):
    if not isinstance(story, dict):
        raise ValueError("Story data must be an object.")
    operation = _clean(operation).lower()
    if operation not in VALID_OPERATIONS:
        raise ValueError("Unsupported Storyboard LLM operation.")

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
            "the Scene content and relationships. Return each Scene's title, summary, optional entry/exit "
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
            "[CURRENT TASK]\nPlan the Story as a concise ordered Scene outline. "
            + scene_count_guidance
            + "Use the Project Concept, Visual / atmosphere and Invariants. For each Scene return a title, "
            "summary / intent, optional entry/exit state, and suggested duration. "
            "Generation prompts will be authored separately. Return JSON matching the supplied schema."
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
                    for key in ("title", "summary", "entryState", "exitState")
                    if _clean(previous_scene.get(key))
                }, indent=2, ensure_ascii=False)
                + "\n\nThe planned outline and author direction establish this Scene's creative scope."
            )
        blocks.append(
            "[CURRENT TASK]\nAuthor exactly this one planned Scene as a complete MiniMax H3 Scene. "
            "Preserve the planned Scene's purpose and its place in the complete outline. "
            "Return the complete title, summary, optional entryState / exitState, suggestedDurationSeconds, and the full H3 generation prompt exactly as it should be stored. "
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
            blocks.append("[EXISTING SCENE OUTLINE]\n" + "\n".join(
                str(number) + ". " + _clean(scenes.get(ordered_id, {}).get("title"))
                + ": " + _clean(scenes.get(ordered_id, {}).get("summary"))
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
        blocks.append("[EXISTING SCENE OUTLINE]\n" + "\n".join(
            str(number) + ". " + _clean(scenes[ordered_id].get("title"))
            + ": " + _clean(scenes[ordered_id].get("summary"))
            for number, ordered_id in enumerate(order, start=1)
        ))
        last_exit = _clean(scenes[order[-1]].get("exitState"))
        if last_exit:
            blocks.append("[LAST SCENE EXIT STATE]\n" + last_exit)
        if _clean(instruction):
            blocks.append("[USER DIRECTION]\n" + _clean(instruction))
        blocks.append(
            "[CURRENT TASK]\nAppend exactly " + str(scene_count) + " new Scenes after the existing sequence. "
            "Use the Project Concept, Visual / atmosphere, Invariants, established facts and existing Scene outline to author the new material. "
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
            "Include only fields that need changing: summary, entryState, exitState, or complete revised H3 prompt. "
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
    if concept and operation == "write_prompt":
        blocks.append("[STORY CONCEPT / OVERVIEW]\n" + concept)
    if style:
        blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
    if story_invariants:
        blocks.append(
            "[STORY INVARIANTS]\n" + story_invariants
            + "\n\nTreat these as established constraints, not material to add to this Scene."
        )
    if scene_context:
        blocks.append("[SCENE]\n" + scene_context)
    if vocabulary:
        blocks.append(vocabulary)
    if operation == "write_prompt":
        blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
    _add_model_limitations(blocks, "minimax_h3")
    blocks.append("[REFERENCE MODE]\n" + h3_mode)

    if operation == "write_prompt":
        if not _clean(scene.get("summary")):
            raise ValueError("Scene summary / intent is required to write a prompt.")
        blocks.append(
            "[CURRENT TASK]\nWrite the complete MiniMax H3 generation prompt for this Scene exactly as it should be used, following the supplied guidance and Scene context."
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
            "Otherwise return the complete minimally revised prompt and only the optional Scene fields "
            "changed by the correction. Duration updates must be between 6 and 15 seconds."
        )

    return {
        "operation": operation,
        "output": "json",
        "prompt": "\n\n".join(blocks).strip() + "\n",
        "response_schema": _prompt_response_schema(
            allow_duration=operation == "refine_prompt",
            allow_scene_fields=operation == "refine_prompt",
            allow_unchanged=operation == "refine_prompt",
        ),
    }
