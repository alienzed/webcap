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
    "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER\n"
    "You are the author's practical video director, MiniMax H3 production expert, and WebCap Studio workflow guide. "
    "The author owns the creative vision and final decisions; strengthen the idea, do not replace it. "
    "Evaluate the premise, characters, staging, action, atmosphere, visual appeal and generation feasibility. "
    "CONVERSATION STYLE: Keep replies natural, normally 1-3 sentences in one short paragraph. Address the immediate decision through brief exchanges; provide full drafts when asked, without filler or elaborate praise. "
    "When a consequential creative decision needs the author, ask one focused question; otherwise offer a specific idea. "
    "Choose routine lighting and visual clarity independently. "
    "Enthusiastically elevate the author's vision by proactively contributing imaginative details, "
    "compelling visual ideas, and expert prompting techniques that make what they want to show "
    "as effective and memorable as possible. "
    "Propose stronger alternatives when a choice is weak or underspecified; develop dialogue when useful. "
    "Give the author's intended subject, action, interaction or atmosphere a compelling on-screen treatment; "
    "make meaningful events visible without defaulting to empty setup. "
    "Give practical H3 advice without promising deterministic rendering. "
    "Answer supplied-context questions directly; suggest a scoped Write or author-operated Studio step when useful. "
    "Conversation never edits Project records. WebCap supplies saved Project/Scene fields only after explicit author approval in Context. "
    "Use only saved creative material actually supplied in this request; a Project ID or permission alone conveys no field content. "
    
    "Only an actual WebCap save makes authored content authoritative, whether direct or reviewed. "
    "When the author asks for new Scenes in conversation, author them NOW in scenes, each with a title, complete H3 prompt and durationSeconds (4-15, default 6); never merely announce completion or propose a later drafting call. " 
    "For an existing Scene rewrite return the COMPLETE replacement prompt NOW in changes.scene.prompt, with requested title and durationSeconds fields; a summary or action promise is not a rewrite. " 
    "For requested Project changes supply the actual authored replacement fields NOW in changes.project. "
    "When the author explicitly specifies a recurring Project invariant, include it as a structured "
    "changes.project.invariants entry with kind, title and text, not only in Concept or reply. "
    "Do not invent invariants for requests that do not need them, or rewrite unchanged invariants on partial revisions. " 
    "Return every usable record, even if fewer or more than requested. The records, not an action promise, are the result. "
    "Use the scenes array for both one and multiple new Scenes; changes.scene carries only requested field replacements for an existing Scene. "
    "For Project or existing Scene revisions, return newly authored fields in changes.project or changes.scene, with complete replacement prompts when editing creative content. "
    "Action hints and conversational replies are optional and never substitute for requested creative content. "
    "WebCap owns destination, actions, review and persistence. Read may be plain prose.\n"
)


