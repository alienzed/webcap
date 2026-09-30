import json
from pathlib import Path

from .h3_prompt_contract import mode_from_reference_roles


DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
DIRECTOR_CONTEXT_PATH = DOCS_ROOT / "storyboard-director-context.txt"
H3_RUNTIME_CONTEXT_PATH = DOCS_ROOT / "mmh3-prompt-runtime-context.txt"
SCENE_PLAN_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-plan.schema.json"
INVARIANT_SCHEMA_PATH = DOCS_ROOT / "storyboard-invariants.schema.json"
SCENE_REPAIR_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-repair.schema.json"
VALID_OPERATIONS = {"expand_concept", "define_invariants", "develop_story", "insert_scene", "repair_scenes", "write_prompt", "refine_prompt"}


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
        ("Generation prompt", scene.get("prompt")),
    )
    return "\n".join(
        label + ": " + _clean(value)
        for label, value in fields
        if _clean(value)
    )


def build_request(story, scene_id, operation, instruction=""):
    if not isinstance(story, dict):
        raise ValueError("Story data must be an object.")
    operation = _clean(operation).lower()
    if operation not in VALID_OPERATIONS:
        raise ValueError("Unsupported Storyboard LLM operation.")

    director_context = _read_text(DIRECTOR_CONTEXT_PATH, "Storyboard director context")
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
        existing = _story_invariants_text(story)
        if existing:
            blocks.append(
                "[EXISTING STORY INVARIANTS]\n"
                + existing
                + "\n\nDo not repeat an existing character or location invariant with the same subject."
            )
        blocks.append(
            "[CURRENT TASK]\nIdentify recurring characters and recurring locations from this Story concept that should "
            "have stable visual definitions across independently generated Scenes. Return only character and location "
            "invariants. Preserve explicit Story facts. For a recurring character, produce a concrete reusable physical "
            "identity rather than a generic role. Include only stable visible traits that materially help reproduce the "
            "intended design, such as age range, appearance or skin tone when relevant, hair, build, face shape, or "
            "distinguishing features; do not fill every category mechanically. If the concept leaves needed visual identity "
            "unspecified, choose a coherent grounded design and keep it internally consistent. Omit scene-specific wardrobe "
            "unless the concept makes it a defining persistent feature. For a recurring location, describe only stable "
            "physical details that materially help reproduce it, such as layout, architecture, materials, or fixed features. "
            "If the concept clearly requires missing visual detail for reproducibility, choose a sensible concrete detail "
            "and keep it grounded; do not invent plot events, "
            "relationships, one-off extras, or new locations. Do not plan Scenes.\n\n"
            "Return exactly this JSON shape:\n"
            "{\"invariants\":[{\"kind\":\"character\",\"title\":\"Elena\",\"text\":\"Woman in her early 30s with shoulder-length dark brown wavy hair, slim build, oval face, and a small mole beneath her left eye.\"},"
            "{\"kind\":\"location\",\"title\":\"Elena's apartment\",\"text\":\"Small older apartment with faded green walls, narrow rooms, dark wood trim, and two brass wall sconces.\"}]}\n"
            "If there are no useful recurring characters or locations, return {\"invariants\":[]}."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(INVARIANT_SCHEMA_PATH, "Storyboard invariant schema"),
        }

    if operation == "expand_concept":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to expand a Story.")
        blocks = []
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
            "[CURRENT TASK]\nExpand this Story concept into a richer creative overview that can drive later Scene planning. "
            "Develop the experience, progression, subjects or characters, setting, themes, relationships, or ending direction "
            "that the seed actually supports; do not force conventional plot, conflict, or character arcs onto a concept that "
            "does not call for them. Be creatively useful and fill in sensible connective material rather than asking "
            "questions. Preserve explicit facts from the original concept and Story invariants. Treat the supplied Visual / Atmosphere as authoritative: "
            "do not replace it, reinterpret it into a different style, or introduce a competing visual atmosphere in the expanded prose. Expand the narrative within it. Do not break the Story into "
            "Scenes yet and do not write MiniMax H3 prompts. Aim for roughly 500-1000 words total when the concept supports it; "
            "treat that as a useful target, not a minimum to pad toward. Stop once the concept is fully developed. "
            "Return only the expanded Story concept as polished prose."
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
        target_scene_count = story.get("targetSceneCount")
        scene_count_guidance = (
            "Create exactly " + str(int(target_scene_count)) + " Scenes. "
            if target_scene_count is not None
            else "Choose the Scene count that best fits the Story's natural progression and pacing. "
        )
        blocks.append(
            "[CURRENT TASK]\nDevelop the Story into a complete sequence of MiniMax H3 Scenes. "
            + scene_count_guidance
            + "Each Scene is a short generation unit, normally about 10-15 seconds and never longer than 15 seconds. "
            "Use that window densely: unless uninterrupted time genuinely serves the material, give each Scene several meaningful shots, cuts, or distinct visual beats rather than idle coverage. "
            "Keep the Story's progression clear and preserve explicit facts and supplied invariants where they matter, but do not force every Scene to behave like a literal continuation of the previous render. "
            "Entry and exit state are optional planning notes; include them only when a specific handoff or visible state is genuinely useful. "
            "Write each Scene's complete H3 generation prompt yourself. WebCap will store that prompt as written and will not inject invariants, continuity blocks, field labels, shot labels, sound sections, or other creative text afterward. "
            "Follow the supplied H3 guidance roughly rather than mechanically. Be concrete and visually productive, but avoid repetitive continuity prose and unnecessary boilerplate. "
            "Return only JSON matching the supplied schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema"),
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
        blocks.append("[CURRENT SCENE PLAN]\n" + json.dumps(scene_plan, indent=2, ensure_ascii=False))
        blocks.append(
            "[USER REPAIR INSTRUCTION]\n" + correction
            + "\n\n[CURRENT TASK]\nApply the user's instruction to the current Scene plan. "
            "This is a targeted revision pass, not Story redevelopment. Preserve unaffected Scenes and fields. "
            "Do not add, remove, merge, split, or reorder Scenes unless the user's instruction explicitly asks for that; this operation currently applies sparse patches to the existing Scene list. "
            "Return only the Scene fields that actually need changing: summary, optional entryState/exitState, and/or the complete revised H3 prompt string. "
            "When changing a prompt, author the complete prompt exactly as it should be stored; WebCap will not rebuild it, inject continuity text, or add H3 field labels. "
            "Use the 1-based sceneNumber values supplied above and return each Scene at most once. "
            "If the instruction does not require any repair, return {\"changes\":[]}."
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
    h3_mode = mode_from_reference_roles(_reference_roles(scene))

    blocks = [
        "[DIRECTOR CONTEXT]\n" + director_context,
    ]
    concept = _clean(story.get("concept"))
    if concept:
        blocks.append("[STORY CONCEPT / OVERVIEW]\n" + concept)
    if style:
        blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
    if story_invariants:
        blocks.append(
            "[STORY INVARIANTS]\n"
            + story_invariants
            + "\n\nUse these as context where relevant. Do not mechanically repeat them or turn them into a continuity preamble."
        )
    if scene_context:
        blocks.append("[SCENE]\n" + scene_context)
    blocks.append("[H3 GUIDANCE]\n" + h3_runtime_context)
    blocks.append("[REFERENCE MODE]\n" + h3_mode)

    if operation == "write_prompt":
        if not _clean(scene.get("summary")):
            raise ValueError("Scene summary / intent is required to write a prompt.")
        blocks.append(
            "[CURRENT TASK]\nWrite the complete MiniMax H3 generation prompt for this Scene. "
            "Use the short duration densely: several meaningful cuts, shots, or visual beats are normally expected unless uninterrupted time genuinely serves the material. "
            "Preserve explicit Story facts and use relevant invariants naturally, without repeating a continuity block. "
            "Return the prompt exactly as it should be stored. WebCap will not rewrite it. "
            "If an exact first/last-frame reference is attached, respect that visual anchor; WebCap will add only the required mechanical alignment statement."
        )
    else:
        existing_prompt = _clean(scene.get("prompt"))
        correction = _clean(instruction)
        if not existing_prompt:
            raise ValueError("Scene generation prompt is required to refine a prompt.")
        if not correction:
            raise ValueError("A refinement instruction is required.")
        previous_scene_context = _previous_scene_context(story, scene_id)
        if previous_scene_context:
            blocks.append(
                "[PREVIOUS SCENE - CONTEXT ONLY]\n"
                + previous_scene_context
                + "\n\nUse this only when it genuinely helps the requested revision. Do not force a continuity handoff."
            )
        blocks.append("[EXISTING PROMPT]\n" + existing_prompt)
        blocks.append(
            "[CURRENT TASK]\nApply the requested correction faithfully to this Scene:\n"
            + correction
            + "\n\nReturn changed=false and reproduce the existing prompt unchanged when no edit is needed. "
            "Otherwise return the complete revised prompt exactly as it should be stored, plus only any optional Scene fields the correction actually requires. "
            "Preserve unrelated prompt details. Keep the Scene visually dense unless the requested change or material genuinely calls for uninterrupted time. "
            "If the change materially alters the needed screen time, you may include durationSeconds between 6 and 15 seconds."
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
