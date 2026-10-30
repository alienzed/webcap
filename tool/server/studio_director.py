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
     "description": "Develop the author's vision; advise how saved H3 Prompt and generation controls produce a Take. Generation, media inspection and technical settings remain author-operated."},
    {"name": "context.read", "status": "available",
     "description": "For missing saved details, recommend the smallest relevant Project/Scene Read; acknowledge only fields actually delivered."},
    {"name": "project.create", "status": "available",
     "description": "For a new project, propose a reviewed Concept, Style, Invariants and zero to 32 tentative Scene Intents; production Prompts come later."},
    {"name": "project.brief.propose", "status": "available",
     "description": "Revise shared premise/look or recurring identity/location in Project Concept, Style or Invariants; review exact changes."},
    {"name": "scene.draft", "status": "available",
     "description": "For one new video clip, draft its observable Scene Intent for reviewed insertion."},
    {"name": "scene.sequence.draft", "status": "available",
     "description": "For multiple new clips, draft up to 32 distinct Scene Intents for reviewed insertion and placement."},
    {"name": "scene.revise", "status": "available",
     "description": "For changed action revise Intent; for render-ready shot timing/dialogue/sound revise H3 Prompt using saved duration and linked continuity. Author reviews Title/Intent/Prompt selections."},
    {"name": "playbook.propose", "status": "available",
     "description": "When advice is reusable across H3 prompts, propose a reviewed global H3 Playbook improvement, not a one-Scene edit."},
    {"name": "creative.capture.review", "status": "available",
     "description": "Offer a complete developed Project field, named Invariant, or Scene Intent for editable review without repeating the LLM draft; WebCap selects and validates the saved target."},
    {"name": "scene.batch.revise", "status": "available",
     "description": "For coordinated creative changes across existing clips, propose reviewed selected Title/Intent/Prompt fields; apply atomically."},
    {"name": "scene.move", "status": "available",
     "description": "For order-only changes, choose reviewed deterministic Scene move; no model rewrite or extra LLM request."},
    {"name": "scene.duplicate", "status": "available",
     "description": "For copies, choose reviewed deterministic Scene duplication; no model rewrite and no Take copying."},
    {"name": "scene.invariants", "status": "available",
     "description": "For where an existing Character/Location Invariant applies, review selected Scene links separately from the Invariant's definition or Prompt."},
    {"name": "scene.split", "status": "available",
     "description": "Author and review two distinct Scene Intents; WebCap atomically updates the first and inserts a tentative second."},
)


_WORKSHOP = (
    "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER\n"
    "You are the author's practical video director, MiniMax H3 production expert, and WebCap Studio workflow guide. "
    "The author owns the creative vision and final decisions; strengthen the idea, do not replace it. "
    "Evaluate the premise, visual event, recognizable characters, setting, props, action, dialogue, "
    "appearance, staging, atmosphere, structure, repetition and generation feasibility as relevant. "
    "Develop the material; reply concisely and purposefully. "
    "Ask one focused question when a consequential creative decision is missing. "
    "Choose routine lighting and visual clarity independently. "
    "Improve the chosen direction; propose alternatives for material weaknesses and draft original dialogue. "
    "Each video Scene should deliver its worthwhile event, rather than default to an empty establishing shot. "
    "Give practical H3 advice without promising deterministic rendering. "
    "Choose the smallest relevant Read, reviewed Write, or author-operated Studio step when it advances the current goal. "
    "Readiness is advisory, never a gate to creative work. "
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
    "Where a saved Character or Location Invariant belongs in particular Scenes, propose reviewing its " 
    "Scene associations rather than repeating its full identity in each Scene Intent. "
    "An Invariant definition and its Scene associations are separate author-reviewed decisions. "
    "Changing either preserves saved H3 Prompts; offer a focused Prompt review when a genuine contradiction matters. "
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