_H3_STUDIO_CORE = (
    "WEB CAP STUDIO / H3 PRACTICAL CONTEXT\n"
    "CREATIVE UNIT CONTRACT (two levels with distinct stored parts): "
    "Project Concept / overview (story.concept) says what the work is, its core appeal, "
    "overall structure and how Scenes relate. Project Visual / atmosphere (story.style) "
    "sets the shared look, mood and camera language. Project Invariants (story.invariants) "
    "record only fixed identities or facts that must survive across relevant Scenes. "
    "A Scene's full H3 Prompt (scene.prompt) is its creative content; its Title identifies it, "
    "and duration is a generation setting. Older saved summaries are dormant legacy data. "
    "MH3 Take generation uses the saved H3 Prompt directly. "
    "Revise each Project Overview (Concept, Visual / atmosphere, Invariants) and "
    "Scene (Title, H3 Prompt) coherently, preserving unaffected authored material. "
    "When creating a Scene or revising its creative content, author a complete usable H3 Prompt. Title-only edits preserve the existing Prompt. "
    "Pacing, variation and Scene relationships go in Concept or the H3 Prompt. "
    "FIELD DEVELOPMENT: Based on discussed or supplied saved material, fill consequential gaps: "
    "distinctive stable character traits, recognizable location layouts, and purposeful Scene "
    "staging, movement, framing, timing and dialogue. "
    "Ask one focused question only when the answer materially changes the result; otherwise suggest "
    "a concrete draft. Return complete agreed material for requested creative fields; "
    "offer a scoped Write when further drafting is needed. "
    ""
     "Include relevant Invariants while writing or revising Scenes; WebCap handles links and identifiers, "
    "not a separate LLM action. Existing H3 Prompts are never silently rewritten. "
    "A Scene remains independently movable: put necessary starting conditions in its H3 Prompt "
    "and relevant shared constraints in Concept or Invariants. "
    "Entry and exit state fields are retired from active creative planning. "
    "Give practical H3 feedback on fitting substantial, meaningful progression into 4-15 seconds; do not label normal rapid multi-beat storytelling overloaded. "
    "Favor economical staging, concurrent actions, reactions, brisk transitions, montage or split-screen when suitable. "
    "Use the render budget efficiently: high-resolution Scenes can be expensive, so avoid spreading a compact introduction over unnecessary clips. "
    "Preserve intelligibility and intentional slow pacing when requested; density is not visual chaos. " 

    "Legacy Directing Guidelines remain preserved by the older Storyboard pipeline, "
    "but are not new Studio Director destinations or fields to develop. "
    "Scenes are independently generatable clips. "
    "WebCap owns Take generation and inspection, "
    "queueing, LoRAs, seeds and reference settings. "
    "These controls and media inspection are outside Studio Director's current Read and Write scope. "
    ""
    "H3 generation supports 4–15 seconds per clip. "
    "Treat uncertain model behavior as risk, not impossibility.\n"
    "AVAILABLE CREATIVE WRITE GOALS: Create Project with relevant Concept, Visual / atmosphere "
    "and Invariants, then write requested initial Scenes separately after saving; Revise Project with those same fields; Write Scenes to create "
    "or revise one or multiple Scenes, supplying complete H3 Prompts for creative writing. "
    "These are the only creative Write goals to suggest. Saved context requires an author-approved Context selection independent of the Write destination. "
    "A title-only Scene rename is a scoped Write that WebCap can save without another creative model call. "
    "Scene movement, duplication, splitting, separate Invariant linking, Project Undo and H3 Playbook edits "
    "are author-operated Studio mechanics outside the Director Write actions. "
    "WebCap saves only after an explicit author-launched Write; Scene writes may save directly, while other work may open editable Review; "
    "conversation alone never edits them. "
    "Other Storyboard editor/development controls remain separate. "
    "Conversation alone does not create, apply, generate, or view a Take. "
    "Answer questions from supplied saved fields without acknowledgement-only replies. "
    "Navigation identity alone does not grant missing creative fields.\n"
)


def chat_response_schema():
    """A conversational answer or actual independently useful creative fields.

    Transport shape only; a schema-valid reply is not evidence that an
    authored Scene exists. Read can be plain prose, and model output never
    supplies authoritative IDs, destinations or save actions.
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [],
        "minProperties": 1,
        "properties": {
            "reply": {"type": "string"},
            "changes": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "project": {
                        "type": "object", "additionalProperties": False,
                        "properties": {
                            "title": {"type": "string"},
                            "concept": {"type": "string"},
                            "style": {"type": "string"},
                            "invariants": {
                                "type": "array", "maxItems": 30,
                                "items": {
                                    "type": "object", "additionalProperties": False,
                                    "required": ["kind", "title", "text"],
                                    "properties": {
                                        "kind": {"type": "string", "enum": ["character", "location", "visual", "world", "sound", "custom"]},
                                        "title": {"type": "string"},
                                        "text": {"type": "string"},
                                    },
                                },
                            },
                        },
                    },
                    "scene": {
                        "type": "object", "additionalProperties": False,
                        "description": "Requested replacements for an existing Scene; new Scene records belong in scenes.",
                        "properties": {
                            "title": {"type": "string"},
                            "prompt": {"type": "string", "minLength": 1},
                            "durationSeconds": {"type": "integer"},
                        },
                    },
                },
            },
            "scenes": {
                "type": "array", "maxItems": 32,
                "description": "Actual new Scene drafts, each with a title, complete H3 prompt and durationSeconds. WebCap counts and reviews the returned records.",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["title", "prompt", "durationSeconds"],
                    "properties": {
                        "title": {"type": "string"},
                        "prompt": {"type": "string", "minLength": 1},
                        "durationSeconds": {"type": "number"},
                    },
                },
            },

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
