"""Studio Director's implicit production knowledge (not creative Story context).

This guidance is loaded only when the user explicitly opens Studio Director.
Do not mix selected *language* model identifiers with the *generation* model
whose limitations and prompt structure guide the production conversation.
"""

from pathlib import Path

from . import config as app_config


_DOCS = Path(__file__).resolve().parents[2] / "docs"
_H3_RUNTIME = _DOCS / "mmh3-prompt-runtime-context.txt"

# Human-visible, text-based capability catalog. No implied mutation API:
# exposing a function here must not make the LLM believe it has executed it.
ACTIONS = (
    {"name": "conversation.discuss", "status": "available", "description": "Discuss and challenge an idea; one question at a time."},
    {"name": "context.attach", "status": "available", "description": "Author explicitly attaches an inspectable Story or Scene snapshot."},
    {"name": "project.brief.propose", "status": "planned", "description": "Extract Concept, Style and Invariants for human-reviewed Apply."},
    {"name": "scene.draft", "status": "planned", "description": "Draft a tentative Scene at an author-selected placement."},
    {"name": "scene.revise", "status": "planned", "description": "Propose an explicit, reviewable Scene revision."},
    {"name": "scene.move", "status": "planned", "description": "Reorder Scenes using stable IDs and author approval."},
    {"name": "scene.prompt.propose", "status": "planned", "description": "Draft a model-ready prompt from a reviewed Scene intent."},
)


def guidance(target_model="minimax_h3"):
    """Return server-owned technical guidance, never a Story attachment."""
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
    system = (
        "STUDIO DIRECTOR | WRITER'S WORKSHOP\n"
        "You are a creative collaborator and a practical producer for one person making AI-generated videos. "
        "An idea may be a visual, a gag, a montage, a continuing narrative, or one episode of a series.\n"
        "Help the author discover the core appeal: what makes the idea interesting, funny, "
        "compelling or worth watching. You may riff on the author's script and offer inventive alternatives. "
        "Ask exactly one useful focused question at a time. Keep replies conversational and concise.\n"
        "Creativity comes first. When considering production, suggest the simplest renderable "
        "expression of the idea. A narrative beat does not necessarily need its own Scene. "
        "Do not assume a fixed number of Scenes, an ending, or even a title. "
        "A Scene is a single generatable clip; existing WebCap duration constraints apply. "
        "Treat practical failure modes as risks rather than guaranteed impossibilities.\n"
        "You may recognize when an idea is ready to draft, but propose the next step rather than "
        "claiming you have created or edited Studio records. No Studio changes are made by conversation alone. "
        "Only the author's explicit actions and WebCap's validated functions can change saved work.\n"
        "When given explicit Story or Scene reference text, preserve its meaning. "
        "Unattached Stories and changes in app navigation provide no creative context.\n"
        "TECHNICAL H3 PRODUCTION PROMPT CONTRACT (for production discussions, not a requirement "
        "to write a prompt during brainstorming):\n" + prompt_contract
    )
    if lessons:
        system += "\nUSER'S H3 PRODUCTION PLAYBOOK (editable in Settings):\n" + lessons
    return {"targetModel": target_model, "system": system, "actions": list(ACTIONS)}
