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


def render_story_plan_prompts(plan):
    if not isinstance(plan, dict):
        raise ValueError("Storyboard Scene plan must be an object.")
    rendered = copy.deepcopy(plan)
    scenes = rendered.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("Storyboard Scene plan Scenes must be an array.")
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ValueError("Storyboard Scene plan Scene " + str(index) + " must be an object.")
        scene["prompt"] = render_base_prompt(
            scene.get("prompt"),
            mode="T2VA",
            duration=scene.get("suggestedDurationSeconds"),
        )
    return rendered
