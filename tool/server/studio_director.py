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
    {"name": "conversation.discuss", "status": "available",
     "description": "Develop the author's creative vision with practical production judgment."},
    {"name": "context.read", "status": "available",
     "description": "Author chooses specific saved Project and Scene fields through Read; model acknowledges actual values received."},
    {"name": "project.create", "status": "available",
     "description": "Draft a reviewed Project with zero to 32 initial tentative Scenes."},
    {"name": "project.brief.propose", "status": "available",
     "description": "Propose reviewed Concept, Visual / atmosphere and Invariant changes."},
    {"name": "scene.draft", "status": "available",
     "description": "Propose one tentative Scene for reviewed insertion."},
    {"name": "scene.sequence.draft", "status": "available",
     "description": "Propose up to 32 tentative Scenes for reviewed insertion."},
    {"name": "scene.revise", "status": "available",
     "description": "Propose and review scoped edits to an existing Scene Title, Intent or H3 Prompt."},
    {"name": "playbook.propose", "status": "available",
     "description": "Propose an editable replacement for existing H3 Playbook guidance; author reviews and applies."},
    {"name": "creative.capture.review", "status": "available",
     "description": "Offer a complete developed Project field, named Invariant, or Scene Intent for editable review without repeating the LLM draft; WebCap selects and validates the saved target."},
    {"name": "scene.batch.revise", "status": "available",
     "description": "Author and review selected text fields across multiple existing Scenes, applied atomically."},
    {"name": "scene.move", "status": "available",
     "description": "Author reviews exact Scene order changes; WebCap moves Scenes deterministically without a model request."},
    {"name": "scene.duplicate", "status": "available",
     "description": "WebCap duplicates a reviewed Scene setup without copying Takes or deleting anything."},
    {"name": "scene.invariants", "status": "available",
     "description": "Review the Character or Location Invariants used by selected Scenes, with exact links saved atomically and no changes to creative prose."},
    {"name": "scene.split", "status": "available",
     "description": "Author and review two distinct Scene Intents; WebCap atomically updates the first and inserts a tentative second."},
)


_WORKSHOP = (
    "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER\n"
    "You are the author's practical video director and MiniMax H3 production expert. "
    "The author owns the creative vision and final decisions; strengthen the idea, do not replace it. "
    "Evaluate the premise, visual event, recognizable characters, setting, props, action, dialogue, "
    "appearance, staging, atmosphere, structure, repetition and generation feasibility as relevant. "
    "Develop the material thoroughly; keep each conversational reply concise and purposeful. "
    "Ask one focused question when a consequential creative decision is missing. "
    "Handle routine production choices such as appropriate lighting and visual clarity independently. "
    "Offer an alternate concept only if the author's approach has a material weakness; "
    "otherwise improve the chosen direction. Give original dialogue first drafts rather than repeating examples. "
    "Each video Scene should deliver its worthwhile event, rather than default to an empty establishing shot. "
    "Make practical, qualified H3 recommendations without promising deterministic rendering. "
    "Readiness is your advisory assessment, not a WebCap permission gate. "
    "Read and Write are explicit author-driven operations. Conversation never edits Project records. "
    "Acknowledge only the exact saved fields actually supplied with an explicit Read; "
    "a Project ID or permission alone conveys no creative field content. "
    "After a reviewed Apply, the author's edited saved content is authoritative. "
    "Avoid verbose JSON in normal conversation except for the explicitly requested structured status.\n"
)


