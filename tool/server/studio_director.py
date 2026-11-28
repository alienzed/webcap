"""Studio Director response schema and guidance composition.

Creative role defaults are editable via the shared LLM Guidance catalog.
The technical H3 authoring reference is returned separately for Scene writing.
"""

from . import config as app_config


# User-visible capability catalog. These entries describe WebCap controls;
# they are not direct LLM tools or promises of automatic mutation.
ACTIONS = (
    {"name": "context.read", "status": "available",
     "description": "WebCap supplies only saved Project and Scene material explicitly approved in Context; answer directly, with no save."},
    {"name": "project.write", "status": "available",
     "description": "Create or revise the Project title, Concept, Visual / atmosphere and Invariants, preserving unrelated saved fields."},
    {"name": "scenes.write", "status": "available",
     "description": "Create one or more Scenes with complete H3 Prompts, or revise only requested Scene fields; title-only edits need no creative rewrite. WebCap binds and saves each target."},
)

from .studio_guidance_defaults import PROFILES, _PROFILE_IDS
from .llm_guidance import text_for as llm_guidance_text


def chat_response_schema():
    """Ordinary Studio chat is conversation, not an implicit Write request."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["reply"],
        "properties": {
            "reply": {"type": "string", "description": "Answer the author naturally."},
        },
    }

def chat_guidance(target_model="minimax_h3"):
    """Compose the single editable Studio Chat role with its shared H3 Rulebook."""
    if target_model != "minimax_h3":
        raise ValueError("Studio Writer's Workshop currently supports MiniMax H3.")
    try:
        system = llm_guidance_text("studio.chat").strip() + "\n\n" + llm_guidance_text("h3.authoring").strip()
    except OSError as exc:
        raise RuntimeError("Studio production prompt guidance is unavailable.") from exc
    return {"targetModel": target_model, "system": system, "promptContract": ""}


def guidance(target_model="minimax_h3", profile="classic", include_prompt_contract=True):
    """Compose the selected creative role and expertise, loading H3 format only for writing."""
    if target_model != "minimax_h3":
        raise ValueError("Studio Writer's Workshop currently supports MiniMax H3.")
    if profile not in _PROFILE_IDS:
        raise ValueError("Unknown Studio Director creative profile.")
    system = llm_guidance_text("studio." + profile) + "\n\n" + llm_guidance_text("h3.toolkit")
    prompt_contract = ""
    if include_prompt_contract:
        try:
            prompt_contract = llm_guidance_text("h3.authoring")
        except OSError as exc:
            raise RuntimeError("Studio production prompt guidance is unavailable.") from exc
        configured = app_config.config.get("generation_model_guidance", {})
        if not isinstance(configured, dict):
            raise RuntimeError("Generation model guidance must be an object.")
        lessons = str(configured.get(target_model) or "").strip()
        if lessons:
            prompt_contract += "\n\nUSER'S H3 PRODUCTION PLAYBOOK (empirical methods):\n" + lessons
    return {
        "targetModel": target_model,
        "profile": profile,
        "profiles": list(PROFILES),
        "system": system,
        "promptContract": prompt_contract,
        "actions": list(ACTIONS),
    }


def read_story_scope(story, field, scene_id=""):
    """Read one authoritative, bounded field group for an explicitly granted Story.

    No prompt assembly here: the caller decides if the retrieved data should be
    supplied privately to a specific model request. This never changes the Story.
    """
    if not isinstance(story, dict) or not story.get("id"):
        raise ValueError("Studio Story data is unavailable.")
    if field == "brief":
        data = {key: story.get(key) for key in ("title", "concept", "style", "invariants")}
    elif field == "index":
        data = [
            {"id": sid, "position": position, "title": story["scenes"][sid].get("title", "")}
            for position, sid in enumerate(story.get("sceneOrder", []), 1)
        ]
    elif field in {"scene", "prompt", "takes"}:
        if not scene_id or scene_id not in story.get("sceneOrder", []) or scene_id not in story.get("scenes", {}):
            raise ValueError("Select an existing Scene in the granted Story.")
        scene = story["scenes"][scene_id]
        if field == "scene":
            data = {key: scene.get(key) for key in ("id", "title", "prompt", "durationSeconds", "notes")}
        elif field == "prompt":
            data = {"id": scene_id, "prompt": scene.get("prompt", ""), "durationSeconds": scene.get("durationSeconds")}
        else:
            data = {"id": scene_id, "takeIds": list(scene.get("takeOrder") or [])}
    else:
        raise ValueError("Unsupported Studio Story read scope.")
    return data
