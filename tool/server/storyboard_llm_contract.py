import json
from pathlib import Path


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
    roles = []
    for reference in scene.get("references") or []:
        if not isinstance(reference, dict):
            continue
        role = _clean(reference.get("role"))
        if role not in {"first_frame", "last_frame"}:
            continue
        if role not in roles:
            roles.append(role)
    return roles


def _reference_summary(scene):
    roles = _reference_roles(scene)
    if not roles:
        return ""
    return ", ".join(role + " exact visual anchor supplied" for role in roles)


def _h3_mode(scene):
    roles = set(_reference_roles(scene))
    if roles == {"first_frame", "last_frame"}:
        return "FL2VA"
    if roles == {"first_frame"}:
        return "I2VA"
    if roles == {"last_frame"}:
        return "L2VA"
    return "T2VA"


def _h3_output_contract(scene):
    mode = _h3_mode(scene)
    duration = float(scene.get("durationSeconds") or 0)
    if mode == "I2VA":
        preamble = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."
    elif mode == "L2VA":
        preamble = (
            "How the reference pictures align with the target video — <Picture 1> (from [Shot N]) "
            "aligns with the " + format(duration, ".2f") + "-second mark of the target video."
        )
    elif mode == "FL2VA":
        preamble = (
            "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns "
            "with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the "
            + format(duration, ".2f") + "-second mark of the target video."
        )
    else:
        preamble = ""

    core = (
        "integrated_multimodal_description: [Shot 1] ...\n\n"
        "overall_soundscape: ...\n\n"
        "non_diegetic_music: ..."
    )
    body = core if not preamble else preamble + "\n\n" + core
    return mode, body


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
            blocks.append("[STORY STYLE]\n" + style)
        blocks.append(
            "[CURRENT TASK]\nExpand this Story concept into a richer creative overview that can drive later Scene planning. "
            "Develop the narrative arc, important characters, setting, conflict, progression, and ending direction when "
            "the seed supports them. Be creatively useful and fill in sensible connective material rather than asking "
            "questions. Preserve explicit facts from the original concept and supplied style. Do not break the Story into "
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
            blocks.append("[STORY STYLE]\n" + style)
        blocks.append("[H3 WRITING RULES]\n" + h3_runtime_context)
        blocks.append(
            "[CURRENT TASK]\nDevelop the Story into a complete production-ready sequence of MiniMax H3 T2VA Scenes. "
            "Choose the number of Scenes and each duration yourself from the creative material; use at least two Scenes, "
            "and keep every Scene between 4 and 15 seconds. Preserve a coherent narrative progression and explicit "
            "entry/exit continuity. Establish recurring characters as stable people before writing the Scene prompts, and "
            "preserve their core visual identity across the entire Story. If the Story spans age changes, age the same person "
            "rather than silently changing ethnicity/heritage, skin tone, facial structure, eye/hair traits, or other identity "
            "markers. Because every Scene is generated independently, repeat enough concrete character identity detail in each "
            "relevant prompt when no LoRA or exact visual reference anchors that identity. Write a complete model-facing H3 "
            "prompt for every Scene now, not a placeholder. Be creatively useful: invent natural dialogue, performance details, "
            "camera behavior, sound, and music when they improve the Story, while preserving supplied facts. Each Scene prompt "
            "must be independently generatable and follow the supplied H3 base prompt rules. Return only JSON matching the supplied schema."
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
    scene_context = _scene_context(scene)
    previous_handoff = _previous_handoff(story, scene_id)
    h3_mode, h3_output = _h3_output_contract(scene)

    blocks = [
        "[DIRECTOR CONTEXT]\n" + director_context,
    ]
    if style:
        blocks.append("[STORY STYLE]\n" + style)
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
            + "\n\nUse the supplied Scene facts and exact frame anchors. Return only the final model-facing prompt."
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
            + "\n\nPreserve all prompt details unrelated to the requested correction. Return only the revised model-facing prompt."
        )
        blocks.append("[CURRENT TASK]\nApply this correction with the smallest coherent change:\n" + correction)

    return {
        "operation": operation,
        "output": "text",
        "prompt": "\n\n".join(blocks).strip() + "\n",
    }
