import json
from pathlib import Path

from .h3_prompt_contract import content_schema, final_shape, mode_from_reference_roles


DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
DIRECTOR_CONTEXT_PATH = DOCS_ROOT / "storyboard-director-context.txt"
H3_RUNTIME_CONTEXT_PATH = DOCS_ROOT / "mmh3-prompt-runtime-context.txt"
SCENE_PLAN_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-plan.schema.json"
VALID_OPERATIONS = {"expand_concept", "develop_story", "write_prompt", "refine_prompt"}


def _read_text(path, label):
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Could not read " + label + ".") from exc


def _clean(value):
    return str(value or "").strip()


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


def _scene_shared_context_text(story, scene):
    refs = scene.get("sharedContextRefs") if isinstance(scene.get("sharedContextRefs"), list) else []
    if not refs:
        return ""
    development = story.get("development") if isinstance(story.get("development"), dict) else {}
    plan = development.get("plan") if isinstance(development.get("plan"), dict) else {}
    shared = plan.get("sharedContext") if isinstance(plan.get("sharedContext"), dict) else {}
    by_id = {}
    for category in ("subjects", "wardrobes", "locations", "persistentFacts"):
        items = shared.get(category) if isinstance(shared.get(category), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            context_id = _clean(item.get("id"))
            description = _clean(item.get("description"))
            if context_id and description:
                by_id[context_id] = {
                    "label": _clean(item.get("label")) or context_id,
                    "description": description,
                }
    lines = []
    for ref in refs:
        item = by_id.get(_clean(ref))
        if item is not None:
            lines.append(item["label"] + ": " + item["description"])
    return "\n".join(lines)


def _previous_handoff(story, scene_id):
    order = story.get("sceneOrder") if isinstance(story.get("sceneOrder"), list) else []
    if scene_id not in order:
        return ""
    index = order.index(scene_id)
    if index <= 0:
        return ""
    previous = (story.get("scenes") or {}).get(order[index - 1])
    if not isinstance(previous, dict):
        return ""
    exit_state = _clean(previous.get("exitState"))
    if not exit_state:
        return ""
    return exit_state


def build_request(story, scene_id, operation, instruction=""):
    if not isinstance(story, dict):
        raise ValueError("Story data must be an object.")
    operation = _clean(operation).lower()
    if operation not in VALID_OPERATIONS:
        raise ValueError("Unsupported Storyboard LLM operation.")

    director_context = _read_text(DIRECTOR_CONTEXT_PATH, "Storyboard director context")
    h3_runtime_context = _read_text(H3_RUNTIME_CONTEXT_PATH, "MiniMax H3 runtime context")

    if operation == "expand_concept":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to expand a Story.")
        blocks = [
            "[DIRECTOR CONTEXT]\n" + director_context,
        ]
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
            "Develop the narrative arc, important characters, setting, conflict, progression, and ending direction when "
            "the seed supports them. Be creatively useful and fill in sensible connective material rather than asking "
            "questions. Preserve explicit facts from the original concept, supplied visual atmosphere, and Story invariants. Do not break the Story into "
            "Scenes yet and do not write MiniMax H3 prompts. Return only the expanded Story concept as polished prose."
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
        blocks.append("[H3 WRITING RULES]\n" + h3_runtime_context)
        target_scene_count = int(story.get("targetSceneCount") or 12)
        blocks.append(
            "[CURRENT TASK]\nDevelop the Story into a complete production-ready sequence of MiniMax H3 T2VA Scenes. "
            "Produce exactly " + str(target_scene_count) + " Scenes. Give each meaningful narrative beat its own generatable Scene and pace the material across the full requested Scene count rather than compressing several beats together. "
            "Keep every Scene between 4 and 15 seconds. Preserve coherent narrative progression, explicit entry/exit continuity, supplied Story facts, and Story invariants across the sequence. "
            "Before writing Scenes, establish sharedContext for recurring subjects, wardrobe states, locations, and other persistent visible/audible facts. These definitions must be concrete, visually detailed, and reusable verbatim. "
            "Do not redesign the same character, clothes, room, weather, props, or other persistent state for variety. Reuse the same sharedContext IDs in every Scene where they still apply, and create a new wardrobe/location/persistent-state definition only when the Story explicitly changes it. "
            "Each Scene must list sharedContextRefs for the exact shared definitions that apply to that Scene. Treat those references as authoritative continuity. WebCap will inject the referenced descriptions into the final H3 prompt mechanically; do not depend on implicit memory between Scenes. "
            "Use continuity.carryForward only for state changes created by a Scene, not for static shared definitions. "
            "Provide complete structured H3 content for every Scene now, not a placeholder; WebCap will render the exact model-facing field labels and spacing. Be creatively useful: invent natural dialogue, performance details, camera behavior, sound, and music when they improve the Story and remain consistent with the supplied material. "
            "Each Scene prompt must be independently generatable and follow the supplied H3 base prompt rules. Repeat important identity/wardrobe/location facts through sharedContext references rather than synonymizing or creatively varying them. "
            "Return only JSON matching the supplied schema."
        )
        return {
            "operation": operation,
            "output": "json",
            "prompt": "\n\n".join(blocks).strip() + "\n",
            "response_schema": _read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema"),
        }

    scene_id = _clean(scene_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    scene = scenes.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")

    style = _clean(story.get("style"))
    invariants = _story_invariants_text(story)
    scene_context = _scene_context(scene)
    shared_context = _scene_shared_context_text(story, scene)
    previous_handoff = _previous_handoff(story, scene_id)
    h3_mode = mode_from_reference_roles(_reference_roles(scene))
    h3_output = final_shape(h3_mode, scene.get("durationSeconds"))

    blocks = [
        "[DIRECTOR CONTEXT]\n" + director_context,
    ]
    if style:
        blocks.append("[STORY VISUAL / ATMOSPHERE]\n" + style)
    if invariants:
        blocks.append("[STORY INVARIANTS]\n" + invariants)
    if shared_context:
        blocks.append(
            "[SHARED CONTINUITY FOR THIS SCENE]\n"
            + shared_context
            + "\n\nThese definitions are authoritative and must be repeated concretely in the resulting prompt. Do not redesign, synonymize away, or omit them."
        )
    if scene_context:
        blocks.append("[SCENE]\n" + scene_context)
    if previous_handoff and not _clean(scene.get("entryState")):
        blocks.append("[PREVIOUS SCENE HANDOFF]\nPrevious exit state: " + previous_handoff)

    if operation == "write_prompt":
        if not _clean(scene.get("summary")):
            raise ValueError("Scene summary / intent is required to write a prompt.")
        blocks.append(
            "[H3 WRITING RULES]\n" + h3_runtime_context
        )
        blocks.append(
            "[H3 MODE]\n" + h3_mode
        )
        blocks.append(
            "[H3 OUTPUT CONTRACT]\n"
            + h3_output
            + "\n\nWebCap owns the final labels and alignment syntax. Return only the three semantic field values through the supplied JSON schema."
        )
        blocks.append(
            "[CURRENT TASK]\nWrite the MiniMax H3 prompt for this Scene. "
            "Preserve supplied facts. Do not add unrelated Story events, dialogue, text, characters, props, or music."
        )
    else:
        existing_prompt = _clean(scene.get("prompt"))
        correction = _clean(instruction)
        if not existing_prompt:
            raise ValueError("Scene generation prompt is required to refine a prompt.")
        if not correction:
            raise ValueError("A refinement instruction is required.")
        blocks.append("[EXISTING PROMPT]\n" + existing_prompt)
        blocks.append(
            "[H3 WRITING RULES]\n" + h3_runtime_context
        )
        blocks.append(
            "[H3 MODE]\n" + h3_mode
        )
        blocks.append(
            "[H3 OUTPUT CONTRACT]\n"
            + h3_output
            + "\n\nPreserve all prompt details unrelated to the requested correction. WebCap owns the final labels and alignment syntax; return only the three revised semantic field values through the supplied JSON schema."
        )
        blocks.append("[CURRENT TASK]\nApply this correction with the smallest coherent change:\n" + correction)

    return {
        "operation": operation,
        "output": "json",
        "prompt": "\n\n".join(blocks).strip() + "\n",
        "response_schema": content_schema(),
        "result_renderer": {
            "type": "h3_base",
            "mode": h3_mode,
            "duration": scene.get("durationSeconds"),
        },
    }
