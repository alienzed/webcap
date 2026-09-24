import copy

BASE_FIELDS = (
    "integrated_multimodal_description",
    "overall_soundscape",
    "non_diegetic_music",
)

VALID_MODES = {"T2VA", "I2VA", "L2VA", "FL2VA"}


def content_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(BASE_FIELDS),
        "properties": {
            "integrated_multimodal_description": {
                "type": "string",
                "minLength": 1,
                "description": (
                    "Chronological audiovisual description for the clip. "
                    "Begin with [Shot 1]. Later shots, if any, use H3 cut timestamps."
                ),
            },
            "overall_soundscape": {
                "type": "string",
                "minLength": 1,
                "description": "Clip-wide ambience, Foley, impacts, and non-dialogue diegetic sound.",
            },
            "non_diegetic_music": {
                "type": "string",
                "minLength": 1,
                "description": "Audience-only score, or N/A when no non-diegetic score is intended.",
            },
        },
    }


def mode_from_reference_roles(reference_roles):
    roles = {
        str(role or "").strip()
        for role in (reference_roles or [])
        if str(role or "").strip() in {"first_frame", "last_frame"}
    }
    if roles == {"first_frame", "last_frame"}:
        return "FL2VA"
    if roles == {"first_frame"}:
        return "I2VA"
    if roles == {"last_frame"}:
        return "L2VA"
    return "T2VA"


def _clean_field(data, key):
    value = str((data or {}).get(key) or "").strip()
    if not value:
        raise ValueError("MiniMax H3 structured output is missing " + key + ".")
    prefix = key + ":"
    if value.casefold().startswith(prefix.casefold()):
        value = value[len(prefix):].lstrip()
    if not value:
        raise ValueError("MiniMax H3 structured output is missing " + key + ".")
    return value


def _duration_text(duration):
    if isinstance(duration, bool):
        raise ValueError("MiniMax H3 duration must be numeric.")
    try:
        value = float(duration)
    except (TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 duration must be numeric.") from exc
    if value <= 0:
        raise ValueError("MiniMax H3 duration must be greater than zero.")
    return format(value, ".2f")


def alignment_line(mode, duration=None):
    mode = str(mode or "T2VA").strip().upper()
    if mode not in VALID_MODES:
        raise ValueError("Unsupported MiniMax H3 base mode: " + mode)
    if mode == "T2VA":
        return ""
    if mode == "I2VA":
        return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."

    duration_text = _duration_text(duration)
    if mode == "L2VA":
        return (
            "How the reference pictures align with the target video — <Picture 1> (from [Shot N]) "
            "aligns with the " + duration_text + "-second mark of the target video."
        )
    return (
        "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns "
        "with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the "
        + duration_text + "-second mark of the target video."
    )


def render_base_prompt(data, mode="T2VA", duration=None):
    if not isinstance(data, dict):
        raise ValueError("MiniMax H3 structured output must be an object.")

    integrated = _clean_field(data, "integrated_multimodal_description")
    soundscape = _clean_field(data, "overall_soundscape")
    music = _clean_field(data, "non_diegetic_music")

    if not integrated.startswith("[Shot 1]"):
        integrated = "[Shot 1] " + integrated

    core = (
        "integrated_multimodal_description: " + integrated
        + "\n\noverall_soundscape: " + soundscape
        + "\n\nnon_diegetic_music: " + music
    )
    preamble = alignment_line(mode, duration)
    return core if not preamble else preamble + "\n\n" + core


def final_shape(mode="T2VA", duration=None):
    sample = {
        "integrated_multimodal_description": "[Shot 1] ...",
        "overall_soundscape": "...",
        "non_diegetic_music": "...",
    }
    return render_base_prompt(sample, mode=mode, duration=duration)


def _shared_context_index(plan):
    shared = plan.get("sharedContext") if isinstance(plan, dict) and isinstance(plan.get("sharedContext"), dict) else {}
    index = {}
    for category in ("subjects", "wardrobes", "locations", "persistentFacts"):
        items = shared.get(category) if isinstance(shared.get(category), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            context_id = str(item.get("id") or "").strip()
            description = str(item.get("description") or "").strip()
            label = str(item.get("label") or context_id).strip()
            if context_id and description:
                index[context_id] = {
                    "category": category,
                    "label": label,
                    "description": description,
                }
    return index


def inject_shared_context_text(prompt_data, shared_context_text):
    if not isinstance(prompt_data, dict):
        raise ValueError("MiniMax H3 structured output must be an object.")
    copied = copy.deepcopy(prompt_data)
    integrated = _clean_field(copied, "integrated_multimodal_description")
    continuity_text = " ".join(
        line.strip()
        for line in str(shared_context_text or "").splitlines()
        if line.strip()
    )
    if not continuity_text:
        return copied

    prefix = "[Shot 1]"
    if integrated.startswith(prefix):
        remainder = integrated[len(prefix):].lstrip()
    else:
        remainder = integrated
    continuity = "Continuity anchors — " + continuity_text
    copied["integrated_multimodal_description"] = prefix + " " + continuity + (" " + remainder if remainder else "")
    return copied


def _inject_shared_context(prompt_data, refs, context_index):
    lines = []
    for context_id in refs or []:
        item = context_index.get(str(context_id or "").strip())
        if item is None:
            continue
        lines.append(item["label"] + ": " + item["description"])
    return inject_shared_context_text(prompt_data, "\n".join(lines))


def inject_shared_context_into_rendered_prompt(prompt, shared_context_text):
    text = str(prompt or "").strip()
    continuity_text = " ".join(
        line.strip()
        for line in str(shared_context_text or "").splitlines()
        if line.strip()
    )
    if not text or not continuity_text or "Continuity anchors —" in text:
        return text

    marker = "integrated_multimodal_description:"
    marker_index = text.find(marker)
    if marker_index < 0:
        return text
    shot_index = text.find("[Shot 1]", marker_index + len(marker))
    if shot_index < 0:
        return text
    insert_at = shot_index + len("[Shot 1]")
    return (
        text[:insert_at]
        + " Continuity anchors — "
        + continuity_text
        + text[insert_at:]
    )


def render_story_plan_prompts(plan):
    if not isinstance(plan, dict):
        raise ValueError("Storyboard Scene plan must be an object.")
    rendered = copy.deepcopy(plan)
    scenes = rendered.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("Storyboard Scene plan Scenes must be an array.")
    context_index = _shared_context_index(rendered)
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ValueError("Storyboard Scene plan Scene " + str(index) + " must be an object.")
        prompt_data = _inject_shared_context(
            scene.get("prompt"),
            scene.get("sharedContextRefs") if isinstance(scene.get("sharedContextRefs"), list) else [],
            context_index,
        )
        scene["prompt"] = render_base_prompt(
            prompt_data,
            mode="T2VA",
            duration=scene.get("suggestedDurationSeconds"),
        )
    return rendered
