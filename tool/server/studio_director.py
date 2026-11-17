"""Concise, built-in WebCap Studio expertise for the H3 Writer's Workshop.

The production-prompt shape is returned separately for prompt-authoring tasks,
rather than spent on every open-ended brainstorm request.
"""

from pathlib import Path

from . import config as app_config


_H3_RUNTIME = Path(__file__).resolve().parents[2] / "docs" / "mmh3-prompt-runtime-context.txt"

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

_WORKSHOP = (
    "STUDIO DIRECTOR | CREATIVE PARTNER\n"
    "You are an imaginative, capable creative director collaborating with the author on "
    "short generative-video Projects and Scenes. Understand and elevate the author's "
    "vision with meaningful ideas, sound creative judgment and compelling, coherent, "
    "producible results. The author sets the direction; develop it rather than replacing it. "
    "Bring expertise in storytelling, character, staging, camera, atmosphere, dialogue, "
    "pacing and MiniMax H3 generation. Make meaningful actions visible, maintain clear "
    "physical continuity, and respect deliberately quiet or atmospheric pacing. "
    "CONVERSATION: Respond naturally and concisely to discussion. Explore alternatives "
    "when useful and make a recommendation when you can. "
    "DISCUSSION: Develop ideas and make useful recommendations. Explicit Write functions "
    "are separately launched by the author with their own task and format. "
    "Use the saved Project and Scene facts actually supplied as context; treat earlier "
    "unsaved ideas as proposals that the author may refine. "
    "Conversation can develop material, but only WebCap saves Project and Scene records.\n"
)


_H3_STUDIO_CORE = (
    "STUDIO CREATIVE MATERIAL\n"
    "A Project's Title identifies the work. Concept (story.concept) defines its premise, "
    "core appeal and Scene relationships. Visual / atmosphere (story.style) establishes "
    "shared mood, look and camera language. Invariants (story.invariants) record recurring "
    "character, location or other continuity facts that should remain stable. "
    "A Scene's Title identifies the clip, and its complete H3 Prompt (scene.prompt) "
    "is the generatable creative content. Scenes are independently producible clips "
    "lasting 4–15 seconds; durationSeconds is the saved duration setting. "
    "Develop requested Project fields into complete, useful field values, adding "
    "Invariants when stable recurring facts matter. "
    "For Scene creation or creative revision, provide a complete standalone H3 Prompt "
    "with clear starting conditions, visual actions, staging, timing and sound. "
    "Revise the existing prompt rather than merely describing a change. "
    "Keep unaffected titles, durations, creative decisions and continuity intact. "
    "When several pieces are requested, deliver all the useful pieces you can. "
    "For H3 writing, use the production reference supplied with that task. "
    "Actual authored material can be offered for review or application by WebCap; "
    "discussion and draft creation never imply a saved change.\n"
)


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

def guidance(target_model="minimax_h3"):
    """Return concise Studio expertise plus the distinct prompt-authoring contract."""
    if target_model != "minimax_h3":
        raise ValueError("Studio Writer's Workshop currently supports MiniMax H3.")
    try:
        prompt_contract = _H3_RUNTIME.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Studio production prompt guidance is unavailable.") from exc
    configured = app_config.config.get("generation_model_guidance", {})
    if not isinstance(configured, dict):
        raise RuntimeError("Generation model guidance must be an object.")
    lessons = str(configured.get(target_model) or "").strip()
    system = _WORKSHOP + _H3_STUDIO_CORE
    if lessons:
        prompt_contract += "\n\nUSER'S H3 PRODUCTION PLAYBOOK (empirical methods):\n" + lessons
    return {
        "targetModel": target_model,
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
            data = {key: scene.get(key) for key in ("id", "title", "prompt", "entryState", "exitState", "notes")}
        elif field == "prompt":
            data = {"id": scene_id, "prompt": scene.get("prompt", ""), "durationSeconds": scene.get("durationSeconds")}
        else:
            data = {"id": scene_id, "takeIds": list(scene.get("takeOrder") or [])}
    else:
        raise ValueError("Unsupported Studio Story read scope.")
    return data
