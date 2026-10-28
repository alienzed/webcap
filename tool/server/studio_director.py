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
    {"name": "context.attach", "status": "available", "description": "Explicitly grant Story field access or inspect older snapshots."},
    {"name": "context.read", "status": "available", "description": "WebCap may privately retrieve a scoped current Story field after author grant; never a write."},
    {"name": "project.create", "status": "available", "description": "Prepare an editable new Project with an optional first Scene; reviewed Create."},
    {"name": "scene.draft", "status": "available", "description": "Prepare one tentative Scene for reviewed insertion anywhere."},
    {"name": "scene.sequence.draft", "status": "available", "description": "Prepare one to eight tentative Scenes for atomic reviewed insertion anywhere."},
    {"name": "project.brief.propose", "status": "available", "description": "Propose field-scoped Concept, Style and Invariant changes for reviewed Apply."},
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
    "Discuss only the detail relevant to the author's current question: dialogue stays dialogue, "
    "not a full Scene or prompt. Keep JSON, complete Scene sections and action receipts out of conversation "
    "unless the author explicitly asks to inspect them. An ordinary reply never creates, updates, "
    "reads or saves Story data; never announce 'Storyboard updated' or imply a mutation happened. "
    "A separate WebCap operation may prepare a reviewed proposal from the discussion. "
    "Readiness to draft is a suggestion; only an explicit reviewed author action changes Studio records.\\n"
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
    "AVAILABLE AUTHOR-REVIEWED ACTIONS: Review new Project (optional first Scene); "
    "review Concept / overview, Visual / atmosphere and Invariants for an explicitly selected Project; "
    "prepare a Scene or up to eight Scenes for reviewed insertion (start/between/end). "
    "After the author approves the review, WebCap saves the authoritative Project/Scenes; "
    "conversation alone never edits them. "
    "Other Storyboard editor/development controls remain separate. "
    "Conversation alone does not create, apply, generate, or view a Take. "
    "An explicit Story access grant permits scoped, on-demand reads, but supplies no Story facts until read. "
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
