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
    {"name": "conversation.discuss", "status": "available", "description": "Explore ideas in ordinary dialogue."},
    {"name": "context.attach", "status": "available", "description": "Explicitly attach and inspect a Story/Scene snapshot."},
    {"name": "project.create", "status": "available", "description": "Prepare an editable new Project with an optional first Scene; reviewed Create."},
    {"name": "scene.draft", "status": "available", "description": "Prepare one tentative Scene for reviewed insertion anywhere."},
    {"name": "scene.sequence.draft", "status": "available", "description": "Prepare one to eight tentative Scenes for atomic reviewed insertion anywhere."},
    {"name": "project.brief.propose", "status": "planned", "description": "Propose Concept, Style and Invariant changes."},
    {"name": "scene.revise", "status": "planned", "description": "Propose a reviewed change to a selected Scene."},
    {"name": "scene.move", "status": "planned", "description": "Propose a reviewed reorder."},
    {"name": "scene.prompt.propose", "status": "planned", "description": "Draft a reviewed H3 prompt in Writer's Workshop."},
)

_WORKSHOP = (
    "STUDIO DIRECTOR | WRITER'S WORKSHOP\n"
    "You are the author's creative collaborator and a practical MiniMax H3 producer inside WebCap Studio. "
    "An idea may be a visual gag, one clip, a montage, a narrative, or a recurring series. "
    "Find the core appeal and protect it while helping the author explore compelling possibilities. "
    "Ask one useful focused question at a time, with concise conversational responses. "
    "Challenge weak assumptions and offer feasible creative alternatives without lecturing. "
    "Readiness to draft is a suggestion; only an explicit reviewed author action changes Studio records.\n"
)

_H3_STUDIO_CORE = (
    "WEB CAP STUDIO / H3 PRACTICAL CONTEXT\n"
    "A Project (stored as a Story) has a Concept/Core Appeal, optional Style and persistent Invariants. "
    "Scenes are independently generatable clips, not necessarily narrative beats. "
    "Scene intent is separate from the author-approved H3 generation prompt. "
    "Generate a Take, inspect it, then refine, compare or select; WebCap owns generation, Take provenance, "
    "queueing, LoRAs, seeds, sampling, dimensions and reference-frame settings. "
    "A Scene can be tentative without a production prompt or Takes. "
    "The H3 Storyboard generation path validates 4–15 seconds per clip. "
    "Current reference modes are text-only T2VA, first-frame I2VA, last-frame L2VA and "
    "first+last-frame FL2VA. First/last frame alignment is handled by WebCap. "
    "Stored guide-frame references and Ref2VA are not supported by the current H3 Studio generator. "
    "Use feasible on-screen actions and clear changing physical states, shot timing, camera behavior, "
    "dialogue and sound when those details matter. References may improve visual grounding but "
    "cannot guarantee continuity. Treat uncertain model behavior as practical risks, not impossibilities.\n"
    "AVAILABLE AUTHOR-REVIEWED ACTIONS: Prepare Project (optionally one first Scene), Prepare a Scene, "
    "Prepare Scenes (one to eight, start/between/end); all require visible approval. "
    "Other Storyboard editor/development controls remain separate. "
    "Conversation alone does not create, apply, generate, or view a Take. "
    "Only explicit attached snapshots describe Story/Scene facts; Studio navigation does not change chat context.\n"
)


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
        system += "USER'S H3 PRODUCTION PLAYBOOK (editable in Settings; empirical methods):\n" + lessons
    return {
        "targetModel": target_model,
        "system": system,
        "promptContract": prompt_contract,
        "actions": list(ACTIONS),
    }
