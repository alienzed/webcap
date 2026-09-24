import json
from pathlib import Path

from .h3_prompt_contract import content_schema, final_shape, mode_from_reference_roles


DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
DIRECTOR_CONTEXT_PATH = DOCS_ROOT / "storyboard-director-context.txt"
H3_RUNTIME_CONTEXT_PATH = DOCS_ROOT / "mmh3-prompt-runtime-context.txt"
SCENE_PLAN_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-plan.schema.json"
INVARIANT_SCHEMA_PATH = DOCS_ROOT / "storyboard-invariants.schema.json"
SCENE_REPAIR_SCHEMA_PATH = DOCS_ROOT / "storyboard-scene-repair.schema.json"
VALID_OPERATIONS = {"expand_concept", "define_invariants", "develop_story", "repair_scenes", "write_prompt", "refine_prompt"}


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


def _scene_invariants_text(story, scene):
    refs = scene.get("invariantRefs") if isinstance(scene.get("invariantRefs"), list) else []
    if not refs:
        return ""
    by_key = {}
    invariants = story.get("invariants") if isinstance(story.get("invariants"), list) else []
    for item in invariants:
        if not isinstance(item, dict):
            continue
        kind = _clean(item.get("kind")).lower()
        title = _clean(item.get("title"))
        text = _clean(item.get("text"))
        if kind not in {"character", "location"} or not title or not text:
            continue
        by_key[(kind, title.casefold())] = {
            "kind": kind,
            "title": title,
            "text": text,
        }

    lines = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        kind = _clean(ref.get("kind")).lower()
        title = _clean(ref.get("title"))
        item = by_key.get((kind, title.casefold()))
        if item is not None:
            lines.append(item["kind"].capitalize() + ": " + item["title"] + "\n" + item["text"])
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

    if operation == "define_invariants":
        concept = _clean(story.get("concept"))
        if not concept:
            raise ValueError("Story concept / overview is required to define Story invariants.")
        blocks = [
            "[DIRECTOR CONTEXT]\n" + director_context,
        ]
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
            "identity rather than a generic role. Include apparent age range, broad racial or ethnic appearance and skin "
            "tone when useful to the intended fictional design, eye color, hair color, hair length, hair texture/style, "
            "build/body proportions, face shape, and distinguishing visible features; include facial hair or other stable "
            "traits when relevant. If the concept leaves these unspecified, choose one coherent design now and keep it "
            "internally consistent. Omit scene-specific wardrobe unless the concept makes it a defining persistent feature. "
            "For a recurring location, describe stable layout, architecture, materials, dominant colors, fixed features, "
            "and baseline practical lighting when useful. If the concept clearly requires missing visual detail for "
            "reproducibility, choose one sensible concrete detail and keep it grounded; do not invent plot events, "
            "relationships, one-off extras, or new locations. Do not plan Scenes.\n\n"
            "Return exactly this JSON shape:\n"
            "{\"invariants\":[{\"kind\":\"character\",\"title\":\"Elena\",\"text\":\"White woman in her early 30s with fair skin, hazel eyes, shoulder-length dark brown wavy hair, slim build, oval face, and a small mole beneath her left eye.\"},"
            "{\"kind\":\"location\",\"title\":\"Elena's apartment\",\"text\":\"Small older apartment with faded green walls, narrow rooms, dark wood trim, and warm practical lamps.\"}]}\n"
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
            "Aim for " + str(target_scene_count) + " Scenes. Give each meaningful narrative beat its own generatable Scene and pace the material across the requested Scene count rather than compressing several beats together. "
            "Keep every Scene between 4 and 15 seconds. Preserve coherent narrative progression, explicit entry/exit continuity, supplied Story facts, Story invariants, recurring character identity, wardrobe, location, and persistent visible state across the sequence. "
            "For every Scene, invariantRefs must contain the exact kind/title pairs of only the supplied character and location invariants actually present or materially relevant in that Scene; use an empty array when none apply. Do not introduce a character or location merely to justify a reference. WebCap will inject those invariant descriptions verbatim into the final H3 prompt, so do not rewrite their identity details merely for variety. "
            "Provide complete structured H3 content for every Scene now, not a placeholder; WebCap will render the exact model-facing field labels and spacing. Be creatively useful: invent natural dialogue, performance details, camera behavior, sound, and music when they improve the Story and remain consistent with the supplied material. "
            "Each Scene prompt must be independently generatable and follow the supplied H3 base prompt rules. "
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
            raise ValueError("A Check & Repair instruction is required.")
        scene_plan = _repair_scene_plan(story)
        if not scene_plan:
            raise ValueError("Story must have Scenes before Check & Repair can run.")

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
            + "\n\n[CURRENT TASK]\nReview the whole current Scene plan against the user's instruction and heal only concrete problems. "
            "This is a sparse repair pass, not Story redevelopment. Keep the exact Scene count, order, titles, durations, references, LoRAs, seeds, and narrative beats. "
            "Do not add, remove, merge, split, or reorder Scenes. Do not rewrite an unaffected Scene or field for style or variety. "
            "Return only the minimum field patches actually required. Allowed fields are summary, entryState, exitState, and prompt. "
            "Use the 1-based sceneNumber values supplied above; never invent or return WebCap IDs, and return each Scene at most once. "
            "If a generation prompt needs repair, return complete semantic H3 prompt content in fields.prompt using the supplied three-field structure; "
            "do not reproduce WebCap's app-owned Continuity anchors prefix or final field labels. WebCap will render those itself. "
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
    scene_invariants = _scene_invariants_text(story, scene)
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
    if scene_invariants:
        blocks.append(
            "[SCENE INVARIANTS]\n"
            + scene_invariants
            + "\n\nThese are the authoritative character/location definitions relevant to this Scene. WebCap will inject them verbatim into the rendered H3 prompt after your response. Use them when writing the Scene action, but do not rewrite, paraphrase, or duplicate them in your structured fields."
        )
    elif story_invariants:
        blocks.append("[STORY INVARIANTS]\n" + story_invariants)
    if shared_context:
        blocks.append(
            "[SHARED CONTINUITY FOR THIS SCENE]\n"
            + shared_context
            + "\n\nThese legacy shared definitions are authoritative. WebCap will inject them verbatim into the rendered H3 prompt after your response. Use them when writing the Scene action, but do not rewrite, paraphrase, or duplicate the app-owned continuity block in your structured fields."
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
            + "\n\nWebCap owns the final labels, alignment syntax, and shared continuity prefix. Do not reproduce any app-owned 'Continuity anchors' prefix yourself. Return only the three semantic field values through the supplied JSON schema."
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
            + "\n\nPreserve all prompt details unrelated to the requested correction, except do not reproduce the app-owned 'Continuity anchors' prefix from the existing prompt. WebCap will restore the authoritative shared continuity block after your response. WebCap owns the final labels and alignment syntax; return only the three revised semantic field values through the supplied JSON schema."
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
            "shared_context": "\n".join(
                part for part in (scene_invariants, shared_context) if part
            ),
        },
    }
