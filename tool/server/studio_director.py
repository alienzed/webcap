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
     "description": "Draft a reviewed Project with zero to twelve initial tentative Scenes."},
    {"name": "project.brief.propose", "status": "available",
     "description": "Propose reviewed Concept, Visual / atmosphere and Invariant changes."},
    {"name": "scene.draft", "status": "available",
     "description": "Propose one tentative Scene for reviewed insertion."},
    {"name": "scene.sequence.draft", "status": "available",
     "description": "Propose up to eight tentative Scenes for reviewed insertion."},
    {"name": "scene.revise", "status": "available",
     "description": "Propose and review scoped edits to an existing Scene Title, Intent or H3 Prompt."},
    {"name": "scene.move", "status": "planned",
     "description": "Reorder Scenes with Director assistance; existing Studio manual editing remains available."},
)


_WORKSHOP = (
    "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER\\n"
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
    "Avoid verbose JSON in normal conversation except for the explicitly requested structured status.\\n"
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
    "Existing Directing Guidelines are legacy authored context: preserve populated values "
    "and honor them until separately reviewed, without creating new guideline fields. "
    "Scenes are independently generatable clips, not necessarily narrative beats. "
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
    "AVAILABLE AUTHOR-REVIEWED ACTIONS: Review new Project with multiple initial Scenes; "
    "review Concept / overview, Visual / atmosphere and Invariants for an explicitly selected Project; "
    "Prepare a Scene or Prepare Scenes (up to eight) for reviewed insertion (start/between/end); " +
    "propose reviewed existing Scene Title, Intent or H3 Prompt revisions. "
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