_H3_STUDIO_CORE = (
    "WEB CAP STUDIO / H3 PRACTICAL CONTEXT\n"
    "CREATIVE FIELD CONTRACT (five authored fields, two levels): "
    "Project Concept / overview (story.concept) says what the work is, its core appeal, "
    "overall structure and how Scenes relate. Project Visual / atmosphere (story.style) "
    "sets the shared look, mood and camera language. Project Invariants (story.invariants) "
    "record only fixed identities or facts that must survive across relevant Scenes. "
    "Scene Intent (scene.summary) describes this clip's purpose, observable action, "
    "and any scene-specific beats; it can be brief and is not a video prompt. "
    "H3 Prompt (scene.prompt) is the separate, complete generation instruction derived "
    "from agreed Intent and relevant Project context, then reviewed and editable. "
    "MH3 Take generation uses the saved H3 Prompt, not the Intent directly. "
    "Keep changes at the narrowest existing level; don't repeat one detail in all five fields. "
    "Pacing, variation and Scene relationships go in Concept or the relevant Scene Intent. "
    "FIELD DEVELOPMENT: When material has been explicitly discussed or Read, notice consequential gaps and "
    "offer a specific next step. For recurring characters, develop distinguishing visible traits and "
    "stable appearance; for locations, defining layout and recognizable features; for Scenes, clarify "
    "the on-screen event, causality, staging, timing and dialogue where useful. "
    "Tell the author which of the five creative fields should hold a decision and why. "
    "Ask one focused question only when the answer materially changes the result; otherwise suggest "
    "a concrete editable draft. Offer reviewed Write after a decision becomes clear. "
    "Assess the available material, not unread or imagined saved fields. Distinguish genuinely missing "
    "facts from intentionally flexible creative choices. "
    "A Scene remains independently movable: put any necessary starting condition or handoff in its Intent "
    "and relevant shared constraints in Concept or Invariants. "
    "Entry and exit state fields are retired from active creative planning. "
    "Give practical H3 feedback on whether the action fits 4-15 seconds, using achievable actions and "
    "clear physical transitions. "

    "Legacy Directing Guidelines remain preserved by the older Storyboard pipeline, "
    "but are not new Studio Director destinations or fields to develop. "
    "Scenes are independently generatable clips, not necessarily narrative beats. "
    "Generate a Take, inspect it, then refine, compare or select; WebCap owns generation, Take provenance, "
    "queueing, LoRAs, seeds, sampling, dimensions and reference-frame settings. "
    "These controls and media inspection are outside Studio Director's current Read and Write scope. "
    "A Scene can be tentative without a production prompt or Takes. "
    "The H3 Storyboard generation path validates 4–15 seconds per clip. "
    "Use feasible on-screen actions and clear changing physical states, shot timing, camera behavior, "
    "dialogue and sound when those details matter. Treat uncertain model behavior as practical risks, not impossibilities.\n"
    "AVAILABLE AUTHOR-REVIEWED ACTIONS: Review new Project with multiple initial Scenes; "
    "review Concept / overview, Visual / atmosphere and Invariants for an explicitly selected Project; "
    "Prepare a Scene or Prepare Scenes (up to 32) for reviewed insertion (start/between/end); " +
    "offer already-developed creative material for direct editable review; " +
    "propose reviewed existing Scene Title, Intent or H3 Prompt revisions, including a selected multi-Scene revision; " +
    "move or duplicate Scenes deterministically; propose a reviewed two-Intent Scene split. "
    "After the author approves the review, WebCap saves the authoritative Project/Scenes; "
    "conversation alone never edits them. "
    "Other Storyboard editor/development controls remain separate. "
    "Conversation alone does not create, apply, generate, or view a Take. "
    "Read supplies only the author-selected saved fields and requires explicit acknowledgement by Director. "
    "Old snapshots remain historical references; Studio navigation never changes conversation context.\n"
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
            {"id": sid, "position": position, "title": story["scenes"][sid].get("title", ""),
             "summary": story["scenes"][sid].get("summary", "")}
            for position, sid in enumerate(story.get("sceneOrder", []), 1)
        ]
    elif field in {"scene", "prompt", "takes"}:
        if not scene_id or scene_id not in story.get("sceneOrder", []) or scene_id not in story.get("scenes", {}):
            raise ValueError("Select an existing Scene in the granted Story.")
        scene = story["scenes"][scene_id]
        if field == "scene":
            data = {key: scene.get(key) for key in ("id", "title", "summary", "entryState", "exitState", "notes")}
        elif field == "prompt":
            data = {"id": scene_id, "prompt": scene.get("prompt", ""), "durationSeconds": scene.get("durationSeconds")}
        else:
            data = {"id": scene_id, "takeIds": list(scene.get("takeOrder") or [])}
    else:
        raise ValueError("Unsupported Studio Story read scope.")
    import json
    if len(json.dumps(data, ensure_ascii=False)) > 32000:
        raise ValueError("Story field selection is too large. Select a narrower field or Scene.")
    return data
