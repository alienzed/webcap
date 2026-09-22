from pathlib import Path


DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
DIRECTOR_CONTEXT_PATH = DOCS_ROOT / "storyboard-director-context.txt"
H3_TEMPLATE_PATH = DOCS_ROOT / "mmh3-prompt-template.txt"
VALID_OPERATIONS = {"write_prompt", "refine_prompt"}


def _read_text(path, label):
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Could not read " + label + ".") from exc


def _clean(value):
    return str(value or "").strip()


def _reference_summary(scene):
    roles = []
    for reference in scene.get("references") or []:
        if not isinstance(reference, dict):
            continue
        role = _clean(reference.get("role"))
        if role not in {"first_frame", "last_frame"}:
            continue
        if role not in roles:
            roles.append(role)
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

    scene_id = _clean(scene_id)
    scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
    scene = scenes.get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")

    style = _clean(story.get("style"))
    scene_context = _scene_context(scene)
    previous_handoff = _previous_handoff(story, scene_id)
    director_context = _read_text(DIRECTOR_CONTEXT_PATH, "Storyboard director context")
    h3_template = _read_text(H3_TEMPLATE_PATH, "MiniMax H3 prompt template")

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
            "[H3 OUTPUT CONTRACT]\n"
            + h3_template
            + "\n\nUse the supplied Scene facts and references. Return only the final model-facing prompt."
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
            "[H3 OUTPUT CONTRACT]\n"
            + h3_template
            + "\n\nPreserve all prompt details unrelated to the requested correction. Return only the revised model-facing prompt."
        )
        blocks.append("[CURRENT TASK]\nApply this correction with the smallest coherent change:\n" + correction)

    return {
        "operation": operation,
        "output": "text",
        "prompt": "\n\n".join(blocks).strip() + "\n",
    }
